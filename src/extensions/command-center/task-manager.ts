/**
 * Task Manager — CRUD operations on the shared task queue file.
 *
 * Task file lives at `.agents/command-center/tasks.json`.
 * Uses atomic writes (write .tmp + rename) for crash safety.
 * Reuses the wj/rj pattern from head-agent/helpers.ts.
 */
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import type { Task, TaskFile, TaskStatus, TaskPriority } from "./types.js";

// ─── Path Helpers ────────────────────────────────────────

const agentsDir = (cwd: string) => path.join(cwd, ".agents");
const taskFilePath = (cwd: string) => path.join(agentsDir(cwd), "command-center", "tasks.json");

// ─── File I/O ────────────────────────────────────────────

async function readFile(cwd: string): Promise<TaskFile> {
  const fp = taskFilePath(cwd);
  try {
    const content = await fs.readFile(fp, "utf-8");
    const data = JSON.parse(content);
    return data && data.tasks ? data : { tasks: [], nextId: 1 };
  } catch {
    return { tasks: [], nextId: 1 };
  }
}

async function writeFile(cwd: string, data: TaskFile): Promise<void> {
  const fp = taskFilePath(cwd);
  await fs.mkdir(path.dirname(fp), { recursive: true });
  const tmpPath = fp + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n");
  await fs.rename(tmpPath, fp);
}

// ─── Public API ──────────────────────────────────────────

/** Generate a unique task ID. */
function taskId(): string {
  return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Create a new task. */
export async function createTask(
  cwd: string,
  description: string,
  priority: TaskPriority = "medium",
  assignedTo: string | null = null,
): Promise<Task> {
  const data = await readFile(cwd);
  const now = new Date().toISOString();
  const task: Task = {
    id: taskId(),
    description,
    status: assignedTo ? "assigned" : "pending",
    assignedTo,
    result: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    priority,
  };
  data.tasks.push(task);
  await writeFile(cwd, data);
  return task;
}

/** Get all tasks. */
export async function getTasks(cwd: string): Promise<Task[]> {
  const data = await readFile(cwd);
  return data.tasks;
}

/** Get a single task by ID. */
export async function getTask(cwd: string, taskId: string): Promise<Task | null> {
  const data = await readFile(cwd);
  return data.tasks.find(t => t.id === taskId) ?? null;
}

/** Update task status. */
export async function updateTaskStatus(
  cwd: string,
  taskId: string,
  status: TaskStatus,
  result?: string,
): Promise<Task | null> {
  const data = await readFile(cwd);
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) return null;

  task.status = status;
  task.updatedAt = new Date().toISOString();
  if (result !== undefined) task.result = result;
  if (status === "completed" || status === "failed") {
    task.completedAt = new Date().toISOString();
  }
  if (status === "in-progress" && !task.assignedTo) {
    // Keep assignedTo as-is if already set
  }
  await writeFile(cwd, data);
  return task;
}

/** Assign a task to an instance. */
export async function assignTask(
  cwd: string,
  taskId: string,
  instanceId: string,
): Promise<Task | null> {
  const data = await readFile(cwd);
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) return null;

  task.assignedTo = instanceId;
  task.status = "assigned";
  task.updatedAt = new Date().toISOString();
  await writeFile(cwd, data);
  return task;
}

/** Unassign a task (return to pending). */
export async function unassignTask(
  cwd: string,
  taskId: string,
): Promise<Task | null> {
  const data = await readFile(cwd);
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) return null;

  task.assignedTo = null;
  task.status = "pending";
  task.updatedAt = new Date().toISOString();
  await writeFile(cwd, data);
  return task;
}

/** Delete a task. */
export async function deleteTask(
  cwd: string,
  taskId: string,
): Promise<boolean> {
  const data = await readFile(cwd);
  const idx = data.tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return false;
  data.tasks.splice(idx, 1);
  await writeFile(cwd, data);
  return true;
}

/** Get tasks assigned to a specific instance. */
export async function getTasksForInstance(
  cwd: string,
  instanceId: string,
): Promise<Task[]> {
  const data = await readFile(cwd);
  return data.tasks.filter(t => t.assignedTo === instanceId);
}

/** Get pending (unassigned) tasks. */
export async function getPendingTasks(cwd: string): Promise<Task[]> {
  const data = await readFile(cwd);
  return data.tasks.filter(t => t.status === "pending");
}

/** Get next pending task for a worker to pick up. */
export async function getNextTaskForWorker(
  cwd: string,
  instanceId: string,
): Promise<Task | null> {
  const data = await readFile(cwd);
  // First check for tasks assigned to this instance
  const assigned = data.tasks.find(t => t.assignedTo === instanceId && t.status === "assigned");
  if (assigned) return assigned;
  // Then check for pending tasks
  const pending = data.tasks.find(t => t.status === "pending");
  if (pending) {
    pending.assignedTo = instanceId;
    pending.status = "assigned";
    pending.updatedAt = new Date().toISOString();
    await writeFile(cwd, data);
    return pending;
  }
  return null;
}
