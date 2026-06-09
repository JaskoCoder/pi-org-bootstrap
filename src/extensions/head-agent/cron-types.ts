/**
 * Type definitions for the autonomous cron scheduler.
 */
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

// ─── Scheduled Task ───────────────────────────────────────

export interface ScheduledTask {
  /** Unique task identifier (lowercase, hyphens only) */
  id: string;
  /** Human-readable description */
  description: string;
  /** Schedule interval in milliseconds */
  intervalMs: number;
  /** Whether the task is enabled */
  enabled: boolean;
  /** ISO timestamp of last successful run */
  lastRun: string | null;
  /** ISO timestamp of next scheduled run */
  nextRun: string | null;
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Total runs */
  totalRuns: number;
  /** Total failures */
  totalFailures: number;
  /** Last error message */
  lastError: string | null;
  /** ISO timestamp of creation */
  createdAt: string;
  /** Whether this is a built-in task (cannot be removed) */
  builtin: boolean;
  /** Task category for grouping */
  category: "health" | "maintenance" | "monitoring" | "custom";
}

// ─── Task Executor ────────────────────────────────────────

export type TaskExecutor = (ctx: ExtensionContext) => Promise<void>;

export interface TaskDefinition {
  id: string;
  description: string;
  intervalMs: number;
  category: "health" | "maintenance" | "monitoring" | "custom";
  builtin: boolean;
  executor: TaskExecutor;
}

// ─── Cron Scheduler Config ────────────────────────────────

export interface CronSchedulerConfig {
  /** Path to cron.json persistence file */
  statePath: string;
  /** Max concurrent tasks (default: 1 — run serially) */
  maxConcurrency: number;
  /** Default cooldown after a task failure (ms, default: 60000) */
  failureCooldown: number;
  /** Max consecutive failures before auto-disabling (default: 5) */
  maxConsecutiveFailures: number;
  /** Task execution timeout (ms, default: 30000) */
  taskTimeout: number;
}

// ─── Cron Persistence State ───────────────────────────────

export interface CronHistoryEntry {
  taskId: string;
  timestamp: string;
  success: boolean;
  duration: number;
  error: string | null;
}

export interface CronState {
  version: number;
  tasks: ScheduledTask[];
  actions: Record<string, string>;
  history: CronHistoryEntry[];
}

// ─── Cron Scheduler Interface ─────────────────────────────

export interface CronScheduler {
  /** Load state from cron.json and start timers */
  start(ctx: ExtensionContext): Promise<void>;
  /** Stop all timers and save state */
  stop(): Promise<void>;
  /** Register a new task */
  register(task: Omit<ScheduledTask, "lastRun" | "nextRun" | "consecutiveFailures" | "totalRuns" | "totalFailures" | "lastError" | "createdAt">): void;
  /** Remove a task by ID (cannot remove built-in tasks) */
  unregister(taskId: string): boolean;
  /** Enable/disable a task */
  setEnabled(taskId: string, enabled: boolean): void;
  /** Run a task immediately */
  runNow(taskId: string): Promise<void>;
  /** Get all tasks with current state */
  getTasks(): ScheduledTask[];
  /** Get a single task */
  getTask(taskId: string): ScheduledTask | undefined;
  /** Register a task executor */
  registerExecutor(taskId: string, executor: TaskExecutor): void;
  /** Register a custom task action (for agent-triggered tasks) */
  setTaskAction(taskId: string, action: string): void;
  /** Get a task action template */
  getTaskAction(taskId: string): string | undefined;
  /** Get execution history */
  getHistory(): CronHistoryEntry[];
  /** Reset failure count and re-enable a task */
  resetTask(taskId: string): void;
  /** Check if scheduler is running */
  isRunning(): boolean;
}
