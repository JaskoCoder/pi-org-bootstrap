# Extension Manifest — pi-org-bootstrap

This directory contains portable pi extensions that ship with `pi-org-bootstrap`.
They are stack-agnostic and can be installed into any project's `.pi/extensions/` directory.

## Extensions

### 1. `head-agent/` — Head Agent Orchestrator

The main orchestration extension. Provides a head agent that delegates work to specialized
team agents via the `delegate` tool, runs an autonomous debug loop, shows a TUI dashboard,
and coordinates multiple pi instances.

**What it does:**
- Registers tools: `delegate`, `delegate_parallel`, `send_mail`, `check_mail`, `pipeline_status`, `pipeline_run`, `sprint_plan`, `update_agent_memory`, `claim_task`, `release_task`, `sync_registry`, `get_active_instances`, `spawn_focused`, `register_cron`, `unregister_cron`
- Registers commands: `/head`, `/pi`, `/debug`, `/cron`, `/feed`
- Shows TUI dashboard widget with agent status, mail, pipeline state, cron tasks
- Shows instance pool widget (tree graph of active instances and their agents)
- Shows context feed widget (real-time event stream from all instances)
- Runs autonomous debug loop (scan → triage → fix → test → review → reflect)
- Manages cron scheduler for periodic tasks
- Provides mail system for inter-agent communication
- Provides context bus for cross-instance event tracking
- Provides instance registry for multi-instance coordination
- Provides memory merge for safe concurrent memory file writes

**Files that need generation (by pi-org-bootstrap):**

| File | What to generate | Template |
|------|-----------------|----------|
| `constants.ts` | Team definitions, debug scopes, all project-specific config | `constants.ts.template` |

The template `constants.ts.template` uses Handlebars-style `{{PLACEHOLDER}}` syntax:

- `{{TEAMS_OBJECT}}` — A TypeScript object literal mapping team names to `TeamDef` objects. Example:
  ```typescript
  {
    "backend-team": { file: "backend-team.md", label: "BACKEND", color: "accent", scope: "src/", desc: "Express, PostgreSQL" },
    "frontend-team": { file: "frontend-team.md", label: "FRONTEND", color: "success", scope: "app/", desc: "React, Tailwind" },
    ...
  }
  ```
- `{{TEAMS_ARRAY}}` — Array literal of team names in display order. Example:
  ```typescript
  ["backend-team", "frontend-team", "reviewer", "tech-lead"]
  ```
- `{{DEBUG_SCOPES_ARRAY}}` — Array of scope names for the debug loop. Example:
  ```typescript
  ["backend", "frontend", "infra", "tests"]
  ```

**Files shipped as-is (no modification needed):**

All other `.ts` files in the directory are generic and work with any team configuration
defined in `constants.ts`. This includes:
- `index.ts` — Main entry point
- `types.ts` — Shared type definitions
- `dashboard.ts` — TUI dashboard rendering
- `context-bus.ts` — Persistent event bus
- `context-feed-widget.ts` — Event stream widget
- `mail.ts` — Mail system
- `helpers.ts` — Utility functions
- `extension-context.ts` — Shared context interface
- `debug-state.ts` — Debug state machine
- `autonomous-cycle.ts` — Debug loop engine
- `phase-handlers.ts` — Per-phase result processing
- `parsers.ts` — Response parsers
- `spawner.ts` — Agent spawning
- `memory-merge.ts` — Concurrent memory merging
- `instance-registry.ts` — Multi-instance coordination
- `instance-pool-widget.ts` — Instance pool TUI widget
- `register-commands.ts` — `/head`, `/pi`, `/debug` commands
- `register-tools.ts` — delegate, mail, pipeline, memory tools
- `register-coordination-tools.ts` — claim/release, sync, get_active tools
- `register-context-tools.ts` — spawn_focused tool, /feed command
- `cron-scheduler.ts` — Core cron engine
- `cron-tasks.ts` — Built-in cron tasks (health-check, log-rotate, etc.)
- `cron-commands.ts` — `/cron` command
- `cron-tools.ts` — `register_cron`, `unregister_cron` tools
- `cron-types.ts` — Cron type definitions
- `package.json` — NPM dependencies
- `tsconfig.json` — TypeScript config
- `.gitignore` — Ignores node_modules

**Installation:**
```bash
# 1. Copy the entire head-agent directory to .pi/extensions/
cp -r head-agent/ .pi/extensions/head-agent/

# 2. Generate constants.ts from the template
# (pi-org-bootstrap does this automatically during `init`)
# The generated file replaces {{PLACEHOLDER}} values with project-specific teams

# 3. Install dependencies
cd .pi/extensions/head-agent && npm install
```

**Dependencies:**
- `@mariozechner/pi-coding-agent` — Pi extension API
- `@mariozechner/pi-ai` — StringEnum utility
- `@mariozechner/pi-tui` — TUI rendering utilities
- `@sinclair/typebox` — JSON Schema type builder

---

### 2. `command-center/` — Multi-Instance Command Center

A TUI-based command center for managing multiple pi instances in parallel.
Imports `instance-registry` from the head-agent extension.

**What it does:**
- Registers `/cc` command for multi-instance management
- Shows a command center dashboard with worker status
- Supports spawning workers, sending commands, and polling results
- Provides task management across instances

**Files that need generation:** None — fully generic.

**Files shipped as-is:**
- `index.ts` — Main entry point
- `dashboard.ts` — Command center TUI rendering
- `instance-bridge.ts` — Bridge to instance registry
- `task-manager.ts` — Cross-instance task management
- `types.ts` — Type definitions
- `worker-poller.ts` — Worker status polling

**Installation:**
```bash
# Copy to .pi/extensions/ (requires head-agent to be installed first)
cp -r command-center/ .pi/extensions/command-center/
```

**Dependency:** Requires `head-agent/` extension in the same `.pi/extensions/` directory (imports from `../head-agent/instance-registry.js`).

---

### 3. `instance-username.ts` — Random Instance Usernames

A single-file extension that assigns a fun random username to each pi session.

**What it does:**
- Assigns a random codename (e.g., "CosmicPotato", "NeonDragon") to each session
- Displays the username in the TUI footer and session name
- Persists the name across reloads within the same session
- Registers `/whoami` and `/reroll-username` commands

**Files that need generation:** None — fully generic.

**Installation:**
```bash
# Copy as a single file
cp instance-username.ts .pi/extensions/instance-username.ts
```

**Dependencies:** None (only uses `@mariozechner/pi-coding-agent`).

---

## Architecture Notes

### How Team Configuration Works

The head-agent extension is designed around a **single generated file** (`constants.ts`) that
defines all project-specific configuration. Every other file imports from `constants.ts` and
works with whatever teams are defined there.

This means:
- Adding/removing teams only requires changing `constants.ts`
- The `delegate` tool's `StringEnum` parameter is built from `TEAM_ORDER` at runtime
- The dashboard dynamically renders whatever teams are configured
- The debug loop scopes are derived from `DEBUG_SCOPES` in constants
- The instance pool widget abbreviations are built from team names

### How the Debug Loop Works

The autonomous debug loop (`/debug start`) runs a phase-based cycle:
1. **Scanning** — Analyzes a scope for problems
2. **Triaging** — Files GitHub issues for findings
3. **Fixing** — Fixes issues in priority order
4. **Testing** — Runs test suites
5. **Reviewing** — Reviews and merges open PRs
6. **Reflecting** — Summarizes cycle results

Scopes are defined in `DEBUG_SCOPES` in `constants.ts` and should match the project's
codebase structure (e.g., `["backend", "frontend", "infra"]`).

### Multi-Instance Coordination

When multiple pi instances run simultaneously, the head-agent extension:
- Registers each instance in `.agents/instance-registry.json`
- Sends heartbeats every 30 seconds
- Provides task claiming to prevent duplicate work
- Emits events to the context bus (`.agents/context-bus/events.jsonl`)
- Shows all instances and their agents in the instance pool widget

### Key Design Decisions

1. **Single generated file** — Only `constants.ts` needs per-project customization
2. **Dynamic tool parameters** — `delegate` and `send_mail` team lists come from `TEAM_ORDER`
3. **No hardcoded paths** — Debug scopes and project paths are configured, not hardcoded
4. **Stack-agnostic** — No references to specific frameworks, databases, or tech stacks
5. **Backward compatible** — The extension works identically to the original UniBrain version when configured with UniBrain's team structure
