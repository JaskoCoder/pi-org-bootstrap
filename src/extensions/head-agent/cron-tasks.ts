/**
 * Built-in cron task executors and registry.
 *
 * Tasks:
 * - health-check (5 min): process memory, debug log size, session stats
 * - log-rotate (15 min): truncate debug log when > 10MB
 * - session-cleanup (30 min): remove stale session files > 7 days
 * - memory-check (2 min): watch RSS, warn on high memory
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CronScheduler, TaskDefinition } from "./cron-types.js";

// Re-export the shared cron log helper from the scheduler
import { appendCronLog as _appendCronLog } from "./cron-scheduler.js";

const CRON_STATE_PATH = path.join(os.homedir(), ".pi", "agent", "cron.json");

async function appendCronLog(taskId: string, message: string): Promise<void> {
  return _appendCronLog(CRON_STATE_PATH, taskId, message);
}

// ─── Built-in Task: health-check ─────────────────────

const healthCheckTask: TaskDefinition = {
  id: "health-check",
  description: "Run pi diagnostics: check process memory, debug log size, session stats",
  intervalMs: 5 * 60 * 1000,
  category: "health",
  builtin: true,
  async executor(ctx: ExtensionContext): Promise<void> {
    const results: string[] = [];
    const mem = process.memoryUsage();

    // Memory check
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    results.push(`Memory: heap=${heapMB}MB rss=${rssMB}MB`);

    if (rssMB > 512) {
      results.push(`WARNING: RSS exceeds 512MB`);
    }

    // Debug log check
    const debugLogPath = path.join(os.homedir(), ".pi", "agent", "pi-debug.log");
    try {
      const stat = await fs.stat(debugLogPath);
      const sizeMB = stat.size / 1024 / 1024;
      results.push(`Debug log: ${sizeMB.toFixed(1)}MB`);
      if (sizeMB > 10) {
        results.push(`WARNING: Debug log exceeds 10MB — log-rotate should handle this`);
      }
    } catch (err) {
      results.push(`Debug log: (stat failed: ${err instanceof Error ? err.message : String(err)})`);
    }

    // Session count
    try {
      const entries = ctx.sessionManager.getEntries();
      results.push(`Session entries: ${entries.length}`);
    } catch (err) {
      results.push(`Session entries: (unavailable: ${err instanceof Error ? err.message : String(err)})`);
    }

    await appendCronLog("health-check", results.join(" | "));
  },
};

// ─── Built-in Task: log-rotate ───────────────────────

const logRotateTask: TaskDefinition = {
  id: "log-rotate",
  description: "Rotate/truncate pi-debug.log when it exceeds 10MB; keep last 1MB as tail",
  intervalMs: 15 * 60 * 1000,
  category: "maintenance",
  builtin: true,
  async executor(_ctx: ExtensionContext): Promise<void> {
    const logPath = path.join(os.homedir(), ".pi", "agent", "pi-debug.log");
    const maxSize = 10 * 1024 * 1024; // 10MB
    const keepSize = 1 * 1024 * 1024;  // 1MB tail

    try {
      const stat = await fs.stat(logPath);
      if (stat.size <= maxSize) return; // No rotation needed

      // Read the tail, write it back
      const content = await fs.readFile(logPath, "utf-8");
      const tail = content.slice(-keepSize);
      await fs.writeFile(logPath, tail, "utf-8");

      await appendCronLog(
        "log-rotate",
        `Rotated: ${Math.round(stat.size / 1024 / 1024)}MB → ${Math.round(tail.length / 1024)}KB`,
      );
    } catch (err) {
      await appendCronLog("log-rotate", `Rotation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

// ─── Built-in Task: session-cleanup ──────────────────

const sessionCleanupTask: TaskDefinition = {
  id: "session-cleanup",
  description: "Clean stale session temp files and orphaned debug state files",
  intervalMs: 30 * 60 * 1000,
  category: "maintenance",
  builtin: true,
  async executor(ctx: ExtensionContext): Promise<void> {
    const sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");
    let cleaned = 0;

    try {
      const files = await fs.readdir(sessionsDir);
      const now = Date.now();
      const staleAge = 7 * 24 * 60 * 60 * 1000; // 7 days

      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const filePath = path.join(sessionsDir, file);
        const stat = await fs.stat(filePath);
        if (now - stat.mtimeMs > staleAge) {
          await fs.unlink(filePath);
          cleaned++;
        }
      }
    } catch (err) {
      await appendCronLog("session-cleanup", `sessions dir error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Clean stale pipeline temp files
    const pipelineDir = path.join(ctx.cwd || process.cwd(), ".agents", "pipeline");
    try {
      const tmpFiles = await fs.readdir(pipelineDir);
      for (const f of tmpFiles) {
        if (f.startsWith("tmp-") || f.endsWith(".tmp")) {
          const stat = await fs.stat(path.join(pipelineDir, f));
          if (Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) {
            await fs.unlink(path.join(pipelineDir, f));
            cleaned++;
          }
        }
      }
    } catch (err) {
      await appendCronLog("session-cleanup", `pipeline dir error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (cleaned > 0) {
      await appendCronLog("session-cleanup", `Cleaned ${cleaned} stale files`);
    }
  },
};

// ─── Built-in Task: memory-check ─────────────────────

const memoryCheckTask: TaskDefinition = {
  id: "memory-check",
  description: "Monitor process memory; warn and attempt GC if RSS exceeds threshold",
  intervalMs: 2 * 60 * 1000,
  category: "monitoring",
  builtin: true,
  async executor(ctx: ExtensionContext): Promise<void> {
    const mem = process.memoryUsage();
    const rssMB = mem.rss / 1024 / 1024;
    const threshold = 768; // MB

    if (rssMB > threshold) {
      // Attempt garbage collection if exposed
      if ((globalThis as { gc?: () => void }).gc) {
        (globalThis as { gc: () => void }).gc();
        const afterGC = process.memoryUsage();
        const afterMB = afterGC.rss / 1024 / 1024;
        await appendCronLog(
          "memory-check",
          `High memory: ${Math.round(rssMB)}MB → ${Math.round(afterMB)}MB after GC`,
        );
        if (afterMB > threshold) {
          try {
            ctx.ui.setStatus("cron-memory",
              ctx.ui.theme.fg("warning", `⚠ High memory: ${Math.round(afterMB)}MB`),
            );
          } catch (uiErr) {
            await appendCronLog("memory-check", `UI setStatus failed: ${uiErr instanceof Error ? uiErr.message : String(uiErr)}`);
          }
        }
      } else {
        await appendCronLog(
          "memory-check",
          `High memory: ${Math.round(rssMB)}MB (GC not exposed — run with --expose-gc)`,
        );
      }
    } else {
      // Clear warning if memory is fine
      try {
        ctx.ui.setStatus("cron-memory", undefined);
      } catch (uiErr) {
        await appendCronLog("memory-check", `UI clearStatus failed: ${uiErr instanceof Error ? uiErr.message : String(uiErr)}`);
      }
    }
  },
};

// ─── Built-in Task Registry ──────────────────────────

const BUILTIN_TASKS: TaskDefinition[] = [
  healthCheckTask,
  logRotateTask,
  sessionCleanupTask,
  memoryCheckTask,
];

/**
 * Register all built-in tasks with the scheduler.
 * Should be called before scheduler.start().
 */
export function registerBuiltinTasks(scheduler: CronScheduler): void {
  for (const def of BUILTIN_TASKS) {
    scheduler.registerExecutor(def.id, def.executor);
    // Only register task definition if not already persisted
    const existing = scheduler.getTask(def.id);
    if (!existing) {
      scheduler.register({
        id: def.id,
        description: def.description,
        intervalMs: def.intervalMs,
        enabled: true,
        builtin: def.builtin,
        category: def.category,
      });
    } else {
      // Update executor reference even if task was persisted
      scheduler.registerExecutor(def.id, def.executor);
    }
  }
}
