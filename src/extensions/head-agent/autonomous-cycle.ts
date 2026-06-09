/**
 * Autonomous debug cycle engine — runs the main phase loop.
 * Phase-specific result processing is delegated to phase-handlers.ts.
 */
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AutonomousDebugState, DebugPhase, DebugKnownFinding, DebugObjective, ExtensionState } from "./types.js";
import { MEMORY_MANDATE, PHASE_ORDER, USER_SIM_CYCLE_INTERVAL, FIX_ONLY_QUEUE_THRESHOLD } from "./constants.js";
import { appendDebugLog, generateId } from "./helpers.js";
import { loadDebugState, saveDebugState, buildPhasePrompt, compressMemory, reviewObjectives, getDebugScope } from "./debug-state.js";
import { spawnAgent } from "./spawner.js";
import { processPhaseResult, isEmptyCycle, MAX_CONSECUTIVE_EMPTY_CYCLES } from "./phase-handlers.js";
import type { MailSystem } from "./mail.js";

export function createCycleRunner(
  extState: ExtensionState,
  mailSystem: MailSystem,
  refresh: (ctx?: ExtensionContext) => void,
  getCurrentCtx: () => ExtensionContext | null,
) {
  // ─── Cycle Telemetry ────────────────────────────────
  interface CycleTelemetry {
    findings: number;
    fixes: number;
    tests: number;
    errors: number;
    cost: number;
    summary: string;
  }

  function freshTelemetry(): CycleTelemetry {
    return { findings: 0, fixes: 0, tests: 0, errors: 0, cost: 0, summary: "" };
  }

  // ─── Phase Execution Tracker ─────────────────────────

  /** Tracks whether any phase actually ran (vs was skipped) in a cycle. */
  let anyPhaseExecuted = false;

  // ─── Empty-Cycle Detection (imported from phase-handlers.ts) ────

  // ─── Limit Checks ───────────────────────────────────

  type LimitStatus = "ok" | "cycles-reached" | "cost-reached" | "runtime-reached" | "error-budget";

  function checkLimits(s: AutonomousDebugState): LimitStatus {
    if (s.maxCycles > 0 && s.totalCycles >= s.maxCycles) return "cycles-reached";
    if (s.maxCost > 0 && s.totalCost >= s.maxCost) return "cost-reached";
    if (s.maxRuntimeMs > 0 && (Date.now() - new Date(s.startedAt).getTime()) >= s.maxRuntimeMs) return "runtime-reached";
    if (s.consecutiveErrors >= s.maxConsecutiveErrors) return "error-budget";
    return "ok";
  }

  async function handleLimitHit(limit: LimitStatus, cwd: string, s: AutonomousDebugState): Promise<void> {
    const ts = new Date().toISOString();
    switch (limit) {
      case "cycles-reached":
        s.status = "completed";
        await saveDebugState(cwd, s);
        await appendDebugLog(cwd, "\n## [" + ts + "] Debug Loop — Completed\n- Reached max cycles (" + s.maxCycles + ")");
        break;
      case "cost-reached":
        s.status = "completed";
        await saveDebugState(cwd, s);
        await appendDebugLog(cwd, "\n## [" + ts + "] Debug Loop — Cost limit reached ($" + s.totalCost.toFixed(2) + ")");
        break;
      case "runtime-reached":
        s.status = "completed";
        await saveDebugState(cwd, s);
        await appendDebugLog(cwd, "\n## [" + ts + "] Debug Loop — Runtime limit reached");
        break;
      case "error-budget":
        s.status = "error";
        s.errors.push("Stopped after " + s.maxConsecutiveErrors + " consecutive errors");
        await saveDebugState(cwd, s);
        await appendDebugLog(cwd, "\n## [" + ts + "] Debug Loop — Error budget exceeded");
        break;
    }
  }

  // ─── Phase Skipping Logic ───────────────────────────

  function shouldSkipPhase(phase: DebugPhase, s: AutonomousDebugState, queueLengthAtCycleStart?: number): boolean {
    if (phase === "triaging" && Object.values(s.knownFindings).filter(f => f.status === "new").length === 0) return true;
    if (phase === "fixing" && s.fixQueue.length === 0) return true;
    if (phase === "scanning") {
      // Fix-only mode: skip scanning when fix queue exceeds threshold.
      // Use the queue length snapshot from the start of the cycle so that
      // draining in the fixing phase or re-population in testing cannot
      // mask a genuinely overloaded queue.
      const effectiveQueueLen = queueLengthAtCycleStart ?? s.fixQueue.length;
      if (effectiveQueueLen > FIX_ONLY_QUEUE_THRESHOLD) return true;
      const scope = getDebugScope(s.scopeIndex, s.scopeFilter);
      const scopeStats = s.scopeHistory[scope];
      if (s.scopeFilter === "all" && scopeStats && scopeStats.consecutiveEmptyScans >= 3) {
        s.scopeIndex++;
        return true;
      }
    }
    return false;
  }

  // ─── Execute Single Phase ───────────────────────────

  async function executePhase(
    cwd: string, phase: DebugPhase, s: AutonomousDebugState,
    telemetry: CycleTelemetry, signal: AbortSignal,
    queueLengthAtCycleStart?: number,
  ): Promise<void> {
    s.status = phase;
    s.lastPhaseAt = new Date().toISOString();
    await saveDebugState(cwd, s);
    refresh();

    // Context bus: debug_cycle event
    if (extState.emitBusEvent) {
      extState.emitBusEvent(cwd, "debug_cycle", "debug-agent", {
        cycle: s.totalCycles,
        phase,
      }).catch(() => {});
    }

    if (shouldSkipPhase(phase, s, queueLengthAtCycleStart)) return;

    // At least one phase actually ran this cycle
    anyPhaseExecuted = true;

    const prompt = await buildPhasePrompt(s, phase);
    const systemPrompt = "You are the autonomous debug agent. Execute the phase instructions precisely. Work autonomously and output structured results.\n\n" + MEMORY_MANDATE.replace(/\{team\}/g, "debug-agent");

    await appendDebugLog(cwd, "\n## [" + new Date().toISOString() + "] Phase: " + phase + " | Cycle " + s.totalCycles);

    try {
      const result = await spawnAgent(cwd, "tech-lead.md", systemPrompt, prompt, "tech-lead", extState.agentStates, mailSystem, signal);
      telemetry.cost += result.cost;
      s.totalCost += result.cost;
      const response = result.output || "";

      if (result.exitCode !== 0) {
        telemetry.errors++;
        s.consecutiveErrors++;
        s.errors.push(phase + " error: " + (result.error || response).slice(0, 200));
      } else {
        s.consecutiveErrors = 0;
      }

      // Dispatch to phase-specific handler
      const phaseResult = await processPhaseResult(phase, s, response);
      telemetry.findings += phaseResult.findings;
      telemetry.fixes += phaseResult.fixes;
      telemetry.tests += phaseResult.tests;
      telemetry.summary = phaseResult.summary;

      // Self-termination: reflect phase requested stop
      if (phaseResult.shouldTerminate) {
        s.status = "paused";
        await saveDebugState(cwd, s);
        await appendDebugLog(cwd, "\n## [" + new Date().toISOString() + "] Debug Loop — Self-terminated\n- Reflect phase requested stop at cycle " + s.totalCycles);
        extState.debugAbortController?.abort();
      }

    } catch (err: unknown) {
      telemetry.errors++;
      s.consecutiveErrors++;
      const msg = err instanceof Error ? err.message : String(err);
      s.errors.push(phase + " exception: " + msg.slice(0, 200));
    }

    await saveDebugState(cwd, s);
    refresh();
  }

  // ─── End-of-Cycle Processing ────────────────────────

  async function finalizeCycle(cwd: string, s: AutonomousDebugState, telemetry: CycleTelemetry, signal: AbortSignal): Promise<void> {
    s.totalCycles++;
    s.totalRuntime = Date.now() - new Date(s.startedAt).getTime();

    // ── Empty-cycle detection ──
    // Only count as empty if at least one phase actually executed.
    // All-skipped cycles (e.g. empty fix queue + no new findings) are not dead loops —
    // the agent legitimately has no work to do.
    if (anyPhaseExecuted && isEmptyCycle(telemetry)) {
      s.consecutiveEmptyCycles = (s.consecutiveEmptyCycles || 0) + 1;
    } else {
      s.consecutiveEmptyCycles = 0;
    }
    anyPhaseExecuted = false; // reset for next cycle
    if ((s.consecutiveEmptyCycles || 0) >= MAX_CONSECUTIVE_EMPTY_CYCLES) {
      s.status = "paused";
      s.errors.push("Dead loop detected: " + MAX_CONSECUTIVE_EMPTY_CYCLES + " consecutive empty cycles. Auto-pausing.");
      await saveDebugState(cwd, s);
      await appendDebugLog(cwd, "\n## [" + new Date().toISOString() + "] Debug Loop \u2014 Dead loop detected\n- " + MAX_CONSECUTIVE_EMPTY_CYCLES + " consecutive empty cycles. Auto-paused at cycle " + s.totalCycles + ". f:" + telemetry.findings + " x:" + telemetry.fixes + " t:" + telemetry.tests + " e:" + telemetry.errors + " $" + telemetry.cost.toFixed(2));
      extState.debugAbortController?.abort();
      return;
    }

    s.recentMemory.push({
      timestamp: new Date().toISOString(), phase: "reflecting", summary: telemetry.summary || "Cycle completed",
      findings: telemetry.findings, fixes: telemetry.fixes, tests: telemetry.tests, errors: telemetry.errors, cost: telemetry.cost,
    });
    compressMemory(s);

    // Objective review on schedule
    if (s.totalCycles % s.objectiveReviewCycle === 0) {
      reviewObjectives(s);
      s.lastObjectiveReviewAt = new Date().toISOString();

      // Generate objectives from new findings
      const prio: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

      // Collect hashes already covered by active objectives to prevent duplicates
      const coveredHashes = new Set<string>();
      for (const o of s.objectives) {
        if (o.status === "pending" || o.status === "in-progress") {
          for (const h of o.relatedFindings) coveredHashes.add(h);
        }
      }

      const unresolved = Object.values(s.knownFindings)
        .filter((f: DebugKnownFinding) => (f.status === "new" || f.status === "filed") && !coveredHashes.has(f.hash))
        .sort((a: DebugKnownFinding, b: DebugKnownFinding) => (prio[a.severity] ?? 2) - (prio[b.severity] ?? 2));
      for (const f of unresolved.slice(0, 3)) {
        if (s.objectives.filter((o: DebugObjective) => o.status !== "abandoned" && o.status !== "completed").length >= 10) break;
        s.objectives.push({
          id: generateId(), description: f.description.slice(0, 100),
          priority: (f.severity as "critical" | "high" | "medium" | "low") || "medium", status: "pending",
          createdAt: new Date().toISOString(), completedAt: null,
          relatedFindings: [f.hash], source: "scan",
        });
      }

      // Mark completed objectives
      for (const obj of s.objectives) {
        if (obj.status === "in-progress") {
          const allResolved = obj.relatedFindings.every((h: string) => s.knownFindings[h]?.status === "resolved");
          if (allResolved) {
            obj.status = "completed";
            obj.completedAt = new Date().toISOString();
          }
        }
      }

      // Pick next objective
      const nextObj = s.objectives.find((o: DebugObjective) => o.status === "pending");
      if (nextObj) {
        nextObj.status = "in-progress";
        s.currentObjectiveId = nextObj.id;
      }
    }

    s.fixesThisCycle = 0;
    s.status = "sleeping";
    await saveDebugState(cwd, s);
    refresh();

    await appendDebugLog(cwd, "- Cycle " + s.totalCycles + ": " + (telemetry.summary || "done") +
      " | f:" + telemetry.findings + " x:" + telemetry.fixes + " t:" + telemetry.tests +
      " e:" + telemetry.errors + " $" + telemetry.cost.toFixed(2));

    if (s.sleepBetweenCycles > 0 && !signal.aborted) {
      await new Promise(r => setTimeout(r, s.sleepBetweenCycles));
    }
  }

  // ─── Main Cycle Loop ────────────────────────────────

  async function runAutonomousCycle(ctx: ExtensionContext): Promise<void> {
    const cwd = ctx?.cwd || getCurrentCtx()?.cwd || process.cwd();
    extState.debugAbortController = new AbortController();
    const signal = extState.debugAbortController.signal;

    const state = await loadDebugState(cwd);
    if (!state) return;

    state.status = "initializing";
    state.lastPhaseAt = new Date().toISOString();
    await saveDebugState(cwd, state);
    refresh();

    while (!signal.aborted) {
      const cur = await loadDebugState(cwd);
      if (!cur || cur.status === "paused" || cur.status === "completed" || cur.status === "error" || cur.status === "idle") break;

      // Check resource limits
      const limit = checkLimits(cur);
      if (limit !== "ok") {
        await handleLimitHit(limit, cwd, cur);
        break;
      }

      // Handle backoff
      if (cur.backoffUntil && new Date(cur.backoffUntil).getTime() > Date.now()) {
        cur.status = "sleeping";
        await saveDebugState(cwd, cur);
        const backoffMs = new Date(cur.backoffUntil).getTime() - Date.now();
        await new Promise(r => setTimeout(r, Math.min(10000, backoffMs)));
        if (signal.aborted) break;
        continue;
      }

      // Snapshot the fix queue length at cycle start so the scanning-skip
      // decision cannot be influenced by phases that haven't run yet.
      const queueLengthAtCycleStart = cur.fixQueue.length;

      // Build phase list for this cycle
      const phasesThisCycle: DebugPhase[] = [...PHASE_ORDER];
      if (cur.totalCycles > 0 && cur.totalCycles % USER_SIM_CYCLE_INTERVAL === 0) {
        phasesThisCycle.splice(4, 0, "user-simulating");
      }

      // Execute each phase
      const telemetry = freshTelemetry();
      for (const phase of phasesThisCycle) {
        if (signal.aborted) break;
        if (!cur || (cur.status as string) === "paused" || (cur.status as string) === "completed" || (cur.status as string) === "error" || (cur.status as string) === "idle") break;
        await executePhase(cwd, phase, cur, telemetry, signal, queueLengthAtCycleStart);
        if (signal.aborted) break;
      }

      // End of cycle
      if (cur) {
        await finalizeCycle(cwd, cur, telemetry, signal);
      }

      if (signal.aborted) break;
    }

    // Clean up on exit
    const finalState = await loadDebugState(cwd);
    if (finalState && finalState.status !== "paused" && finalState.status !== "completed" && finalState.status !== "error") {
      finalState.status = "paused";
      await saveDebugState(cwd, finalState);
    }
    extState.debugAbortController = null;
    refresh();
  }

  return { runAutonomousCycle };
}
