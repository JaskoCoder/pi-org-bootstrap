/**
 * Pure utility functions — async filesystem operations.
 */
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { DEBUG_STATE_FILE, DEBUG_LOG_FILE } from "./constants.js";

// ─── Path Helpers ────────────────────────────────────────

export const ad = (cwd: string) => path.join(cwd, ".agents");

// ─── File Helpers (async) ────────────────────────────────

export async function rj<T = Record<string, unknown>>(f: string): Promise<T | null> {
  try {
    const content = await fs.readFile(f, "utf-8");
    return JSON.parse(content) as T;
  } catch (e) {
    try { await fs.access(f); process.stderr.write("[head-agent] rj: failed to parse " + f + ": " + (e instanceof Error ? e.message : String(e)) + "\n"); } catch {}
    return null;
  }
};

export const wj = async (f: string, d: unknown) => {
  await fs.mkdir(path.dirname(f), { recursive: true });
  const tmpPath = f + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(d, null, 2) + "\n");
  await fs.rename(tmpPath, f);
};

export const readFileToString = async (f: string) => {
  try { return await fs.readFile(f, "utf-8"); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") process.stderr.write("[head-agent] readFileToString: failed to read " + f + ": " + (e instanceof Error ? e.message : String(e)) + "\n");
    return "";
  }
};

// ─── String Helpers ──────────────────────────────────────

export const vclip = truncateToWidth;
export const clip = (s: string, max: number) => visibleWidth(s) > max ? truncateToWidth(s, max) : s;

export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + "m ago";
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + "h ago";
  return Math.floor(diff / 86_400_000) + "d ago";
}

export function fmtTime(ms: number): string {
  if (ms < 1000) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

/** Take the last N non-empty lines of a string, each clipped to maxLen */
export function lastLines(text: string, count: number, maxLen: number): string[] {
  return text.split("\n").map(l => l.trim()).filter(l => l.length > 0).slice(-count).map(l => clip(l, maxLen));
}

// ─── ID & Hash Helpers ───────────────────────────────────

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function hashFinding(file: string, line: string | number, issueType: string): string {
  const raw = `${file}:${line}:${issueType}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) { hash = ((hash << 5) - hash) + raw.charCodeAt(i); hash |= 0; }
  return hash.toString(36);
}

// ─── Debug Path Helpers ──────────────────────────────────

export const debugStatePath = (cwd: string) => path.join(ad(cwd), DEBUG_STATE_FILE);
export const debugLogPath = (cwd: string) => path.join(ad(cwd), DEBUG_LOG_FILE);

export async function appendDebugLog(cwd: string, entry: string) {
  const logFile = debugLogPath(cwd);
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  await fs.appendFile(logFile, entry + "\n");
}

// ─── Subagent detection ────────────────────────────────

/** Check if this session is a subagent (spawned via spawn_focused/delegate) */
export const isSubagent = (): boolean => process.env.PI_SUB_AGENT === "1";

// ─── Sync convenience wrappers (for cases where sync is required) ──

/** Sync exists check — needed for startup/CLI decision points */
export const existsSync = (f: string) => fsSync.existsSync(f);

/** Sync read JSON — only for the pipeline state in dashboard render (called from sync render()) */
export function rjSync<T = Record<string, unknown>>(f: string): T | null {
  try { return JSON.parse(fsSync.readFileSync(f, "utf-8")); } catch (e) {
    try { fsSync.accessSync(f); process.stderr.write("[head-agent] rjSync: failed to parse " + f + ": " + (e instanceof Error ? e.message : String(e)) + "\n"); } catch {}
    return null;
  }
};
