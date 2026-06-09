---
name: memory-maintenance
description: "Standardizes agent memory file format and maintenance. Use when updating agent memory files (.agents/agent-memory/*.md), initializing new agent memory, enforcing memory structure, or performing post-task memory writes. Triggers on keywords: update memory, write memory, memory update, post-task memory, agent memory, memory maintenance, memory template, persist notes, save learnings, memory audit."
---

# Memory Maintenance Skill

Provides a standardized template and protocol for agent memory files.
Ensures all agents maintain consistent, useful, and searchable memory across sessions.

## When to Load

This skill activates when:
- An agent completes a task and needs to update its memory file
- A new agent is created and needs an initialized memory file
- A memory audit is being performed
- The user mentions "memory", "memory template", "memory format", or "persist notes"
- Post-task cleanup includes memory writing

## Memory File Location

Agent memory files live at:
```
.agents/agent-memory/<agent-name>.md
```

Where `<agent-name>` matches the agent's identifier (e.g., `backend-team`, `frontend-team`, `pi-skills`).

---

## Memory Template

Use this template when creating a **new** agent memory file or when reinitializing
an existing one during an audit:

```markdown
# <Agent-Name> Agent Memory

## Mental Model

### Architecture
<!-- How this agent's domain fits into the overall system. Key subsystems,
     dependencies, data flows. Update when structural changes occur. -->

### Patterns & Conventions
<!-- Recurring patterns in this domain. Naming conventions, file organization,
     preferred approaches. Update when new patterns are established. -->

### Risks & Constraints
<!-- Known risks, technical debt, brittle areas, things that break easily.
     Update when new risks are discovered. -->

---

## Key Decisions

<!-- Log important decisions with rationale. Each entry should explain WHY,
     not just WHAT. Old decisions remain for historical context. -->

### [YYYY-MM-DD] <Brief Decision Title>
- **Context**: What situation prompted this decision
- **Decision**: What was chosen
- **Rationale**: Why this approach over alternatives
- **Alternatives Considered**: What else was on the table

---

## Active Work

<!-- Current and recent tasks. Move completed items to History.
     Keep only the last 3-5 active items here. -->

### <Task Description> (Issue #N)
- **Branch**: `type/issue-N-description`
- **Status**: in-progress | blocked | review
- **Notes**: Key findings, blockers, next steps

---

## Gotchas & Learnings

<!-- Things that surprised, broke, or took too long to figure out.
     Tag with [GOTCHA], [LEARNING], or [PATTERN]. -->

### [GOTCHA] <Short Description>
<!-- What went wrong and how to avoid it -->

### [PATTERN] <Short Description>
<!-- A reusable pattern discovered during work -->

### [LEARNING] <Short Description>
<!-- Something that wasn't obvious but is now understood -->

---

## History

<!-- Chronological log of completed work. Newest first.
     Keep entries concise — 2-5 lines per entry.
     Move items here from Active Work when complete. -->

### [YYYY-MM-DD] <Task Summary> (Issue #N)
- What was done, key outcome, any follow-up needed
```

---

## Post-Task Memory Update Protocol

After completing **every** task, the agent MUST append to its memory file.
Follow these steps:

### 1. Read Current Memory

```bash
# Always read before writing to avoid overwriting
cat .agents/agent-memory/<agent-name>.md
```

### 2. Determine What Changed

Based on the completed task, identify which sections need updates:

| Situation | Section to Update |
|-----------|-------------------|
| Architecture changed, new subsystem | Mental Model → Architecture |
| New pattern discovered or established | Mental Model → Patterns & Conventions |
| Risk or brittleness found | Mental Model → Risks & Constraints |
| Non-obvious choice made | Key Decisions |
| Task completed | Active Work → History |
| New task started | Active Work |
| Something broke unexpectedly | Gotchas & Learnings → [GOTCHA] |
| Reusable approach discovered | Gotchas & Learnings → [PATTERN] |
| Non-obvious insight gained | Gotchas & Learnings → [LEARNING] |

### 3. Write the Update

**Format each entry as:**
```
### [YYYY-MM-DD] <Title>
- **Details**: What happened
```

**Rules:**
- Always include the date in `[YYYY-MM-DD]` format
- Be specific — "CSP header was missing report-uri" not "fixed a header"
- Include issue numbers: `(Issue #N)` or `(PR #N)`
- Include file paths when relevant
- Explain *why*, not just *what*

### 4. Housekeeping (Every 5+ Updates)

Periodically reorganize to prevent bloat:

- **Active Work**: Remove completed items (move to History)
- **History**: Archive items older than 30 days (keep in file, move to bottom)
- **Gotchas & Learnings**: Consolidate related entries
- **Mental Model**: Update if architecture understanding has shifted
- **Total file size**: Keep under 50KB. If larger, archive oldest History entries

---

## Multi-Instance Protocol

When multiple pi instances are active simultaneously:

1. **Read before write** — Always read the current file before appending
2. **Tag with instance** — Include `[instance:ID]` in entries when multiple instances exist:
   ```
   ### [2026-06-04] [instance:srv163963] Fixed CSP header (PR #2331)
   ```
3. **Append only** — Never overwrite the full file unless creating it new
4. **Merge conflicts** — The memory-merge module deduplicates by content hash. Trust the merge.

---

## Section Guidelines

### Mental Model

This is the most valuable section — it's what lets a new session immediately
understand the domain. Maintain it like a living architecture document.

**Good Mental Model entries:**
- "Backend uses Express + Prisma + PostgreSQL. Routes in `backend/src/routes/`, middleware in `backend/src/middleware/`. Prisma schema at `backend/prisma/schema.prisma`."
- "Frontend is Next.js App Router. Pages in `frontend/src/app/(app)/`. Shared components in `frontend/src/components/ui/`. Uses Tailwind with custom design tokens."
- "Tests run via Jest. Backend tests in `backend/src/__tests__/`. Must use `resetInstrumentation()` in beforeEach for singleton modules."

**Bad Mental Model entries:**
- "We use React" (too vague)
- "See documentation" (defeats the purpose)

### Key Decisions

Record decisions that future sessions might question or need to reverse.

**Good entry:**
```
### [2026-06-04] In-memory metrics storage (Issue #2321)
- **Context**: Need request instrumentation without adding Redis dependency
- **Decision**: In-memory ring-buffer with 60s decay
- **Rationale**: Keeps infrastructure simple, metrics are ephemeral anyway
- **Alternatives Considered**: Redis sorted sets, SQLite WAL, external monitoring
```

**Bad entry:**
```
### [2026-06-04] Used in-memory storage
- Because it was easier
```

### Gotchas & Learnings

These prevent repeating mistakes. Be honest about what went wrong.

**Good entries:**
```
### [GOTCHA] Git hooks auto-switch branches
The post-checkout hook switches to the default branch. After creating a feature branch,
verify you're on the right branch with `git branch --show-current`.

### [PATTERN] Singleton modules need test isolation
Instrumentation module is a singleton. Tests share state across files.
Use resetInstrumentation() in beforeEach.

### [LEARNING] .pi/ is in .gitignore
Must use `git add -f` to track skill files in .pi/skills/.
```

### History

Keep a concise chronological log. Each entry should be 2-5 lines.

```
### [2026-06-04] HTTP request instrumentation middleware (Issue #2321)
- Created middleware with ring-buffer storage and 60s decay
- Added /api/health/metrics endpoint
- PR #2356 merged

### [2026-06-04] Fixed CSP enforced header missing report-uri (Issue #2311)
- Added report-uri to enforced CSP in Caddyfile
- PR #2331 merged
```

---

## Memory Audit Checklist

When performing a memory audit (monthly or on request):

- [ ] All agent memory files exist in `.agents/agent-memory/`
- [ ] Each file follows the standard template sections
- [ ] Mental Model section is current (reflects actual architecture)
- [ ] Active Work has no stale entries (completed items moved to History)
- [ ] History entries are chronological (newest first)
- [ ] Gotchas & Learnings are tagged with [GOTCHA], [PATTERN], or [LEARNING]
- [ ] Key Decisions include rationale and alternatives
- [ ] File size is under 50KB
- [ ] No duplicate entries across sections
- [ ] Dates are consistent (YYYY-MM-DD format throughout)
