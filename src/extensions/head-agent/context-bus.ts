/**
 * Context Bus — Persistent append-only event bus for cross-instance coordination.
 *
 * Stores events as JSONL in `.agents/context-bus/events.jsonl`.
 * Snapshots go to `.agents/context-bus/snapshots/latest.json`.
 *
 * Design:
 * - Append-only JSONL for events (no full file rewrites)
 * - Auto-pruning of events older than retention period (default 24h)
 * - Atomic snapshot writes (temp + rename)
 * - All events tagged with instanceId for cross-instance tracking
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ad, generateId } from "./helpers.js";

// ─── Types ───────────────────────────────────────────────

/** Charter-defined event types (dot notation) — the primary types. */
export type CharterEventType =
  | "task.claimed"
  | "task.released"
  | "task.started"
  | "task.completed"
  | "mail.sent"
  | "delegation.started"
  | "delegation.completed"
  | "state.changed"
  | "subagent.spawned"
  | "subagent.completed"
  | "memory.updated";

/** Internal-only event types (not in charter but useful). */
export type InternalEventType =
  | "mail.read"
  | "debug_cycle"
  | "pipeline_event"
  | "cron_fire"
  | "log"
  | "error";

/** All context bus event types. */
export type ContextEventType = CharterEventType | InternalEventType;

export interface ContextBusEvent {
  id: string;
  timestamp: string;
  instanceId: string;
  agent: string;
  type: ContextEventType;
  payload: Record<string, unknown>;
  parentTask?: string;
}

export interface ContextBusOptions {
  /** Maximum age of events in ms (default: 24h) */
  retentionMs?: number;
  /** Max events to return from getRecentEvents (default: 50) */
  defaultLimit?: number;
}

export interface ContextSnapshot {
  timestamp: string;
  instanceId: string;
  agentStates: Record<string, { status: string; task: string | null }>;
  activeTasks: string[];
  recentEventsSummary: { type: string; count: number }[];
}

// ─── Path Helpers ────────────────────────────────────────

const busDir = (cwd: string) => path.join(ad(cwd), "context-bus");
const eventsPath = (cwd: string) => path.join(busDir(cwd), "events.jsonl");
const snapshotsDir = (cwd: string) => path.join(busDir(cwd), "snapshots");
const snapshotPath = (cwd: string) => path.join(snapshotsDir(cwd), "latest.json");

// ─── Event Emitter ───────────────────────────────────────

/**
 * Emit an event to the context bus. Appends a single JSONL line — no read-modify-write.
 * Returns the emitted event (with generated id and timestamp).
 */
export async function emitEvent(
  cwd: string,
  event: Omit<ContextBusEvent, "id" | "timestamp">,
): Promise<ContextBusEvent> {
  const full: ContextBusEvent = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    ...event,
  };

  const ep = eventsPath(cwd);
  await fs.mkdir(path.dirname(ep), { recursive: true });
  await fs.appendFile(ep, JSON.stringify(full) + "\n");

  return full;
}

// ─── Event Readers ───────────────────────────────────────

/** Parse events from a JSONL file, optionally filtering. Returns newest-last. */
async function readEventsFiltered(
  cwd: string,
  filter: (e: ContextBusEvent) => boolean,
  limit?: number,
): Promise<ContextBusEvent[]> {
  const ep = eventsPath(cwd);
  let content: string;
  try {
    content = await fs.readFile(ep, "utf-8");
  } catch {
    return [];
  }

  const lines = content.split("\n").filter(l => l.trim());
  const events: ContextBusEvent[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as ContextBusEvent;
      if (filter(parsed)) events.push(parsed);
    } catch {
      // Skip malformed lines
    }
  }

  // Return newest-last, limited
  return limit ? events.slice(-limit) : events;
}

/** Get recent events, newest-last, optionally filtered. */
export async function getRecentEvents(
  cwd: string,
  opts?: { limit?: number; type?: ContextEventType; agent?: string; instanceId?: string },
): Promise<ContextBusEvent[]> {
  const limit = opts?.limit ?? 50;
  const filter = (e: ContextBusEvent) => {
    if (opts?.type && e.type !== opts.type) return false;
    if (opts?.agent && e.agent !== opts.agent) return false;
    if (opts?.instanceId && e.instanceId !== opts.instanceId) return false;
    return true;
  };
  return readEventsFiltered(cwd, filter, limit);
}

/** Get all events for a specific agent. */
export async function getEventsByAgent(
  cwd: string,
  agent: string,
  limit?: number,
): Promise<ContextBusEvent[]> {
  return readEventsFiltered(cwd, e => e.agent === agent, limit);
}

/** Get all events of a specific type. */
export async function getEventsByType(
  cwd: string,
  type: ContextEventType,
  limit?: number,
): Promise<ContextBusEvent[]> {
  return readEventsFiltered(cwd, e => e.type === type, limit);
}

/** Get all events from a specific instance. */
export async function getEventsByInstance(
  cwd: string,
  instanceId: string,
  limit?: number,
): Promise<ContextBusEvent[]> {
  return readEventsFiltered(cwd, e => e.instanceId === instanceId, limit);
}

// ─── Pruning ─────────────────────────────────────────────

/** Prune events older than retentionMs from the JSONL file. Uses atomic write. */
export async function pruneEvents(
  cwd: string,
  retentionMs: number = 86_400_000, // 24h default
): Promise<number> {
  const ep = eventsPath(cwd);
  let content: string;
  try {
    content = await fs.readFile(ep, "utf-8");
  } catch {
    return 0;
  }

  const cutoff = Date.now() - retentionMs;
  const lines = content.split("\n").filter(l => l.trim());
  const kept: string[] = [];
  let pruned = 0;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as ContextBusEvent;
      const ts = new Date(parsed.timestamp).getTime();
      if (ts >= cutoff) {
        kept.push(line);
      } else {
        pruned++;
      }
    } catch {
      // Keep malformed lines (don't lose data)
      kept.push(line);
    }
  }

  if (pruned > 0) {
    // Atomic write: temp + rename
    const tmpPath = ep + ".tmp";
    await fs.writeFile(tmpPath, kept.join("\n") + "\n");
    await fs.rename(tmpPath, ep);
  }

  return pruned;
}

// ─── State Snapshot ──────────────────────────────────────

/** Write a state snapshot to the snapshots directory. */
export async function writeSnapshot(
  cwd: string,
  snapshot: ContextSnapshot,
): Promise<void> {
  const sp = snapshotPath(cwd);
  await fs.mkdir(path.dirname(sp), { recursive: true });
  const tmpPath = sp + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(snapshot, null, 2) + "\n");
  await fs.rename(tmpPath, sp);
}

/** Read the latest snapshot. */
export async function readSnapshot(cwd: string): Promise<ContextSnapshot | null> {
  const sp = snapshotPath(cwd);
  try {
    const content = await fs.readFile(sp, "utf-8");
    return JSON.parse(content) as ContextSnapshot;
  } catch {
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────

/** Get a summary of event counts by type for recent events. */
export async function getEventSummary(
  cwd: string,
  limit: number = 100,
): Promise<{ type: string; count: number }[]> {
  const events = await readEventsFiltered(cwd, () => true, limit);
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.type] = (counts[e.type] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

/** Count events in the JSONL file (fast line count, no parsing). */
export async function countEvents(cwd: string): Promise<number> {
  const ep = eventsPath(cwd);
  try {
    const content = await fs.readFile(ep, "utf-8");
    return content.split("\n").filter(l => l.trim()).length;
  } catch {
    return 0;
  }
}
