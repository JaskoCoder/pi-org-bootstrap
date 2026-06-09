/**
 * Extension command registration — /head, /pi, /debug.
 */
import * as path from "node:path";
import type { DebugKnownFinding, DebugObjective } from "./types.js";
import { TEAMS, TEAM_ORDER, DEBUG_SCOPES } from "./constants.js";
import { ad, readFileToString, fmtTime } from "./helpers.js";
import { loadDebugState, saveDebugState, createInitialDebugState, getDebugScope, loadL1Context, loadL2Context, loadL3Context } from "./debug-state.js";
import { appendDebugLog } from "./helpers.js";
import type { ExtensionSharedContext } from "./extension-context.js";

export function registerCommands(sctx: ExtensionSharedContext): void {
  const { pi, agentStates, refresh,
    runAutonomousCycle, registerWidgetFactory, WIDGET_KEY } = sctx;
  const setMetaMode = (v: boolean) => { sctx.setMetaMode(v); };
  let debugAbortController = sctx.debugAbortController;
  const setDebugAbortController = (ac: typeof debugAbortController) => { debugAbortController = ac; sctx.setDebugAbortController(ac); };
  let widgetActive = sctx.widgetActive;
  const setWidgetActive = (v: boolean) => { widgetActive = v; sctx.setWidgetActive(v); };

  // ── /head command ──
  pi.registerCommand("head", {
    description: "Activate head agent orchestrator mode",
    getArgumentCompletions(prefix: string) {
      return ["status", "triage", "sprint", "fix", "deploy", "review", "audit", "dashboard"]
        .filter(c => c.startsWith(prefix)).map(c => ({ value: c, label: c }));
    },
    handler: async (args, ctx) => {
      const sub = args.trim();
      if (sub === "dashboard") {
        setWidgetActive(!widgetActive);
        if (widgetActive) { registerWidgetFactory(ctx); ctx.ui.notify("Dashboard enabled", "info"); }
        else {
          ctx.ui.setWidget(WIDGET_KEY, undefined);
          ctx.ui.notify("Dashboard hidden", "info");
        }
        return;
      }
      if (sub === "status") { pi.sendUserMessage("Use pipeline_status to show the full org state."); return; }
      if (sub === "triage") { pi.sendUserMessage("List all open GitHub Issues with `gh issue list --label type:bug`, then triage each by adding labels via `gh issue edit`. Use delegate to assign fixes to teams."); return; }
      if (sub === "sprint") { pi.sendUserMessage("Plan the next sprint using sprint_plan."); return; }
      if (sub.startsWith("fix ")) { const bugRef = sub.slice(5).trim(); pi.sendUserMessage("Fix bug " + bugRef + ": First check if there's a GitHub Issue (gh issue view " + bugRef + "). If not, create one (gh issue create). Then delegate the fix to the appropriate team with the issue number. The team will create a branch, fix it, and open a PR with 'Closes #N'. Then delegate to reviewer for review, and merge."); return; }
      if (sub === "deploy") { pi.sendUserMessage("Run pipeline_run stage 'full'. If passes, delegate to infra-devops to deploy."); return; }
      if (sub === "review") { pi.sendUserMessage("Delegate to reviewer to review all open PRs: use `gh pr list` to find them, then review each."); return; }
      if (sub === "audit") { pi.sendUserMessage("Delegate to security-officer for a full security audit."); return; }
      const teamList = TEAM_ORDER.map(n => "  " + TEAMS[n].label.padEnd(10) + " " + TEAMS[n].desc).join("\n");
      setMetaMode(false);
      pi.sendUserMessage("Head Agent mode activated. I will NOT do any work directly — I will delegate everything to the appropriate team using the delegate tool.\n\nAvailable teams:\n" + teamList + "\n\nAll code changes will go through GitHub Issues and PRs. What should I have the teams do?");
    },
  });

  // ── /pi command ──
  pi.registerCommand("pi", {
    description: "Activate pi meta-agent team for pi infrastructure work",
    getArgumentCompletions(prefix: string) {
      return ["extensions", "agents", "skills", "config", "status", "docs"]
        .filter(c => c.startsWith(prefix)).map(c => ({ value: c, label: c }));
    },
    handler: async (args, _ctx) => {
      const sub = args.trim();
      if (sub === "status") {
        const metaTeams = ["pi-extensions", "pi-agents", "pi-skills", "pi-config"];
        const statusLines = metaTeams.map(n => {
          const a = agentStates[n];
          const t = TEAMS[n];
          return "  " + t.label.padEnd(10) + " " + a.status + " | tasks: " + a.sessionOk + "/" + a.sessionTotal;
        });
        pi.sendUserMessage("Meta Team Status:\n" + statusLines.join("\n"));
        return;
      }
      if (sub === "docs") {
        pi.sendUserMessage("Delegate to pi-config to read pi documentation from /usr/local/lib/node_modules/@mariozechner/pi-coding-agent/docs/ and answer questions about pi's API, extensions, tools, events, and configuration.");
        return;
      }
      const directMap: Record<string, string> = {
        "extensions": "pi-extensions",
        "agents": "pi-agents",
        "skills": "pi-skills",
        "config": "pi-config",
      };
      if (directMap[sub]) {
        pi.sendUserMessage("Meta-agent mode: " + sub + ". Use delegate(team: \"" + directMap[sub] + "\", task: ...) to send work to the " + sub + " specialist.");
        return;
      }
      setMetaMode(true);
      const metaTeamList = ["pi-extensions", "pi-agents", "pi-skills", "pi-config"]
        .map(n => "  " + TEAMS[n].label.padEnd(10) + " " + TEAMS[n].desc).join("\n");
      pi.sendUserMessage(
        "Pi meta-agent mode activated. I will route all pi-related work through the specialized meta-agent team.\n\n" +
        "Available meta agents:\n" + metaTeamList + "\n\n" +
        "I will determine which meta agent(s) to use based on the task and delegate accordingly.\n" +
        "Type '/head' to return to standard head agent mode."
      );
    },
  });

  // ── /debug command (autonomous loop) ──

  pi.registerCommand("debug", {
    description: "Autonomous debug loop with memory, objectives, and phase-based cycle engine",
    getArgumentCompletions(prefix: string) {
      return ["start", "stop", "pause", "resume", "status", "objectives", "log", "memory"]
        .filter(c => c.startsWith(prefix)).map(c => ({ value: c, label: c }));
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const sub = parts[0] || "";
      const cwd = ctx.cwd;

      if (sub === "status") {
        const state = await loadDebugState(cwd);
        if (!state) { ctx.ui.notify("\u{1F41B} Debug: No state found. Use /debug start.", "info"); return; }
        const scope = ["running", "scanning", "triaging", "fixing", "testing"].includes(state.status)
          ? getDebugScope(state.scopeIndex, state.scopeFilter) : "-";
        const known = Object.keys(state.knownFindings).length;
        const resolved = Object.values(state.knownFindings).filter((f: DebugKnownFinding) => f.status === "resolved").length;
        const openCount = Object.values(state.knownFindings).filter((f: DebugKnownFinding) => ["new", "filed", "fixing"].includes(f.status)).length;
        const runtime = state.startedAt ? fmtTime(Date.now() - new Date(state.startedAt).getTime()) : "0s";
        const activeObj = state.objectives.filter((o: DebugObjective) => o.status === "in-progress");
        const statusMsg = [
          `\u{1F41B} Debug Loop Status: ${state.status}`,
          `  Session: ${state.id}`,
          `  Cycle: ${state.totalCycles}/${state.maxCycles || "\u221E"} | Runtime: ${runtime}`,
          `  Phase: ${state.status} | Scope: ${state.scopeFilter}` + (state.status === "scanning" ? ` (next: ${scope})` : ""),
          `  Findings: ${known} (${resolved} resolved, ${openCount} open)`,
          `  Fix queue: ${state.fixQueue.length} | Dead loops: ${state.deadLoopFindings.length}`,
          `  Errors: ${state.consecutiveErrors}/${state.maxConsecutiveErrors} | Cost: $${state.totalCost.toFixed(2)}`,
          `  Memory entries: ${state.recentMemory.length} | Compressed: ${state.compressedSummary ? "yes" : "no"}`,
          `  Objectives: ${state.objectives.length} (${activeObj.length} active)`,
          activeObj.length > 0 ? `  Current: ${activeObj[0].description}` : null,
          state.errors.length > 0 ? `  Recent errors: ${state.errors.slice(-3).join("; ")}` : null,
        ].filter(Boolean).join("\n");
        pi.sendUserMessage(statusMsg);
        return;
      }

      if (sub === "log") {
        const logContent = await readFileToString(path.join(ad(cwd), "debug", "log.md"));
        if (!logContent) { ctx.ui.notify("\u{1F41B} Debug: No log entries yet.", "info"); return; }
        const count = parseInt(parts[1] || "20", 10);
        const lines = logContent.split("\n").filter(l => l.trim());
        pi.sendUserMessage("\u{1F41B} Debug Log (last " + count + " entries):\n" + lines.slice(-(count * 3)).join("\n"));
        return;
      }

      if (sub === "objectives") {
        const state = await loadDebugState(cwd);
        if (!state) { ctx.ui.notify("\u{1F41B} Debug: No state found.", "info"); return; }
        const objSub = parts[1] || "";
        if (objSub === "add" && parts.length > 2) {
          const desc = parts.slice(2).join(" ");
          state.objectives.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), description: desc, priority: "medium", status: "pending",
            createdAt: new Date().toISOString(), completedAt: null,
            relatedFindings: [], source: "manual",
          });
          await saveDebugState(cwd, state);
          ctx.ui.notify("\u{1F41B} Objective added: " + desc, "info");
          return;
        }
        if (objSub === "remove" && parts[2]) {
          state.objectives = state.objectives.filter((o: DebugObjective) => o.id !== parts[2]);
          await saveDebugState(cwd, state);
          ctx.ui.notify("\u{1F41B} Objective removed.", "info");
          return;
        }
        const objLines = state.objectives.length === 0
          ? "  No objectives."
          : state.objectives.map((o: DebugObjective) =>
            `  [${o.status}] ${o.priority} ${o.description.slice(0, 60)} (${o.source})`
          ).join("\n");
        pi.sendUserMessage("\u{1F41B} Objectives:\n" + objLines);
        return;
      }

      if (sub === "memory") {
        const state = await loadDebugState(cwd);
        if (!state) { ctx.ui.notify("\u{1F41B} Debug: No state found.", "info"); return; }
        const memLevel = parts[1] || "summary";
        if (memLevel === "l1") {
          const l1 = await loadL1Context(cwd, state.contextBudget.l1Wiki);
          pi.sendUserMessage("\u{1F41B} L1 (Wiki):\n" + (l1 || "(empty)"));
        } else if (memLevel === "l2") {
          const l2 = await loadL2Context(cwd, TEAM_ORDER, state.contextBudget.l2AgentMemory);
          pi.sendUserMessage("\u{1F41B} L2 (Agent Memory):\n" + (l2 || "(empty)"));
        } else if (memLevel === "l3") {
          const l3 = await loadL3Context(state, { entries: state.contextBudget.l3RecentMemory, summary: state.contextBudget.l3Summary });
          pi.sendUserMessage("\u{1F41B} L3 (Debug Memory):\n" + (l3 || "(empty)"));
        } else {
          pi.sendUserMessage("\u{1F41B} Memory: " + state.recentMemory.length + " entries, compressed: " + (state.compressedSummary ? "yes (" + state.compressedSummary.length + " chars)" : "no") + "\nBudget: L1=" + state.contextBudget.l1Wiki + " L2=" + state.contextBudget.l2AgentMemory + " L3=" + state.contextBudget.l3RecentMemory + "+" + state.contextBudget.l3Summary);
        }
        return;
      }

      if (sub === "stop" || sub === "pause") {
        const state = await loadDebugState(cwd);
        if (!state || !["running", "scanning", "triaging", "fixing", "testing", "user-simulating", "reviewing", "reflecting", "sleeping", "initializing"].includes(state.status)) {
          ctx.ui.notify("\u{1F41B} Debug: Not running.", "warning");
          return;
        }
        state.status = "paused";
        await saveDebugState(cwd, state);
        if (debugAbortController) { debugAbortController.abort(); setDebugAbortController(null); }
        ctx.ui.notify("\u{1F41B} Debug loop paused at cycle " + state.totalCycles, "info");
        await appendDebugLog(cwd, "\n## [" + new Date().toISOString() + "] Debug Loop \u2014 " + (sub === "stop" ? "Stopped" : "Paused") + "\n- At cycle " + state.totalCycles);
        refresh(ctx);
        return;
      }

      if (sub === "resume") {
        const state = await loadDebugState(cwd);
        if (!state || (state.status !== "paused" && state.status !== "error")) {
          ctx.ui.notify("\u{1F41B} Debug: Nothing to resume. Use /debug start.", "warning");
          return;
        }
        state.status = "running";
        state.consecutiveErrors = 0;
        await saveDebugState(cwd, state);
        ctx.ui.notify("\u{1F41B} Debug loop resumed at cycle " + state.totalCycles, "info");
        await appendDebugLog(cwd, "\n## [" + new Date().toISOString() + "] Debug Loop \u2014 Resumed\n- At cycle " + state.totalCycles);
        refresh(ctx);

        runAutonomousCycle(ctx).catch(async (err) => {
          const errorCwd = ctx?.cwd || process.cwd();
          const errState = await loadDebugState(errorCwd);
          if (errState) { errState.status = "error"; errState.errors.push("Unhandled: " + err.message); await saveDebugState(errorCwd, errState); }
          ctx.ui.notify("\u{1F41B} Debug loop crashed: " + err.message, "error");
          refresh(ctx);
        });
        return;
      }

      if (sub === "start") {
        let maxCycles: number | undefined, maxCost: number | undefined;
        let maxRuntimeMs: number | undefined, sleepMs: number | undefined;
        let scopeFilter = "all";
        for (let i = 1; i < parts.length; i++) {
          if (parts[i] === "--max-cycles" && parts[i + 1]) { maxCycles = parseInt(parts[++i], 10); }
          else if (parts[i] === "--max-cost" && parts[i + 1]) { maxCost = parseFloat(parts[++i]); }
          else if (parts[i] === "--max-runtime" && parts[i + 1]) {
            const rt = parts[++i];
            const m = rt.match(/^(\d+)(h|m|s)?$/);
            if (m) maxRuntimeMs = parseInt(m[1], 10) * (m[2] === "h" ? 3600000 : m[2] === "m" ? 60000 : 1000);
          }
          else if (parts[i] === "--sleep" && parts[i + 1]) {
            const sl = parts[++i];
            const m = sl.match(/^(\d+)(h|m|s)?$/);
            if (m) sleepMs = parseInt(m[1], 10) * (m[2] === "h" ? 3600000 : m[2] === "m" ? 60000 : 1000);
          }
          else if (parts[i] === "--scope" && parts[i + 1]) { scopeFilter = parts[++i]; }
        }

        const validScopes = ["all", ...DEBUG_SCOPES];
        if (maxCycles !== undefined && maxCycles < 0) {
          ctx.ui.notify("\u{1F41B} Debug: --max-cycles must be >= 0 (0 means unlimited).", "error");
          return;
        }
        if (maxCost !== undefined && maxCost <= 0) {
          ctx.ui.notify("\u{1F41B} Debug: --max-cost must be > 0.", "error");
          return;
        }
        if (maxRuntimeMs !== undefined && maxRuntimeMs <= 0) {
          ctx.ui.notify("\u{1F41B} Debug: --max-runtime must parse to > 0.", "error");
          return;
        }
        if (!validScopes.includes(scopeFilter)) {
          ctx.ui.notify("\u{1F41B} Debug: --scope must be one of: " + validScopes.join(", "), "error");
          return;
        }

        const existing = await loadDebugState(cwd);
        if (existing && ["running", "scanning", "triaging", "fixing", "testing", "sleeping", "initializing"].includes(existing.status)) {
          ctx.ui.notify("\u{1F41B} Debug: Already running at cycle " + existing.totalCycles + ". Use /debug stop first.", "warning");
          return;
        }

        const state = createInitialDebugState({ maxCycles, maxCost, maxRuntimeMs, sleepBetweenCycles: sleepMs, scopeFilter });
        await saveDebugState(cwd, state);
        ctx.ui.notify("\u{1F41B} Debug loop started! Cycles: " + (state.maxCycles || "\u221E") + ", scope: " + scopeFilter + ", sleep: " + fmtTime(state.sleepBetweenCycles), "info");
        refresh(ctx);

        await appendDebugLog(cwd, "\n## [" + new Date().toISOString() + "] Debug Loop \u2014 Started\n- Max cycles: " + (state.maxCycles || "\u221E") + "\n- Scope: " + scopeFilter + "\n- Sleep: " + fmtTime(state.sleepBetweenCycles));

        runAutonomousCycle(ctx).catch(async (err) => {
          const errorCwd = ctx?.cwd || process.cwd();
          const errState = await loadDebugState(errorCwd);
          if (errState) { errState.status = "error"; errState.errors.push("Unhandled: " + err.message); await saveDebugState(errorCwd, errState); }
          ctx.ui.notify("\u{1F41B} Debug loop crashed: " + err.message, "error");
          refresh(ctx);
        });
        return;
      }

      // Default: show help
      ctx.ui.notify(
        "\u{1F41B} /debug subcommands:\n" +
        "  start [--max-cycles N] [--max-cost $] [--max-runtime 8h] [--scope all|<scope-name>] [--sleep 30s]\n" +
        "  stop/pause \u2014 Pause the loop\n" +
        "  resume \u2014 Continue from pause\n" +
        "  status [--verbose] \u2014 Show current state\n" +
        "  objectives [add <desc>|remove <id>] \u2014 Manage objectives\n" +
        "  log [N] \u2014 Show last N log entries\n" +
        "  memory [l1|l2|l3|summary] \u2014 Show memory levels",
        "info"
      );
    },
  });
}
