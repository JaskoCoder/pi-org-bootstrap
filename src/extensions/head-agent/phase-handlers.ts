/**
 * Per-phase handlers for the autonomous debug cycle.
 * Each handler processes a specific phase's agent response and updates state.
 */
import type { AutonomousDebugState } from "./types.js";
import { hashFinding } from "./helpers.js";
import { getDebugScope } from "./debug-state.js";
import { parseFindingsFromResponse, parseTriageResults, parseFixResults, parseTestResults, parseReflection } from "./parsers.js";
import { execFileSync } from "node:child_process";

/** Result of processing a single phase */
export interface PhaseResult {
  findings: number;
  fixes: number;
  tests: number;
  errors: number;
  summary: string;
  shouldTerminate?: boolean;
}

/** Create a fresh PhaseResult with zero values */
export function emptyPhaseResult(): PhaseResult {
  return { findings: 0, fixes: 0, tests: 0, errors: 0, summary: "" };
}

// ─── Empty-Cycle Detection (shared definition) ────────

/** Maximum consecutive empty cycles before auto-pausing (dead-loop guard). */
export const MAX_CONSECUTIVE_EMPTY_CYCLES = 10;

/**
 * Determine whether a cycle produced no productive output.
 *
 * A cycle is "empty" when it yielded zero **findings** AND zero **fixes**.
 * Tests and errors are secondary signals — they may run even when the
 * agent isn't making forward progress (e.g., running the same failing
 * tests every cycle).  Only findings and fixes represent net-new work.
 *
 * IMPORTANT: Keep this single definition in sync with the test in
 * `__tests__/dead-loop-fix.test.ts`.
 */
export function isEmptyCycle(t: { findings: number; fixes: number; tests: number; errors: number; cost: number; summary: string }): boolean {
  return t.findings === 0 && t.fixes === 0;
}

// ─── Scanning ───────────────────────────────────────────

export function handleScanning(s: AutonomousDebugState, response: string): PhaseResult {
  const findings = parseFindingsFromResponse(response);
  let newFindings = 0;
  const now = new Date().toISOString();

  for (const f of findings) {
    const hash = hashFinding(f.file, f.line, f.issueType);
    if (!s.knownFindings[hash]) {
      s.knownFindings[hash] = {
        hash, description: f.description, severity: "medium",
        issueNumber: null, status: "new", firstSeen: now,
        lastSeen: now, failCount: 0, cooldownUntil: 0,
      };
      newFindings++;
    } else {
      s.knownFindings[hash].lastSeen = now;
    }
  }

  const scope = getDebugScope(s.scopeIndex, s.scopeFilter);
  if (!s.scopeHistory[scope]) s.scopeHistory[scope] = { lastScannedAt: null, findingsCount: 0, consecutiveEmptyScans: 0 };
  s.scopeHistory[scope].lastScannedAt = now;
  s.scopeHistory[scope].findingsCount += findings.length;
  if (newFindings === 0) s.scopeHistory[scope].consecutiveEmptyScans++;
  else s.scopeHistory[scope].consecutiveEmptyScans = 0;
  s.scopeIndex++;

  return {
    findings: findings.length,
    fixes: 0,
    tests: 0,
    errors: 0,
    summary: "Scanned " + scope + ": " + findings.length + " findings (" + newFindings + " new)",
  };
}

// ─── Triaging ───────────────────────────────────────────

export function handleTriaging(s: AutonomousDebugState, response: string): PhaseResult {
  const triResults = parseTriageResults(response);
  for (const tr of triResults) {
    const finding = s.knownFindings[tr.hash];
    if (finding) {
      if (tr.wontfix) {
        finding.status = "wontfix";
      } else if (tr.issueNumber) {
        finding.issueNumber = tr.issueNumber;
        finding.status = "filed";
        s.fixQueue.push(tr.hash);
      }
    }
  }
  const prioMap: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  s.fixQueue.sort((a, b) => {
    const fa = s.knownFindings[a];
    const fb = s.knownFindings[b];
    return (prioMap[fa?.severity || "medium"] ?? 2) - (prioMap[fb?.severity || "medium"] ?? 2);
  });
  return {
    findings: 0,
    fixes: 0,
    tests: 0,
    errors: 0,
    summary: "Triaged: " + triResults.length + " findings",
  };
}

// ─── Fixing ─────────────────────────────────────────────

export function handleFixing(s: AutonomousDebugState, response: string): PhaseResult {
  const fixResults = parseFixResults(response);
  let cycleFixes = 0;
  s.fixesThisCycle = 0;

  for (const fr of fixResults) {
    const finding = s.knownFindings[fr.hash];
    if (finding) {
      if (fr.success) {
        finding.status = "resolved";
        s.fixesThisCycle++;
        cycleFixes++;
      } else {
        finding.status = "failed";
        finding.failCount++;
        if (finding.failCount >= 3) {
          s.deadLoopFindings.push(fr.hash);
        }
        finding.cooldownUntil = s.totalCycles + 2;
      }
    }
  }

  // Remove processed items from queue
  const processedHashes = new Set(fixResults.map(fr => fr.hash));
  s.fixQueue = s.fixQueue.filter(h => !processedHashes.has(h));

  // Prune resolved findings with high fail count
  for (const hash of Object.keys(s.knownFindings)) {
    const f = s.knownFindings[hash];
    if ((f.status === "resolved" || f.status === "failed") && f.failCount >= 3) {
      delete s.knownFindings[hash];
      // Also remove from deadLoopFindings to prevent orphan references
      const idx = s.deadLoopFindings.indexOf(hash);
      if (idx !== -1) s.deadLoopFindings.splice(idx, 1);
    }
  }

  // Skip findings with cooldown or in dead loop
  s.fixQueue = s.fixQueue.filter(h => {
    const f = s.knownFindings[h];
    if (!f) return false;
    if (f.cooldownUntil > s.totalCycles) return false;
    if (s.deadLoopFindings.includes(h)) return false;
    return true;
  });

  // Deduplicate fix queue (guard against re-discovered test failures)
  s.fixQueue = [...new Set(s.fixQueue)];

  return {
    findings: 0,
    fixes: cycleFixes,
    tests: 0,
    errors: 0,
    summary: "Fixed: " + cycleFixes + " issues",
  };
}

// ─── Testing ────────────────────────────────────────────

export function handleTesting(s: AutonomousDebugState, response: string): PhaseResult {
  const testResults = parseTestResults(response);
  const now = new Date().toISOString();
  s.lastTestRun = now;
  s.testFailures = testResults.filter(t => !t.passed).map(t => t.suite);

  for (const failure of s.testFailures) {
    const hash = hashFinding(failure, "0", "test-failure");
    if (!s.knownFindings[hash]) {
      s.knownFindings[hash] = {
        hash, description: "Test failure: " + failure, severity: "high",
        issueNumber: null, status: "new", firstSeen: now,
        lastSeen: now, failCount: 0, cooldownUntil: 0,
      };
      if (!s.fixQueue.includes(hash)) {
        s.fixQueue.push(hash);
      }
    }
  }

  return {
    findings: 0,
    fixes: 0,
    tests: testResults.length,
    errors: 0,
    summary: "Tests: " + testResults.filter(t => t.passed).length + "/" + testResults.length + " passed",
  };
}

// ─── User Simulation ────────────────────────────────────

export function handleUserSimulating(s: AutonomousDebugState, response: string): PhaseResult {
  const findings = parseFindingsFromResponse(response);
  const now = new Date().toISOString();

  for (const f of findings) {
    const hash = hashFinding(f.file, f.line, f.issueType);
    if (!s.knownFindings[hash]) {
      s.knownFindings[hash] = {
        hash, description: "[UX] " + f.description, severity: "medium",
        issueNumber: null, status: "new", firstSeen: now,
        lastSeen: now, failCount: 0, cooldownUntil: 0,
      };
    }
  }

  return {
    findings: findings.length,
    fixes: 0,
    tests: 0,
    errors: 0,
    summary: "User sim: " + findings.length + " UX issues",
  };
}

// ─── Reviewing ──────────────────────────────────────────

export async function handleReviewing(s: AutonomousDebugState, response: string): Promise<PhaseResult> {
  let autoResolved = 0;
  for (const hash of Object.keys(s.knownFindings)) {
    const f = s.knownFindings[hash];
    if (f.status === "filed" && f.issueNumber) {
      try {
        if (!/^\d+$/.test(String(f.issueNumber))) continue;
        const out = execFileSync(
          "gh", ["pr", "list", "--state", "merged", "--search", String(f.issueNumber), "--json", "number", "--jq", ".[].number"],
          { encoding: "utf-8", timeout: 15000, stdio: ["pipe", "pipe", "pipe"] },
        );
        const merged = out.trim().split("\n").filter(Boolean);
        if (merged.length > 0) {
          f.status = "resolved";
          s.fixQueue = s.fixQueue.filter(h => h !== hash);
          autoResolved++;
        }
      } catch {
        // gh CLI not available or network error — skip silently
      }
    }
  }
  return {
    findings: 0,
    fixes: autoResolved,
    tests: 0,
    errors: 0,
    summary: autoResolved > 0
      ? "Review: auto-resolved " + autoResolved + " findings via merged PRs"
      : response.slice(0, 100),
  };
}

// ─── Reflecting ─────────────────────────────────────────

export function handleReflecting(_s: AutonomousDebugState, response: string): PhaseResult {
  const summary = parseReflection(response).slice(0, 200);
  const terminatePattern = /\b(terminate|stop(?:\s+the)?\s*loop|abort|shut\s*down)\b/i;
  const shouldTerminate = terminatePattern.test(summary);
  return {
    findings: 0,
    fixes: 0,
    tests: 0,
    errors: 0,
    summary,
    shouldTerminate,
  };
}

// ─── Dispatcher ─────────────────────────────────────────

const phaseHandlers: Record<string, (s: AutonomousDebugState, response: string) => PhaseResult | Promise<PhaseResult>> = {
  scanning: handleScanning,
  triaging: handleTriaging,
  fixing: handleFixing,
  testing: handleTesting,
  "user-simulating": handleUserSimulating,
  reviewing: handleReviewing,
  reflecting: handleReflecting,
};

/** Dispatch a phase result to the appropriate handler */
export function processPhaseResult(phase: string, state: AutonomousDebugState, response: string): PhaseResult | Promise<PhaseResult> {
  const handler = phaseHandlers[phase];
  if (handler) return handler(state, response);
  return emptyPhaseResult();
}
