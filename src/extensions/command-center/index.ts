/**
 * Command Centre Extension — Multi-level agent orchestration via RPC.
 *
 * Architecture:
 *
 *   Command Centre (Lead Orchestrator) — this session, runs /command-center
 *       |           |           |
 *     Worker1     Worker2     Worker3  — each runs /head (full agent team orchestrator)
 *       |  |  |    |  |  |    |  |  |
 *     Specialized agent teams via delegate() — backend, frontend, ai-ml, etc.
 *       |  |  |    |  |  |    |  |  |
 *     Focused subagents when needed — spawn_focused()
 *
 * Communication: Workers are child processes running `pi --mode rpc`.
 * All communication uses JSON-RPC over stdin/stdout — no tmux required.
 * tmux is kept ONLY for optional visual fleet monitoring via orch_view.
 *
 * /command-center (/hq)  — Activates Lead Orchestrator mode
 * /worker (/w)           — Activates mid-level orchestrator (receives tasks, delegates to teams)
 * /deploy-worker         — Spawns new RPC worker instance
 * /cc-off                — Deactivates command centre mode
 * /cc-view               — Opens optional tmux fleet view (visual monitoring only)
 * /cc-view-off           — Closes fleet view
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { truncateToWidth, type TUI, type Theme } from "@mariozechner/pi-tui";

// ─── Module Imports ──────────────────────────────────────
import type { Task, MessageLogEntry, DashboardStats } from "./types.js";
import { createTask, getTasks, updateTaskStatus } from "./task-manager.js";
import { renderCommandCentre } from "./dashboard.js";
import {
  spawnRpcWorker,
  spawnTmuxWorker,
  isInsideTmux,
  isTmuxAvailable,
  openFleetView,
  closeFleetView,
  rebalanceLayout,
} from "./instance-bridge.js";
import type { RpcWorker, TmuxWorker, PoolWorker } from "./instance-bridge.js";

// ─── Reuse from head-agent ────────────────────────────
import {
  getActive,
  deregister as registryDeregister,
} from "../head-agent/instance-registry.js";
import type { InstanceEntry } from "../head-agent/instance-registry.js";

// ─── Constants ───────────────────────────────────────────

const WIDGET_KEY = "command-centre";
const STORAGE_KEY = "cc-mode";

function shortId(id: string): string {
  return id.length > 12 ? id.slice(-8) : id;
}

// ─── Main Extension ──────────────────────────────────────

export default function (pi: ExtensionAPI) {

  // ─── Shared State ──────────────────────────────────
  let instanceId = "";
  let myUsername = "";
  let currentCtx: ExtensionContext | null = null;

  // Orchestrator mode
  let orchestratorActive = false;
  let cachedInstances: InstanceEntry[] = [];
  let cachedTasks: Task[] = [];
  let messageLog: MessageLogEntry[] = [];
  const MESSAGE_LOG_MAX = 100;

  function pushMessageLog(entry: MessageLogEntry) {
    messageLog.push(entry);
    if (messageLog.length > MESSAGE_LOG_MAX) {
      messageLog = messageLog.slice(-MESSAGE_LOG_MAX);
    }
  }
  let activatedAt = "";
  let refreshInterval: ReturnType<typeof setInterval> | null = null;
  let tuiRef: TUI | null = null;

  // Worker pool — maps instance ID to worker (RPC or tmux)
  const workers = new Map<string, PoolWorker>();

  // ─── Refresh Data ──────────────────────────────────

  // ── Stats Computation ─────────────────────────────

  const ACTIVE_THRESHOLD_MS = 120_000;

  function computeStats(): DashboardStats {
    const now = Date.now();
    const activeInstances = cachedInstances.filter(
      i => (now - i.lastHeartbeat) < ACTIVE_THRESHOLD_MS,
    ).length;
    const totalTasks = cachedTasks.length;
    const completedTasks = cachedTasks.filter(t => t.status === "completed").length;
    const activeTasks = cachedTasks.filter(t => t.status === "assigned" || t.status === "in-progress").length;
    const pendingTasks = cachedTasks.filter(t => t.status === "pending").length;
    const failedTasks = cachedTasks.filter(t => t.status === "failed").length;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const messagesToday = messageLog.filter(
      m => new Date(m.timestamp).getTime() >= todayStart.getTime(),
    ).length;
    return {
      activatedAt: activatedAt || new Date().toISOString(),
      totalTasks,
      completedTasks,
      activeTasks,
      pendingTasks,
      failedTasks,
      totalInstances: cachedInstances.length,
      activeInstances,
      messagesToday,
      unreadMessages: 0,
    };
  }

  async function refreshData(): Promise<void> {
    const cwd = currentCtx?.cwd || process.cwd();
    try { cachedInstances = await getActive(cwd); } catch { /* keep stale */ }
    try { cachedTasks = await getTasks(cwd); } catch { /* keep stale */ }
  }

  /** Find the PoolWorker for an instance by name or ID. */
  function findWorkerForInstance(inst: InstanceEntry): PoolWorker | undefined {
    // First try direct match by instanceId
    const direct = workers.get(inst.instanceId);
    if (direct) return direct;
    // For tmux workers, also try matching by username or pane-related entries
    return undefined;
  }

  /** Resolve instance identifier (name, short ID, full ID) to an InstanceEntry. */
  function resolveInstance(identifier: string): InstanceEntry | undefined {
    return cachedInstances.find(i =>
      i.username === identifier ||
      i.instanceId === identifier ||
      shortId(i.instanceId) === identifier ||
      i.instanceId.endsWith(identifier)
    );
  }

  // ─── Widget ────────────────────────────────────────

  function registerWidget(ctx: ExtensionContext) {
    ctx.ui.setWidget(WIDGET_KEY, (_tui: TUI, theme: Theme) => {
      tuiRef = _tui;
      return {
        render(width: number) {
          const termRows = (tuiRef as any)?.termRows
            ?? (tuiRef as any)?.terminal?.rows
            ?? process.stdout.rows
            ?? 24;
          // Build worker info map for dashboard
          const workerInfo = new Map<string, { type: "rpc" | "tmux"; displayId: string }>();
          for (const [id, w] of workers) {
            if (w.type === "tmux") {
              workerInfo.set(id, { type: "tmux", displayId: w.paneId });
            } else {
              workerInfo.set(id, { type: "rpc", displayId: "PID:" + (w as RpcWorker).process.pid });
            }
          }
          const stats = computeStats();
          return renderCommandCentre(
            theme, width, termRows,
            cachedInstances, instanceId,
            cachedTasks, messageLog,
            stats, workerInfo,
          );
        },
        invalidate() {},
      };
    }, { placement: "belowEditor" });
  }

  function hideOtherWidgets(ctx: ExtensionContext) {
    ctx.ui.setWidget("head-agent-dash", undefined);
    ctx.ui.setWidget("instance-pool", undefined);
    ctx.ui.setWidget("context-feed", undefined);
  }

  // ─── Command: /command-center (/hq) ────────────────

  pi.registerCommand("command-center", {
    description: "Activate Command Centre — Lead Orchestrator mode",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("Command Centre requires interactive mode", "error");
        return;
      }
      if (orchestratorActive) {
        ctx.ui.notify("Command Centre is already active", "info");
        return;
      }

      orchestratorActive = true;
      activatedAt = new Date().toISOString();
      currentCtx = ctx;

      // Get our username
      for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type === "custom" && entry.customType === "instance-username") {
          myUsername = (entry.data as Record<string, string>)?.name || "";
          break;
        }
      }
      if (!myUsername) myUsername = "Lead-" + shortId(instanceId || "cc");

      // 1. Hide other widgets, show ours
      hideOtherWidgets(ctx);
      registerWidget(ctx);

      // 2. Start auto-refresh
      await refreshData();
      if (refreshInterval) clearInterval(refreshInterval);
      refreshInterval = setInterval(async () => {
        await refreshData();
        if (tuiRef?.requestRender) tuiRef.requestRender();
      }, 3000);

      // 3. Footer status
      ctx.ui.setStatus("cc-mode", ctx.ui.theme.fg("accent", "\u2691 Command Centre Lead"));

      // 4. Persist
      pi.appendEntry(STORAGE_KEY, { mode: "orchestrator", instanceId });

      ctx.ui.notify("Command Centre activated — you are the Lead Orchestrator.", "success");

      // 5. Send the initial orchestrator prompt that bootstraps everything
      pi.sendUserMessage(
        "You are now the Command Centre Lead Orchestrator. Your name is " + myUsername + ".\n\n" +
        "Follow these steps in order:\n\n" +
        "1. First, use orch_list to see all active instances in the pool.\n" +
        "2. Identify which instances are idle (not this one — you are " + myUsername + ").\n" +
        "3. For each idle instance, use orch_send to send it this exact command: /head\n" +
        "   This activates the full agent team orchestrator on that instance so it can delegate to specialized agents.\n" +
        "4. If there are no other instances, use orch_spawn to create one first, then repeat step 3.\n" +
        "5. Report fleet status: how many workers are active, their names, and that you're ready to coordinate.\n\n" +
        "After setup, you coordinate high-level tasks. Workers each run their own /head mode with full delegate() capability to specialized agent teams (backend, frontend, AI/ML, infra, etc). You send tasks to workers, they break them down and delegate to their teams.\n\n" +
        "IMPORTANT RESPONSE PROTOCOL:\n" +
        "When assigning tasks via orch_task or orch_send, ALWAYS include instructions telling workers to respond via send_message addressed to you (" + myUsername + "). Workers should report: completion status, summary of work done, any issues encountered, and relevant file paths.\n" +
        "This way you receive results directly as messages rather than having to poll orch_capture."
      );
    },
  });

  pi.registerCommand("hq", {
    description: "Alias for /command-center",
    handler: async (_args, ctx) => {
      pi.sendUserMessage("/command-center", { deliverAs: "followUp" });
    },
  });

  // ─── Command: /worker (/w) — Mid-level orchestrator ──

  pi.registerCommand("worker", {
    description: "Activate as a mid-level pool orchestrator (receives tasks from Lead, delegates to agent teams)",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Activating team orchestrator mode — you will receive tasks from the Lead and delegate to specialized teams.", "success");
      pi.sendUserMessage("/head");
    },
  });

  pi.registerCommand("w", {
    description: "Alias for /worker",
    handler: async (_args, ctx) => {
      pi.sendUserMessage("/worker", { deliverAs: "followUp" });
    },
  });

  // ─── Command: /deploy-worker ───────────────────────

  pi.registerCommand("deploy-worker", {
    description: "Spawn a new worker instance (tmux pane if in tmux, RPC child process otherwise)",
    handler: async (_args, ctx) => {
      const cwd = ctx.cwd || process.cwd();
      try {
        if (isInsideTmux()) {
          const tmuxCount = [...workers.values()].filter(w => w.type === "tmux").length;
          const worker = spawnTmuxWorker(cwd, undefined, tmuxCount);
          const tempId = "tmux-pending-" + Date.now().toString(36);
          workers.set(tempId, worker);
          ctx.ui.notify("Tmux worker spawned in pane " + worker.paneId + ". Use orch_list to verify registration.", "success");
        } else {
          const worker = spawnRpcWorker(cwd);
          const tempId = "rpc-worker-" + Date.now().toString(36);
          workers.set(tempId, worker);
          ctx.ui.notify("RPC worker spawned (PID: " + worker.process.pid + "). Waiting for registration...", "success");
        }
      } catch (e: any) {
        ctx.ui.notify("Failed to spawn worker: " + (e.message || String(e)), "error");
      }
    },
  });

  // ─── Command: /cc-off ──────────────────────────────

  pi.registerCommand("cc-off", {
    description: "Deactivate Command Centre and restore normal widgets",
    handler: async (_args, ctx) => {
      orchestratorActive = false;
      if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      ctx.ui.setStatus("cc-mode", undefined);
      closeFleetView();
      ctx.ui.notify("Command Centre deactivated. Run /reload to restore widgets.", "info");
    },
  });

  // ─── Command: /cc-view ─────────────────────────────

  pi.registerCommand("cc-view", {
    description: "Open optional tmux fleet view for visual monitoring (requires tmux and tmux-based workers)",
    handler: async (_args, ctx) => {
      const result = openFleetView();
      if (result.success) {
        ctx.ui.notify("Fleet view opened! Run in another terminal: " + result.attachCmd, "success");
      } else {
        ctx.ui.notify("Could not open fleet view: " + (result.error || "unknown"), "warning");
      }
    },
  });

  pi.registerCommand("cc-view-off", {
    description: "Close the fleet view tiled window",
    handler: async (_args, ctx) => {
      closeFleetView();
      ctx.ui.notify("Fleet view closed.", "info");
    },
  });

  // ────────────────────────────────────────────────────────
  // Orchestrator Tools — LLM-callable
  // ────────────────────────────────────────────────────────

  // ── orch_list ──

  pi.registerTool({
    name: "orch_list",
    label: "List Fleet Instances",
    description: "List all active instances in the agent pool with their status, name, and connection type",
    promptSnippet: "List all active instances in the fleet",
    promptGuidelines: [
      "Use orch_list to check the fleet before assigning tasks.",
      "Report which instances are idle and ready for work.",
    ],
    parameters: Type.Object({}),
    async execute(_id, _params, _sig, _upd, _ctx) {
      await refreshData();
      if (cachedInstances.length === 0) {
        return { content: [{ type: "text", text: "No instances in the pool. Use orch_spawn to create one." }] };
      }
      const lines: string[] = ["Fleet status: " + cachedInstances.length + " instance(s)"];
      for (const inst of cachedInstances) {
        const isSelf = inst.instanceId === instanceId;
        const tag = isSelf ? " (YOU — Lead)" : "";
        const age = Math.round((Date.now() - inst.lastHeartbeat) / 1000);
        const status = age < 120 ? "active" : age < 300 ? "stale" : "dead";
        const worker = findWorkerForInstance(inst);
        let connType = "unknown";
        if (worker && worker.isAlive()) {
          if (worker.type === "tmux") {
            connType = "tmux " + worker.paneId;
          } else {
            connType = "RPC (PID:" + worker.process.pid + ")";
          }
        }
        const name = inst.username || shortId(inst.instanceId);
        lines.push(
          "  " + status.padEnd(7) + " " + name + tag + " — heartbeat " + age + "s ago — " + connType,
        );
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  });

  // ── orch_spawn ──

  pi.registerTool({
    name: "orch_spawn",
    label: "Spawn Pool Instance",
    description: "Spawn a new agent instance as a child process running pi --mode rpc. It joins the pool and you can then send it /head to activate team delegation.",
    promptSnippet: "Spawn a new agent instance",
    promptGuidelines: [
      "Use orch_spawn when the fleet needs more capacity.",
      "After spawning, use orch_list to verify registration, then orch_send to send it /head.",
    ],
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "Optional instance name" })),
    }),
    async execute(_id, params, _sig, _upd, _ctx) {
      const cwd = currentCtx?.cwd || process.cwd();
      const useTmux = isInsideTmux();
      let worker: PoolWorker;

      try {
        if (useTmux) {
          const tmuxCount = [...workers.values()].filter(w => w.type === "tmux").length;
          worker = spawnTmuxWorker(cwd, params.name, tmuxCount);
        } else {
          worker = spawnRpcWorker(cwd, params.name);
        }
      } catch (e: any) {
        return { content: [{ type: "text", text: "Failed to spawn: " + (e.message || String(e)) }], isError: true };
      }

      const tempId = (useTmux ? "tmux-pending-" : "rpc-pending-") + Date.now().toString(36);
      workers.set(tempId, worker);

      // Wait for the worker to register with the instance pool
      const preExistingIds = new Set(cachedInstances.map(i => i.instanceId));
      preExistingIds.add(instanceId);

      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 3000));
        await refreshData();

        const newInst = cachedInstances.find(inst =>
          !preExistingIds.has(inst.instanceId) &&
          !workers.has(inst.instanceId)
        );
        if (newInst) {
          workers.delete(tempId);
          workers.set(newInst.instanceId, worker);
          worker.instanceId = newInst.instanceId;
          worker.username = newInst.username;
          preExistingIds.add(newInst.instanceId);

          const connDesc = worker.type === "tmux"
            ? "tmux pane " + worker.paneId
            : "RPC (PID: " + worker.process.pid + ")";

          return {
            content: [{ type: "text", text: "Instance spawned and registered!\n  Name: " + (newInst.username || shortId(newInst.instanceId)) + "\n  Connection: " + connDesc + "\n  ID: " + newInst.instanceId + "\n\nNext step: use orch_send to send it \"/head\" to activate team delegation." }],
            details: worker.type === "tmux"
              ? { paneId: worker.paneId, instanceId: newInst.instanceId }
              : { pid: worker.process.pid, instanceId: newInst.instanceId },
          };
        }

        if (!worker.isAlive()) {
          workers.delete(tempId);
          return { content: [{ type: "text", text: "Worker exited before registering. Check pi installation." + (useTmux ? " The tmux pane may have closed — check your terminal." : "") }], isError: true };
        }
      }

      return {
        content: [{ type: "text", text: "Worker spawned (" + (useTmux ? "tmux pane " + worker.paneId : "PID: " + worker.process.pid) + ") but hasn't registered yet. Use orch_list in a moment to check." }],
      };
    },
  });

  // ── orch_send ──

  pi.registerTool({
    name: "orch_send",
    label: "Send to Instance",
    description: "Send a command or message to a specific pool instance. Works for both tmux and RPC workers. The instance receives it as user input.",
    promptSnippet: "Send a command to a pool instance",
    promptGuidelines: [
      "Use orch_send to activate /head on new instances, assign tasks, or send instructions.",
      "The command is sent to the instance (via RPC or tmux send-keys) and appears as if the user typed it.",
    ],
    parameters: Type.Object({
      instance: Type.String({ description: "Instance name or short ID" }),
      command: Type.String({ description: "Command or message to send" }),
    }),
    async execute(_id, params, _sig, _upd, _ctx) {
      await refreshData();
      const inst = resolveInstance(params.instance);
      if (!inst) {
        return { content: [{ type: "text", text: "Instance \"" + params.instance + "\" not found. Use orch_list to see available instances." }], isError: true };
      }
      if (inst.instanceId === instanceId) {
        return { content: [{ type: "text", text: "That's yourself! Use your own tools directly instead." }], isError: true };
      }

      const worker = findWorkerForInstance(inst);
      if (!worker || !worker.isAlive()) {
        const connLabel = worker?.type === "tmux" ? "tmux pane" : "RPC";
        return { content: [{ type: "text", text: "No " + connLabel + " connection to " + (inst.username || shortId(inst.instanceId)) + ". The instance may not be running." }], isError: true };
      }

      const isSlashCmd = params.command.startsWith("/");
      const messageToSend = isSlashCmd
        ? params.command
        : params.command + "\n\n---\nIMPORTANT: When done, use send_message to respond to the Lead (`" + myUsername + "`) with your results.";

      const success = await worker.sendMessage(messageToSend);
      if (!success) {
        const connLabel = worker.type === "tmux" ? "tmux send-keys" : "RPC";
        return { content: [{ type: "text", text: "Failed to send via " + connLabel + " to " + (inst.username || shortId(inst.instanceId)) + "." }], isError: true };
      }

      const name = inst.username || shortId(inst.instanceId);
      pushMessageLog({
        timestamp: new Date().toISOString(),
        direction: "out",
        from: myUsername || "lead",
        to: name,
        content: params.command,
      });

      return {
        content: [{ type: "text", text: "Sent to " + name + ": " + params.command }],
      };
    },
  });

  // ── orch_broadcast ──

  pi.registerTool({
    name: "orch_broadcast",
    label: "Broadcast to Fleet",
    description: "Send the same command to all other active instances in the pool (not yourself). Useful for activating /head on all idle instances at once.",
    promptSnippet: "Send a command to all pool instances",
    promptGuidelines: [
      "Use orch_broadcast to send /head to all idle instances at once.",
      "Also useful for fleet-wide announcements or status checks.",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Command to send to all instances" }),
    }),
    async execute(_id, params, _sig, _upd, _ctx) {
      await refreshData();
      const others = cachedInstances.filter(i => i.instanceId !== instanceId);
      if (others.length === 0) {
        return { content: [{ type: "text", text: "No other instances in the pool. Use orch_spawn first." }] };
      }
      const results: string[] = [];
      for (const inst of others) {
        const name = inst.username || shortId(inst.instanceId);
        const worker = findWorkerForInstance(inst);
        if (!worker || !worker.isAlive()) {
          const connLabel = worker?.type === "tmux" ? "tmux pane" : "RPC";
          results.push("  " + name + ": no " + connLabel + " connection — skipped");
          continue;
        }
        const success = await worker.sendMessage(params.command);
        if (success) {
          const connLabel = worker.type === "tmux" ? "tmux" : "RPC";
          results.push("  " + name + ": sent via " + connLabel);
          pushMessageLog({
            timestamp: new Date().toISOString(),
            direction: "out",
            from: myUsername || "lead",
            to: name,
            content: params.command,
          });
        } else {
          const connLabel = worker.type === "tmux" ? "tmux send-keys" : "RPC";
          results.push("  " + name + ": " + connLabel + " send failed");
        }
      }
      return {
        content: [{ type: "text", text: "Broadcast \"" + params.command + "\" to " + others.length + " instance(s):\n" + results.join("\n") }],
      };
    },
  });

  // ── orch_task ──

  pi.registerTool({
    name: "orch_task",
    label: "Assign Task",
    description: "Create a task and assign it to a specific pool instance. Send the task description to the instance so it starts working immediately.",
    promptSnippet: "Create and assign a task to a pool instance",
    promptGuidelines: [
      "Use orch_task to formally track a task assignment.",
      "Then use orch_send to actually deliver the task description to the instance.",
    ],
    parameters: Type.Object({
      description: Type.String({ description: "Clear description of the task" }),
      instance: Type.String({ description: "Instance name or short ID" }),
      priority: Type.Optional(Type.String({ description: "Priority: low, medium, high, critical" })),
    }),
    async execute(_id, params, _sig, _upd, _ctx) {
      const cwd = currentCtx?.cwd || process.cwd();
      await refreshData();
      const inst = resolveInstance(params.instance);
      if (!inst) {
        return { content: [{ type: "text", text: "Instance \"" + params.instance + "\" not found. Use orch_list first." }], isError: true };
      }

      const priority = (params.priority as "low" | "medium" | "high" | "critical") || "medium";
      const task = await createTask(cwd, params.description, priority, inst.instanceId);
      const name = inst.username || shortId(inst.instanceId);

      // Deliver the task with response instructions
      const worker = findWorkerForInstance(inst);
      let delivered = false;
      if (worker && worker.isAlive()) {
        const taskWithResponse =
          params.description +
          "\n\n---\nIMPORTANT: When you complete this task (or hit a blocking issue), use send_message to report your results back to the Lead orchestrator (`" + myUsername + "`). Include: completion status, summary of work done, any issues, and relevant file paths.";
        delivered = await worker.sendMessage(taskWithResponse);
        if (delivered) {
          pushMessageLog({
            timestamp: new Date().toISOString(),
            direction: "out",
            from: myUsername || "lead",
            to: name,
            content: params.description.slice(0, 60),
          });
        }
      }

      const connLabel = worker?.type === "tmux" ? "tmux pane " + (worker as TmuxWorker).paneId : "RPC (PID: " + (worker as RpcWorker).process?.pid + ")";
      return {
        content: [{ type: "text", text: "Task " + task.id + " assigned to " + name + ".\n  Description: " + params.description + "\n  Priority: " + priority + "\n  Status: assigned" + (delivered ? "\n  Delivered via " + connLabel : "\n  Warning: no connection — task tracked but not delivered") }],
        details: { taskId: task.id, assignedTo: inst.instanceId },
      };
    },
  });

  // ── orch_tasks ──

  pi.registerTool({
    name: "orch_tasks",
    label: "List Tasks",
    description: "List all tasks and their current status across the fleet",
    promptSnippet: "List all tasks and their status",
    promptGuidelines: [
      "Use orch_tasks to monitor progress on assigned work.",
    ],
    parameters: Type.Object({
      filter: Type.Optional(Type.String({ description: "Filter: pending, assigned, in-progress, completed, failed" })),
    }),
    async execute(_id, params, _sig, _upd, _ctx) {
      const cwd = currentCtx?.cwd || process.cwd();
      const tasks = await getTasks(cwd);
      const filtered = params.filter ? tasks.filter(t => t.status === params.filter) : tasks;
      if (filtered.length === 0) {
        return { content: [{ type: "text", text: params.filter ? "No " + params.filter + " tasks." : "No tasks yet. Use orch_task to create one." }] };
      }
      const lines = ["Tasks (" + (params.filter || "all") + "): " + filtered.length];
      for (const task of [...filtered].reverse()) {
        const assigned = task.assignedTo
          ? cachedInstances.find(i => i.instanceId === task.assignedTo)?.username || shortId(task.assignedTo)
          : "unassigned";
        lines.push(
          "  " + task.priority.padEnd(8) + " " + task.status.padEnd(12) + " " + assigned.padEnd(14) + " " + task.description.slice(0, 60),
        );
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  });

  // ── orch_kill ──

  pi.registerTool({
    name: "orch_kill",
    label: "Kill Instance",
    description: "Remove an instance from the pool — deregisters it and terminates the worker (RPC process or tmux pane)",
    promptSnippet: "Remove an instance from the fleet",
    promptGuidelines: [
      "Use orch_kill for unresponsive or unnecessary instances.",
    ],
    parameters: Type.Object({
      instance: Type.String({ description: "Instance name or short ID" }),
    }),
    async execute(_id, params, _sig, _upd, _ctx) {
      const cwd = currentCtx?.cwd || process.cwd();
      await refreshData();
      const inst = resolveInstance(params.instance);
      if (!inst) {
        return { content: [{ type: "text", text: "Instance \"" + params.instance + "\" not found." }], isError: true };
      }
      if (inst.instanceId === instanceId) {
        return { content: [{ type: "text", text: "Cannot kill yourself!" }], isError: true };
      }

      const name = inst.username || shortId(inst.instanceId);
      const worker = findWorkerForInstance(inst);
      if (worker) {
        worker.kill();
        workers.delete(inst.instanceId);
        // Rebalance tmux layout after killing a pane
        if (worker.type === "tmux") {
          try { rebalanceLayout(); } catch { /* ignore */ }
        }
      }

      try { await registryDeregister(cwd, inst.instanceId); } catch { /* best effort */ }

      pushMessageLog({
        timestamp: new Date().toISOString(),
        direction: "out",
        from: myUsername || "lead",
        to: name,
        content: "TERMINATED",
      });

      return { content: [{ type: "text", text: "Instance " + name + " terminated." }] };
    },
  });

  // ── orch_capture ──

  pi.registerTool({
    name: "orch_capture",
    label: "Capture Instance Output",
    description: "Capture recent output from a pool instance to see what it's doing",
    promptSnippet: "Check what an instance is working on",
    promptGuidelines: [
      "Use orch_capture to monitor worker progress or diagnose issues.",
    ],
    parameters: Type.Object({
      instance: Type.String({ description: "Instance name or short ID" }),
      lines: Type.Optional(Type.Number({ description: "Lines to capture (default 30)" })),
    }),
    async execute(_id, params, _sig, _upd, _ctx) {
      await refreshData();
      const inst = resolveInstance(params.instance);
      if (!inst) {
        return { content: [{ type: "text", text: "Instance \"" + params.instance + "\" not found." }], isError: true };
      }

      const worker = findWorkerForInstance(inst);
      if (!worker || !worker.isAlive()) {
        const connLabel = worker?.type === "tmux" ? "tmux pane" : "RPC";
        return { content: [{ type: "text", text: "No " + connLabel + " connection to " + (inst.username || shortId(inst.instanceId)) + "." }], isError: true };
      }

      const name = inst.username || shortId(inst.instanceId);

      try {
        if (worker.type === "tmux") {
          // Tmux worker: capture actual terminal output via tmux capture-pane
          const output = await worker.getLastAssistantText();
          if (output) {
            const maxLen = (params.lines || 30) * 120;
            const truncated = output.length > maxLen
              ? output.slice(0, maxLen) + "\n... (truncated)"
              : output;
            return {
              content: [{ type: "text", text: "Output from " + name + " (tmux pane " + worker.paneId + "):\n" + truncated }],
            };
          }
          return {
            content: [{ type: "text", text: "No output yet from " + name + " (tmux pane " + worker.paneId + "). The worker may still be starting up." }],
          };
        }

        // RPC worker: use existing logic
        const lastText = await worker.getLastAssistantText();
        if (lastText) {
          // Truncate to reasonable length
          const maxLen = (params.lines || 30) * 120;
          const truncated = lastText.length > maxLen
            ? lastText.slice(0, maxLen) + "\n... (truncated)"
            : lastText;
          return {
            content: [{ type: "text", text: "Output from " + name + " (via RPC):\n" + truncated }],
          };
        }

        // No assistant text yet — try get_state for current status
        const state = await worker.getState();
        if (state) {
          const streaming = state.isStreaming ? "STREAMING" : "idle";
          const msgCount = state.messageCount || 0;
          return {
            content: [{ type: "text", text: "Output from " + name + " (via RPC):\n  Status: " + streaming + "\n  Messages: " + msgCount + "\n  (No assistant response yet)" }],
          };
        }

        return {
          content: [{ type: "text", text: "No output available from " + name + " yet. The worker may still be starting up." }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: "Failed to capture output from " + name + ": " + (e.message || String(e)) }],
          isError: true,
        };
      }
    },
  });

  // ── orch_view ──

  pi.registerTool({
    name: "orch_view",
    label: "Open Fleet View",
    description: "Open a tiled tmux window showing all worker sessions live. When inside tmux, workers are visible in split panes — this rebalances the layout. When not in tmux, creates a separate fleet session.",
    promptSnippet: "Open live view of all worker sessions",
    promptGuidelines: [
      "Use orch_view to rebalance panes when inside tmux, or open fleet view otherwise.",
      "For RPC workers, use orch_capture to check on progress.",
    ],
    parameters: Type.Object({}),
    async execute(_id, _params, _sig, _upd, _ctx) {
      const result = openFleetView();
      if (result.isTmuxPanes) {
        return {
          content: [{ type: "text", text: "Workers are visible in your split tmux panes. Layout has been rebalanced.\n\nYou can see all workers live — no need for a separate fleet view." }],
        };
      }
      if (result.success) {
        return {
          content: [{ type: "text", text: "Fleet view opened!\n\nTo watch all workers live, open another terminal and run:\n  " + result.attachCmd + "\n\nNote: Fleet view only shows tmux-based workers. RPC workers are child processes — use orch_capture to monitor them." }],
        };
      }
      return {
        content: [{ type: "text", text: "Fleet view not available: " + (result.error || "unknown error") + "\n\nUse orch_capture to monitor workers instead." }],
      };
    },
  });

  // ────────────────────────────────────────────────────────
  // Event Handlers
  // ────────────────────────────────────────────────────────

  pi.on("before_agent_start", async (event, _ctx) => {
    if (!orchestratorActive) return;

    const orchPrompt = "\n\n## Command Centre Lead Orchestrator (ACTIVE)\n" +
      "You are the Lead Orchestrator coordinating a pool of agent instances.\n" +
      "Your name: " + myUsername + "\n\n" +
      "### Architecture (3 levels)\n" +
      "```\n" +
      "  YOU — Lead Orchestrator (this session)\n" +
      "  |         |         |\n" +
      "  Worker1  Worker2  Worker3  — Each runs /head (full team orchestrator)\n" +
      "  | | |    | | |    | | |\n" +
      "  Specialized agent teams via delegate() — backend, frontend, AI/ML, infra, etc.\n" +
      "  | | |    | | |    | | |\n" +
      "  Focused subagents via spawn_focused() — only when needed\n" +
      "```\n\n" +
      "### Communication\n" +
      "- When inside tmux: workers appear as split panes in your terminal (visible live)\n" +
      "- When not in tmux: workers run as headless RPC child processes\n" +
      "- Both modes use the same tools — orch_spawn, orch_send, orch_capture\n" +
      "- orch_view rebalances panes when in tmux\n\n" +
      "### Your Role\n" +
      "- Break high-level requests into work packages\n" +
      "- Assign each package to a worker using orch_task + orch_send\n" +
      "- Workers run /head and can further delegate to specialized agent teams\n" +
      "- Monitor progress with orch_tasks and orch_capture\n" +
      "- Synthesize results and report back to the user\n\n" +
      "### Response Protocol (CRITICAL)\n" +
      "- EVERY task you send to workers MUST include instructions to respond via send_message addressed to you (`" + myUsername + "`)\n" +
      "- orch_task and orch_send automatically append these instructions for non-slash commands\n" +
      "- Workers should report: completion status, summary of work, issues, and file paths\n" +
      "- When you receive a send_message from a worker, that IS the result — no need to poll orch_capture\n\n" +
      "### Tools\n" +
      "- **orch_list** — List all instances\n" +
      "- **orch_spawn** — Spawn a new instance (tmux pane if in tmux, RPC otherwise)\n" +
      "- **orch_send** — Send command to one instance\n" +
      "- **orch_broadcast** — Send command to ALL other instances\n" +
      "- **orch_task** — Create + assign + deliver a task\n" +
      "- **orch_tasks** — Monitor task progress\n" +
      "- **orch_kill** — Terminate an instance\n" +
      "- **orch_capture** — Check what an instance is doing\n" +
      "- **orch_view** — Rebalance panes (tmux) or open fleet view\n\n" +
      "### Rules\n" +
      "- NEVER do implementation work yourself — delegate to workers\n" +
      "- Workers handle their own delegation to specialized teams\n" +
      "- ALWAYS tell workers to respond via send_message to `" + myUsername + "` — this is automatic for orch_task and orch_send\n" +
      "- When you get a send_message response from a worker, treat it as the task result\n" +
      "- Use orch_capture as a fallback if a worker goes silent\n" +
      "- If a worker is stuck, kill it and spawn a replacement\n";

    return { systemPrompt: event.systemPrompt + orchPrompt };
  });

  // ── Session lifecycle ──

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;

    // Get instance ID from head-agent's registration
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === "instance-username") {
        myUsername = (entry.data as Record<string, string>)?.name || "";
        break;
      }
    }

    // Restore orchestrator mode if it was active
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === STORAGE_KEY) {
        const data = entry.data as { mode?: string; instanceId?: string };
        if (data?.mode === "orchestrator") {
          orchestratorActive = true;
          instanceId = data.instanceId || "";
          hideOtherWidgets(ctx);
          registerWidget(ctx);
          ctx.ui.setStatus("cc-mode", ctx.ui.theme.fg("accent", "\u2691 Command Centre Lead"));
          await refreshData();
          if (refreshInterval) clearInterval(refreshInterval);
          refreshInterval = setInterval(async () => {
            await refreshData();
            if (tuiRef?.requestRender) tuiRef.requestRender();
          }, 3000);
        }
        break;
      }
    }

    if (!instanceId) {
      instanceId = "cc-" + process.pid + "-" + Date.now().toString(36);
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    orchestratorActive = false;
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }

    // Kill all workers
    for (const [id, worker] of workers) {
      try { worker.kill(); } catch { /* best effort */ }
    }
    workers.clear();

    // Rebalance tmux layout after killing panes
    if (isInsideTmux()) {
      try { rebalanceLayout(); } catch { /* ignore */ }
    }

    if (ctx?.hasUI) {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      ctx.ui.setStatus("cc-mode", undefined);
    }
    currentCtx = null;
    tuiRef = null;
  });
}
