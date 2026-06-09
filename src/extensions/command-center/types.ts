/**
 * Shared types for the Command Center extension.
 */

// ─── Task Types ──────────────────────────────────────────

export type TaskStatus = "pending" | "assigned" | "in-progress" | "completed" | "failed";
export type TaskPriority = "low" | "medium" | "high" | "critical";

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  assignedTo: string | null;  // instance ID
  result: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  priority: TaskPriority;
}

export interface TaskFile {
  tasks: Task[];
  nextId: number;
}

// ─── Command Center State ────────────────────────────────

export type CCMode = "orchestrator" | "worker" | "inactive";

export interface CommandCenterState {
  mode: CCMode;
  instanceId: string;
  workerPolling: boolean;
}

// ─── Message Log ─────────────────────────────────────────

export interface MessageLogEntry {
  timestamp: string;
  direction: "in" | "out";
  from: string;
  to: string;
  content: string;
}

// ─── Worker State ────────────────────────────────────────

export interface WorkerState {
  active: boolean;
  instanceId: string;
  currentTaskId: string | null;
  currentTaskDescription: string | null;
  pollingIntervalMs: number;
}

// ─── Responsive Layout Types ─────────────────────────────

export type BreakpointName = "narrow" | "medium" | "wide" | "ultrawide";
export type LayoutMode = "single" | "two-col" | "three-col";
export type DetailLevel = "minimal" | "normal" | "full";

export interface BreakpointConfig {
  /** Breakpoint name for logging/debugging */
  name: BreakpointName;
  /** Actual terminal column count */
  columns: number;
  /** Calculated widget height (8-15) */
  height: number;
  /** Content lines (height - 2 for borders) */
  contentLines: number;
  /** Layout mode */
  layout: LayoutMode;
  /** Inner width of each column (excluding borders and dividers) */
  paneWidths: number[];
  /** Whether messages panel is rendered */
  showMessages: boolean;
  /** Whether stats/metrics sub-panel is rendered */
  showStats: boolean;
  /** Whether worker task lines appear as sub-rows */
  showWorkerTask: boolean;
  /** Whether utilization bar appears in header */
  showUtilization: boolean;
  /** Instance detail verbosity */
  instanceDetailLevel: DetailLevel;
  /** Task detail verbosity */
  taskDetailLevel: DetailLevel;
}

// ─── Dashboard Stats ─────────────────────────────────────

export interface DashboardStats {
  /** Timestamp when /hq was activated (ISO string) */
  activatedAt: string;
  /** Total tasks created */
  totalTasks: number;
  /** Tasks completed (status === "completed") */
  completedTasks: number;
  /** Tasks currently active (assigned + in-progress) */
  activeTasks: number;
  /** Tasks pending */
  pendingTasks: number;
  /** Tasks failed */
  failedTasks: number;
  /** Total instances in pool */
  totalInstances: number;
  /** Instances with heartbeat < 2 min */
  activeInstances: number;
  /** Total messages sent/received today */
  messagesToday: number;
  /** Unread messages (recent, not yet displayed) */
  unreadMessages: number;
}

// ─── Box Drawing Characters (rounded corners) ────────────

/** Rounded box drawing character set — only corners change, junctions stay the same */
export const BOX_CHARS = {
  topLeft:      "\u256D",   // ╭
  topRight:     "\u256E",   // ╮
  bottomLeft:   "\u2570",   // ╰
  bottomRight:  "\u256F",   // ╯
  horizontal:   "\u2500",   // ─
  vertical:     "\u2502",   // │
  teeDown:      "\u252C",   // ┬ (top border junction — unchanged)
  teeUp:        "\u2534",   // ┴ (bottom border junction — unchanged)
  teeRight:     "\u251C",   // ├ (left border junction — unchanged)
  teeLeft:      "\u2524",   // ┤ (right border junction — unchanged)
  cross:        "\u253C",   // ┼ (4-way junction — unchanged)
} as const;
