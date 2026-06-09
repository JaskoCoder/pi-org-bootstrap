---
name: smart-memory
description: "Topic-indexed memory architecture for agent memory files. Use when updating memory with topic tags, loading task-relevant memory sections, compacting memory per-topic, or offloading reference knowledge to Brain Wiki. Complements memory-maintenance and memory-compaction skills. Triggers on: memory topic, topic-indexed memory, smart memory, memory load, memory structure, memory compaction, memory offload, wiki offload, topic tags, memory architecture."
---

# Smart Memory — Topic-Indexed Memory Architecture

Improves how agents use their memory files by adding topic-based indexing,
selective loading, per-topic compaction, and wiki offloading. Works alongside
`memory-maintenance` (template/format) and `memory-compaction` (active zone
compression) — this skill adds topic-level granularity.

## The Problem

All agents have a **1500-char auto-load budget** for their memory files. Agents
with large memory files (backend-team: 12KB, infra-devops: 8KB) can only surface
~12% of their knowledge in the active zone. Domain specialists carry context
that's irrelevant to most tasks but critical for some.

**Solution**: Tag memory sections by topic. Load only relevant topics per task.
Compact per-topic instead of whole-file. Offload reference knowledge to Wiki.

---

## Protocol 1: Structuring Memory with Topic Tags

### Tagging Convention

Wrap each major section in an HTML comment with a topic identifier:

```markdown
<!-- topic:architecture -->
## Mental Model

### Architecture
- Stack: Express + Prisma + PostgreSQL
- Routes in backend/src/routes/

<!-- topic:api -->
## API Patterns

### REST Conventions
- Dual mount: /api/ (legacy) + /api/v1/ (canonical)
- Zod safeParse on all inputs

<!-- topic:database -->
## Database & Prisma

### Schema
- 48 models in schema.prisma
- Ownership: findFirst({ where: { id, userId } })

<!-- topic:jobs -->
## Background Jobs
- BullMQ: document-processor, canvas-sync, dunning
- Workers in backend/src/workers/

<!-- topic:security -->
## Security
- JWT in httpOnly cookies
- SSRF protection via dns.resolve4/6 deny-list
```

### Topic Naming Rules

- **Lowercase, hyphenated**: `api`, `database`, `background-jobs`, `security`
- **Domain-specific**: Use terms agents naturally use in task descriptions
- **One topic per concern**: Don't bundle "api-and-database" — split them
- **Standard topics** (use these when they fit):
  - `architecture` — system structure, tech stack, directory layout
  - `api` — endpoints, routes, REST conventions, versioning
  - `database` — Prisma, migrations, queries, schema, transactions
  - `auth` — authentication, JWT, sessions, OAuth, middleware
  - `security` — CSP, SSRF, rate limiting, vulnerabilities
  - `testing` — test patterns, Vitest config, mock conventions
  - `jobs` — BullMQ, workers, queues, background processing
  - `caching` — Redis, cache patterns, invalidation
  - `deployment` — Docker, CI/CD, environment config
  - `cross-cutting` — insights that span multiple topics

### Placement in Existing Structure

Topic tags go **inside** the standard memory-maintenance sections. They do NOT
replace section headers — they annotate them:

```markdown
# Backend Team Memory

<!-- topic:architecture -->
## Mental Model

### Architecture
...

<!-- topic:cross-cutting -->
### Patterns & Conventions
...

<!-- topic:cross-cutting -->
### Risks & Constraints
...

<!-- topic:cross-cutting -->
## Key Decisions
...

## Active Work
*(no topic tag — always loaded)*

<!-- topic:cross-cutting -->
## Gotchas & Learnings
...

<!-- topic:history -->
## History
...
```

**Note**: `## Active Work` is never topic-tagged — it's always auto-loaded as
part of the active zone.

---

## Protocol 2: Task-Relevant Loading

When a task arrives, load ONLY the topic sections relevant to the task.

### Step 1: Parse Task for Topic Keywords

Map task description keywords to topics:

| Task Keyword Patterns | Topics to Load |
|-----------------------|----------------|
| route, endpoint, API, REST, handler, request, response | `api` |
| Prisma, query, migration, schema, model, SQL, transaction | `database` |
| test, spec, vitest, mock, coverage | `testing` |
| auth, JWT, session, login, OAuth, token, cookie | `auth` |
| security, CSP, SSRF, rate-limit, vulnerability, XSS | `security` |
| BullMQ, worker, queue, job, background, cron | `jobs` |
| Redis, cache, invalidate, TTL, cacheSet | `caching` |
| Docker, deploy, CI, CD, pipeline, environment | `deployment` |
| architecture, stack, structure, directory, layout | `architecture` |
| bug fix, refactor, any ambiguous task | `cross-cutting` |

### Step 2: Load Relevant Sections with `read`

Use offset/limit to load ONLY the topic sections you need:

```bash
# Find the topic section boundaries
grep -n "<!-- topic:" .agents/agent-memory/backend-team.md
# Output: 5:<!-- topic:architecture -->
#         42:<!-- topic:api -->
#         78:<!-- topic:database -->
#         ...

# Load only the API section (lines 42-77)
read .agents/agent-memory/backend-team.md offset=42 limit=36
```

For multiple topics, load each range:

```bash
# Task: "Fix the auth middleware for API rate limiting"
# Topics: auth, api, security

# Find all relevant topic boundaries
grep -n "<!-- topic:" .agents/agent-memory/backend-team.md

# Load auth section (lines 20-41)
read .agents/agent-memory/backend-team.md offset=20 limit=22

# Load api section (lines 42-77)
read .agents/agent-memory/backend-team.md offset=42 limit=36

# Load security section (lines 90-110)
read .agents/agent-memory/backend-team.md offset=90 limit=21
```

### Step 3: Use Loaded Context for the Task

After loading topic sections, proceed with the task. You now have deep domain
context without consuming the 1500-char active-zone budget.

### Quick-Load Helper

For agents that frequently load the same topics, include a topic index at the
top of the memory file (inside the auto-load zone):

```markdown
# Backend Team Memory

## Topics
`architecture:5` `api:42` `database:78` `auth:110` `security:130`
`testing:155` `jobs:175` `caching:195` `deployment:210` `cross-cutting:225`

## Mental Model
...
```

Each `topic:line` pair shows where the topic section starts. Agents can
`read` with `offset=LINE` and `limit=30` (or until next topic marker) to load
just that section.

---

## Protocol 3: Per-Topic Compaction

When a memory file exceeds 15KB, compact **per-topic** instead of whole-file.
This preserves recent detail in active topics while archiving stale topics.

### When to Compact Per-Topic

- File size exceeds **15KB** (15,360 bytes)
- A single topic section exceeds **3KB** on its own
- The file has more than **10 topic sections**

### Compaction Algorithm

For each topic section that exceeds 3KB:

1. **Identify topic boundaries** — `grep -n "<!-- topic:"` to find markers
2. **Read the full topic section** — `read` with offset/limit
3. **Extract dated entries** — Find all `### [YYYY-MM-DD]` headers within the topic
4. **Keep recent entries** — Last 3 entries remain verbatim
5. **Summarize older entries** — Compress to single-line bullets:
   ```markdown
   <!-- topic:api -->
   ## API Patterns

   ### [2026-06-09] Rate limiter migration to Redis (PR #2767)
   - Migrated from in-memory Map to Redis INCR+EXPIRE
   - Full detail archived to wiki:backend/api-rate-limiting.md

   ### Older API changes:
   - [2026-06-04] Added /api/health/metrics endpoint (PR #2356)
   - [2026-06-02] Cache-Control middleware for authenticated routes (PR #2247)
   - [2026-06-01] SSE study materials JSON format overhaul (PR #2177)
   ```
6. **Write the compacted section back** — Use `edit` to replace the original
7. **Log compaction** — Add entry to `## History`: `Compacted topic:api (3KB → 1.2KB)`

### Cross-Topic Insights

When compacting, watch for insights that appear in multiple topics:

```markdown
<!-- topic:cross-cutting -->
## Cross-Cutting Insights

- **Transactions required for**: multi-model writes, user deletion cascade, canvas sync
  (promoted from database + jobs topics)
- **Redis for distributed state**: rate limiting, PKCE, caching
  (promoted from auth + caching + security topics)
```

Move promoted insights to a `<!-- topic:cross-cutting -->` section. This
prevents duplication and ensures cross-domain knowledge survives compaction.

### Integration with memory-compaction

The existing `memory-compaction` skill handles the **active zone** (first 1500
chars) and **archive marker** pattern. This skill handles **per-topic**
compaction within the full file. They work together:

1. **smart-memory** compacts individual topic sections (reduces total file size)
2. **memory-compaction** compresses the active zone (ensures auto-load stays under 1500 chars)

Run smart-memory compaction FIRST (reduces file size), then memory-compaction
(if active zone needs refreshing).

---

## Protocol 4: Wiki Offloading

For reference knowledge that rarely changes, offload to Brain Wiki and keep a
one-liner reference in the memory file.

### What to Offload

| Keep in Memory | Offload to Wiki |
|---------------|-----------------|
| Recent decisions (last 2 weeks) | Architecture decisions (older) |
| Active task context | Full API schemas |
| Gotchas encountered this sprint | Deployment procedures |
| Current patterns in use | Detailed migration guides |
| In-progress work | Reference tables (status codes, error codes) |
| Cross-cutting insights | Step-by-step setup guides |

### Offloading Process

1. **Identify candidate content** — Topic sections with stable reference info
2. **Pull wiki** — `bash ~/.pi/Brain/sync.sh --pull`
3. **Create wiki page** — Write to `~/.pi/Brain/wiki/<agent>/<topic>.md`:
   ```markdown
   # Backend API Reference

   > Offloaded from backend-team memory on 2026-06-09
   > Source: .agents/agent-memory/backend-team.md (topic:api section)

   ## REST Conventions
   - Dual mount: /api/ (legacy) + /api/v1/ (canonical)
   - Zod safeParse on all inputs
   - handleRouteError pattern in all routes
   ...
   ```
4. **Replace memory section with one-liner**:
   ```markdown
   <!-- topic:api -->
   ## API Patterns
   See `wiki:backend/api-reference.md` for full API conventions, route patterns, and versioning.
   Recent: Rate limiter migration to Redis (PR #2767)
   ```
5. **Push wiki** — `bash ~/.pi/Brain/sync.sh --push`
6. **Log the offload** — Add to `## History`: `Offloaded topic:api reference to wiki:backend/api-reference.md`

### One-Liner Format

```markdown
See `wiki:<path>` for <description of what's there>.
Recent: <one-line summary of latest change>
```

Examples:
```markdown
See `wiki:backend/prisma-schema.md` for full schema reference (48 models, relations).
Recent: Added Document.sourceType enum (PR #2414)

See `wiki:infra/deployment.md` for Docker, CI/CD, and environment setup.
Recent: Fixed healthcheck in docker-compose.yml

See `wiki:frontend/component-library.md` for shared component catalog and usage.
Recent: Added DataTable component with sort/filter
```

### When to Load Offloaded Content

When a task needs the full reference:
1. Pull wiki: `bash ~/.pi/Brain/sync.sh --pull`
2. Read the wiki page: `read ~/.pi/Brain/wiki/<agent>/<topic>.md`
3. Proceed with task using full context

This is the same selective-loading principle as Protocol 2 — load deep context
only when the task requires it.

---

## Complete Workflow Example

### Agent: backend-team, Task: "Fix the N+1 query in canvas discussions"

**Step 1: Parse task** → keywords: "query", "canvas" → topics: `database`, `api`

**Step 2: Load topic index** (auto-loaded, part of active zone):
```
Topics: `architecture:5` `api:42` `database:78` `jobs:175` `cross-cutting:225`
```

**Step 3: Load relevant sections**:
```bash
# Database section (lines 78-109, ~32 lines)
read .agents/agent-memory/backend-team.md offset=78 limit=32

# API section for canvas routes (lines 42-77, ~36 lines)
read .agents/agent-memory/backend-team.md offset=42 limit=36
```

**Step 4: Execute task** with loaded context (Prisma patterns, ownership checks,
transaction conventions, canvas route structure).

**Step 5: Post-task update** (via memory-maintenance protocol):
```markdown
<!-- topic:database -->
### [2026-06-09] N+1 fix in canvas discussions (PR #2738)
- Used parallelLimit pattern for batched ownership checks
- Replaced sequential findFirst with Promise.allSettled
```

**Step 6: Check if compaction needed**:
- File under 15KB? → No compaction needed
- `database` topic over 3KB? → Per-topic compact (keep last 3 entries, summarize older)

**Step 7: Check if offload possible**:
- Any stable reference in the database topic? → Offload to `wiki:backend/prisma-schema.md`

---

## Integration with Existing Skills

### memory-maintenance
- **Role**: Template format, post-task update protocol, section guidelines
- **smart-memory adds**: Topic tags within those sections, selective loading
- **Use together**: Follow memory-maintenance template, add topic markers

### memory-compaction
- **Role**: Active zone compression (1500 chars), archive marker pattern
- **smart-memory adds**: Per-topic compaction within the full file
- **Use together**: Smart-memory compacts topics first, memory-compaction refreshes active zone

### brain-wiki
- **Role**: Knowledge base for persistent reference content
- **smart-memory adds**: Structured offloading protocol from memory → wiki
- **Use together**: Follow brain-wiki conventions for created pages

---

## Migration Guide

For agents with existing memory files, add topic tags incrementally:

1. **Don't restructure everything at once.** Add tags during normal post-task updates.
2. **Start with the largest sections.** If "Mental Model" is 800 chars, split it:
   ```markdown
   <!-- topic:architecture -->
   ### Architecture
   ...

   <!-- topic:api -->
   ### API Conventions
   ...
   ```
3. **Add topic index** to the active zone once you have 3+ tagged sections.
4. **Offload when sections stabilize** — if a topic hasn't changed in 2+ sprints,
   it's a candidate for wiki offloading.
