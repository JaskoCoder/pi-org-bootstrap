/**
 * Context Feed Widget — TUI widget showing real-time event stream.
 *
 * Shows last N events from ALL instances, color-coded by type.
 * Filterable by agent, type, and instance.
 * Placed below the instance pool widget (or as a toggleable overlay via /feed).
 */
import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import type { ContextBusEvent, ContextEventType } from "./context-bus.js";

// ─── Types ───────────────────────────────────────────────

export interface FeedFilter {
  agent?: string;
  type?: ContextEventType;
  instanceId?: string;
}

export interface FeedWidgetState {
  visible: boolean;
  filter: FeedFilter;
  maxLines: number;
}

// ─── Color Mapping ───────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  "task.claimed": "accent",
  "task.released": "dim",
  "task.started": "accent",
  "task.completed": "success",
  "mail.sent": "success",
  "mail.read": "dim",
  "delegation.started": "accent",
  "delegation.completed": "success",
  "state.changed": "text",
  "subagent.spawned": "thinkingXhigh",
  "subagent.completed": "thinkingXhigh",
  "memory.updated": "mdLink",
  debug_cycle: "warning",
  pipeline_event: "mdHeading",
  cron_fire: "mdCode",
  log: "dim",
};

const TYPE_ICONS: Record<string, string> = {
  delegate: "\u2192",
  "mail.sent": "\u2709",
  "mail.read": "\u2709",
  "delegation.completed": "\u2713",
  "state.changed": "\u21BB",
  debug_cycle: "\u2699",
  pipeline_event: "\u25B6",
  cron_fire: "\u23F0",
  "subagent.spawned": "\u25B7",
  "subagent.completed": "\u25C1",
  log: "\u2022",
};

// ─── Event Formatting ────────────────────────────────────

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "??:??:??";
  }
}

function formatAgentName(agent: string): string {
  // Shorten agent names: "backend-team" -> "BE", "tech-lead" -> "TL"
  const abbrevs: Record<string, string> = {
    "head-agent": "HEAD",
    "backend-team": "BE",
    "frontend-team": "FE",
    "ai-ml-team": "AI",
    "infra-devops": "INF",
    "reviewer": "REV",
    "security-officer": "SEC",
    "tech-lead": "TL",
    "pi-extensions": "PE",
    "pi-agents": "PA",
    "pi-skills": "PS",
    "pi-config": "PC",
  };
  return abbrevs[agent] || agent.slice(0, 4).toUpperCase();
}

function summarizePayload(event: ContextBusEvent): string {
  const p = event.payload;
  switch (event.type) {
    case "delegation.started":
      return String(p.taskDescription || p.task || "").slice(0, 40);
    case "mail.sent":
      return (String(p.to || "") + ": " + String(p.subject || "")).slice(0, 40);
    case "mail.read":
      return String(p.agent || "") + " (" + String(p.count || 0) + ")";
    case "delegation.completed":
      return String(p.task || "").slice(0, 40);
    case "state.changed":
      return String(p.key || "") + ": " + String(p.from || "") + " -> " + String(p.to || "");
    case "debug_cycle":
      return "cycle " + String(p.cycle || "?") + " " + String(p.phase || "");
    case "pipeline_event":
      return String(p.stage || "") + " " + String(p.status || "");
    case "cron_fire":
      return String(p.taskId || "");
    case "subagent.spawned":
      return String(p.agent || "") + " " + String(p.taskDescription || "").slice(0, 30);
    case "subagent.completed":
      return String(p.agent || "") + " " + String(p.status || "");
    case "log":
      return String(p.message || "").slice(0, 40);
    default:
      return JSON.stringify(p).slice(0, 40);
  }
}

// ─── Widget Rendering ────────────────────────────────────

export function renderContextFeed(
  theme: Theme,
  width: number,
  events: ContextBusEvent[],
  filter: FeedFilter,
  maxLines: number = 8,
): string[] {
  if (width < 40) return [];

  // Apply filter
  let filtered = events;
  if (filter.agent) filtered = filtered.filter(e => e.agent === filter.agent);
  if (filter.type) filtered = filtered.filter(e => e.type === filter.type);
  if (filter.instanceId) filtered = filtered.filter(e => e.instanceId === filter.instanceId);

  // Take last N events (newest last)
  const shown = filtered.slice(-maxLines);
  if (shown.length === 0) {
    const noData = theme.fg("dim", "No context bus events");
    return [truncateToWidth("  " + noData, width, "")];
  }

  const lines: string[] = [];

  // Header with filter info
  const filterParts: string[] = [];
  if (filter.agent) filterParts.push("agent:" + filter.agent);
  if (filter.type) filterParts.push("type:" + filter.type);
  if (filter.instanceId) filterParts.push("inst:" + filter.instanceId.slice(-8));
  const filterStr = filterParts.length > 0 ? " [" + filterParts.join(", ") + "]" : "";
  const header = theme.fg("mdHeading", "Context Feed" + filterStr);
  lines.push(truncateToWidth(header, width, ""));

  // Event lines
  for (const event of shown) {
    const time = formatTimestamp(event.timestamp);
    const icon = TYPE_ICONS[event.type] || "\u2022";
    const agent = formatAgentName(event.agent);
    const summary = summarizePayload(event);
    const color = TYPE_COLORS[event.type] || "text";

    const timePart = theme.fg("dim", time);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const iconPart = theme.fg(color as any, icon);
    const agentPart = theme.fg("accent", agent);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const summaryPart = theme.fg(color as any, summary);

    // Format: "HH:MM:SS → AGENT summary"
    const line = " " + timePart + " " + iconPart + " " + agentPart + " " + summaryPart;
    lines.push(truncateToWidth(line, width, ""));
  }

  return lines;
}

// ─── Feed Cache ──────────────────────────────────────────

/** Create a cached feed renderer that only re-reads events when requested. */
export function createFeedCache() {
  let cachedEvents: ContextBusEvent[] = [];
  let cachedKey: string | undefined;

  return {
    getEvents(): ContextBusEvent[] {
      return cachedEvents;
    },
    setEvents(events: ContextBusEvent[]): void {
      cachedEvents = events;
    },
    getCachedKey(): string | undefined {
      return cachedKey;
    },
    setCachedKey(key: string): void {
      cachedKey = key;
    },
    invalidate(): void {
      cachedKey = undefined;
    },
  };
}
