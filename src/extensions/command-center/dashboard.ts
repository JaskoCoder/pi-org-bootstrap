/**
 * Command Centre Widget — Responsive TUI dashboard with 4 breakpoints.
 *
 * Render pipeline:
 *   renderCommandCentre()
 *     ├─ resolveBreakpoint(width, termRows) → BreakpointConfig
 *     ├─ buildRenderContext(...) → RenderContext
 *     ├─ renderHeader(ctx) → string
 *     ├─ Panel renderers (instances, tasks, messages, stats)
 *     └─ applyBorders(...) → string[]
 *
 * Breakpoints:
 *   Narrow   (<60):   single-column, compact, no messages/stats
 *   Medium   (60-99): two-column, instances|tasks, no messages
 *   Wide     (100-149): two-column, instances|tasks+messages, utilization bar
 *   Ultrawide (≥150):  three-column, instances|tasks|messages+stats, all metrics
 *
 * Visual: Rounded corners (╭╮╰╯), section headers with accent underlines,
 * worker health indicators (♥), utilization bar (████░░ 80%).
 */
import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type {
  Task, MessageLogEntry, BreakpointConfig, DashboardStats,
} from "./types.js";
import { BOX_CHARS } from "./types.js";
import type { InstanceEntry } from "../head-agent/instance-registry.js";

// ─── Worker Connection Info ──────────────────────────────

export interface WorkerConnInfo {
  type: "rpc" | "tmux";
  displayId: string;
}

// ─── Render Context ──────────────────────────────────────

export interface RenderContext {
  theme: Theme;
  breakpoint: BreakpointConfig;
  instances: InstanceEntry[];
  currentInstanceId: string;
  tasks: Task[];
  messages: MessageLogEntry[];
  stats: DashboardStats;
  workerInfo?: Map<string, WorkerConnInfo>;
}

// ─── Constants ───────────────────────────────────────────

const ACTIVE_THRESHOLD_MS = 120_000;   // < 2min -> active
const STALE_THRESHOLD_MS = 300_000;    // < 5min -> stale

const TASK_STATUS_ICON: Record<string, string> = {
  pending:       "\u25CB",  // ○
  assigned:      "\u25C9",  // ◉
  "in-progress": "\u25CF",  // ●
  completed:     "\u2713",  // ✓
  failed:        "\u2717",  // ✗
};

const TASK_STATUS_COLOR: Record<string, ThemeColor> = {
  pending:       "dim",
  assigned:      "warning",
  "in-progress": "accent",
  completed:     "success",
  failed:        "error",
};

const PRIORITY_COLOR: Record<string, ThemeColor> = {
  low:      "dim",
  medium:   "text",
  high:     "warning",
  critical: "error",
};

// ─── Helpers ─────────────────────────────────────────────

function getStatusStyle(heartbeat: number): { dot: string; color: ThemeColor } {
  const age = Date.now() - heartbeat;
  if (age < ACTIVE_THRESHOLD_MS) return { dot: "\u25CF", color: "success" };
  if (age < STALE_THRESHOLD_MS) return { dot: "\u25CF", color: "warning" };
  return { dot: "\u25CB", color: "dim" };
}

function heartbeatAge(heartbeat: number): string {
  const ms = Date.now() - heartbeat;
  if (ms < 1_000) return "now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  return Math.floor(m / 60) + "h" + (m % 60) + "m";
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(-8) : id;
}

function padLine(content: string, width: number): string {
  const truncated = truncateToWidth(content, width, "");
  const padNeeded = Math.max(0, width - visibleWidth(truncated));
  return truncated + " ".repeat(padNeeded);
}

// ─── Breakpoint Resolution ───────────────────────────────

export function resolveBreakpoint(width: number, termRows: number): BreakpointConfig {
  const height = Math.min(15, Math.max(8, Math.floor(termRows * 0.2)));
  const inner = width - 2; // minus left+right border
  const contentLines = height - 2; // minus top+bottom border

  if (width < 60) {
    return {
      name: "narrow", columns: width, height, contentLines,
      layout: "single", paneWidths: [inner],
      showMessages: false, showStats: false,
      showWorkerTask: false, showUtilization: false,
      instanceDetailLevel: "minimal", taskDetailLevel: "minimal",
    };
  }

  if (width < 100) {
    const left = Math.floor(inner * 0.55);
    const right = inner - left - 1; // -1 for divider
    return {
      name: "medium", columns: width, height, contentLines,
      layout: "two-col", paneWidths: [left, right],
      showMessages: false, showStats: false,
      showWorkerTask: true, showUtilization: false,
      instanceDetailLevel: "normal", taskDetailLevel: "normal",
    };
  }

  if (width < 150) {
    const left = Math.floor(inner * 0.50);
    const right = inner - left - 1;
    return {
      name: "wide", columns: width, height, contentLines,
      layout: "two-col", paneWidths: [left, right],
      showMessages: true, showStats: false,
      showWorkerTask: true, showUtilization: true,
      instanceDetailLevel: "full", taskDetailLevel: "full",
    };
  }

  // Ultrawide: 3 columns
  const col1 = Math.floor(inner * 0.35);
  const col2 = Math.floor(inner * 0.35);
  const col3 = inner - col1 - col2 - 2; // -2 for two dividers
  return {
    name: "ultrawide", columns: width, height, contentLines,
    layout: "three-col", paneWidths: [col1, col2, col3],
    showMessages: true, showStats: true,
    showWorkerTask: true, showUtilization: true,
    instanceDetailLevel: "full", taskDetailLevel: "full",
  };
}

// ─── Context Builder ─────────────────────────────────────

function buildRenderContext(
  theme: Theme,
  breakpoint: BreakpointConfig,
  instances: InstanceEntry[],
  currentInstanceId: string,
  tasks: Task[],
  messages: MessageLogEntry[],
  stats: DashboardStats,
  workerInfo?: Map<string, WorkerConnInfo>,
): RenderContext {
  return {
    theme, breakpoint, instances, currentInstanceId,
    tasks, messages, stats, workerInfo,
  };
}

// ─── Utility Renderers ───────────────────────────────────

function renderUtilizationBar(stats: DashboardStats, barWidth: number, theme: Theme): string {
  const total = stats.totalInstances;
  if (total === 0) return theme.fg("dim", "\u2591".repeat(barWidth) + " --");
  const pct = stats.activeInstances / total;
  const filled = Math.round(pct * barWidth);
  const empty = barWidth - filled;
  const bar = theme.fg("accent", "\u2588".repeat(filled)) + theme.fg("dim", "\u2591".repeat(empty));
  const pctStr = Math.round(pct * 100) + "%";
  return bar + " " + theme.fg("text", pctStr);
}

function formatUptime(activatedAt: string): string {
  try {
    const ms = Date.now() - new Date(activatedAt).getTime();
    if (ms < 0) return "Up 0s";
    const totalMin = Math.floor(ms / 60_000);
    if (totalMin < 1) return "Up " + Math.floor(ms / 1000) + "s";
    if (totalMin < 60) return "Up " + totalMin + "m";
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return "Up " + h + "h" + (m > 0 ? m + "m" : "");
  } catch {
    return "Up ??";
  }
}

function renderUptime(activatedAt: string, theme: Theme): string {
  return theme.fg("dim", formatUptime(activatedAt));
}

function renderHealthIndicator(heartbeat: number, theme: Theme): string {
  const age = Date.now() - heartbeat;
  if (age < ACTIVE_THRESHOLD_MS) return theme.fg("success", "\u2665");   // ♥ healthy
  if (age < STALE_THRESHOLD_MS) return theme.fg("warning", "\u2665");   // ♥ stale
  return theme.fg("dim", "\u2661");                                      // ♡ dead
}

function taskCompletionRate(stats: DashboardStats): string {
  if (stats.totalTasks === 0) return "Rate --";
  const pct = Math.round((stats.completedTasks / stats.totalTasks) * 100);
  return "Rate " + pct + "%";
}

function renderSectionHeader(label: string, paneWidth: number, theme: Theme): string {
  const inner = paneWidth - 2; // account for "  " prefix
  if (inner < 6) return padLine("", paneWidth);
  const labelText = " " + label + " ";
  const dashTotal = Math.max(0, inner - visibleWidth(labelText));
  const leftDash = Math.floor(dashTotal / 2);
  const rightDash = dashTotal - leftDash;
  const line = "\u2500".repeat(leftDash) + labelText + "\u2500".repeat(rightDash);
  return padLine(theme.fg("accent", line), paneWidth);
}

// ─── Header Rendering ────────────────────────────────────

function renderHeader(ctx: RenderContext): string {
  const { theme, breakpoint, stats, instances, tasks } = ctx;
  const bp = breakpoint;
  const c = (s: string) => theme.fg("accent", s);
  const inner = bp.columns - 2;

  const activeCount = stats.activeInstances;
  const runningTasks = stats.activeTasks;
  const pendingTasks = stats.pendingTasks;

  // Minimal header for very narrow
  if (bp.columns < 40) {
    const text = theme.fg("accent", "HQ") + " " +
      theme.fg("text", stats.totalInstances + " workers");
    return c(BOX_CHARS.topLeft) + padLine(text, inner) + c(BOX_CHARS.topRight);
  }

  if (bp.layout === "single") {
    // Narrow: single header line
    let header = theme.fg("accent", " HQ") +
      " " + theme.fg("success", "\u25CF" + instances.length) +
      " " + theme.fg("accent", "\u25B8" + activeCount) +
      " " + theme.fg("dim", "idle" + (instances.length - activeCount));

    // Add task summary if space
    const taskSummary = theme.fg("dim", " " + pendingTasks + " pending");
    const headerFull = header + " " + c("\u2500".repeat(3)) + taskSummary;

    return c(BOX_CHARS.topLeft) + padLine(headerFull, inner) + c(BOX_CHARS.topRight);
  }

  if (bp.layout === "two-col") {
    const leftWidth = bp.paneWidths[0];
    const rightWidth = bp.paneWidths[1];

    // Left header
    let leftHeader = theme.fg("accent", " Instances") +
      " " + theme.fg("text", instances.length + "\u25B8") +
      " " + theme.fg("success", activeCount + " active");

    // Add utilization bar for wide
    if (bp.showUtilization) {
      const utilBar = renderUtilizationBar(stats, 8, theme);
      leftHeader += " " + c("\u2500") + " " + theme.fg("dim", "Util") + " " + utilBar;
    }

    // Right header
    let rightHeader = theme.fg("accent", "Tasks") +
      " " + theme.fg("text", runningTasks + " run") +
      " " + theme.fg("dim", pendingTasks + " pend");

    // Add messages count for wide
    if (bp.showMessages) {
      const msgCount = ctx.messages.length;
      rightHeader += " " + c("\u2500".repeat(2)) + " " +
        theme.fg("accent", "Messages") + " " +
        theme.fg("text", "(" + msgCount + ")");
    }

    return c(BOX_CHARS.topLeft) +
      padLine(leftHeader, leftWidth) +
      c("\u252C") +
      padLine(rightHeader, rightWidth) +
      c(BOX_CHARS.topRight);
  }

  // Three-column (ultrawide)
  const col1W = bp.paneWidths[0];
  const col2W = bp.paneWidths[1];
  const col3W = bp.paneWidths[2];

  // Col 1: Instances + Util + Uptime
  let col1Header = theme.fg("accent", " Instances") +
    " " + theme.fg("text", instances.length + "\u25B8") +
    " " + theme.fg("success", activeCount + " active");

  if (bp.showUtilization) {
    const utilBar = renderUtilizationBar(stats, 6, theme);
    col1Header += " " + c("\u2500") + " " + theme.fg("dim", "Util") + " " + utilBar;
  }

  const uptimeStr = renderUptime(stats.activatedAt, theme);
  col1Header += " " + c("\u2500") + " " + uptimeStr;

  // Col 2: Tasks + Rate
  let col2Header = theme.fg("accent", "Tasks") +
    " " + theme.fg("text", runningTasks + " run") +
    " " + theme.fg("dim", pendingTasks + " pend");

  const rateStr = taskCompletionRate(stats);
  col2Header += " " + c("\u2500") + " " + theme.fg("dim", rateStr);

  // Col 3: Messages
  const msgCount = ctx.messages.length;
  let col3Header = theme.fg("accent", "Messages") +
    " " + theme.fg("text", "(" + msgCount + ")");

  return c(BOX_CHARS.topLeft) +
    padLine(col1Header, col1W) +
    c("\u252C") +
    padLine(col2Header, col2W) +
    c("\u252C") +
    padLine(col3Header, col3W) +
    c(BOX_CHARS.topRight);
}

// ─── Instances Panel ─────────────────────────────────────

function renderInstances(
  ctx: RenderContext,
  paneWidth: number,
  maxLines: number,
): string[] {
  const { theme, breakpoint, instances, currentInstanceId, tasks, workerInfo } = ctx;
  const lines: string[] = [];
  const tw = (s: string) => truncateToWidth(s, paneWidth, "");
  const showHealth = breakpoint.name === "wide" || breakpoint.name === "ultrawide";

  if (instances.length === 0) {
    lines.push(padLine(tw(theme.fg("dim", "  No instances. Use orch_spawn.")), paneWidth));
    while (lines.length < maxLines) lines.push(padLine("", paneWidth));
    return lines;
  }

  // Sort: self first, then by heartbeat (most recent first)
  const sorted = [...instances].sort((a, b) => {
    if (a.instanceId === currentInstanceId) return -1;
    if (b.instanceId === currentInstanceId) return 1;
    return b.lastHeartbeat - a.lastHeartbeat;
  });

  // Determine max instances to show (leave room for task sub-lines)
  const maxInstances = Math.min(sorted.length, Math.ceil(maxLines * 0.7));
  let lineBudget = maxLines;

  for (let i = 0; i < sorted.length && lineBudget > 0; i++) {
    const inst = sorted[i];
    const isSelf = inst.instanceId === currentInstanceId;
    const isLast = i === sorted.length - 1 || lineBudget <= 2;
    const status = getStatusStyle(inst.lastHeartbeat);
    const ageStr = heartbeatAge(inst.lastHeartbeat);
    const selfTag = isSelf ? " " + theme.fg("accent", "\u25C4") : "";

    // Name with truncation
    const maxNameLen = Math.max(6, paneWidth - 30);
    const rawName = inst.username || shortId(inst.instanceId);
    const name = rawName.length > maxNameLen
      ? rawName.slice(0, maxNameLen - 1) + "\u2026"
      : rawName;
    const identifier = theme.fg("accent", name.padEnd(maxNameLen).slice(0, maxNameLen));

    // Connection type
    const connInfo = workerInfo?.get(inst.instanceId);
    let connLabel: string;
    if (connInfo) {
      connLabel = connInfo.type === "tmux"
        ? theme.fg("dim", "tmux") + " " + theme.fg("muted", connInfo.displayId)
        : theme.fg("dim", "RPC");
    } else {
      connLabel = theme.fg("dim", "RPC");
    }

    // Health indicator (wide+)
    const health = showHealth ? " " + renderHealthIndicator(inst.lastHeartbeat, theme) : "";

    // Tree prefix
    const treePrefix = isLast ? "\u2514\u2500" : "\u251C\u2500";

    const line = theme.fg("dim", treePrefix + " ") +
      theme.fg(status.color, status.dot) + " " +
      identifier + " " +
      connLabel + "  " +
      theme.fg("dim", ageStr.padEnd(5)) +
      health +
      selfTag;

    lines.push(padLine(tw(line), paneWidth));
    lineBudget--;

    // Show active task as child line (if breakpoint allows and we have budget)
    if (breakpoint.showWorkerTask && lineBudget > 0) {
      const activeTask = tasks.find(t =>
        t.assignedTo === inst.instanceId &&
        (t.status === "assigned" || t.status === "in-progress")
      );

      if (activeTask) {
        const childPrefix = isLast ? "    \u2514 " : "  \u2502 \u2514 ";
        const taskIcon = TASK_STATUS_ICON[activeTask.status];
        const taskColor = TASK_STATUS_COLOR[activeTask.status];
        const maxDesc = Math.max(8, paneWidth - 12);
        const desc = activeTask.description.slice(0, maxDesc);
        const taskLine = theme.fg("dim", childPrefix) +
          theme.fg(taskColor, taskIcon + " " + desc);
        lines.push(padLine(tw(taskLine), paneWidth));
        lineBudget--;
      }
    }
  }

  while (lines.length < maxLines) lines.push(padLine("", paneWidth));
  return lines;
}

// ─── Tasks Panel ─────────────────────────────────────────

function renderTasksPanel(
  ctx: RenderContext,
  paneWidth: number,
  maxLines: number,
): string[] {
  const { theme, tasks } = ctx;
  const lines: string[] = [];
  const tw = (s: string) => truncateToWidth(s, paneWidth, "");

  if (tasks.length === 0) {
    lines.push(padLine(tw(theme.fg("dim", "  No tasks yet.")), paneWidth));
    while (lines.length < maxLines) lines.push(padLine("", paneWidth));
    return lines;
  }

  // Newest first
  const sorted = [...tasks].reverse().slice(0, maxLines);
  for (const task of sorted) {
    if (lines.length >= maxLines) break;

    const icon = TASK_STATUS_ICON[task.status] || "\u25CB";
    const color = TASK_STATUS_COLOR[task.status] || "dim";
    const priColor = PRIORITY_COLOR[task.priority] || "dim";
    const maxDesc = Math.max(8, paneWidth - 16);
    const desc = task.description.length > maxDesc
      ? task.description.slice(0, maxDesc - 2) + ".."
      : task.description;

    const line = theme.fg(priColor, task.priority.slice(0, 3).toUpperCase()) + " " +
      theme.fg(color, icon + " " + task.status.padEnd(11)) +
      theme.fg("text", desc);
    lines.push(padLine(tw(line), paneWidth));
  }

  while (lines.length < maxLines) lines.push(padLine("", paneWidth));
  return lines;
}

// ─── Messages Panel ──────────────────────────────────────

function renderMessagesPanel(
  ctx: RenderContext,
  paneWidth: number,
  maxLines: number,
): string[] {
  const { theme, messages } = ctx;
  const lines: string[] = [];
  const tw = (s: string) => truncateToWidth(s, paneWidth, "");

  if (messages.length === 0) {
    lines.push(padLine(tw(theme.fg("dim", "  No messages.")), paneWidth));
    while (lines.length < maxLines) lines.push(padLine("", paneWidth));
    return lines;
  }

  const recent = messages.slice(-maxLines);
  for (const msg of recent) {
    if (lines.length >= maxLines) break;
    const time = msg.timestamp.split("T")[1]?.slice(0, 5) || "??:??";
    const dir = msg.direction === "in" ? "\u2190" : "\u2192";
    const maxContent = Math.max(5, paneWidth - 15);
    const content = msg.content.slice(0, maxContent);
    const routing = (msg.from + "\u2192" + msg.to).slice(0, 12);
    const line = theme.fg("dim", time) + " " +
      theme.fg("accent", dir) + " " +
      theme.fg("muted", routing) + " " +
      theme.fg("text", content);
    lines.push(padLine(tw(line), paneWidth));
  }

  while (lines.length < maxLines) lines.push(padLine("", paneWidth));
  return lines;
}

// ─── Stats Panel (for ultrawide) ─────────────────────────

function renderStatsPanel(
  ctx: RenderContext,
  paneWidth: number,
  maxLines: number,
): string[] {
  const { theme, stats } = ctx;
  const lines: string[] = [];
  const tw = (s: string) => truncateToWidth(s, paneWidth, "");

  if (maxLines <= 0) return lines;

  // Section header
  lines.push(padLine(tw(renderSectionHeader("Stats", paneWidth, theme)), paneWidth));

  if (maxLines > 1) {
    const taskLine = theme.fg("dim", "Tasks: ") +
      theme.fg("text", stats.totalTasks + " total") +
      theme.fg("dim", " \u00B7 ") +
      theme.fg("success", stats.completedTasks + " done") +
      theme.fg("dim", " \u00B7 ") +
      theme.fg("text", stats.activeTasks + " active");
    lines.push(padLine(tw(taskLine), paneWidth));
  }

  if (maxLines > 2) {
    const msgLine = theme.fg("dim", "Msgs:  ") +
      theme.fg("text", stats.messagesToday + " today") +
      theme.fg("dim", " \u00B7 ") +
      theme.fg("text", stats.unreadMessages + " unread");
    lines.push(padLine(tw(msgLine), paneWidth));
  }

  while (lines.length < maxLines) lines.push(padLine("", paneWidth));
  return lines;
}

// ─── Right Panel: Tasks + Messages combined ──────────────

function renderRightPanel(
  ctx: RenderContext,
  paneWidth: number,
  maxLines: number,
): string[] {
  const { theme, breakpoint } = ctx;
  const lines: string[] = [];
  const tw = (s: string) => truncateToWidth(s, paneWidth, "");

  if (breakpoint.showMessages) {
    // Split: 65% tasks, 35% messages
    const taskLines = Math.max(1, Math.ceil(maxLines * 0.65));
    const msgLines = maxLines - taskLines;

    const tasks = renderTasksPanel(ctx, paneWidth, taskLines);
    lines.push(...tasks);

    // Messages separator
    if (msgLines > 0) {
      const sep = theme.fg("dim", "\u2500".repeat(3) + " Messages " +
        "\u2500".repeat(Math.max(0, paneWidth - 13)));
      lines.push(padLine(tw(sep), paneWidth));
    }

    const msgs = renderMessagesPanel(ctx, paneWidth, Math.max(0, msgLines - 1));
    lines.push(...msgs);
  } else {
    // Tasks only
    const tasks = renderTasksPanel(ctx, paneWidth, maxLines);
    lines.push(...tasks);
  }

  while (lines.length < maxLines) lines.push(padLine("", paneWidth));
  return lines.slice(0, maxLines);
}

// ─── Border Assembly ─────────────────────────────────────

function applyBorders(
  header: string,
  contentRows: string[][],  // one array per column
  bp: BreakpointConfig,
  theme: Theme,
): string[] {
  const c = (s: string) => theme.fg("accent", s);
  const result: string[] = [];
  const height = bp.height;
  const inner = bp.columns - 2;
  const numCols = contentRows.length;

  // Header
  result.push(header);

  // Content rows
  const contentHeight = height - 2; // minus top/bottom border
  for (let row = 0; row < contentHeight; row++) {
    let line = c(BOX_CHARS.vertical);
    for (let col = 0; col < numCols; col++) {
      const colLines = contentRows[col];
      const colWidth = bp.paneWidths[col] ?? 0;
      const content = colLines && row < colLines.length
        ? colLines[row]
        : padLine("", colWidth);
      line += content;
      if (col < numCols - 1) {
        line += c(BOX_CHARS.vertical);
      }
    }
    line += c(BOX_CHARS.vertical);
    result.push(line);
  }

  // Bottom border
  if (numCols <= 1) {
    result.push(c(BOX_CHARS.bottomLeft) + c("\u2500".repeat(inner)) + c(BOX_CHARS.bottomRight));
  } else {
    let bottom = c(BOX_CHARS.bottomLeft);
    for (let col = 0; col < numCols; col++) {
      const colWidth = bp.paneWidths[col] ?? 0;
      bottom += c("\u2500".repeat(colWidth));
      if (col < numCols - 1) {
        bottom += c("\u2534"); // ┴ junction
      }
    }
    bottom += c(BOX_CHARS.bottomRight);
    result.push(bottom);
  }

  return result;
}

// ─── Minimal Widget (<40 width) ──────────────────────────

function renderMinimal(theme: Theme, width: number, stats: DashboardStats): string[] {
  const c = (s: string) => theme.fg("accent", s);
  const inner = Math.max(1, width - 2);
  const activeStr = String(stats.activeInstances);

  const line1 = theme.fg("accent", " HQ active") + " " +
    theme.fg("text", activeStr + " workers");

  return [
    c(BOX_CHARS.topLeft) + padLine(line1, inner) + c(BOX_CHARS.topRight),
    c(BOX_CHARS.vertical) + padLine("", inner) + c(BOX_CHARS.vertical),
    c(BOX_CHARS.bottomLeft) + c("\u2500".repeat(inner)) + c(BOX_CHARS.bottomRight),
  ];
}

// ─── Full Render ─────────────────────────────────────────

export function renderCommandCentre(
  theme: Theme,
  width: number,
  termRows: number,
  instances: InstanceEntry[],
  currentInstanceId: string,
  tasks: Task[],
  messages: MessageLogEntry[],
  stats: DashboardStats,
  workerInfo?: Map<string, WorkerConnInfo>,
): string[] {
  // Graceful degradation for very narrow terminals
  if (width < 40) {
    return renderMinimal(theme, width, stats);
  }

  const bp = resolveBreakpoint(width, termRows);
  const ctx = buildRenderContext(
    theme, bp, instances, currentInstanceId,
    tasks, messages, stats, workerInfo,
  );

  const contentHeight = bp.contentLines;
  const c = (s: string) => theme.fg("accent", s);

  // ── Height degradation ──
  if (contentHeight <= 3) {
    // Instances only
    const header = renderHeader(ctx);
    const instanceLines = renderInstances(ctx, bp.paneWidths[0], contentHeight);
    return applyBorders(header, [instanceLines], bp, theme);
  }

  if (bp.layout === "single") {
    // ── Narrow: single column ──
    const header = renderHeader(ctx);
    const paneWidth = bp.paneWidths[0];

    // Split: 60% instances, separator, 40% tasks
    const instLines = Math.ceil(contentHeight * 0.6);
    const sepLines = 1;
    const taskLinesCount = contentHeight - instLines - sepLines;

    const instances = renderInstances(ctx, paneWidth, instLines);

    // Separator
    const sepText = theme.fg("dim", "\u2500".repeat(3) + " " +
      stats.pendingTasks + " pending \u00B7 " + stats.activeTasks + " running " +
      "\u2500".repeat(Math.max(0, paneWidth - 20)));
    const sep = padLine(truncateToWidth(sepText, paneWidth, ""), paneWidth);

    const taskLines = taskLinesCount > 0
      ? renderTasksPanel(ctx, paneWidth, taskLinesCount)
      : [];

    const allContent = [...instances, sep, ...taskLines];
    while (allContent.length < contentHeight) allContent.push(padLine("", paneWidth));

    return applyBorders(header, [allContent.slice(0, contentHeight)], bp, theme);
  }

  if (bp.layout === "two-col") {
    // ── Medium / Wide: two columns ──
    const header = renderHeader(ctx);
    const leftWidth = bp.paneWidths[0];
    const rightWidth = bp.paneWidths[1];

    const leftLines = renderInstances(ctx, leftWidth, contentHeight);
    const rightLines = renderRightPanel(ctx, rightWidth, contentHeight);

    return applyBorders(header, [leftLines, rightLines], bp, theme);
  }

  // ── Ultrawide: three columns ──
  const header = renderHeader(ctx);
  const col1W = bp.paneWidths[0];
  const col2W = bp.paneWidths[1];
  const col3W = bp.paneWidths[2];

  // Col 1: instances + stats at bottom
  let statsLines = 0;
  if (bp.showStats && contentHeight >= 10) {
    statsLines = Math.min(3, Math.floor(contentHeight * 0.2));
  }
  const instanceLines = contentHeight - statsLines;
  const instLines = renderInstances(ctx, col1W, instanceLines);
  const statsContent = statsLines > 0
    ? renderStatsPanel(ctx, col1W, statsLines)
    : [];
  const col1Content = [...instLines, ...statsContent];
  while (col1Content.length < contentHeight) col1Content.push(padLine("", col1W));

  // Col 2: tasks
  const col2Content = renderTasksPanel(ctx, col2W, contentHeight);

  // Col 3: messages
  const col3Content = renderMessagesPanel(ctx, col3W, contentHeight);

  return applyBorders(header, [col1Content, col2Content, col3Content], bp, theme);
}
