/**
 * Worker Poller — Polls task file for assignments when in worker mode.
 *
 * When activated, periodically checks `.agents/command-center/tasks.json`
 * for tasks assigned to this instance. When a new task is found:
 * 1. Updates status to "in-progress"
 * 2. Sends it as a user message to the agent via pi.sendUserMessage()
 * 3. Monitors for completion
 *
 * Also provides a worker status widget for the TUI footer.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getNextTaskForWorker, updateTaskStatus } from "./task-manager.js";
import type { WorkerState } from "./types.js";

// ─── Worker Poller ───────────────────────────────────────

export class WorkerPoller {
  private state: WorkerState;
  private pi: ExtensionAPI;
  private interval: ReturnType<typeof setInterval> | null = null;
  private currentProcessing = false;
  private knownTaskIds = new Set<string>();

  constructor(pi: ExtensionAPI, instanceId: string) {
    this.pi = pi;
    this.state = {
      active: false,
      instanceId,
      currentTaskId: null,
      currentTaskDescription: null,
      pollingIntervalMs: 10_000,  // 10 seconds default
    };
  }

  /** Start polling for tasks. */
  start(cwd: string): void {
    if (this.state.active) return;
    this.state.active = true;
    this._cwd = cwd;

    // Pre-populate known task IDs so we don't re-execute old tasks
    getNextTaskForWorker(cwd, this.state.instanceId).catch(() => {});

    this.interval = setInterval(async () => {
      await this.poll(cwd);
    }, this.state.pollingIntervalMs);

    // Do first poll immediately
    setTimeout(() => this.poll(cwd), 1000);
  }

  /** Stop polling. */
  stop(): void {
    this.state.active = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** Get current worker state (for widget rendering). */
  getState(): WorkerState {
    return { ...this.state };
  }

  private _cwd: string = "";

  /** Update polling interval. */
  setIntervalMs(ms: number): void {
    this.state.pollingIntervalMs = ms;
    // Restart interval with new timing if active
    if (this.state.active && this.interval) {
      clearInterval(this.interval);
      this.interval = setInterval(async () => {
        await this.poll(this._cwd);
      }, ms);
    }
  }

  // ─── Internal ──────────────────────────────────────

  private async poll(cwd: string): Promise<void> {
    if (!this.state.active || this.currentProcessing) return;

    try {
      const task = await getNextTaskForWorker(cwd, this.state.instanceId);
      if (!task) return;

      // Skip already-known tasks
      if (this.knownTaskIds.has(task.id)) return;

      this.knownTaskIds.add(task.id);
      this.state.currentTaskId = task.id;
      this.state.currentTaskDescription = task.description;
      this.currentProcessing = true;

      // Update status to in-progress
      await updateTaskStatus(cwd, task.id, "in-progress");

      // Send task as a natural user request — not bracketed injection syntax
      const taskMessage = task.description +
        "\n\nPlease work on this task using your available tools. When you're done, briefly summarize what you accomplished.";

      this.pi.sendUserMessage(taskMessage);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write("[command-center:worker] poll error: " + msg + "\n");
    }
  }

  /** Mark current task as completed (called after agent finishes a worker task). */
  async completeCurrentTask(cwd: string, result: string): Promise<void> {
    if (!this.state.currentTaskId) return;

    await updateTaskStatus(cwd, this.state.currentTaskId, "completed", result);
    this.state.currentTaskId = null;
    this.state.currentTaskDescription = null;
    this.currentProcessing = false;
  }

  /** Mark current task as failed. */
  async failCurrentTask(cwd: string, error: string): Promise<void> {
    if (!this.state.currentTaskId) return;

    await updateTaskStatus(cwd, this.state.currentTaskId, "failed", error);
    this.state.currentTaskId = null;
    this.state.currentTaskDescription = null;
    this.currentProcessing = false;
  }
}
