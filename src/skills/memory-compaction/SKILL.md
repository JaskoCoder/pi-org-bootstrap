# Memory Compaction Skill

Triggers when agent memory files need compaction — compressing verbose history into a concise active zone while preserving full detail in an archive section.

## When to Use
- After completing a task, if the memory file exceeds 5KB
- When manually invoked via "compact memory" or "memory compaction"
- During scheduled maintenance (cron-based compaction)
- When the agent notices it can't see its recent entries in the auto-loaded context

## Compaction Algorithm

### Active Zone (first 1500 chars — auto-loaded into system prompt)

The active zone MUST contain, in order:

1. **Title** — `# [Agent Name] Memory`
2. **Mental Model** — Verbatim from current file (or synthesized if missing)
3. **Key Decisions** — Verbatim (trimmed to most recent 5 if excessive)
4. **Active Work** — Verbatim (only unresolved items)
5. **Patterns & Gotchas** — Compressed one-liners extracted from `[PATTERN]`, `[GOTCHA]`, `[LESSON]`, `[DECISION]`, `[SECURITY]` tags across ALL entries (not just visible ones)
6. **History Summary** — One bullet per dated entry: `## [YYYY-MM-DD] brief summary`

**Constraint**: Active zone MUST be under 1500 characters (excluding the archive marker).

### Archive Zone (below `---\n` marker)

Everything after the archive marker is the full original content, preserved verbatim:
- All original dated entries
- All detailed descriptions
- All file change lists
- All code snippets and examples

The archive is accessible via the `read` tool but NOT auto-loaded.

### Compaction Rules

1. **Preserve structure** — Keep the standard sections (Mental Model, Key Decisions, Active Work, Gotchas & Learnings, History)
2. **Extract tags** — Scan the ENTIRE file for `[PATTERN]`, `[GOTCHA]`, `[LESSON]`, `[DECISION]`, `[SECURITY]` tags
3. **Compress tagged entries** — Convert to one-liners: `- **[TAG]**: compressed description`
4. **Summarize history** — Each `## [YYYY-MM-DD]` entry becomes one bullet with the title only
5. **Trim from bottom** — If active zone exceeds 1500 chars, remove oldest history bullets first, then oldest patterns/gotchas
6. **Never lose data** — All removed content goes into the archive section

### Tag Extraction Patterns

Look for these patterns in the raw file content:

```
- **[PATTERN]**: description
- **[GOTCHA]**: description  
- **[LESSON]**: description
- **[DECISION]**: description
- **[SECURITY]**: description
```

Also check for inline tags within prose:
```
[PATTERN]: description in prose
GOTCHA — description in prose
Key pattern: description
Key gotcha: description
```

### Compaction Trigger

Run compaction when:
- File size exceeds 5KB (5120 bytes)
- After any POST-TASK memory update if file grew by more than 1KB
- On scheduled maintenance (weekly recommended)

Files under 5KB should still follow the two-tier format but don't need compression.

## Implementation

Use a script to process memory files:

```bash
python3 .pi/skills/memory-compaction/compact.py .agents/agent-memory/<agent>.md
```

The script:
1. Reads the full file
2. Extracts and preserves structured sections
3. Scans for tagged entries throughout
4. Builds active zone (under 1500 chars)
5. Writes: active zone + `---\n# Archived (full detail below)\n\n` + original content
6. Validates output

## Post-Compaction Verification

After compaction, verify:
1. Active zone is under 1500 characters
2. All `[PATTERN]`, `[GOTCHA]`, `[LESSON]` tags are represented in the active zone
3. Mental Model, Key Decisions, Active Work are present
4. Archive section contains the full original content
5. File is valid markdown (no broken headers or links)
