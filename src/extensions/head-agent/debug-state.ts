/**
 * Debug state machine — state management, memory system, phase prompt building.
 * Scopes and paths are derived from the team configuration in constants.ts.
 */
import * as os from "node:os";
import * as path from "node:path";
import type { AutonomousDebugState, DebugPhase } from "./types.js";
import {
  DEBUG_SCOPES, DEFAULT_MAX_FIXES_PER_CYCLE, DEFAULT_MAX_CONSECUTIVE_ERRORS,
  DEFAULT_OBJECTIVE_REVIEW_CYCLE, DEFAULT_SLEEP_BETWEEN_CYCLES, DEFAULT_CONTEXT_BUDGET,
  TEAM_ORDER,
} from "./constants.js";
import { ad, rj, wj, readFileToString, rjSync, debugStatePath, generateId } from "./helpers.js";

export const loadDebugState = async (cwd: string): Promise<AutonomousDebugState | null> => {
    return await rj<AutonomousDebugState>(debugStatePath(cwd));
  };
export const saveDebugState = async (cwd: string, state: AutonomousDebugState) => wj(debugStatePath(cwd), state);

/** Sync loader for dashboard rendering (called from sync widget render) */
export const loadDebugStateSync = (cwd: string): AutonomousDebugState | null => rjSync<AutonomousDebugState>(debugStatePath(cwd));

// ─── Load / Save ────────────────────────────────────────



// ─── Scope Helpers ──────────────────────────────────────

export function getDebugScope(index: number, scopeFilter: string): string {
  if (scopeFilter !== "all") return scopeFilter;
  return DEBUG_SCOPES[index % DEBUG_SCOPES.length];
}

export function getScopeDir(scope: string): string {
  // Generic: return scope name as-is for display
  return scope + "/";
}

// ─── Create Initial State ───────────────────────────────

export function createInitialDebugState(opts?: {
  maxCycles?: number; maxCost?: number; maxRuntimeMs?: number;
  sleepBetweenCycles?: number; scopeFilter?: string;
}): AutonomousDebugState {
  return {
    id: generateId(),
    status: "initializing",
    startedAt: new Date().toISOString(),
    lastPhaseAt: new Date().toISOString(),
    totalCycles: 0,
    totalRuntime: 0,
    objectives: [],
    currentObjectiveId: null,
    objectiveReviewCycle: DEFAULT_OBJECTIVE_REVIEW_CYCLE,
    lastObjectiveReviewAt: null,
    recentMemory: [],
    compressedSummary: null,
    knownFindings: {},
    scopeIndex: 0,
    scopeHistory: {},
    fixQueue: [],
    fixesThisCycle: 0,
    maxFixesPerCycle: DEFAULT_MAX_FIXES_PER_CYCLE,
    lastTestRun: null,
    testFailures: [],
    consecutiveErrors: 0,
    maxConsecutiveErrors: DEFAULT_MAX_CONSECUTIVE_ERRORS,
    backoffUntil: null,
    deadLoopFindings: [],
    maxCycles: opts?.maxCycles ?? 0,
    maxCost: opts?.maxCost ?? 0,
    maxRuntimeMs: opts?.maxRuntimeMs ?? 0,
    sleepBetweenCycles: opts?.sleepBetweenCycles ?? DEFAULT_SLEEP_BETWEEN_CYCLES,
    totalCost: 0,
    contextBudget: { ...DEFAULT_CONTEXT_BUDGET },
    scopeFilter: opts?.scopeFilter ?? "all",
    errors: [],
  };
}

// ─── Three-Level Memory System ──────────────────────────

export async function loadL1Context(_cwd: string, budget: number): Promise<string> {
  try {
    const briefingPath = path.join(os.homedir(), ".pi/Brain/wiki/briefing.md");
    const briefing = await readFileToString(briefingPath);
    if (!briefing) return "";
    const lines = briefing.split("\n").filter((l: string) => l.trim());
    const result = lines.slice(0, 40).join("\n").replace(/^#+\s*/gm, "").trim();
    return result.slice(0, budget);
  } catch (e) { process.stderr.write("[head-agent] loadL1Context: " + (e instanceof Error ? e.message : String(e)) + "\n"); return ""; }
}

export async function loadL2Context(cwd: string, teams: string[], budget: number): Promise<string> {
  const parts: string[] = [];
  let totalLen = 0;
  const perTeam = Math.floor(budget / Math.max(teams.length, 1));
  for (const team of teams) {
    if (totalLen >= budget) break;
    const mem = await readFileToString(path.join(ad(cwd), "agent-memory", team + ".md"));
    if (mem) {
      const snippet = mem.slice(0, perTeam);
      parts.push("[" + team + "] " + snippet);
      totalLen += snippet.length;
    }
  }
  return parts.join("\n").slice(0, budget);
}

export function loadL3Context(state: AutonomousDebugState, budget: { entries: number; summary: number }): string {
  const parts: string[] = [];
  if (state.compressedSummary) {
    parts.push("## Compressed History\n" + state.compressedSummary.slice(0, budget.summary));
  }
  const recent = state.recentMemory.slice(-budget.entries);
  if (recent.length > 0) {
    const memLines = recent.map(e =>
      `[${e.phase}] ${e.summary} (${e.findings}f/${e.fixes}x/${e.tests}t/${e.errors}e $${e.cost.toFixed(2)})`
    );
    parts.push("## Recent Cycles\n" + memLines.join("\n"));
  }
  return parts.join("\n");
}

export function compressMemory(state: AutonomousDebugState): void {
  if (state.recentMemory.length <= 50) return;
  const toCompress = state.recentMemory.slice(0, state.recentMemory.length - 10);
  const summary = toCompress.map(e =>
    `[${e.phase}] ${e.summary} (${e.findings}f/${e.fixes}x/${e.tests}t)`
  ).join("; ");
  state.compressedSummary = (state.compressedSummary || "") + " | " + summary;
  state.compressedSummary = state.compressedSummary.slice(-500);
  const lastSep = state.compressedSummary.lastIndexOf("|");
  if (lastSep > 200) state.compressedSummary = state.compressedSummary.slice(lastSep + 1).trim();
  state.recentMemory = state.recentMemory.slice(-10);
}

export function reviewObjectives(state: AutonomousDebugState): void {
  const now = Date.now();
  const maxActive = 10;
  const staleThreshold = 10 * state.objectiveReviewCycle * 60000;
  state.objectives = state.objectives.filter(o => {
    if (o.status === "abandoned" || o.status === "completed") return false;
    if (o.status === "pending" && (now - new Date(o.createdAt).getTime()) > staleThreshold) {
      o.status = "abandoned";
      return false;
    }
    return true;
  });

  // Deduplicate: keep only one objective per finding hash (the oldest by createdAt).
  // Sort first so the oldest objective per hash always wins.
  // Uses per-hash tracking instead of normalized-key to catch partial overlaps.
  const sorted = [...state.objectives].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const hashToFirstObjId = new Map<string, string>(); // hash -> oldest objective id
  const dupeObjIds = new Set<string>();
  for (const o of sorted) {
    // Check if this objective shares any hash with an already-registered objective
    const sharedHash = o.relatedFindings.find(h => hashToFirstObjId.has(h));
    if (sharedHash) {
      // Mark as dupe — do NOT register any of its hashes to avoid cascading
      dupeObjIds.add(o.id);
    } else {
      // First (oldest) objective to claim these hashes — register them all
      for (const h of o.relatedFindings) {
        hashToFirstObjId.set(h, o.id);
      }
    }
  }
  if (dupeObjIds.size > 0) {
    state.objectives = state.objectives.filter(o => !dupeObjIds.has(o.id));
  }

  const active = state.objectives.filter(o => o.status === "in-progress" || o.status === "pending");
  if (active.length > maxActive) {
    const prio = { critical: 0, high: 1, medium: 2, low: 3 };
    active.sort((a, b) => prio[a.priority] - prio[b.priority]);
    for (let i = maxActive; i < active.length; i++) active[i].status = "abandoned";
  }
}

// ─── Phase Prompt Builder ───────────────────────────────

export async function buildPhasePrompt(state: AutonomousDebugState, phase: DebugPhase, cwd?: string): Promise<string> {
  const projectDir = cwd || process.cwd();
  const l1 = await loadL1Context(projectDir, state.contextBudget.l1Wiki);
  const l2 = await loadL2Context(projectDir, TEAM_ORDER, state.contextBudget.l2AgentMemory);
  const l3 = loadL3Context(state, { entries: state.contextBudget.l3RecentMemory, summary: state.contextBudget.l3Summary });

  const cycleInfo = `Cycle ${state.totalCycles}/${state.maxCycles || "\u221E"} | Phase: ${phase}`;
  const activeObj = state.objectives.filter(o => o.status === "in-progress").length;
  const findingsInfo = `Findings: ${Object.keys(state.knownFindings).length} | Queue: ${state.fixQueue.length} | Cost: $${state.totalCost.toFixed(2)}`;

  let prompt = `## Autonomous Debug Agent\n${cycleInfo} | Active obj: ${activeObj}\n${findingsInfo}\n\n`;
  if (l1) prompt += `## Project Context (wiki)\n${l1}\n\n`;
  if (l2) prompt += `## Team Memory\n${l2}\n\n`;
  if (l3) prompt += `## Recent Activity\n${l3}\n\n`;
  prompt += buildPhaseInstructions(state, phase, projectDir);
  return prompt;
}

export function buildPhaseInstructions(state: AutonomousDebugState, phase: DebugPhase, projectDir?: string): string {
  const cwd = projectDir || process.cwd();
  const TOOL_WARNING =
    "CRITICAL: You only have these tools: bash, read, write, edit, gh. " +
    "Do NOT use delegate, delegate_parallel, pipeline_run, send_mail, check_mail, " +
    "or any agent orchestration tools \u2014 they do NOT exist in your context. " +
    "Execute everything directly via bash and read.\n\n";

  switch (phase) {
    case "scanning": {
      const scope = getDebugScope(state.scopeIndex, state.scopeFilter);
      const scopeDir = getScopeDir(scope);
      const scopeStats = state.scopeHistory[scope];
      const skipNote = scopeStats && scopeStats.consecutiveEmptyScans >= 3
        ? "\nNOTE: This scope has had " + scopeStats.consecutiveEmptyScans + " empty scans. Focus on deeper analysis."
        : "";
      const knownHashes = Object.keys(state.knownFindings).slice(0, 20)
        .map(h => "  " + h + ": " + state.knownFindings[h].description.slice(0, 60)).join("\n");
      const scopeCwd = scope;
      return TOOL_WARNING +
        `## SCAN Phase\nScope: ${scope} (${scopeDir})${skipNote}\n\nAnalyze the ${scope} scope for problems using ONLY bash and read:\n\n` +
        "- Errors: bash(\"cd " + cwd + "/" + scopeCwd + " && npm run typecheck 2>&1 | tail -20\")\n" +
        "- Lint issues: bash(\"cd " + cwd + "/" + scopeCwd + " && npx eslint . --max-warnings 999 2>&1 | head -50\")\n" +
        "- Security: bash(\"cd " + cwd + " && npm audit --production 2>&1 | head -30\")\n" +
        "- Dead code / imports: bash(\"cd " + cwd + " && grep -r 'TODO|FIXME|HACK' --include='*.ts' --include='*.tsx' " + scopeCwd + " 2>&1 | head -20\")\n" +
        "- Dependency issues: read(\"package.json\") and check for outdated or missing deps\n\n" +
        "Report findings in EXACT format:\n" +
        "FINDING: <filepath>:<line>:<issueType> \u2014 <description>\n\n" +
        "Known findings (skip these):\n" +
        (knownHashes || "  (none)");
    }
    case "triaging": {
      const newF = Object.values(state.knownFindings).filter(f => f.status === "new");
      const list = newF.map(f => `  [${f.severity}] ${f.hash}: ${f.description}`).join("\n");
      return TOOL_WARNING +
        `## TRIAGE Phase\nNew findings:\n${list || "  (none)"}\n\n` +
        "For each finding, use ONLY bash and gh to triage:\n" +
        "IMPORTANT: Before filing a new issue, check for existing open issues to avoid duplicates:\n" +
        "  bash(\"gh issue list --state open --limit 50\") and search for similar titles/descriptions.\n" +
        "  If a matching open issue already exists, do NOT create a new one — use TRIAGE_RESULT with the existing issue number instead.\n\n" +
        "- Create issue ONLY if no duplicate exists: bash(\"gh issue create --title 'bug: <title>' --body '<description>' --label 'type:bug,severity:<level>'\")\n" +
        "- Or mark wontfix: just output TRIAGE_RESULT with wontfix\n\n" +
        "Output: TRIAGE_RESULT: <hash>:issue=<number>\n" +
        "Output: TRIAGE_RESULT: <hash>:wontfix";
    }
    case "fixing": {
      const queue = state.fixQueue.slice(0, state.maxFixesPerCycle);
      const items = queue.map(h => {
        const f = state.knownFindings[h];
        return f ? `  #${f.issueNumber || "?"} [${f.severity}] ${f.description}` : "";
      }).filter(Boolean).join("\n");
      return TOOL_WARNING +
        `## FIX Phase\nFix up to ${state.maxFixesPerCycle} issues:\n${items || "  (queue empty)"}\n\n` +
        "For each fix, use ONLY bash, read, edit, and gh:\n" +
        "1. bash(\"git checkout -b fix/issue-<N>-<desc>\")\n" +
        "2. read(<file>) to understand the code, edit(<file>, edits) to fix it\n" +
        "3. bash(\"cd " + cwd + " && npm run typecheck 2>&1 | tail -10\") to verify fix compiles\n" +
        "4. bash(\"git add -A && git commit -m 'fix(scope): description closes #<N>' && git push origin fix/issue-<N>-<desc>\")\n" +
        "5. bash(\"gh pr create --title 'fix(scope): description' --body 'Closes #<N>' --label 'team:debug-agent'\")\n\n" +
        "Output per fix:\n" +
        "FIX_RESULT: <hash>:status=<success|failed>\n" +
        "FIX_RESULT: <hash>:pr=<PR-number>";
    }
    case "testing": {
      return TOOL_WARNING +
        "## TEST Phase\n" +
        "Run tests using ONLY bash:\n" +
        "1. bash(\"cd " + cwd + " && npm run typecheck 2>&1 | tail -10\")\n" +
        "2. bash(\"cd " + cwd + " && npm test 2>&1 | tail -30\")\n\n" +
        "Output:\n" +
        "TEST_RESULT: <suite>:status=<pass|fail>\n" +
        "TEST_RESULT: <suite>:failures=<count>";
    }
    case "user-simulating": {
      return TOOL_WARNING +
        "## HEALTH CHECK Phase\n" +
        "Check service health using ONLY bash:\n" +
        "1. bash(\"curl -sf http://localhost:3000/api/health 2>&1 || echo 'HEALTH CHECK FAILED'\")\n" +
        "2. bash(\"cd " + cwd + " && ls -la dist/ build/ 2>&1 | head -10\")\n\n" +
        "For issues found:\n" +
        "FINDING: <service>:<check>:<issueType> \u2014 <description>";
    }
    case "reviewing": {
      return TOOL_WARNING +
        "## REVIEW Phase\n" +
        "Review open PRs using ONLY bash and gh:\n" +
        "1. bash(\"gh pr list --state open --limit 10\")\n" +
        "2. For each PR: bash(\"gh pr diff <number>\") then read relevant changed files\n" +
        "3. If approved: bash(\"gh pr review <number> --approve --body 'LGTM'\")\n" +
        "4. Then merge: bash(\"gh pr merge <number> --squash\")\n\n" +
        "Output:\n" +
        "REVIEW_RESULT: PR#<number>:status=<approved|changes-requested>";
    }
    case "reflecting": {
      const findings = Object.keys(state.knownFindings).length;
      const resolved = Object.values(state.knownFindings).filter(f => f.status === "resolved").length;
      const failed = Object.values(state.knownFindings).filter(f => f.status === "failed").length;
      return TOOL_WARNING +
        `## REFLECT Phase\nStats: findings=${findings} resolved=${resolved} failed=${failed} cycles=${state.totalCycles} cost=$${state.totalCost.toFixed(2)}\n\nProvide a brief summary (max 200 chars).\nOutput:\nREFLECT: <summary>`;
    }
    default:
      return TOOL_WARNING + "No instructions for phase: " + phase;
  }
}
