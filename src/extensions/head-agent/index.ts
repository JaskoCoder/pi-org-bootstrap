/**
 * Head Agent — Main Extension Entry Point
 *
 * Thin orchestration layer that:
 * - Sets up shared mutable state
 * - Registers dashboard widget
 * - Handles lifecycle events (session_start, session_shutdown, agent streaming)
 * - Delegates command/tool registration to focused modules
 * - Injects head-agent context via before_agent_start
 *
 * Module structure:
 * - extension-context.ts — shared context interface
 * - register-commands.ts  — /head, /pi, /debug commands
 * - register-tools.ts     — delegate, send_mail, pipeline tools, etc.
 * - types.ts              — shared type definitions
 * - constants.ts          — team definitions, debug constants
 * - helpers.ts            — pure utility functions
 * - mail.ts               — mail system
 * - parsers.ts            — response parsers for debug loop
 * - debug-state.ts        — debug state machine, memory system
 * - dashboard.ts          — TUI dashboard rendering
 * - spawner.ts            — agent spawning logic
 * - autonomous-cycle.ts   — debug cycle engine
 * - cron-scheduler.ts     — cron scheduler
 * - cron-tasks.ts         — built-in cron tasks
 * - cron-commands.ts      — /cron command
 * - cron-tools.ts         — register_cron, unregister_cron tools
 * - cron-types.ts         — cron type definitions
 * - phase-handlers.ts     — debug phase handlers
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { visibleWidth, truncateToWidth, type TUI } from "@mariozechner/pi-tui";

// ─── Module Imports ──────────────────────────────────────
import type { AgentState, AutonomousDebugState, ExtensionState, PipelineState } from "./types.js";
import { TEAMS, TEAM_ORDER } from "./constants.js";
import { ad, appendDebugLog, existsSync, isSubagent, rj } from "./helpers.js";
import { createMailSystem } from "./mail.js";
import { loadDebugState, saveDebugState } from "./debug-state.js";
import { renderDashboard, DashboardCache } from "./dashboard.js";
import { createCycleRunner } from "./autonomous-cycle.js";
import { createCronScheduler } from "./cron-scheduler.js";
import { registerBuiltinTasks } from "./cron-tasks.js";
import { registerCronCommand } from "./cron-commands.js";
import { registerCronTools } from "./cron-tools.js";
import type { CronScheduler } from "./cron-types.js";
import type { ExtensionSharedContext } from "./extension-context.js";
import { registerCommands } from "./register-commands.js";
import { registerTools } from "./register-tools.js";
import { generateInstanceId, register as registryRegister, deregister as registryDeregister, heartbeat as registryHeartbeat, getActive, pruneDeadInstances } from "./instance-registry.js";
import { renderInstancePool } from "./instance-pool-widget.js";
import { registerCoordinationTools } from "./register-coordination-tools.js";
import { pickRandomName } from "../instance-username.js";
import { HEARTBEAT_INTERVAL_MS } from "./constants.js";
import { emitEvent, getRecentEvents, pruneEvents, type ContextEventType } from "./context-bus.js";
import { renderContextFeed, createFeedCache, type FeedWidgetState } from "./context-feed-widget.js";
import { registerContextTools } from "./register-context-tools.js";

// ─── Main Extension ──────────────────────────────────────

export default function (pi: ExtensionAPI) {

  // ─── Local Mutable State ──────────────────────────────
  let instanceId = "";
  let instanceUsername = "";
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let isSub = false;
  const agentStates: Record<string, AgentState> = {};
  for (const name of TEAM_ORDER) {
    agentStates[name] = { status: "idle", task: null, snippet: null, preview: "", startedAt: null, lastDuration: null, sessionTotal: 0, sessionOk: 0, sessionCost: 0, statusTimeout: null };
  }

  let metaMode = false;
  let headAgentPreview = "";
  let headAgentActive = false;

  // ─── Context Bus State ────────────────────────────────
  const feedState: FeedWidgetState = {
    visible: false, // starts hidden, toggle with /feed
    filter: {},
    maxLines: 8,
  };
  let cachedFeedEvents: import("./context-bus.js").ContextBusEvent[] = [];
  let feedCacheInterval: ReturnType<typeof setInterval> | null = null;
  let feedPruneInterval: ReturnType<typeof setInterval> | null = null;
  const feedCache = createFeedCache();

  // ─── Cached Pipeline State (avoids sync I/O in render path) ───
  let cachedPipelineState: PipelineState | null = null;
  let pipelineCacheInterval: ReturnType<typeof setInterval> | null = null;
  const refreshPipelineCache = async () => {
    try {
      const cwd = currentCtx?.cwd || process.cwd();
      const dir = ad(cwd);
      const statePath = path.join(dir, "pipeline", "state.json");
      const loaded = await rj<PipelineState>(statePath);
      const newVal = loaded || cachedPipelineState;
      if (JSON.stringify(newVal) !== JSON.stringify(cachedPipelineState)) {
        cachedPipelineState = newVal;
        dashboardDirty = true;
      }
    } catch {
      // keep stale cache
    }
  };

  // ─── Cached Debug State (avoids sync I/O in render path) ───
  let cachedDebugState: AutonomousDebugState | null = null;
  let debugCacheInterval: ReturnType<typeof setInterval> | null = null;
  let cachedInstanceCount = 1;
  let cachedInstances: import("./instance-registry.js").InstanceEntry[] = [];
  let instancePoolInterval: ReturnType<typeof setInterval> | null = null;
  const refreshDebugCache = async () => {
    try {
      const loaded = await loadDebugState(currentCtx?.cwd || process.cwd());
      if (JSON.stringify(loaded) !== JSON.stringify(cachedDebugState)) {
        cachedDebugState = loaded;
        dashboardDirty = true;
      }
    } catch {}
  };

  const refreshInstancePoolCache = async () => {
    try {
      const cwd = currentCtx?.cwd || process.cwd();
      const newInstances = await getActive(cwd);
      const newCount = newInstances.length;
      if (newCount !== cachedInstanceCount || JSON.stringify(newInstances) !== JSON.stringify(cachedInstances)) {
        cachedInstances = newInstances;
        cachedInstanceCount = newCount;
        dashboardDirty = true;
      }
    } catch {
      // keep stale cache
    }
  };

  // ─── Feed Cache Refresh ──────────────────────────────
  const refreshFeedCache = async () => {
    try {
      const cwd = currentCtx?.cwd || process.cwd();
      const events = await getRecentEvents(cwd, { limit: 30 });
      const newKey = JSON.stringify(events.map(e => e.id));
      if (newKey !== feedCache.getCachedKey()) {
        feedCache.setEvents(events);
        feedCache.setCachedKey(newKey);
        cachedFeedEvents = events;
        // Trigger re-render only if feed is visible
        if (feedState.visible && tuiRef?.requestRender) {
          tuiRef.requestRender();
        }
      }
    } catch {
      // keep stale feed cache
    }
  };

    // ─── Mail System ──────────────────────────────────────
  let mailCounter = 0;
  const mailboxes: Record<string, import("./types.js").MailMessage[]> = {};
  const globalInbox: import("./types.js").MailMessage[] = [];
  const mailSystem = createMailSystem(
    mailboxes, globalInbox,
    () => mailCounter, (n: number) => { mailCounter = n; },
  );

  // ─── Extension State (for autonomous cycle) ───────────
  const extState: ExtensionState = {
    agentStates,
    mailboxes,
    globalInbox,
    mailCounter,
    headAgentPreview,
    headAgentActive,
    metaMode,
    debugAbortController: null,
    cronScheduler: null,
  };

  // ─── Dashboard / Widget State ─────────────────────────
  let widgetActive = false;
  let refreshInterval: ReturnType<typeof setInterval> | null = null;
  let currentCtx: ExtensionContext | null = null;
  let tuiRef: TUI | null = null;
  let factoryRegistered = false;

  // ─── Render optimization: dirty flag + content cache ───
  // dashboardDirty is set when async caches detect actual data changes.
  // The main interval only calls refresh() when dirty or agents are active.
  // dashCache skips re-computing identical dashboard output.
  let dashboardDirty = true; // start dirty so first interval renders
  const dashCache = new DashboardCache();

  const scheduleAgentIdle = (key: string) => {
    const agent = agentStates[key];
    agent.statusTimeout = setTimeout(() => {
      if (agent.status === "done") { agent.status = "idle"; agent.statusTimeout = null; }
      dashboardDirty = true;
    }, 3000);
  };

  const clearAgentIdle = (key: string) => {
    const agent = agentStates[key];
    if (agent.statusTimeout) { clearTimeout(agent.statusTimeout); agent.statusTimeout = null; }
  };

  const WIDGET_KEY = "head-agent-dash";

  function registerWidgetFactory(ctx: ExtensionContext) {
    const ui = ctx?.ui ?? currentCtx?.ui;
    if (!ui) return;
        ui.setWidget(WIDGET_KEY, (_tui: TUI, theme: Theme) => {
      tuiRef = _tui;
      return {
        render: (width: number) => {
          try {
            const instCount = cachedInstanceCount;
            const anyWorking = TEAM_ORDER.some(n => agentStates[n].status !== "idle");
            const cacheKey = {
              width,
              anyWorking,
              spinFrame: anyWorking ? Math.floor(Date.now() / 5000) % 4 : 0,
              headAgentActive,
              headAgentPreviewLen: headAgentPreview.length,
              agentSnapshot: TEAM_ORDER.map(n => {
                const a = agentStates[n];
                return `${n}:${a.status}:${a.task ?? ""}:${a.snippet ?? ""}:${a.startedAt ?? 0}:${a.lastDuration ?? 0}:${a.sessionCost}:${a.sessionTotal}`;
              }).join("|"),
              mailCount: mailSystem.allRecentMail(3).length,
              cronTaskCount: cronScheduler ? cronScheduler.getTasks().length : 0,
              sprintNum: cachedPipelineState?.currentSprint?.number,
              debugStatus: cachedDebugState?.status ?? "idle",
            };
            const cached = dashCache.getCached(width, cacheKey);
            if (cached) return cached;
            const lines = renderDashboard(theme, width, agentStates, headAgentActive, headAgentPreview, mailSystem, cachedPipelineState, cachedDebugState, cronScheduler, instCount);
            dashCache.setCached(width, cacheKey, lines);
            return lines;
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return [truncateToWidth("DASH ERROR: " + msg, width, "")];
          }
        },
        invalidate: () => { dashCache.invalidate(); },
      };
    });
    factoryRegistered = true;

    // Instance pool widget (below editor) — only for top-level sessions
    if (!isSub) {
      // Instance pool widget (below editor) with render caching
      let poolCacheKey: string | undefined;
      let poolCacheLines: string[] | undefined;
      let poolCacheWidth: number | undefined;
      ui.setWidget("instance-pool", (_tui: TUI, theme: Theme) => {
        return {
          render: (width: number) => {
            try {
              // Build cache key from instance data + agent states + feed events
              const key = `${width}|${cachedInstances.length}|${JSON.stringify(cachedInstances)}|${JSON.stringify(agentStates)}|${cachedFeedEvents.length}|${cachedDebugState?.status ?? ""}|${cachedPipelineState?.currentSprint?.number ?? ""}`;
              if (poolCacheKey === key && poolCacheWidth === width && poolCacheLines) {
                return poolCacheLines;
              }
              const lines = renderInstancePool(theme, width, cachedInstances, instanceId, agentStates, cachedFeedEvents, cachedDebugState, cachedPipelineState);
              poolCacheKey = key;
              poolCacheWidth = width;
              poolCacheLines = lines;
              return lines;
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              return [truncateToWidth("POOL ERROR: " + msg, width, "")];
            }
          },
          invalidate: () => {
            poolCacheKey = undefined;
            poolCacheLines = undefined;
            poolCacheWidth = undefined;
          },
        };
      }, { placement: "belowEditor" });
    }

      // Context Feed widget (below editor, toggleable via /feed)
      ui.setWidget("context-feed", (_tui2: TUI, theme2: Theme) => {
        return {
          render: (width: number) => {
            if (!feedState.visible) return [];
            try {
              return renderContextFeed(theme2, width, cachedFeedEvents, feedState.filter, feedState.maxLines);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              return [truncateToWidth("FEED ERROR: " + msg, width, "")];
            }
          },
          invalidate: () => { feedCache.invalidate(); },
        };
      }, { placement: "belowEditor" });
  }

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  function refresh(_ctx?: ExtensionContext) {
    if (!widgetActive) return;
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (tuiRef?.requestRender) tuiRef.requestRender();
      else if (!factoryRegistered && _ctx) registerWidgetFactory(_ctx);
    }, 500);
  }

  // ─── Autonomous Cycle Runner ──────────────────────────
  const { runAutonomousCycle } = createCycleRunner(
    extState,
    mailSystem,
    refresh,
    () => currentCtx,
  );

  let debugAbortController: AbortController | null = null;

  // ─── Cron Scheduler ────────────────────────────────────
  const cronScheduler: CronScheduler = createCronScheduler({
    statePath: path.join(os.homedir(), ".pi", "agent", "cron.json"),
    maxConcurrency: 1,
    failureCooldown: 60_000,
    maxConsecutiveFailures: 5,
    taskTimeout: 30_000,
  });
  extState.cronScheduler = cronScheduler;

  // Register built-in cron tasks
  registerBuiltinTasks(cronScheduler);

  // Register /cron command
  registerCronCommand(pi, cronScheduler);

  // Register agent tools (register_cron, unregister_cron)
  registerCronTools(pi, cronScheduler);

  // ─── Shared Context for extracted modules ─────────────
  // ─── Context Bus Helper ──────────────────────────────
  // Throttle state.changed events: max 1 per minute per instance
  const stateChangedThrottle = new Map<string, number>();
  const STATE_CHANGED_INTERVAL = 60_000; // 1 minute

  const emitBusEvent = async (cwd: string, type: ContextEventType, agent: string, payload: Record<string, unknown>, parentTask?: string) => {
    // Throttle state.changed events to reduce noise
    if (type === "state.changed") {
      const key = instanceId || "unknown";
      const last = stateChangedThrottle.get(key) || 0;
      if (Date.now() - last < STATE_CHANGED_INTERVAL) return; // skip — too soon
      stateChangedThrottle.set(key, Date.now());
    }
    await emitEvent(cwd, {
      instanceId: instanceId || "unknown",
      agent,
      type,
      payload,
      parentTask,
    });
    // Refresh feed cache immediately so new event shows up
    if (feedState.visible) {
      await refreshFeedCache();
    }
  };
  extState.emitBusEvent = emitBusEvent;

  const sctx: ExtensionSharedContext = {
    pi,
    agentStates,
    mailSystem,
    extState,
    cronScheduler,
    get widgetActive() { return widgetActive; },
    setWidgetActive: (v: boolean) => { widgetActive = v; },
    registerWidgetFactory,
    refresh,
    scheduleAgentIdle,
    clearAgentIdle,
    WIDGET_KEY,
    runAutonomousCycle,
    get debugAbortController() { return debugAbortController; },
    setDebugAbortController: (ac) => { debugAbortController = ac; },
    get metaMode() { return metaMode; },
    setMetaMode: (v: boolean) => { metaMode = v; },
    emitBusEvent,
  };

  // Register commands (/head, /pi, /debug)
  registerCommands(sctx);

  // Register tools (delegate, send_mail, pipeline, etc.)
  registerTools(sctx, () => instanceId);

  // Register coordination tools (claim_task, release_task, sync_registry, get_active_instances)
  registerCoordinationTools(pi, () => currentCtx?.cwd || process.cwd(), instanceId);

  // Register context bus tools (spawn_focused) and /feed command
  registerContextTools(sctx, () => instanceId, feedState, () => {
    refreshFeedCache().then(() => refresh());
  });

  // ── Session start ──
  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;

    // ── Random theme selection ──
    // When theme is set to "random" in project settings, pick a random theme on each new session.
    //
    // Uses project-level .pi/settings.json (not global) to avoid conflicts between multiple
    // pi instances that share the same global config but run in different projects.
    //
    // Architecture note: ctx.ui.setTheme(name) persists the theme name to settingsManager
    // (both in-memory and disk). This is needed so that /reload's handleReloadCommand()
    // reads a valid theme name via settingsManager.getTheme() instead of "random".
    // But we must restore "random" in the settings FILE so the next session_start sees it.
    // We use setImmediate() to defer the file write-back until AFTER settingsManager's
    // async file write (microtask) completes.
    if (ctx.hasUI) {
      try {
        const settingsPath = path.join(ctx.cwd, ".pi", "settings.json");
        const settingsContent = fs.readFileSync(settingsPath, "utf-8");
        const settings = JSON.parse(settingsContent);
        if (settings.theme === "random") {
          const allThemes = ctx.ui.getAllThemes();
          if (allThemes.length > 0) {
            const randomTheme = allThemes[Math.floor(Math.random() * allThemes.length)];
            // Set theme — this updates the global theme, settingsManager in-memory state,
            // and queues an async file write with the actual theme name.
            ctx.ui.setTheme(randomTheme.name);
            // Restore "random" in the settings file after settingsManager's async write completes.
            // setImmediate runs in the macrotask queue, after all pending microtasks (including
            // settingsManager's .then() write). This ensures the file ends up with "random" again
            // for the next session_start to detect.
            setImmediate(() => {
              try {
                const fresh = fs.readFileSync(settingsPath, "utf-8");
                const currentSettings = JSON.parse(fresh);
                if (currentSettings.theme !== "random") {
                  currentSettings.theme = "random";
                  fs.writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2) + "\n");
                }
              } catch {
                // File may have been deleted or modified — non-critical
              }
            });
          }
        }
      } catch {
        // Settings file may not exist or may not have theme setting — skip silently
      }
    }

    // ── Multi-instance coordination ──
    instanceId = generateInstanceId();
    isSub = isSubagent();

    // ── Pick a username ──
    // Check if a username was already stored in this session via instance-username extension
    let username: string | undefined;
    const STORAGE_KEY = "instance-username";
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === STORAGE_KEY) {
        username = (entry.data as Record<string, string> | undefined)?.name;
        if (username) break;
      }
    }
    if (!username) {
      username = pickRandomName();
      pi.appendEntry(STORAGE_KEY, { name: username });
    }
    instanceUsername = username;

    // Set session name so it shows in session selector
    const existingName = pi.getSessionName();
    if (!existingName) {
      pi.setSessionName(`🤖 ${username}`);
    }

    // ── Multi-instance coordination (top-level sessions only) ──
    if (!isSub) {
      // Prune any phantom instances left by crashed/killed sessions
      try {
        const prunedCount = await pruneDeadInstances(ctx.cwd);
        if (prunedCount > 0) {
          process.stderr.write(`[head-agent] Pruned ${prunedCount} phantom instance(s) from registry\n`);
        }
      } catch {
        // Non-critical — best effort
      }

      await registryRegister(ctx.cwd, instanceId, {
        hostname: os.hostname(),
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }, username);
      heartbeatInterval = setInterval(async () => {
        try {
          const cwd = currentCtx?.cwd || process.cwd();
          await registryHeartbeat(cwd, instanceId);
        } catch {
          // Heartbeat failure is non-critical
        }
      }, HEARTBEAT_INTERVAL_MS);

      // Graceful deregistration on forced termination (SIGTERM, SIGINT)
      // Ensures phantom entries don't persist even when the process is killed
      const gracefulShutdown = async () => {
        if (!instanceId) return;
        const swd = currentCtx?.cwd || process.cwd();
        try { await registryDeregister(swd, instanceId); } catch { /* best effort */ }
        instanceId = "";
      };
      process.on("SIGTERM", gracefulShutdown);
      process.on("SIGINT", gracefulShutdown);
    }

    const isInteractive = ctx.hasUI;

    if (isInteractive) {
      widgetActive = true;
      registerWidgetFactory(ctx);

      if (refreshInterval) clearInterval(refreshInterval);
      refreshInterval = setInterval(() => {
        if (!widgetActive) return;
        const anyActive = TEAM_ORDER.some(n => agentStates[n].status !== "idle");
        if (anyActive || dashboardDirty) {
          dashboardDirty = false;
          refresh();
        }
      }, 5000);

      // Start async pipeline cache refresh (every 5s, avoids sync I/O in render)
      refreshPipelineCache();
      refreshDebugCache();
      if (pipelineCacheInterval) clearInterval(pipelineCacheInterval);
      pipelineCacheInterval = setInterval(refreshPipelineCache, 5000);
      if (debugCacheInterval) clearInterval(debugCacheInterval);
      debugCacheInterval = setInterval(refreshDebugCache, 5000);

      // Start instance pool cache refresh (every 3s) — top-level only
      if (!isSub) {
        if (instancePoolInterval) clearInterval(instancePoolInterval);
        instancePoolInterval = setInterval(refreshInstancePoolCache, 3000);

        // Refresh instance pool data
        await refreshInstancePoolCache();
      }

        // ── Context Bus: start feed cache + pruning ──
        await refreshFeedCache();
        if (feedCacheInterval) clearInterval(feedCacheInterval);
        feedCacheInterval = setInterval(refreshFeedCache, 5000);
        // Prune events every 10 minutes
        if (feedPruneInterval) clearInterval(feedPruneInterval);
        feedPruneInterval = setInterval(async () => {
          try {
            const cwd = currentCtx?.cwd || process.cwd();
            await pruneEvents(cwd);
          } catch { /* best effort */ }
        }, 600_000);
    }

    if (isInteractive) {
      await cronScheduler.start(ctx);

      const activeTasks = cronScheduler.getTasks().filter(t => t.enabled).length;
      if (activeTasks > 0) {
        ctx.ui.setStatus("cron", ctx.ui.theme.fg("dim", `Cron ${activeTasks} active`));
      }
    }

    if (!isInteractive) return;
    // NOTE: Footer is now managed by info-footer.ts extension.
    // Removed setFooter() here to avoid overriding the custom footer.

    // ── Splash screen ──
    if (ctx.hasUI) {
      const splashLines = [
        "",
        "\u{1F680} pi-org-bootstrap — Autonomous Agent Organization",
        "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
        "",
        "  Commands:",
        "  /head        Start head agent mode (delegates to teams)",
        "  /pi          Pi meta-agents (extensions, skills, config)",
        "  /help        Ask a question to the agent",
        "  /debug       Autonomous debug loop",
        "  /cron        Scheduled tasks",
        "  /feed        Context bus event feed",
        "",
        "  Quick start:",
        "  \u2022 Type /head to activate the orchestrator",
        "  \u2022 Type /pi to manage your pi setup",
        "  \u2022 Just describe what you want built or fixed",
        "  \u2022 The agent will delegate to the right team automatically",
        "",
        "  Examples:",
        "  \u2022 \"Add a login page\" \u2192 frontend-team",
        "  \u2022 \"Fix the auth bug\" \u2192 backend-team",
        "  \u2022 \"Deploy to production\" \u2192 infra-devops",
        "  \u2022 \"Add a new pi skill\" \u2192 /pi skills",
        "",
        "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
        "",
      ];
      ctx.ui.notify(splashLines.join("\n"), "info");
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    // ── Multi-instance coordination cleanup (top-level only) ──
    if (!isSub) {
      const shutdownCwdCoord = ctx?.cwd || process.cwd();
      if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
      try {
        await registryDeregister(shutdownCwdCoord, instanceId);
      } catch {
        // Best-effort deregister
      }
      instanceId = "";

      if (instancePoolInterval) { clearInterval(instancePoolInterval); instancePoolInterval = null; }
      cachedInstances = [];
    }

    // ── Context Bus cleanup ──
    if (feedCacheInterval) { clearInterval(feedCacheInterval); feedCacheInterval = null; }
    if (feedPruneInterval) { clearInterval(feedPruneInterval); feedPruneInterval = null; }
    cachedFeedEvents = [];
    feedCache.invalidate();

    if (!ctx.hasUI) return;
    const shutdownCwd = ctx?.cwd || process.cwd();
    const debugState = await loadDebugState(shutdownCwd);
    if (debugState && debugState.status !== "idle" && debugState.status !== "paused" && debugState.status !== "completed" && debugState.status !== "error") {
      debugState.status = "paused";
      await saveDebugState(shutdownCwd, debugState);
      await appendDebugLog(shutdownCwd, "\n## [" + new Date().toISOString() + "] Debug Loop \u2014 Auto-paused on session shutdown\n- Paused at cycle " + debugState.totalCycles);
    }
    widgetActive = false;
    currentCtx = null;
    tuiRef = null;
    factoryRegistered = false;
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    if (pipelineCacheInterval) { clearInterval(pipelineCacheInterval); pipelineCacheInterval = null; }
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    cachedPipelineState = null;
    cachedDebugState = null;
    dashboardDirty = true;
    dashCache.invalidate();

    if (cronScheduler.isRunning()) {
      await cronScheduler.stop();
    }

    if (ctx.hasUI) {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
        if (!isSub) ctx.ui.setWidget("instance-pool", undefined);
        ctx.ui.setWidget("context-feed", undefined);
        // NOTE: Footer cleanup handled by info-footer.ts
    }
  });

  // ── Track main agent streaming ──
  pi.on("agent_start", async () => {
    headAgentActive = true;
    headAgentPreview = "";
    dashboardDirty = true;
    // Context bus: state change event (throttled to 1/min/instance)
    const cwd = currentCtx?.cwd || process.cwd();
    emitBusEvent(cwd, "state.changed", "head-agent", { key: "headAgent", from: "idle", to: "active" }).catch(() => {});
  });

  pi.on("message_update", async (event) => {
    if (event.message?.role === "assistant") {
      for (const part of event.message.content ?? []) {
        if (part.type === "text" && part.text) {
          headAgentPreview = part.text;
          dashboardDirty = true;
        }
      }
    }
  });

  pi.on("agent_end", async (_event) => {
    headAgentActive = false;
    headAgentPreview = "";
    dashboardDirty = true;
    // Context bus: state change event (throttled to 1/min/instance)
    const cwd = currentCtx?.cwd || process.cwd();
    emitBusEvent(cwd, "state.changed", "head-agent", { key: "headAgent", from: "active", to: "idle" }).catch(() => {});
  });

  // ── Inject head agent context ──
  pi.on("before_agent_start", async (event, ctx) => {
    if (!existsSync(path.join(ad(ctx.cwd), "ORGANIZATION.md"))) return;
    const tools = pi.getAllTools();
    if (!tools.some(t => t.name === "delegate")) return;
    const teamList = TEAM_ORDER.map(n => {
      const t = TEAMS[n];
      return "  " + t.label.padEnd(10) + " | " + t.desc + " | owns: " + t.scope;
    }).join("\n");
    let metaSuffix = "";
    if (metaMode) {
      metaSuffix = "\n\n## Pi Meta-Agent Mode (ACTIVE)\nThe user has activated pi meta-agent mode. Prioritize pi-related tasks. Available meta agents:\n  - pi-extensions: Pi Extensions & Tools (owns .pi/extensions/, extension API)\n  - pi-agents: Pi Agent Configuration (owns .pi/agents/, agent roles)\n  - pi-skills: Pi Skills & Triggers (owns skill files, SKILL.md)\n  - pi-config: Pi Settings & Providers (owns .pi/settings, providers, themes)\nUse delegate(team, task) to send work to the appropriate meta agent. For pi documentation questions, delegate to pi-config.\n";
    }
    return {
      systemPrompt: event.systemPrompt + "\n\n## Head Agent Mode\n\nYou are the orchestrator. Your ONLY job is to delegate work to specialized teams.\nYou must NEVER write code, edit files, or do implementation work yourself.\nALWAYS use the delegate tool to send work to the appropriate team.\n\n### Teams (use delegate)\n" + teamList + "\n\n### Tools\n- delegate / delegate_parallel -- send tasks to teams (USE THESE FOR ALL WORK)\n- send_mail / check_mail -- inter-agent communication\n- pipeline_status -- visibility\n- gh issue create/list/view -- use GitHub Issues for bug tracking (MANDATORY)\n- pipeline_run -- run CI/CD\n- sprint_plan -- plan sprints\n- update_agent_memory -- persist notes\n\n### Rules\n1. NEVER do implementation work yourself — ALWAYS delegate to a team\n2. Understand request, break into team tasks, delegate\n3. Bug fix: create GitHub Issue -> triage -> team -> reviewer -> resolve via PR\n4. Feature: tech-lead -> teams -> reviewer\n5. Deploy: pipeline_run -> infra-devops\n6. Check pipeline_status before assigning work\n7. Use send_mail to pass context between teams before/after delegation\n8. Check mail before delegating to ensure no missed context\n\n### ⚠️ GitHub-First Workflow (MANDATORY)\nEvery code change MUST go through GitHub. No exceptions.\n\nFor bugs:\n  1. Create GitHub Issue: gh issue create --title \"bug title\" --body \"description\" --label \"type:bug\"\n  2. Delegate fix to team: delegate(team, \"Fix issue #N: description\")\n  3. The team creates a branch, commits, and opens a PR with \"Closes #N\"\n  4. Delegate review to reviewer\n   5. Merge PR (auto-closes issue)\n\nFor features:\n  1. Create GitHub Issue for tracking\n  2. Delegate design to tech-lead\n  3. Delegate implementation to appropriate team\n  4. Delegate review to reviewer\n  5. Merge PR\n\nWhen delegating, tell the team the issue number so they can:\n  - Create a branch: git checkout -b fix/issue-N-description\n  - Commit with: git commit -m \"fix(scope): description closes #N\"\n  - Open PR: gh pr create --title \"fix(scope): desc\" --body \"Closes #N\"\n" + metaSuffix
    };
  });
}
