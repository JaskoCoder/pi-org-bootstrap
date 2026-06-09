/**
 * Core cron scheduler — timer-based scheduling with persistence.
 *
 * Key properties:
 * - Non-blocking: all tasks are async, run in Node.js event loop
 * - No drift: next timer scheduled AFTER execution completes
 * - Crash safety: try/catch on every task, atomic state writes
 * - Graceful shutdown: cancel all timers, save state
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type {
  CronScheduler,
  CronSchedulerConfig,
  CronState,
  CronHistoryEntry,
  ScheduledTask,
  TaskExecutor,
} from "./cron-types.js";

const DEFAULT_CONFIG: CronSchedulerConfig = {
  statePath: "",
  maxConcurrency: 1,
  failureCooldown: 60_000,
  maxConsecutiveFailures: 5,
  taskTimeout: 30_000,
};

const CRON_MAX_HISTORY = 100;

export function createCronScheduler(
  config: Partial<CronSchedulerConfig> & { statePath: string },
): CronScheduler {
  const cfg: CronSchedulerConfig = { ...DEFAULT_CONFIG, ...config };
  const timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  const running: Set<string> = new Set();
  const tasks: Map<string, ScheduledTask> = new Map();
  const executors: Map<string, TaskExecutor> = new Map();
  const taskActions: Map<string, string> = new Map();
  const history: CronHistoryEntry[] = [];
  const failureCooldowns: Map<string, ReturnType<typeof setTimeout>> = new Map();
  let ctx: ExtensionContext | null = null;
  let started = false;

  /** Trim history to CRON_MAX_HISTORY, keeping the most recent entries. */
  function trimHistory(): void {
    if (history.length > CRON_MAX_HISTORY) {
      history.splice(0, history.length - CRON_MAX_HISTORY);
    }
  }

  // ─── Persistence ───────────────────────────────────

  function createDefaultState(): CronState {
    return { version: 1, tasks: [], actions: {}, history: [] };
  }

  async function loadState(): Promise<CronState> {
    try {
      const content = await fs.readFile(cfg.statePath, "utf-8");
      const parsed = JSON.parse(content);
      if (!parsed || parsed.version !== 1) return createDefaultState();
      return parsed as CronState;
    } catch (err) {
      appendCronLogSync("scheduler", "loadState: using defaults — " + (err instanceof Error ? err.message : String(err)));
      return createDefaultState();
    }
  }

  async function saveState(): Promise<void> {
    try {
      const state: CronState = {
        version: 1,
        tasks: Array.from(tasks.values()),
        actions: Object.fromEntries(taskActions),
        history: history.slice(-100),
      };

      const dir = path.dirname(cfg.statePath);
      await fs.mkdir(dir, { recursive: true });

      const tmpPath = cfg.statePath + ".tmp";
      const backupPath = cfg.statePath + ".bak";

      // Write to temp file
      await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), "utf-8");

      // Backup existing
      try {
        await fs.rename(cfg.statePath, backupPath);
      } catch {
        // No existing file — expected on first run
      }

      // Atomically move temp to real path
      await fs.rename(tmpPath, cfg.statePath);

      // Clean up backup on success
      try {
        await fs.unlink(backupPath);
      } catch {
        // Backup already removed — ok
      }
    } catch (err) {
      appendCronLogSync("scheduler", "Failed to save state: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  // ─── Cron Log ──────────────────────────────────────

  function appendCronLogSync(taskId: string, message: string): void {
    const logPath = path.join(path.dirname(cfg.statePath), "cron.log");
    const line = `[${new Date().toISOString()}] [${taskId}] ${message}\n`;
    // Fire-and-forget append
    fs.appendFile(logPath, line, "utf-8").catch(() => {});
  }

  async function appendCronLog(taskId: string, message: string): Promise<void> {
    const logPath = path.join(path.dirname(cfg.statePath), "cron.log");
    const line = `[${new Date().toISOString()}] [${taskId}] ${message}\n`;
    try {
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.appendFile(logPath, line, "utf-8");

      // Rotate cron.log if too large (> 1MB)
      try {
        const stat = await fs.stat(logPath);
        if (stat.size > 1024 * 1024) {
          const content = await fs.readFile(logPath, "utf-8");
          await fs.writeFile(logPath, content.slice(-512 * 1024), "utf-8");
        }
      } catch {
        // Rotation failed — log still usable
      }
    } catch (err) {
      // Best-effort logging — use sync fallback since async log itself failed
      try { process.stderr.write(`[cron-log-err] ${err instanceof Error ? err.message : String(err)}\n`); } catch { /* give up */ }
    }
  }

  // ─── Timer Management ──────────────────────────────

  function cancelTimer(taskId: string): void {
    const timer = timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      timers.delete(taskId);
    }
  }

  function scheduleTask(task: ScheduledTask): void {
    cancelTimer(task.id);

    const now = Date.now();
    const lastRun = task.lastRun ? new Date(task.lastRun).getTime() : 0;
    const elapsed = now - lastRun;
    const delay = Math.max(0, task.intervalMs - elapsed);

    const timer = setTimeout(async () => {
      await executeTask(task.id);
      // Re-schedule AFTER execution completes (prevents drift)
      const current = tasks.get(task.id);
      if (current?.enabled) {
        scheduleTask(current);
      }
    }, delay);

    timers.set(task.id, timer);
    task.nextRun = new Date(now + delay).toISOString();
  }

  // ─── Task Execution ────────────────────────────────

  async function executeTask(taskId: string): Promise<void> {
    if (running.has(taskId)) return; // Prevent concurrent execution
    running.add(taskId);

    const task = tasks.get(taskId);
    const executor = executors.get(taskId);
    if (!task || !executor) {
      running.delete(taskId);
      return;
    }

    const startTime = Date.now();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      // Execute with timeout — clean up timeout timer to prevent leak
      await Promise.race([
        executor(ctx!),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Task timed out after " + cfg.taskTimeout + "ms")),
            cfg.taskTimeout,
          );
        }),
      ]);
      // Executor finished first — clear the timeout timer
      if (timeoutId !== undefined) clearTimeout(timeoutId);

      task.lastRun = new Date().toISOString();
      task.consecutiveFailures = 0;
      task.totalRuns++;
      task.lastError = null;

      const duration = Date.now() - startTime;
      history.push({
        taskId,
        timestamp: new Date().toISOString(),
        success: true,
        duration,
        error: null,
      });
      trimHistory();

      await appendCronLog(taskId, `OK (${duration}ms)`);
    } catch (err) {
      // Clear timeout if executor threw (not timeout)
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      task.consecutiveFailures++;
      task.totalFailures++;
      task.totalRuns++;
      task.lastError = err instanceof Error ? err.message : String(err);

      const duration = Date.now() - startTime;
      history.push({
        taskId,
        timestamp: new Date().toISOString(),
        success: false,
        duration,
        error: task.lastError,
      });
      trimHistory();

      // Auto-disable after too many failures
      if (task.consecutiveFailures >= cfg.maxConsecutiveFailures) {
        task.enabled = false;
        cancelTimer(taskId);
        // Clear any failure cooldown timer
        const cooldownTimer = failureCooldowns.get(taskId);
        if (cooldownTimer) {
          clearTimeout(cooldownTimer);
          failureCooldowns.delete(taskId);
        }
        await appendCronLog(taskId, `AUTO-DISABLED after ${task.consecutiveFailures} failures: ${task.lastError}`);
        // Notify user
        try {
          ctx?.ui?.notify?.(
            `Cron task "${task.id}" auto-disabled after ${task.consecutiveFailures} failures: ${task.lastError}`,
            "error",
          );
        } catch (uiErr) {
          appendCronLogSync(taskId, "UI notify failed: " + (uiErr instanceof Error ? uiErr.message : String(uiErr)));
        }
      } else {
        await appendCronLog(taskId, `FAIL: ${task.lastError}`);
      }
    } finally {
      running.delete(taskId);
      await saveState();
    }
  }

  // ─── Scheduler Lifecycle ───────────────────────────

  const scheduler: CronScheduler = {
    async start(startCtx: ExtensionContext): Promise<void> {
      ctx = startCtx;
      if (started) return;
      started = true;

      const state = await loadState();

      // Restore tasks from persisted state
      for (const task of state.tasks) {
        tasks.set(task.id, task);
      }

      // Restore custom task actions
      if (state.actions) {
        for (const [id, action] of Object.entries(state.actions)) {
          taskActions.set(id, action);
        }
      }

      // Restore history
      if (state.history) {
        history.push(...state.history);
        trimHistory();
      }

      // Register executor for custom tasks (agent-triggered)
      for (const [id, _action] of taskActions) {
        if (!executors.has(id)) {
          // Custom task: sends a message to the agent
          executors.set(id, async (_taskCtx: ExtensionContext) => {
            const taskAction = taskActions.get(id);
            if (taskAction) {
              await appendCronLog(id, `Triggering agent action: ${taskAction}`);
            }
          });
        }
      }

      // Schedule timers for each enabled task
      for (const task of tasks.values()) {
        if (task.enabled && executors.has(task.id)) {
          scheduleTask(task);
        }
      }

      await appendCronLog("scheduler", `Started with ${tasks.size} tasks (${Array.from(tasks.values()).filter(t => t.enabled).length} enabled)`);
    },

    async stop(): Promise<void> {
      if (!started) return;
      started = false;

      // Cancel all timers
      for (const taskId of timers.keys()) {
        cancelTimer(taskId);
      }

      // Wait for running tasks (with timeout)
      const deadline = Date.now() + 5000;
      while (running.size > 0 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 100));
      }

      await saveState();
      await appendCronLog("scheduler", "Stopped");
      ctx = null;
    },

    register(task: Omit<ScheduledTask, "lastRun" | "nextRun" | "consecutiveFailures" | "totalRuns" | "totalFailures" | "lastError" | "createdAt">): void {
      const fullTask: ScheduledTask = {
        ...task,
        lastRun: null,
        nextRun: null,
        consecutiveFailures: 0,
        totalRuns: 0,
        totalFailures: 0,
        lastError: null,
        createdAt: new Date().toISOString(),
      };
      tasks.set(fullTask.id, fullTask);

      // If enabled and we have an executor, schedule it
      if (fullTask.enabled && executors.has(fullTask.id) && started) {
        scheduleTask(fullTask);
      }

      // Fire-and-forget save
      saveState().catch((err) => { appendCronLogSync("scheduler", "saveState failed in register: " + (err instanceof Error ? err.message : String(err))); });
    },

    unregister(taskId: string): boolean {
      const task = tasks.get(taskId);
      if (!task || task.builtin) return false;

      cancelTimer(taskId);
      tasks.delete(taskId);
      executors.delete(taskId);
      taskActions.delete(taskId);

      saveState().catch((err) => { appendCronLogSync("scheduler", "saveState failed in unregister: " + (err instanceof Error ? err.message : String(err))); });
      return true;
    },

    setEnabled(taskId: string, enabled: boolean): void {
      const task = tasks.get(taskId);
      if (!task) return;

      task.enabled = enabled;
      if (enabled && executors.has(taskId) && started) {
        scheduleTask(task);
      } else if (!enabled) {
        cancelTimer(taskId);
        task.nextRun = null;
      }

      saveState().catch((err) => { appendCronLogSync("scheduler", "saveState failed in setEnabled: " + (err instanceof Error ? err.message : String(err))); });
    },

    async runNow(taskId: string): Promise<void> {
      await executeTask(taskId);
      // Re-schedule if still enabled
      const task = tasks.get(taskId);
      if (task?.enabled && started) {
        scheduleTask(task);
      }
    },

    getTasks(): ScheduledTask[] {
      return Array.from(tasks.values());
    },

    getTask(taskId: string): ScheduledTask | undefined {
      return tasks.get(taskId);
    },

    registerExecutor(taskId: string, executor: TaskExecutor): void {
      executors.set(taskId, executor);
    },

    setTaskAction(taskId: string, action: string): void {
      taskActions.set(taskId, action);
    },

    getTaskAction(taskId: string): string | undefined {
      return taskActions.get(taskId);
    },

    getHistory(): CronHistoryEntry[] {
      return [...history];
    },

    resetTask(taskId: string): void {
      const task = tasks.get(taskId);
      if (!task) return;

      task.consecutiveFailures = 0;
      task.lastError = null;
      task.enabled = true;

      if (executors.has(taskId) && started) {
        scheduleTask(task);
      }

      saveState().catch((err) => { appendCronLogSync("scheduler", "saveState failed in resetTask: " + (err instanceof Error ? err.message : String(err))); });
    },

    isRunning(): boolean {
      return started;
    },
  };

  return scheduler;
}

// ─── Cron Log Helper (for use by task executors) ──────

export async function appendCronLog(statePath: string, taskId: string, message: string): Promise<void> {
  const logPath = path.join(path.dirname(statePath), "cron.log");
  const line = `[${new Date().toISOString()}] [${taskId}] ${message}\n`;
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, line, "utf-8");

    // Rotate cron.log if too large (> 1MB)
    try {
      const stat = await fs.stat(logPath);
      if (stat.size > 1024 * 1024) {
        const content = await fs.readFile(logPath, "utf-8");
        await fs.writeFile(logPath, content.slice(-512 * 1024), "utf-8");
      }
    } catch {
      // Rotation failed — log still usable
    }
  } catch (err) {
    try { process.stderr.write(`[cron-log-err] ${err instanceof Error ? err.message : String(err)}\n`); } catch { /* give up */ }
  }
}
