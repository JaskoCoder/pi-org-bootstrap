/**
 * Memory Merge — Safe concurrent memory file merging.
 *
 * When multiple instances write to the same agent memory file, their
 * changes need to be merged without data loss. This module:
 * - Parses markdown memory files into entries by date heading
 * - Deduplicates entries by content hash
 * - Merges two versions preserving ALL unique content
 * - Writes memory files atomically
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ─── Types ───────────────────────────────────────────────

export interface MemoryEntry {
  heading: string;   // e.g., "## [2026-06-04]"
  content: string;   // Full text including heading
  sortKey: string;   // Date string for chronological ordering
}

// ─── Parsing ─────────────────────────────────────────────

/**
 * Split markdown content into entries delimited by `## [YYYY-MM-DD]` headings.
 * Content before the first heading is treated as a preamble (not an entry).
 */
export function parseMemoryEntries(content: string): MemoryEntry[] {
  if (!content || !content.trim()) return [];

  const lines = content.split("\n");
  const entries: MemoryEntry[] = [];
  let currentLines: string[] = [];
  let currentSortKey = "";

  const dateHeading = /^## \[(\d{4}-\d{2}-\d{2})\]/;

  for (const line of lines) {
    const match = line.match(dateHeading);
    if (match) {
      // Flush previous entry
      if (currentLines.length > 0 && currentSortKey) {
        entries.push({
          heading: currentLines[0],
          content: currentLines.join("\n"),
          sortKey: currentSortKey,
        });
      }
      currentLines = [line];
      currentSortKey = match[1];
    } else if (currentSortKey) {
      currentLines.push(line);
    }
    // Lines before the first date heading are ignored (preamble)
  }

  // Flush last entry
  if (currentLines.length > 0 && currentSortKey) {
    entries.push({
      heading: currentLines[0],
      content: currentLines.join("\n"),
      sortKey: currentSortKey,
    });
  }

  return entries;
}

// ─── Hashing ─────────────────────────────────────────────

/**
 * Generate a content hash for deduplication.
 * Normalizes whitespace, takes first 200 chars of body, then hashes.
 */
export function hashEntry(entry: MemoryEntry): string {
  // Get body (everything after heading line)
  const bodyLines = entry.content.split("\n").slice(1);
  const body = bodyLines.join("\n")
    .replace(/\s+/g, " ")        // Normalize all whitespace to single spaces
    .trim()
    .slice(0, 200);              // Take first 200 chars

  return crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);
}

// ─── Merging ─────────────────────────────────────────────

/**
 * Merge two versions of a memory file, preserving all unique content.
 *
 * Strategy:
 * 1. Parse both into entries
 * 2. Deduplicate by content hash
 * 3. Sort chronologically (newest first)
 * 4. Return merged content
 */
export function mergeMemories(localContent: string, registryContent: string): string {
  const localEntries = parseMemoryEntries(localContent);
  const registryEntries = parseMemoryEntries(registryContent);

  const seen = new Set<string>();
  const merged: MemoryEntry[] = [];

  // Process all entries (local first for stability, then registry)
  const allEntries = [...localEntries, ...registryEntries];

  for (const entry of allEntries) {
    const hash = hashEntry(entry);
    if (!seen.has(hash)) {
      seen.add(hash);
      merged.push(entry);
    }
  }

  // Sort chronologically: newest first (descending sortKey)
  merged.sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  return merged.map(e => e.content.trim()).join("\n\n") + "\n";
}

// ─── Quick Diff Check ────────────────────────────────────

/** Quick check if two memory file contents differ. */
export function needsMerge(localContent: string, registryContent: string): boolean {
  if (!localContent && !registryContent) return false;
  if (!localContent || !registryContent) return true;
  // Normalize and compare
  const normLocal = localContent.replace(/\s+/g, " ").trim();
  const normRegistry = registryContent.replace(/\s+/g, " ").trim();
  return normLocal !== normRegistry;
}

// ─── Atomic Write ────────────────────────────────────────

/** Write a memory file atomically (tmp + rename). */
export async function atomicWriteMemory(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = filePath + ".tmp";
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, filePath);
}
