/**
 * Dashboard rendering — compact TUI layout with capped height.
 *
 * Sections are ordered by priority (highest first):
 *   Header → Agents → Preview → Debug → Cron → Mail → Border
 * When the line budget runs out, lower-priority sections are dropped first.
 *
 * Fixed (issue #1956):
 * - Removed sync file I/O from render path (accepts pre-loaded state)
 * - Fixed width calculations: single consistent borderedLine() function,
 *   no more redundant safeLine(bordered(...)) double-wrapping
 * - Added render caching via DashboardCache to avoid re-computing unchanged content
 */
import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { AgentState, AutonomousDebugState, PipelineState } from "./types.js";
import { TEAMS, TEAM_ORDER } from "./constants.js";
import { clip, fmtTime, relativeTime } from "./helpers.js";
import type { MailSystem } from "./mail.js";

const MIN_DASHBOARD_WIDTH = 40;
const MAX_DASHBOARD_HEIGHT = 12;
const MIN_DASHBOARD_HEIGHT = 4;

/** Sanitize string for single-line rendering — strips newlines, tabs, and control chars. */
const clean = (s: string): string =>
  s.replace(/[\r\n\t]/g, " ").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

function borderedLine(content: string, inner: number, borderFn: (s: string) => string): string {
  const truncated = truncateToWidth(content, inner, "");
  const padNeeded = Math.max(0, inner - visibleWidth(truncated));
  return borderFn("\u2502") + truncated + " ".repeat(padNeeded) + borderFn("\u2502");
}

export function renderMinimalStatus(
  theme: Theme, width: number,
  agentStates: Record<string, AgentState>,
  pipelineState: PipelineState | null,
): string[] {
  const sprint = pipelineState?.currentSprint || {};
  const anyWorking = TEAM_ORDER.some(n => agentStates[n].status !== "idle");
  const spin = anyWorking ? ["|", "/", "-", "\\"][Math.floor(Date.now() / 5000) % 4] : " ";
  const txt = `[${spin}] Sprint #${sprint.number || "?"} | ${anyWorking ? "working..." : "idle"}`;
  return [truncateToWidth(theme.fg("accent", "Agents") + " " + theme.fg("dim", txt), width, "")];
}

export function renderDashboard(
  theme: Theme, width: number,
  agentStates: Record<string, AgentState>,
  headAgentActive: boolean, headAgentPreview: string,
  mailSystem: MailSystem,
  pipelineState: PipelineState | null,
  debugState: AutonomousDebugState | null,
  cronScheduler?: import("./cron-types.js").CronScheduler | null,
  activeInstanceCount?: number,
): string[] {
  if (width < MIN_DASHBOARD_WIDTH) return renderMinimalStatus(theme, width, agentStates, pipelineState);

  const sprint = pipelineState?.currentSprint || {};
  const triage = pipelineState?.triage || {};
  const stats = pipelineState?.stats || {};
  const pipeline = pipelineState?.pipeline || {};

  const spin = ["|", "/", "-", "\\"][Math.floor(Date.now() / 5000) % 4];
  const anyWorking = TEAM_ORDER.some(n => agentStates[n].status !== "idle");
  const inner = width - 2;
  const c = (s: string) => theme.fg("accent", s);
  const L: string[] = [];

  let addedContent = false;
  const sep = () => {
    if (addedContent && budget() > 0) L.push(borderedLine(theme.fg("dim", "\u2500".repeat(inner)), inner, c));
  };

  const budget = () => MAX_DASHBOARD_HEIGHT - L.length - 1;

  const activeAgents = TEAM_ORDER.filter(n => agentStates[n].status !== "idle");

  // ── Header line (ALWAYS shown) ──
  const firstActive = activeAgents.length > 0 ? activeAgents[0] : null;
  let taskStr: string;
  if (firstActive) {
    const agent = agentStates[firstActive];
    const baseTask = clip(clean(agent.task || agent.snippet || "working"), 30);
    const remaining = activeAgents.length - 1;
    taskStr = remaining > 0 ? baseTask + theme.fg("dim", "+" + remaining + " more") : baseTask;
  } else {
    taskStr = theme.fg("dim", "idle");
  }

  const activeCount = activeAgents.length;
  const totalCount = TEAM_ORDER.length;
  const runningStr = activeCount + "/" + totalCount + " running";

  let pipeStr: string;
  if (anyWorking) pipeStr = theme.fg("warning", "[" + spin + "]");
  else if (pipeline.lastRunStatus === "success") pipeStr = theme.fg("success", "[+]");
  else if (pipeline.lastRunStatus === "failed") pipeStr = theme.fg("error", "[x]");
  else pipeStr = theme.fg("dim", "[-]");

  const totalSent = TEAM_ORDER.reduce((sum, n) => sum + (agentStates[n]?.sessionTotal ?? 0), 0);
  const sentStr = totalSent + " sent";

  const instCount = activeInstanceCount ?? 1;
  const instStr = instCount > 1
    ? theme.fg("warning", "Inst:" + instCount)
    : theme.fg("dim", "Inst:1");

  const header = " " + theme.fg("text", taskStr) +
    theme.fg("dim", " \u2502 ") + theme.fg("text", runningStr) +
    theme.fg("dim", " \u2502 ") + pipeStr +
    theme.fg("dim", " \u2502 ") + theme.fg("text", sentStr) +
    theme.fg("dim", " \u2502 ") + instStr;
  const hdrTruncated = truncateToWidth(header, inner, "");
  const hdrPad = Math.max(0, inner - visibleWidth(hdrTruncated));
  L.push(c("\u250c") + hdrTruncated + " ".repeat(hdrPad) + c("\u2510"));
  addedContent = true;

  // ── Active agent lines ──
  sep();

  if (activeAgents.length === 0 && !headAgentActive) {
    L.push(borderedLine(theme.fg("dim", " All teams idle"), inner, c));
  } else {
    for (const name of activeAgents.slice(0, 4)) {
      if (budget() <= 0) break;
      const agent = agentStates[name];
      const team = TEAMS[name];
      const clr = team.color;

      let icon: string;
      switch (agent.status) {
        case "working":   icon = theme.fg(clr as ThemeColor, "[" + spin + "]"); break;
        case "reviewing": icon = theme.fg("mdLink" as ThemeColor, "[?]"); break;
        case "scanning":  icon = theme.fg("error" as ThemeColor, "[!]"); break;
        case "deploying": icon = theme.fg("warning" as ThemeColor, "[#]"); break;
        case "done":      icon = theme.fg("success" as ThemeColor, "[+]"); break;
        default:          icon = theme.fg("dim" as ThemeColor, "[ ]"); break;
      }

      const label = theme.fg(clr as ThemeColor, team.label.padEnd(8));
      const task = clip(clean(agent.task || agent.snippet || ""), 24);
      let timeStr = "";
      if (agent.startedAt && agent.status !== "idle") timeStr = fmtTime(Date.now() - agent.startedAt);
      else if (agent.lastDuration) timeStr = fmtTime(agent.lastDuration);
      let costStr = agent.sessionCost > 0 ? "$" + agent.sessionCost.toFixed(3) : "";

      const line = icon + " " + label + " " + theme.fg("text", task) +
        (timeStr ? " " + theme.fg("dim", timeStr) : "") +
        (costStr ? " " + theme.fg("dim", costStr) : "");
      L.push(borderedLine(" " + line, inner, c));

      if (agent.preview && budget() > 0) {
        const lastLine = agent.preview.split("\n").map(l => l.trim()).filter(l => l.length > 0).slice(-1)[0] || "";
        if (lastLine) {
          const previewLine = theme.fg("dim", "   \u2514 ") + theme.fg("muted", clip(lastLine, inner - 6));
          L.push(borderedLine(previewLine, inner, c));
        }
      }
    }
  }

  // ── Main agent streaming preview ──
  if (headAgentActive && headAgentPreview && budget() > 0) {
    const lines = headAgentPreview.split("\n").map(l => l.trim()).filter(l => l.length > 0).slice(-2).map(l => clip(l, inner - 4));
    for (const line of lines) {
      if (budget() <= 0) break;
      L.push(borderedLine(theme.fg("dim", " \u25B8 ") + theme.fg("text", line), inner, c));
    }
  }

  // ── Debug loop status ──
  if (debugState && debugState.status !== "idle" && budget() >= 2) {
    sep();
    const dbgIcon = theme.fg("error", "[BUG]");
    const phaseSpin = ["running", "scanning", "fixing", "testing"].some(s => debugState.status === s || debugState.status === "initializing")
      ? " " + theme.fg("warning", "[" + spin + "]") : "";
    const activeObj = debugState.objectives.filter(o => o.status === "in-progress")[0];
    const objStr = activeObj ? clip(clean(activeObj.description), 20) : "";
    const knownCount = Object.keys(debugState.knownFindings).length;
    const resolvedCount = Object.values(debugState.knownFindings).filter(f => f.status === "resolved").length;
    const runtime = debugState.startedAt ? fmtTime(Date.now() - new Date(debugState.startedAt).getTime()) : "0s";
    const dbgLine = dbgIcon + phaseSpin + " " + theme.fg("text", debugState.status) +
      " " + theme.fg("dim", "c" + debugState.totalCycles + "/" + (debugState.maxCycles || "\u221E")) +
      " " + theme.fg("dim", "f" + knownCount + "/r" + resolvedCount) +
      (debugState.totalCost > 0 ? " " + theme.fg("dim", "$" + debugState.totalCost.toFixed(2)) : "") +
      " " + theme.fg("dim", runtime) +
      (objStr ? " " + theme.fg("muted", clip(objStr, 15)) : "");
    L.push(borderedLine(dbgLine, inner, c));
  }

  // ── Cron status row ──
  if (cronScheduler && budget() >= 2) {
    try {
      const cronTasks = cronScheduler.getTasks();
      sep();
      const cronActive = cronTasks.filter(t => t.enabled).length;
      const cronFailed = cronTasks.filter(t => t.consecutiveFailures > 0).length;
      const cronNext = cronTasks
        .filter(t => t.enabled && t.nextRun)
        .sort((a, b) => new Date(a.nextRun!).getTime() - new Date(b.nextRun!).getTime())[0];
      const cronNextIn = cronNext
        ? (() => {
            const diff = new Date(cronNext.nextRun!).getTime() - Date.now();
            if (diff <= 0) return "now";
            const s = Math.floor(diff / 1000);
            if (s < 60) return `in ${s}s`;
            return `in ${Math.floor(s / 60)}m`;
          })()
        : "\u2014";

      const cronIcon = theme.fg("accent", " Cron");
      const cronFailedStr = cronFailed > 0 ? theme.fg("error", ` ${cronFailed} failing`) : "";
      const cronLine = cronIcon +
        theme.fg("dim", ` ${cronActive} active next: ${cronNextIn}`) +
        cronFailedStr;
      L.push(borderedLine(cronLine, inner, c));
    } catch {
      // Cron not available yet
    }
  }

  // ── Comm Feed ──
  if (budget() >= 2) {
    const maxMailItems = Math.min(3, budget() - 2);
    const recentMail = maxMailItems > 0 ? mailSystem.allRecentMail(maxMailItems) : [];
    if (recentMail.length > 0) {
      sep();
      L.push(borderedLine(theme.fg("dim", " \u2500\u2500 Messages \u2500\u2500"), inner, c));
      for (const mail of recentMail) {
        if (budget() <= 0) break;
        const fromTeam = TEAMS[mail.from];
        const toLabel = mail.to === "all" ? "ALL" : (TEAMS[mail.to]?.label || mail.to);
        const fromColor = (fromTeam?.color || "text") as ThemeColor;
        const fromLabel = fromTeam?.label || mail.from;
        const isUnread = !mail.read;
        const dot = isUnread ? theme.fg("warning", "\u2022") : theme.fg("dim", " ");
        const timeStr = relativeTime(mail.timestamp);
        const subj = clip(clean(mail.subject), 18);
        const subjStyle = (isUnread ? "text" : "dim") as ThemeColor;

        const prefix = dot + " " +
          theme.fg(fromColor, clip(fromLabel, 7)) +
          theme.fg("dim", "\u2192") +
          theme.fg(subjStyle, clip(toLabel, 7)) + " " +
          theme.fg(subjStyle, subj) + " ";
        const timePart = theme.fg("dim", " " + timeStr);
        const prefixWidth = visibleWidth(prefix);
        const timeWidth = visibleWidth(timePart);
        const bodyMax = Math.max(0, inner - 2 - prefixWidth - timeWidth);
        const bodyPreview = bodyMax > 0 ? clip(clean(mail.body), bodyMax) : "";

        const mailLine = prefix + theme.fg("muted", bodyPreview) + timePart;
        L.push(borderedLine(mailLine, inner, c));
      }
    }
  }

  // ── Pad to MIN_DASHBOARD_HEIGHT ──
  while (L.length < MIN_DASHBOARD_HEIGHT - 1) {
    L.push(borderedLine("", inner, c));
  }

  // ── Bottom border ──
  L.push(c("\u2514") + c("\u2500".repeat(inner)) + c("\u2518"));

  return L;
}

// ─── Render Cache ──────────────────────────────────────────

interface CacheKey {
  width: number;
  anyWorking: boolean;
  spinFrame: number;
  headAgentActive: boolean;
  headAgentPreviewLen: number;
  agentSnapshot: string;
  mailCount: number;
  cronTaskCount: number;
  sprintNum: number | undefined;
  debugStatus: string;
}

export class DashboardCache {
  private cachedWidth?: number;
  private cachedLines?: string[];
  private lastKey?: string;

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.lastKey = undefined;
  }

  getCached(width: number, inputs: CacheKey): string[] | undefined {
    const key = this.buildKey(width, inputs);
    if (this.lastKey === key && this.cachedWidth === width && this.cachedLines) {
      return this.cachedLines;
    }
    return undefined;
  }

  setCached(width: number, inputs: CacheKey, lines: string[]): void {
    this.cachedWidth = width;
    this.cachedLines = lines;
    this.lastKey = this.buildKey(width, inputs);
  }

  private buildKey(width: number, inputs: CacheKey): string {
    return `${width}|${inputs.anyWorking ? 1 : 0}|${inputs.spinFrame}|${inputs.headAgentActive ? 1 : 0}|${inputs.headAgentPreviewLen}|${inputs.agentSnapshot}|${inputs.mailCount}|${inputs.cronTaskCount}|${inputs.sprintNum ?? ""}|${inputs.debugStatus}`;
  }
}
