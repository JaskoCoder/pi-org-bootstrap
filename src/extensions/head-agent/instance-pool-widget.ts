/**
 * Instance Pool Widget — Tree-style agent graph with action feed.
 *
 * Left panel: Instance → Agent tree graph with tree-drawing characters.
 * Right panel: Live action feed (top) + system objectives (bottom).
 *
 * Layout (width >= 80): two-column split (left 55%, right 45%, │ separator)
 * Layout (width < 80): single column (tree only, feed hidden)
 * Max height: MAX_POOL_HEIGHT = 8 lines
 *
 * ┌ Instance Pool  3 inst  2 active  1 claimed ──────────────┐
 * │ ├─ ● Turing          bear-pc:12345  12s ◄ │ 14:22:01 → BE Fix auth     │
 * │ │  ├ BE fixing auth bug         2m  $0.04 │ 14:21:55 ✉ TL→BE review    │
 * │ │  └ REV reviewing PR #42       5m  $0.12 │ ── Objectives ─────────── │
 * │ ├─ ○ Nova             bear-pc:54321  45s   │ ◉ Fix auth bypass (in-prog)│
 * │ │  └ AI training model          8m  $0.31 │ ○ Sprint goal: ship v2     │
 * └────────────────────────────────────┴───────────────────────────────────┘
 */
import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { InstanceEntry } from "./instance-registry.js";
import type { AgentState, AutonomousDebugState, PipelineState, DebugObjective } from "./types.js";
import type { ContextBusEvent, ContextEventType } from "./context-bus.js";
import { clip, fmtTime } from "./helpers.js";
import { TASK_KEY_PREFIX } from "./constants.js";

const MAX_POOL_HEIGHT = 8;
const MIN_POOL_WIDTH = 40;
const SPLIT_MIN_WIDTH = 80;

// Heartbeat thresholds
const ACTIVE_THRESHOLD_MS = 60_000;   // < 60s  -> active
const STALE_THRESHOLD_MS = 300_000;   // < 5min -> stale, else dead

// ─── Agent Name Abbreviations ────────────────────────────

const AGENT_ABBREV: Record<string, string> = {
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

function abbrevAgent(name: string): string {
  return AGENT_ABBREV[name] || name.slice(0, 4).toUpperCase();
}

// ─── Context Bus Event Formatting (reused from context-feed-widget) ──

const TYPE_COLORS: Record<string, string> = {
  "delegation.started": "accent",
  "delegation.completed": "accent",
  "mail.sent": "success",
  "mail.read": "success",
  "task.claimed": "accent",
  "task.released": "dim",
  "task.started": "accent",
  "task.completed": "success",
  "state.changed": "text",
  "subagent.spawned": "thinkingXhigh",
  "subagent.completed": "thinkingXhigh",
  "memory.updated": "mdLink",
  debug_cycle: "warning",
  pipeline_event: "mdHeading",
  cron_fire: "mdCode",
  log: "dim",
  error: "error",
};

const TYPE_ICONS: Record<string, string> = {
  "delegation.started": "\u2192",
  "delegation.completed": "\u2190",
  "mail.sent": "\u2709",
  "mail.read": "\u2709",
  "task.claimed": "\u25C1",
  "task.released": "\u25B7",
  "task.started": "\u25B6",
  "task.completed": "\u2713",
  "state.changed": "\u21BB",
  "subagent.spawned": "\u25B7",
  "subagent.completed": "\u25C1",
  "memory.updated": "\u270E",
  debug_cycle: "\u2699",
  pipeline_event: "\u25B6",
  cron_fire: "\u23F0",
  log: "\u2022",
  error: "\u2717",
};

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "??:??:??";
  }
}

function summarizeEvent(event: ContextBusEvent): string {
  const p = event.payload;
  switch (event.type) {
    case "delegation.started":
    case "delegation.completed":
      return String(p.taskDescription || p.task || "").slice(0, 30);
    case "task.claimed":
    case "task.released":
      return String(p.team || "") + ": " + String(p.taskDescription || "").slice(0, 20);
    case "mail.sent":
      return (String(p.to || "") + ": " + String(p.subject || "")).slice(0, 30);
    case "mail.read":
      return String(p.agent || "") + " (" + String(p.count || 0) + ")";
    case "state.changed":
      return String(p.key || "") + " " + String(p.to || "");
    case "debug_cycle":
      return "c" + String(p.cycle || "?") + " " + String(p.phase || "");
    case "pipeline_event":
      return String(p.stage || "") + " " + String(p.status || "");
    case "cron_fire":
      return String(p.taskId || "");
    case "subagent.spawned":
      return String(p.agent || "") + " " + String(p.taskDescription || "").slice(0, 20);
    case "subagent.completed":
      return String(p.agent || "") + " " + String(p.status || "");
    case "memory.updated":
      return String(p.agent || "") + ": " + String(p.summary || "").slice(0, 20);
    case "log":
      return String(p.message || "").slice(0, 30);
    default:
      return JSON.stringify(p).slice(0, 30);
  }
}

// ─── Helpers ─────────────────────────────────────────────

function getStatusStyle(heartbeat: number): { dot: string; color: ThemeColor; label: string } {
  const age = Date.now() - heartbeat;
  if (age < ACTIVE_THRESHOLD_MS) return { dot: "\u25CF", color: "success", label: "active" };
  if (age < STALE_THRESHOLD_MS) return { dot: "\u25CF", color: "warning", label: "stale" };
  return { dot: "\u25CB", color: "dim", label: "dead" };
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

function parseClaim(claim: string): { team: string; description: string } {
  if (claim.startsWith(TASK_KEY_PREFIX)) {
    const rest = claim.slice(TASK_KEY_PREFIX.length);
    const colonIdx = rest.indexOf(":");
    if (colonIdx >= 0) {
      return { team: rest.slice(0, colonIdx), description: rest.slice(colonIdx + 1) };
    }
    return { team: rest, description: "" };
  }
  return { team: "", description: claim };
}

function shortId(instanceId: string): string {
  return instanceId.slice(-8);
}

/** Pad a string to exactly `width` visible columns, truncating or appending spaces */
function padLine(content: string, width: number): string {
  const truncated = truncateToWidth(content, width, "");
  const padNeeded = Math.max(0, width - visibleWidth(truncated));
  return truncated + " ".repeat(padNeeded);
}

function borderedLine(content: string, inner: number, borderFn: (s: string) => string): string {
  const truncated = truncateToWidth(content, inner, "");
  const padNeeded = Math.max(0, inner - visibleWidth(truncated));
  return borderFn("\u2502") + truncated + " ".repeat(padNeeded) + borderFn("\u2502");
}

// ─── Agent Status Dot ────────────────────────────────────

function agentStatusDot(state: AgentState): { dot: string; color: ThemeColor } {
  switch (state.status) {
    case "working": return { dot: "\u25CF", color: "success" };
    case "reviewing": return { dot: "\u25CF", color: "warning" };
    case "scanning": return { dot: "\u25CB", color: "accent" };
    case "deploying": return { dot: "\u25CF", color: "mdHeading" };
    case "done": return { dot: "\u2713", color: "success" };
    default: return { dot: "\u25CB", color: "dim" };
  }
}

function formatDuration(state: AgentState): string {
  if (state.startedAt == null) return "";
  const ms = Date.now() - state.startedAt;
  if (ms < 60_000) return Math.floor(ms / 1000) + "s";
  return fmtTime(ms);
}

function formatCost(cost: number): string {
  if (cost < 0.01) return "";
  return "$" + cost.toFixed(2);
}

// ─── Minimal Mode (single instance) ─────────────────────

export function renderMinimalPool(theme: Theme, width: number, instanceId: string, username?: string): string[] {
  const label = username ? theme.fg("accent", username) : theme.fg("dim", shortId(instanceId));
  const txt = theme.fg("accent", "Pool") + " " + theme.fg("dim", "solo") + " " + label;
  return [truncateToWidth(txt, width, "")];
}

// ─── Instance → Agent Mapping from Context Bus Events ───

function buildInstanceAgentMap(events: ContextBusEvent[]): Map<string, { agent: string; task: string; status: "active" | "done" }[]> {
  const map = new Map<string, { agent: string; task: string; status: "active" | "done" }[]>();
  // Process newest-first so "complete" events override earlier delegation events
  const sorted = [...events].reverse();
  const seen = new Set<string>(); // "instanceId:agent" pairs
  for (const event of sorted) {
    if (event.type === "delegation.started" || event.type === "subagent.spawned") {
      const key = event.instanceId + ":" + event.agent;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = map.get(event.instanceId) || [];
      const task = String(event.payload.taskDescription || event.payload.task || "").slice(0, 60);
      list.push({ agent: event.agent, task, status: "active" });
      map.set(event.instanceId, list);
    } else if (event.type === "delegation.completed" || event.type === "subagent.completed") {
      const key = event.instanceId + ":" + event.agent;
      if (seen.has(key)) continue;
      seen.add(key);
      // Don't add to map — this agent is done on this instance
    }
  }
  return map;
}

// ─── Left Panel: Instance → Agent Tree ──────────────────

function renderTreeLines(
  sorted: InstanceEntry[],
  currentInstanceId: string,
  theme: Theme,
  paneWidth: number,
  maxLines: number,
  agentStates?: Record<string, AgentState>,
  busEvents?: ContextBusEvent[],
): string[] {
  const lines: string[] = [];
  const tw = (s: string) => truncateToWidth(s, paneWidth, "");

  // Build agent map from bus events (cross-instance agent tracking)
  const agentMap = busEvents ? buildInstanceAgentMap(busEvents) : new Map<string, { agent: string; task: string; status: "active" | "done" }[]>();

  for (let iIdx = 0; iIdx < sorted.length && lines.length < maxLines; iIdx++) {
    const inst = sorted[iIdx];
    const isSelf = inst.instanceId === currentInstanceId;
    const isLast = iIdx === sorted.length - 1;
    const status = getStatusStyle(inst.lastHeartbeat);
    const ageStr = heartbeatAge(inst.lastHeartbeat);
    const selfTag = isSelf ? " " + theme.fg("accent", "\u25C4") : "";

    // Tree prefix: ├─ or └─
    const treePrefix = isLast ? "\u2514\u2500" : "\u251C\u2500";

    // Instance name
    const identifier = inst.username
      ? theme.fg("accent", inst.username)
      : theme.fg("text", shortId(inst.instanceId));

    // Host info compact: hostname:PID (clipped)
    const hostPid = clip(inst.meta.hostname.replace(/\..*/, "") + ":" + inst.meta.pid, 16);

    const instLine = theme.fg("dim", treePrefix + " ") +
      theme.fg(status.color, status.dot) + " " +
      identifier + " " +
      theme.fg("dim", hostPid) + " " +
      theme.fg("dim", ageStr) +
      selfTag;
    lines.push(padLine(tw(instLine), paneWidth));

    // Collect agents for this instance from events + claims + local state
    const agentsShown: string[] = [];

    // 1. Agents from context bus events (works cross-instance)
    const eventAgents = agentMap.get(inst.instanceId) || [];

    // 2. Agents from claims (backwards compat)
    const claimAgents = inst.claims.map(c => {
      const parsed = parseClaim(c);
      return { agent: parsed.team, task: parsed.description, status: "active" as const };
    });

    // Merge event agents + claim agents (deduplicated)
    const allAgents = [...eventAgents, ...claimAgents];

    for (const { agent: agentName, task: agentTask } of allAgents) {
      if (lines.length >= maxLines) break;
      if (agentsShown.includes(agentName)) continue;
      agentsShown.push(agentName);

      const isLastAgent = agentsShown.length === allAgents.length || lines.length + 1 >= maxLines;
      const childPrefix = isLastAgent ? " " + (isLast ? "  " : "\u2502 ") + "\u2514 " : " " + (isLast ? "  " : "\u2502 ") + "\u251C ";

      const abbrev = abbrevAgent(agentName);
      const localState = agentStates?.[agentName];
      let agentDetail = "";
      if (localState && localState.status !== "idle" && isSelf) {
        // Use rich local state for agents on THIS instance
        const dot = agentStatusDot(localState);
        const dur = formatDuration(localState);
        const cost = formatCost(localState.sessionCost);
        const taskSnippet = localState.snippet
          ? clip(localState.snippet, Math.max(8, paneWidth - 20))
          : clip(localState.task || "", Math.max(8, paneWidth - 20));
        agentDetail = theme.fg(dot.color, dot.dot) + " " +
          theme.fg("accent", abbrev) + " " +
          theme.fg("muted", taskSnippet) +
          (dur ? " " + theme.fg("dim", dur) : "") +
          (cost ? " " + theme.fg("dim", cost) : "");
      } else {
        // Use event payload for agents on other instances (or no local state)
        const descSnippet = clip(agentTask, Math.max(8, paneWidth - 14));
        agentDetail = theme.fg("dim", abbrev) + " " + theme.fg("muted", descSnippet);
      }

      lines.push(padLine(tw(theme.fg("dim", childPrefix) + agentDetail), paneWidth));
    }

    // 3. Also show agents from local agentStates that are active on THIS instance
    //    (for agents not yet tracked in bus events)
    if (agentStates && isSelf) {
      for (const [name, state] of Object.entries(agentStates)) {
        if (lines.length >= maxLines) break;
        if (agentsShown.includes(name)) continue;
        if (state.status === "idle") continue;

        agentsShown.push(name);

        const isLastAgent = lines.length + 1 >= maxLines;
        const childPrefix = isLastAgent
          ? " " + (isLast ? "  " : "\u2502 ") + "\u2514 "
          : " " + (isLast ? "  " : "\u2502 ") + "\u251C ";

        const dot = agentStatusDot(state);
        const abbrev = abbrevAgent(name);
        const dur = formatDuration(state);
        const cost = formatCost(state.sessionCost);
        const taskSnippet = state.snippet
          ? clip(state.snippet, Math.max(8, paneWidth - 20))
          : clip(state.task || "", Math.max(8, paneWidth - 20));

        const agentDetail = theme.fg(dot.color, dot.dot) + " " +
          theme.fg("accent", abbrev) + " " +
          theme.fg("muted", taskSnippet) +
          (dur ? " " + theme.fg("dim", dur) : "") +
          (cost ? " " + theme.fg("dim", cost) : "");

        lines.push(padLine(tw(theme.fg("dim", childPrefix) + agentDetail), paneWidth));
      }
    }
  }

  return lines;
}

// ─── Right Panel: Action Feed + Objectives ───────────────

function renderRightPanel(
  theme: Theme,
  paneWidth: number,
  totalHeight: number,
  busEvents?: ContextBusEvent[],
  debugState?: AutonomousDebugState | null,
  pipelineState?: PipelineState | null,
  instances?: InstanceEntry[],
): string[] {
  const lines: string[] = [];
  const tw = (s: string) => truncateToWidth(s, paneWidth, "");

  // Split: 60% feed, 40% objectives
  const feedHeight = Math.max(1, Math.floor(totalHeight * 0.6));
  const objHeight = totalHeight - feedHeight;

  // ── Feed section ──
  if (busEvents && busEvents.length > 0) {
    const recentEvents = busEvents.slice(-feedHeight);
    for (const event of recentEvents) {
      if (lines.length >= feedHeight) break;
      const time = formatTime(event.timestamp);
      const icon = TYPE_ICONS[event.type] || "\u2022";
      const agent = abbrevAgent(event.agent);
      const summary = summarizeEvent(event);
      const color = TYPE_COLORS[event.type] || "text";

      const line = theme.fg("dim", time) + " " +
        theme.fg(color as ThemeColor, icon) + " " +
        theme.fg("accent", agent) + " " +
        theme.fg(color as ThemeColor, summary);
      lines.push(padLine(tw(line), paneWidth));
    }
  } else {
    lines.push(padLine(tw(theme.fg("dim", "No events")), paneWidth));
  }

  // Pad feed to feedHeight
  while (lines.length < feedHeight) {
    lines.push(padLine("", paneWidth));
  }

  // ── Separator line ──
  const sepContent = theme.fg("dim", "\u2500".repeat(3) + " Objectives " + "\u2500".repeat(Math.max(0, paneWidth - 14)));
  lines.push(padLine(tw(sepContent), paneWidth));

  // ── Objectives section ──
  const objBudget = objHeight - 1; // -1 for separator
  let objLines = 0;

  // Debug objectives
  if (debugState && debugState.objectives.length > 0 && objLines < objBudget) {
    const active = debugState.objectives.filter(o => o.status === "in-progress" || o.status === "pending");
    for (const obj of active.slice(0, 2)) {
      if (objLines >= objBudget) break;
      const icon = obj.status === "in-progress" ? "\u25C9" : "\u25CB";
      const color: ThemeColor = obj.status === "in-progress" ? "warning" : "dim";
      const desc = clip(obj.description, paneWidth - 4);
      lines.push(padLine(tw(theme.fg(color, icon) + " " + theme.fg("muted", desc)), paneWidth));
      objLines++;
    }
  }

  // Sprint goals
  if (pipelineState?.currentSprint?.goals && objLines < objBudget) {
    for (const goal of pipelineState.currentSprint.goals) {
      if (objLines >= objBudget) break;
      const desc = clip(goal, paneWidth - 4);
      lines.push(padLine(tw(theme.fg("dim", "\u25CB") + " " + theme.fg("dim", desc)), paneWidth));
      objLines++;
    }
  }

  // Active claims across instances
  if (instances && objLines < objBudget) {
    for (const inst of instances) {
      if (objLines >= objBudget) break;
      for (const claim of inst.claims) {
        if (objLines >= objBudget) break;
        const parsed = parseClaim(claim);
        const abbrev = abbrevAgent(parsed.team);
        const desc = clip(parsed.description, paneWidth - 12);
        lines.push(padLine(tw(theme.fg("dim", "\u2588") + " " + theme.fg("accent", abbrev) + " " + theme.fg("muted", desc)), paneWidth));
        objLines++;
      }
    }
  }

  // Empty objectives fallback
  if (objLines === 0 && objBudget > 0) {
    lines.push(padLine(tw(theme.fg("dim", "No active objectives")), paneWidth));
  }

  return lines.slice(0, totalHeight);
}

// ─── Full Render ─────────────────────────────────────────

export function renderInstancePool(
  theme: Theme,
  width: number,
  instances: InstanceEntry[],
  currentInstanceId: string,
  agentStates?: Record<string, AgentState>,
  busEvents?: ContextBusEvent[],
  debugState?: AutonomousDebugState | null,
  pipelineState?: PipelineState | null,
): string[] {
  // Minimal mode for single instance or narrow terminals
  const currentInstance = instances.find(i => i.instanceId === currentInstanceId);
  if (instances.length <= 1 || width < MIN_POOL_WIDTH) {
    return renderMinimalPool(theme, width, currentInstanceId, currentInstance?.username);
  }

  const inner = width - 2;
  const c = (s: string) => theme.fg("accent", s);
  const L: string[] = [];

  // Sort: current instance first, then by heartbeat (newest first)
  const sorted = [...instances].sort((a, b) => {
    if (a.instanceId === currentInstanceId) return -1;
    if (b.instanceId === currentInstanceId) return 1;
    return b.lastHeartbeat - a.lastHeartbeat;
  });

  // ── Header line (spans full width) ──
  const instCount = instances.length;
  const activeCount = instances.filter(i => (Date.now() - i.lastHeartbeat) < ACTIVE_THRESHOLD_MS).length;
  const totalClaims = instances.reduce((sum, i) => sum + i.claims.length, 0);
  const freeCount = instCount - instances.filter(i => i.claims.length > 0).length;

  const headerStr = theme.fg("accent", " Instance Pool") +
    " " + theme.fg("text", instCount + " inst") +
    " " + theme.fg("success", activeCount + " active") +
    " " + theme.fg("dim", totalClaims + " claimed") +
    (freeCount > 0 ? " " + theme.fg("dim", freeCount + " free") : "");
  const hdrTruncated = truncateToWidth(headerStr, inner, "");
  const hdrPad = Math.max(0, inner - visibleWidth(hdrTruncated));
  L.push(c("\u250C") + hdrTruncated + " ".repeat(hdrPad) + c("\u2510"));

  const contentHeight = MAX_POOL_HEIGHT - 2; // header + bottom border

  // ── Two-column layout when wide enough ──
  if (width >= SPLIT_MIN_WIDTH) {
    // Split: left 55%, separator (1 char), right 45%
    const leftInner = Math.floor((inner - 1) * 0.55);
    const rightInner = inner - leftInner - 1;

    // Left pane: tree graph
    const leftLines = renderTreeLines(sorted, currentInstanceId, theme, leftInner, contentHeight, agentStates, busEvents);

    // Right pane: feed + objectives
    const rightLines = renderRightPanel(theme, rightInner, contentHeight, busEvents, debugState, pipelineState, instances);

    // Combine into bordered rows
    for (let i = 0; i < contentHeight; i++) {
      const left = i < leftLines.length ? leftLines[i] : padLine("", leftInner);
      const right = i < rightLines.length ? padLine(rightLines[i], rightInner) : padLine("", rightInner);
      L.push(c("\u2502") + left + c("\u2502") + right + c("\u2502"));
    }

    // Bottom border with ┴ at separator junction
    L.push(c("\u2514") + c("\u2500".repeat(leftInner)) + c("\u2534") + c("\u2500".repeat(rightInner)) + c("\u2518"));

  } else {
    // ── Single-column layout (width < 80): tree only ──
    const treeLines = renderTreeLines(sorted, currentInstanceId, theme, inner, contentHeight, agentStates, busEvents);

    for (const line of treeLines) {
      L.push(c("\u2502") + line + c("\u2502"));
    }

    // Pad to contentHeight
    while (L.length < MAX_POOL_HEIGHT - 1) {
      L.push(c("\u2502") + padLine("", inner) + c("\u2502"));
    }

    // ── Bottom border ──
    L.push(c("\u2514") + c("\u2500".repeat(inner)) + c("\u2518"));
  }

  return L;
}
