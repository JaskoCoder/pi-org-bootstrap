/**
 * Instance Registry — Multi-instance coordination via shared JSON file.
 *
 * Tracks active pi instances, their heartbeats, and task claims.
 * Uses atomic file writes to avoid corruption from concurrent access.
 *
 * Stale instance pruning uses a two-tier strategy:
 * 1. Process-liveness check: If the PID is dead, prune immediately (regardless of heartbeat)
 * 2. Heartbeat TTL: If heartbeat is older than STALE_THRESHOLD_MS, prune (for remote hosts where PID can't be checked)
 *
 * This ensures phantom entries from crashed/killed sessions are cleaned up promptly,
 * not waiting for the full TTL to expire.
 */
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { ad, rj, wj } from "./helpers.js";
import { REGISTRY_FILE, STALE_THRESHOLD_MS, TASK_KEY_PREFIX } from "./constants.js";

// ─── Process Liveness ───────────────────────────────────

/**
 * Check if a process is alive using `kill(pid, 0)`.
 * Returns false if PID is dead (ESRCH) or on another host.
 * Returns true if process exists — including EPERM (exists but we lack permission to signal it).
 * EPERM means the process IS alive; returning false would cause live instances to be incorrectly pruned.
 */
function isProcessAlive(hostname: string, pid: number): boolean {
  // Can only check PIDs on the same host
  if (hostname !== os.hostname()) return true; // Assume alive — can't verify remotely
  try {
    process.kill(pid, 0); // Throws if process doesn't exist
    return true;
  } catch (e: any) {
    if (e?.code === "EPERM") return true; // process exists, just can't signal it
    return false; // ESRCH or other error — treat as dead
  }
}

// ─── Types ───────────────────────────────────────────────

export interface InstanceMeta {
  hostname: string;
  pid: number;
  startedAt: string;
}

export interface InstanceEntry {
  instanceId: string;
  meta: InstanceMeta;
  lastHeartbeat: number;
  claims: string[];
  username?: string;
}

export interface RegistryData {
  instances: Record<string, InstanceEntry>;
}

// ─── Instance ID ─────────────────────────────────────────

/** Generate a unique instance ID: `${hostname}-${pid}-${randomSuffix}` */
export function generateInstanceId(): string {
  const hostname = os.hostname().replace(/[^a-zA-Z0-9-]/g, "");
  const pid = process.pid;
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${hostname}-${pid}-${suffix}`;
}

// ─── Registry Path ───────────────────────────────────────

function registryPath(cwd: string): string {
  return path.join(ad(cwd), REGISTRY_FILE);
}

// ─── Prune Stale Instances ───────────────────────────────

function pruneStale(data: RegistryData): RegistryData {
  const now = Date.now();
  const kept: Record<string, InstanceEntry> = {};
  for (const [id, entry] of Object.entries(data.instances)) {
    // First check: is the underlying process dead? (catches crashed/killed sessions immediately)
    if (!isProcessAlive(entry.meta.hostname, entry.meta.pid)) {
      continue; // Dead process — prune regardless of heartbeat age
    }
    // Second check: is the heartbeat too old? (catches unresponsive but alive sessions)
    if (now - entry.lastHeartbeat >= STALE_THRESHOLD_MS) {
      continue; // Stale heartbeat — prune
    }
    kept[id] = entry;
    // Pruned entries are silently dropped — their claims are released automatically
  }
  return { instances: kept };
}

async function readRegistry(cwd: string): Promise<RegistryData> {
  const rp = registryPath(cwd);
  const data = await rj<RegistryData>(rp);
  if (!data || !data.instances) return { instances: {} };
  return pruneStale(data);
}

async function writeRegistry(cwd: string, data: RegistryData): Promise<void> {
  const rp = registryPath(cwd);
  await wj(rp, data);
}

// ─── Public API ──────────────────────────────────────────

/** Register a new instance in the registry. */
export async function register(
  cwd: string,
  instanceId: string,
  meta: InstanceMeta,
  username?: string,
): Promise<void> {
  const data = await readRegistry(cwd);
  data.instances[instanceId] = {
    instanceId,
    meta,
    lastHeartbeat: Date.now(),
    claims: [],
    username,
  };
  await writeRegistry(cwd, data);
}

/** Set the username for an instance. */
export async function setUsername(
  cwd: string,
  instanceId: string,
  username: string,
): Promise<void> {
  const data = await readRegistry(cwd);
  const entry = data.instances[instanceId];
  if (entry) {
    entry.username = username;
    await writeRegistry(cwd, data);
  }
}

/** Deregister an instance, releasing all its claims. */
export async function deregister(cwd: string, instanceId: string): Promise<void> {
  const data = await readRegistry(cwd);
  delete data.instances[instanceId];
  await writeRegistry(cwd, data);
}

/** Update the heartbeat timestamp for an instance. */
export async function heartbeat(cwd: string, instanceId: string): Promise<void> {
  const data = await readRegistry(cwd);
  const entry = data.instances[instanceId];
  if (entry) {
    entry.lastHeartbeat = Date.now();
    await writeRegistry(cwd, data);
  }
}

/**
 * Atomically claim a task. Returns true if the claim was acquired,
 * false if already claimed by another instance.
 */
export async function claim(
  cwd: string,
  instanceId: string,
  taskKey: string,
): Promise<boolean> {
  const fullKey = TASK_KEY_PREFIX + taskKey;
  const data = await readRegistry(cwd);

  // Check if already claimed by another instance
  for (const [id, entry] of Object.entries(data.instances)) {
    if (entry.claims.includes(fullKey)) {
      if (id !== instanceId) return false; // Claimed by someone else
      return true; // Already claimed by us
    }
  }

  // Claim is free — take it
  const entry = data.instances[instanceId];
  if (!entry) return false; // We're not registered
  if (!entry.claims.includes(fullKey)) {
    entry.claims.push(fullKey);
  }
  await writeRegistry(cwd, data);
  return true;
}

/** Release a task claim. */
export async function release(
  cwd: string,
  instanceId: string,
  taskKey: string,
): Promise<void> {
  const fullKey = TASK_KEY_PREFIX + taskKey;
  const data = await readRegistry(cwd);
  const entry = data.instances[instanceId];
  if (entry) {
    entry.claims = entry.claims.filter(c => c !== fullKey);
    await writeRegistry(cwd, data);
  }
}

/** Get all active instances (after pruning stale ones). */
export async function getActive(cwd: string): Promise<InstanceEntry[]> {
  const data = await readRegistry(cwd);
  return Object.values(data.instances);
}

/**
 * Force-prune dead processes from the registry.
 * Useful as a startup cleanup or periodic maintenance task.
 * Returns the number of pruned entries.
 */
export async function pruneDeadInstances(cwd: string): Promise<number> {
  const rp = registryPath(cwd);
  const data = await rj<RegistryData>(rp);
  if (!data || !data.instances) return 0;
  const before = Object.keys(data.instances).length;
  const pruned = pruneStale(data);
  const after = Object.keys(pruned.instances).length;
  if (before !== after) {
    await writeRegistry(cwd, pruned);
  }
  return before - after;
}

/** Check if a task is claimed by another instance. */
export async function isClaimed(
  cwd: string,
  taskKey: string,
  excludeInstanceId?: string,
): Promise<boolean> {
  const fullKey = TASK_KEY_PREFIX + taskKey;
  const data = await readRegistry(cwd);
  for (const [id, entry] of Object.entries(data.instances)) {
    if (entry.claims.includes(fullKey) && id !== excludeInstanceId) {
      return true;
    }
  }
  return false;
}

/** Get all claims for a specific instance. */
export async function getClaims(
  cwd: string,
  instanceId: string,
): Promise<string[]> {
  const data = await readRegistry(cwd);
  return data.instances[instanceId]?.claims ?? [];
}
