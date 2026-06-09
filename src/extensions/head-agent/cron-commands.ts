/**
 * /cron command — interactive management of scheduled tasks.
 *
 * Subcommands: status, list, run, enable, disable, add, remove, history, reset
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CronScheduler } from "./cron-types.js";

// ─── Formatting Helpers ──────────────────────────────

function formatInterval(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  return `${hours.toFixed(1)}h`;
}

function formatRelative(isoStr: string | null): string {
  if (!isoStr) return "—";
  const diff = new Date(isoStr).getTime() - Date.now();
  if (diff <= 0) return "now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `in ${h}h ${m % 60}m`;
}

// ─── Subcommand Handlers ─────────────────────────────

function handleCronStatus(scheduler: CronScheduler, ctx: ExtensionContext): void {
  const tasks = scheduler.getTasks();

  if (tasks.length === 0) {
    ctx.ui.notify("No cron tasks registered.", "info");
    return;
  }

  const lines: string[] = [];
  lines.push("┌─ Cron Tasks ─────────────────────────────────────────┐");

  for (const t of tasks) {
    const status = t.enabled
      ? (t.consecutiveFailures > 0 ? "⚠ failing" : "● active")
      : "○ off";
    const next = t.enabled ? formatRelative(t.nextRun) : "—";
    const interval = formatInterval(t.intervalMs);
    const errs = t.consecutiveFailures > 0 ? ` (${t.consecutiveFailures} fail)` : "";
    const line = `│ ${t.id.padEnd(18)} ${interval.padEnd(6)} ${status.padEnd(10)} ${next}${errs}`;
    lines.push(line);
  }

  lines.push("└──────────────────────────────────────────────────────┘");

  // Stats
  const totalRuns = tasks.reduce((s, t) => s + t.totalRuns, 0);
  const totalFails = tasks.reduce((s, t) => s + t.totalFailures, 0);
  const lastErr = tasks.find(t => t.lastError)?.lastError || "none";
  lines.push(`  Stats: ${totalRuns} runs, ${totalFails} failures, last error: ${lastErr}`);

  ctx.ui.notify(lines.join("\n"), "info");
}

async function handleCronRun(scheduler: CronScheduler, taskId: string | undefined, ctx: ExtensionContext): Promise<void> {
  if (!taskId) {
    ctx.ui.notify("Usage: /cron run <task-id>", "error");
    return;
  }
  const task = scheduler.getTask(taskId);
  if (!task) {
    ctx.ui.notify(`Unknown task: ${taskId}`, "error");
    return;
  }
  ctx.ui.notify(`Running ${taskId}...`, "info");
  await scheduler.runNow(taskId);
  const updated = scheduler.getTask(taskId);
  ctx.ui.notify(
    `${taskId} complete. ${updated?.lastError ? `Error: ${updated.lastError}` : "Success."}`,
    updated?.lastError ? "error" : "info",
  );
}

function handleCronEnable(scheduler: CronScheduler, taskId: string | undefined, ctx: ExtensionContext): void {
  if (!taskId) {
    ctx.ui.notify("Usage: /cron enable <task-id>", "error");
    return;
  }
  const task = scheduler.getTask(taskId);
  if (!task) {
    ctx.ui.notify(`Unknown task: ${taskId}`, "error");
    return;
  }
  scheduler.setEnabled(taskId, true);
  ctx.ui.notify(`Enabled task: ${taskId}`, "info");
}

function handleCronDisable(scheduler: CronScheduler, taskId: string | undefined, ctx: ExtensionContext): void {
  if (!taskId) {
    ctx.ui.notify("Usage: /cron disable <task-id>", "error");
    return;
  }
  const task = scheduler.getTask(taskId);
  if (!task) {
    ctx.ui.notify(`Unknown task: ${taskId}`, "error");
    return;
  }
  scheduler.setEnabled(taskId, false);
  ctx.ui.notify(`Disabled task: ${taskId}`, "info");
}

function handleCronAdd(scheduler: CronScheduler, args: string, ctx: ExtensionContext): void {
  let params: Record<string, unknown>;
  try {
    params = JSON.parse(args);
  } catch (parseErr) {
    ctx.ui.notify(`Invalid JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}\nUsage: /cron add {"id":"...","intervalMinutes":5,"description":"...","category":"custom"}`, "error");
    return;
  }

  const id = params.id as string;
  const intervalMinutes = params.intervalMinutes as number;
  const description = (params.description as string) || "";
  const category = (params.category as string) || "custom";

  if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
    ctx.ui.notify("Invalid task ID: must be lowercase with hyphens, start with a letter", "error");
    return;
  }
  if (!intervalMinutes || intervalMinutes < 1 || intervalMinutes > 1440) {
    ctx.ui.notify("intervalMinutes must be between 1 and 1440", "error");
    return;
  }

  if (scheduler.getTask(id)) {
    ctx.ui.notify(`Task "${id}" already exists. Use /cron enable/disable or /cron remove.`, "error");
    return;
  }

  const validCategories = ["health", "maintenance", "monitoring", "custom"];
  if (!validCategories.includes(category)) {
    ctx.ui.notify(`Category must be one of: ${validCategories.join(", ")}`, "error");
    return;
  }

  scheduler.register({
    id,
    description: description || `Custom task: ${id}`,
    intervalMs: intervalMinutes * 60 * 1000,
    enabled: true,
    builtin: false,
    category: category as "health" | "maintenance" | "monitoring" | "custom",
  });

  ctx.ui.notify(`Registered cron task "${id}" — runs every ${intervalMinutes} minute(s). Use /cron to manage.`, "info");
}

function handleCronRemove(scheduler: CronScheduler, taskId: string | undefined, ctx: ExtensionContext): void {
  if (!taskId) {
    ctx.ui.notify("Usage: /cron remove <task-id>", "error");
    return;
  }
  const removed = scheduler.unregister(taskId);
  if (!removed) {
    ctx.ui.notify(`Cannot remove "${taskId}": not found or is a built-in task`, "error");
    return;
  }
  ctx.ui.notify(`Removed task: ${taskId}`, "info");
}

function handleCronHistory(scheduler: CronScheduler, ctx: ExtensionContext): void {
  const history = scheduler.getHistory();
  if (history.length === 0) {
    ctx.ui.notify("No cron execution history yet.", "info");
    return;
  }

  const recent = history.slice(-20);
  const lines = recent.map(h => {
    const icon = h.success ? "+" : "x";
    const dur = h.duration ? `${h.duration}ms` : "?";
    const err = h.error ? ` — ${h.error.slice(0, 60)}` : "";
    return `[${icon}] ${h.timestamp.slice(11, 19)} ${h.taskId} (${dur})${err}`;
  });

  ctx.ui.notify(`Cron History (last ${recent.length}):\n` + lines.join("\n"), "info");
}

function handleCronReset(scheduler: CronScheduler, taskId: string | undefined, ctx: ExtensionContext): void {
  if (!taskId) {
    ctx.ui.notify("Usage: /cron reset <task-id>", "error");
    return;
  }
  const task = scheduler.getTask(taskId);
  if (!task) {
    ctx.ui.notify(`Unknown task: ${taskId}`, "error");
    return;
  }
  scheduler.resetTask(taskId);
  ctx.ui.notify(`Reset task: ${taskId} (failures cleared, re-enabled)`, "info");
}

// ─── Command Registration ────────────────────────────

export function registerCronCommand(pi: ExtensionAPI, scheduler: CronScheduler): void {
  pi.registerCommand("cron", {
    description: "Manage scheduled cron tasks (status, run, enable, disable, add, remove, history, reset)",
    getArgumentCompletions(prefix: string) {
      const subs = ["status", "list", "run", "enable", "disable", "add", "remove", "history", "reset"];
      const taskIds = scheduler.getTasks().map(t => t.id);
      const completions = [
        ...subs.filter(s => s.startsWith(prefix)),
        ...subs
          .filter(s => ["run", "enable", "disable", "remove", "reset"].includes(s))
          .flatMap(s => taskIds.map(id => `${s} ${id}`)),
      ];
      return completions.filter(c => c.startsWith(prefix)).map(c => ({ value: c, label: c }));
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const sub = parts[0] || "status";

      switch (sub) {
        case "status":
        case "list":
          handleCronStatus(scheduler, ctx);
          break;
        case "run":
          await handleCronRun(scheduler, parts[1], ctx);
          break;
        case "enable":
          handleCronEnable(scheduler, parts[1], ctx);
          break;
        case "disable":
          handleCronDisable(scheduler, parts[1], ctx);
          break;
        case "add":
          handleCronAdd(scheduler, parts.slice(1).join(" "), ctx);
          break;
        case "remove":
          handleCronRemove(scheduler, parts[1], ctx);
          break;
        case "history":
          handleCronHistory(scheduler, ctx);
          break;
        case "reset":
          handleCronReset(scheduler, parts[1], ctx);
          break;
        default:
          ctx.ui.notify(
            `/cron subcommands:\n` +
            `  status          — Show all tasks\n` +
            `  list            — Alias for status\n` +
            `  run <id>        — Run a task immediately\n` +
            `  enable <id>     — Enable a task\n` +
            `  disable <id>    — Disable a task\n` +
            `  add <json>      — Add a custom task\n` +
            `  remove <id>     — Remove a custom task\n` +
            `  history         — Show recent execution log\n` +
            `  reset <id>      — Reset failures and re-enable`,
            "info",
          );
      }
    },
  });
}
