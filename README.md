# pi-org-bootstrap

Self-assembling autonomous agent framework for [pi coding agent](https://github.com/mariozechner/pi-coding-agent).

**One command to generate a complete autonomous agent organization tailored to your project's tech stack.**

```bash
npx pi-org-bootstrap init
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         pi-org-bootstrap                                    │
│                   "A system that builds systems"                            │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          INIT COMMAND                                       │
│                   npx pi-org-bootstrap init                                 │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
     ┌──────────┐  ┌───────────┐  ┌──────────┐
     │  PHASE 1 │  │  PHASE 2  │  │  PHASE 3 │
     │  SCAN    │──│  ASK      │──│  BUILD   │
     │          │  │           │  │  ROLES   │
     └──────────┘  └───────────┘  └──────────┘
                                        │
                       ┌────────────────┼────────────────┐
                       ▼                ▼                ▼
                ┌──────────┐     ┌───────────┐   ┌──────────┐
                │  PHASE 4 │     │           │   │  PHASE 5 │
                │  GENERATE│─────│  INSTALL  │───│  TRACK   │
                │  FILES   │     │  SKILLS   │   │  STATE   │
                └──────────┘     │  + EXT    │   └──────────┘
                                 └───────────┘
```

---

## Detailed Flow: How It Self-Assembles

### Phase 1 — Project Scan

The scanner reads your project directory and produces a **StackProfile** — a structured
description of your tech stack, directory layout, and infrastructure.

```
your-project/
│
│  ┌─────────────── Scanner reads ───────────────┐
│  │                                               │
│  │  package.json ──── Node.js detector           │
│  │  tsconfig.json ── TypeScript detected         │
│  │  requirements.txt  Python detector            │
│  │  Dockerfile ────── Docker detector            │
│  │  .github/ ──────── CI detector               │
│  │  directory tree ── Structure analysis          │
│  │  git remote ────── Hosting detection          │
│  │                                               │
└──┴───────────────────────────────────────────────┘
   │
   ▼
┌─────────────────── StackProfile ───────────────────┐
│                                                     │
│  languages: [typescript (0.95), python (0.3)]       │
│                                                     │
│  frameworks: [next.js/frontend, express/backend,    │
│               prisma/orm, tailwind/styling]          │
│                                                     │
│  structure:  monorepo                               │
│  ┌──────────────────────────────────────────────┐   │
│  │ directories:                                  │   │
│  │   frontend/  → purpose: "frontend"            │   │
│  │   backend/   → purpose: "backend"             │   │
│  │   .github/   → purpose: "infrastructure"      │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  databases:  [postgresql, redis]                    │
│  gitHosting: { provider: "github", owner: "..." }  │
│                                                     │
│  domains:                                           │
│  ┌──────────────────────────────────────────────┐   │
│  │ frontend  → paths: [frontend/], fw: [next.js]│   │
│  │ backend   → paths: [backend/],  fw: [express] │   │
│  │ infra     → paths: [.github/], fw: [docker]  │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

#### Detection Rules

| Detector | Trigger Files | What It Extracts |
|----------|--------------|------------------|
| **Node.js** | `package.json`, `tsconfig.json` | Runtime, frameworks (Next.js, Express, React, Vue, Nest, Prisma, Tailwind...) |
| **Python** | `requirements.txt`, `pyproject.toml` | Frameworks (Django, Flask, FastAPI, SQLAlchemy, PyTorch...) |
| **Docker** | `Dockerfile`, `docker-compose.yml` | Services, orchestration, databases |
| **CI/CD** | `.github/workflows/` | GitHub Actions stages |

#### Directory Purpose Inference

```
RULES (first match wins):
  frontend/   → "frontend"     backend/    → "backend"
  server/     → "backend"      api/        → "backend"
  client/     → "frontend"     web/        → "frontend"
  mobile/     → "mobile"       src/        → depends on frameworks
  infra/      → "infrastructure"           deploy/     → "infrastructure"
  docker/     → "infrastructure"           scripts/    → "tooling"
  tambo/      → "ai-ml"        rag/        → "ai-ml"
  ml/         → "ai-ml"        services/*  → one team per service
```

---

### Phase 2 — Interactive Configuration

The prompter fills gaps and confirms choices with the user:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Detected stack:
  • TypeScript (primary language)
  • Next.js 14 (frontend framework)
  • Express (backend framework)
  • Prisma + PostgreSQL (database)
  • Docker + GitHub Actions (infrastructure)

? Project type:              → fullstack-web / api / library / mobile / data-ml
? Team structure:             → Auto-detect / Monolith / Custom
? Agent features:             → memory ✓  context-bus ✓  smart-dispatcher ✓
                                 release-chain ✓  tmux-control ✓
? Security officer?           → yes / no
? CI/CD integration?          → GitHub / GitLab / None
? Interaction mode:           → Head agent / Direct / Both
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### Phase 3 — Role Generation

The role builder combines **StackProfile** + **UserConfig** → generates the agent roster.

```
StackProfile + UserConfig
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    ROLE RESOLVER                             │
│                                                             │
│  ┌──────────── UNIVERSAL ROLES ────────────┐                │
│  │  (always generated, stack-independent)   │                │
│  │                                          │                │
│  │  • dispatcher    (orchestration)         │                │
│  │  • tech-lead     (architecture)          │                │
│  │  • reviewer      (quality gate)          │                │
│  │  • security-officer (if enabled)         │                │
│  └──────────────────────────────────────────┘                │
│                      │                                      │
│  ┌──────────── DOMAIN ROLES ──────────────┐                  │
│  │  (generated from detected stack)        │                  │
│  │                                         │                  │
│  │  domains[0]: frontend                   │                  │
│  │    → frontend-team                      │                  │
│  │    → owns: frontend/src/                │                  │
│  │    → tools: read,bash,edit,write        │                  │
│  │    → frameworks: next.js, tailwind      │                  │
│  │                                         │                  │
│  │  domains[1]: backend                    │                  │
│  │    → backend-team                       │                  │
│  │    → owns: backend/src/                 │                  │
│  │    → tools: read,bash,edit,write        │                  │
│  │    → frameworks: express, prisma        │                  │
│  │                                         │                  │
│  │  domains[2]: infrastructure             │                  │
│  │    → infra-devops                       │                  │
│  │    → owns: .github/, Docker             │                  │
│  └─────────────────────────────────────────┘                  │
│                      │                                      │
│  ┌──────────── PI META ROLES ─────────────┐                  │
│  │  (if head-agent mode enabled)           │                  │
│  │                                         │                  │
│  │  • pi-extensions  (extension management)│                  │
│  │  • pi-agents      (agent configuration) │                  │
│  │  • pi-skills       (skill management)   │                  │
│  │  • pi-config       (settings/providers) │                  │
│  └─────────────────────────────────────────┘                  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
    Role[] → 11 agents generated
```

#### Domain → Team Mapping Rules

```
┌──────────────────┬──────────────────┬─────────────────────────────┐
│ Detected Domain  │ Team Name        │ Description Pattern          │
├──────────────────┼──────────────────┼─────────────────────────────┤
│ frontend         │ frontend-team    │ "Frontend engineers — {fw}" │
│ backend          │ backend-team     │ "Backend engineers — {fw}"  │
│ api              │ api-team         │ "API engineers — {fw}"      │
│ infrastructure   │ infra-devops     │ "Docker, CI/CD, deployment" │
│ ai-ml            │ ai-ml-team       │ "AI/ML engineers — {fw}"    │
│ mobile           │ mobile-team      │ "Mobile engineers — {fw}"   │
│ data             │ data-team        │ "Data engineers"            │
│ single domain    │ dev-team         │ (no split — monolith)       │
│ microservices    │ {svc}-team       │ (one per service dir)       │
└──────────────────┴──────────────────┴─────────────────────────────┘

MERGING RULES:
  background-jobs + backend  → merge into backend-team
  database + backend         → merge into backend-team
  < 3 files in domain        → merge into nearest related team
  only 1 domain detected     → single "dev-team" (no split)
```

---

### Phase 4 — File Generation

Each agent is rendered from a **Handlebars template** with stack-specific values injected:

```
┌─────────────────────┐      ┌──────────────────────┐
│   TEMPLATE           │      │   STACK PROFILE       │
│                      │      │                      │
│  team-agent.md.hbs   │      │  name: backend-team  │
│                      │      │  owns: backend/src/  │
│  {{name}}            │  ×   │  fw: express, prisma │
│  {{description}}     │ ──── │  test: npm test      │
│  {{tools}}           │      │  lint: npm run lint  │
│  {{ownedPaths}}      │      │  check: tsc --noEmit │
│  {{testCommand}}     │      │  constraints:        │
│  {{constraints}}     │      │    - No frontend/    │
│                      │      │    - No deploy       │
└─────────────────────┘      └──────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  .pi/agents/backend-team.md                         │
│                                                      │
│  ---                                                 │
│  name: backend-team                                  │
│  description: "Backend engineers — Express, Prisma"  │
│  tools: read,bash,edit,write                         │
│  ---                                                 │
│                                                      │
│  # Backend Team Agent                                │
│                                                      │
│  ## Scope                                            │
│  - `backend/src/` — All code under this directory    │
│                                                      │
│  ## After Completing a Task                          │
│  1. Run type checking: `cd backend && npx tsc ...`   │
│  2. Run linting: `cd backend && npm run lint`        │
│  3. Run tests: `cd backend && npm test`              │
│                                                      │
│  ## Constraints                                      │
│  - NEVER modify files in frontend/                   │
│  - NEVER deploy to production                        │
└─────────────────────────────────────────────────────┘
```

#### 6 Agent Templates

| Template | Purpose | Key Variables |
|----------|---------|---------------|
| `team-agent.md.hbs` | Generic build team | name, tools, ownedPaths, testCommand, constraints |
| `dispatcher.md.hbs` | Orchestrator | team labels, routing rules, GitHub workflow |
| `tech-lead.md.hbs` | Architect | ADR format, design template |
| `reviewer.md.hbs` | Quality gate | language checklists, dual-review policy |
| `security-officer.md.hbs` | Security | audit checklist, severity matrix |
| `pi-meta.md.hbs` | Pi config agents | scope paths (extensions/agents/skills/settings) |

---

### Phase 4 (continued) — Skills Installation

9 skills are installed. **5 are generic** (copied as-is), **4 are parameterized** with project-specific content injected via `BOOTSTRAP:` markers.

```
┌─────────────────────────────────────────────────────────────────┐
│                     SKILL INSTALLATION                           │
│                                                                  │
│  ┌──── GENERIC (copy as-is) ────┐  ┌── PARAMETERIZED ────────┐  │
│  │                               │  │                          │  │
│  │  memory-maintenance           │  │  smart-dispatcher        │  │
│  │  memory-compaction (+ .py)    │  │  ┌──────────────────┐   │  │
│  │  smart-memory                 │  │  │ BOOTSTRAP:       │   │  │
│  │  focused-subagent             │  │  │ TEAM-MAPPING     │   │  │
│  │  tmux-control                 │  │  │ Inject per-domain│   │  │
│  │                               │  │  │ file path rules  │   │  │
│  │  No changes needed —          │  │  └──────────────────┘   │  │
│  │  these are stack-agnostic     │  │                          │  │
│  └───────────────────────────────┘  │  release-chain           │  │
│                                      │  ┌──────────────────┐   │  │
│                                      │  │ BOOTSTRAP:       │   │  │
│                                      │  │ DEPLOY-COMMANDS  │   │  │
│                                      │  │ Inject detected  │   │  │
│                                      │  │ docker/ci cmds   │   │  │
│                                      │  └──────────────────┘   │  │
│                                      │                          │  │
│                                      │  ux-design-chain        │  │
│                                      │  brain-orchestrator     │  │
│                                      │  (optional skills)      │  │
│                                      └──────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### BOOTSTRAP Marker Example

The `smart-dispatcher` skill ships with a placeholder team mapping. During installation,
the bootstrap replaces it with your project's detected domains:

```markdown
<!-- Before (in repo): -->
<!-- BOOTSTRAP:TEAM-MAPPING-START -->
| File Path Pattern | Team | Rationale |
|---|---|---|
| `src/**` | `dev-team` | Main source code |
<!-- BOOTSTRAP:TEAM-MAPPING-END -->

<!-- After (in your project): -->
<!-- BOOTSTRAP:TEAM-MAPPING-START -->
| File Path Pattern | Team | Rationale |
|---|---|---|
| `frontend/src/**` | `frontend-team` | Next.js, React, Tailwind |
| `backend/src/**` | `backend-team` | Express, Prisma, PostgreSQL |
| `docker-compose*` | `infra-devops` | Docker orchestration |
<!-- BOOTSTRAP:TEAM-MAPPING-END -->
```

---

### Phase 4 (continued) — Extension Installation

The head-agent extension is generalized — only `constants.ts` is generated per-project:

```
┌─────────────────────────────────────────────────────────────────┐
│                  EXTENSION ARCHITECTURE                          │
│                                                                  │
│  src/extensions/          →      .pi/extensions/                │
│                                                                  │
│  ┌─ head-agent/ ──────────────────────────────────────────────┐  │
│  │                                                             │  │
│  │  index.ts              ← COPIED AS-IS                      │  │
│  │  dashboard.ts          ← COPIED AS-IS                      │  │
│  │  context-bus.ts        ← COPIED AS-IS                      │  │
│  │  mail.ts               ← COPIED AS-IS                      │  │
│  │  cron-scheduler.ts     ← COPIED AS-IS                      │  │
│  │  register-tools.ts     ← COPIED AS-IS                      │  │
│  │  register-commands.ts  ← COPIED AS-IS                      │  │
│  │  register-coord-*.ts   ← COPIED AS-IS                      │  │
│  │  instance-registry.ts  ← COPIED AS-IS                      │  │
│  │  ... (20+ modules)     ← COPIED AS-IS                      │  │
│  │                                                             │  │
│  │  constants.ts          ← GENERATED FROM TEMPLATE            │  │
│  │  ┌───────────────────────────────────────────────────┐      │  │
│  │  │  // Auto-generated by pi-org-bootstrap             │      │  │
│  │  │  export const TEAMS = {                            │      │  │
│  │  │    "frontend-team": { name: "frontend-team" },     │      │  │
│  │  │    "backend-team":  { name: "backend-team" },      │      │  │
│  │  │    "infra-devops":  { name: "infra-devops" }       │      │  │
│  │  │  };                                                │      │  │
│  │  │  export const TEAM_ORDER = [                       │      │  │
│  │  │    "frontend-team", "backend-team", "infra-devops" │      │  │
│  │  │  ] as const;                                       │      │  │
│  │  └───────────────────────────────────────────────────┘      │  │
│  │                                                             │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ command-center/ ── COPIED AS-IS ─────────────────────────┐   │
│  │  dashboard.ts, index.ts, instance-bridge.ts,               │   │
│  │  task-manager.ts, worker-poller.ts, types.ts               │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ instance-username.ts ── COPIED AS-IS ────────────────────┐   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Phase 5 — State Tracking

A `bootstrap.json` is written to `.pi/` to track what was generated, enabling safe regeneration:

```
┌─────────────────────────────────────────────────────────────────┐
│  .pi/bootstrap.json                                             │
│                                                                 │
│  {                                                              │
│    "version": "1.0.0",                                          │
│    "generatedAt": "2026-06-09T12:00:00Z",                       │
│                                                                 │
│    "scan": {                                                    │
│      "languages": ["typescript"],                               │
│      "frameworks": ["next.js", "express", "prisma"],            │
│      "structure": "monorepo",                                   │
│      "databases": ["postgresql", "redis"]                       │
│    },                                                           │
│                                                                 │
│    "config": {                                                  │
│      "projectType": "fullstack-web",                            │
│      "interactionMode": "head-agent",                           │
│      "features": { "memory": true, "contextBus": true, ... }    │
│    },                                                           │
│                                                                 │
│    "generated": {                                               │
│      "agents": [                                                │
│        { "name": "dispatcher", "template": "dispatcher" },      │
│        { "name": "tech-lead", "template": "tech-lead" },        │
│        { "name": "backend-team", "template": "team-agent" },    │
│        ...                                                      │
│      ],                                                         │
│      "files": [ ... ]                                           │
│    }                                                            │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
```

This enables:
- `pi-org-bootstrap status` — shows what was generated and what's been modified
- `pi-org-bootstrap init --force` — safe regeneration (warns on user modifications)
- Incremental updates (only regenerates changed scopes)

---

## The Generated Organization In Action

After `npx pi-org-bootstrap init`, your project has a fully functional autonomous agent system:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AUTONOMOUS AGENT ORGANIZATION                     │
│                                                                      │
│                      ┌──────────────┐                                │
│                      │  DISPATCHER  │                                │
│                      │  (receives   │                                │
│                      │   all work)  │                                │
│                      └──────┬───────┘                                │
│                             │                                        │
│            ┌────────────────┼────────────────┐                       │
│            │                │                │                       │
│            ▼                ▼                ▼                       │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                │
│   │  TECH LEAD   │ │  REVIEWER    │ │  SECURITY    │                │
│   │  (designs)   │ │  (quality)   │ │  (audits)    │                │
│   └──────┬───────┘ └──────┬───────┘ └──────────────┘                │
│          │                │                                          │
│   ┌──────┴────────────────┴──────────────────────┐                  │
│   │              BUILD TEAMS                      │                  │
│   │                                               │                  │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐   │                  │
│   │  │ frontend │  │ backend  │  │  infra   │   │                  │
│   │  │  team    │  │  team    │  │ devops   │   │                  │
│   │  │          │  │          │  │          │   │                  │
│   │  │ frontend/│  │ backend/ │  │ .github/ │   │                  │
│   │  └──────────┘  └──────────┘  └──────────┘   │                  │
│   └───────────────────────────────────────────────┘                  │
│                                                                      │
│   ┌─────────────── SHARED INFRASTRUCTURE ──────────────┐            │
│   │                                                     │            │
│   │  Context Bus ─── cross-instance event logging       │            │
│   │  Mail System ─── inter-agent communication          │            │
│   │  Memory ──────── per-agent persistent context       │            │
│   │  Registry ────── instance tracking + dedup          │            │
│   │  Pipeline ────── CI/CD stage tracking               │            │
│   │                                                     │            │
│   └─────────────────────────────────────────────────────┘            │
│                                                                      │
│   ┌─────────────── SKILL LIBRARY ──────────────────────┐            │
│   │                                                     │            │
│   │  smart-dispatcher ── file-path-aware routing        │            │
│   │  memory-maintenance ── standardized memory format   │            │
│   │  memory-compaction ── keeps memory under budget     │            │
│   │  smart-memory ──────── topic-indexed memory loading │            │
│   │  release-chain ─────── 4-stage release pipeline     │            │
│   │  focused-subagent ──── scoped task delegation       │            │
│   │  tmux-control ──────── parallel agent sessions      │            │
│   │                                                     │            │
│   └─────────────────────────────────────────────────────┘            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Workflow: Bug Fix Lifecycle

```
  User reports bug
       │
       ▼
  ┌──────────┐     gh issue create
  │ DISPATCHER│◄────────────────────── User
  └────┬─────┘
       │ triage: apply severity + team labels
       │
       ▼
  ┌──────────┐     git checkout -b fix/issue-N-desc
  │ BACKEND  │     implement fix
  │   TEAM   │     git commit + push
  └────┬─────┘     gh pr create
       │
       ▼
  ┌──────────┐     gh pr review
  │ REVIEWER │     quality checklist
  └────┬─────┘
       │
       ▼
  ┌──────────┐     gh pr checks
  │   CI     │     lint → test → security → build
  └────┬─────┘
       │
       ▼
  gh pr merge → auto-closes issue
```

### Workflow: Feature Development

```
  Feature request
       │
       ▼
  ┌──────────┐     Design specification
  │TECH LEAD │     Architecture decisions
  └────┬─────┘
       │
       ▼
  ┌──────────┐     Route to team(s)
  │ DISPATCHER│     delegate() or delegate_parallel()
  └────┬─────┘
       │
       ┌───────┼───────┐
       ▼               ▼
  ┌──────────┐   ┌──────────┐
  │ FRONTEND │   │ BACKEND  │    ← parallel if independent
  │   TEAM   │   │   TEAM   │    ← sequential if dependent
  └────┬─────┘   └────┬─────┘
       │               │
       └───────┬───────┘
               ▼
  ┌──────────┐
  │ REVIEWER │     Code review + quality gate
  └────┬─────┘
       │
       ▼
  ┌──────────┐
  │   CI/CD  │     Full pipeline
  └────┬─────┘
       │
       ▼
     Deploy
```

---

## What Gets Generated

```
your-project/
├── .pi/
│   ├── bootstrap.json                          # Bootstrap state tracking
│   ├── agents/                                 # Agent definitions
│   │   ├── dispatcher.md                       # (universal)
│   │   ├── tech-lead.md                        # (universal)
│   │   ├── reviewer.md                         # (universal)
│   │   ├── security-officer.md                 # (universal, optional)
│   │   ├── frontend-team.md                    # (domain — detected)
│   │   ├── backend-team.md                     # (domain — detected)
│   │   ├── infra-devops.md                     # (domain — detected)
│   │   ├── pi-extensions.md                    # (meta — if head-agent mode)
│   │   ├── pi-agents.md                        # (meta)
│   │   ├── pi-skills.md                        # (meta)
│   │   └── pi-config.md                        # (meta)
│   ├── skills/                                 # Skills library
│   │   ├── smart-dispatcher/SKILL.md           # (customized for your stack)
│   │   ├── memory-maintenance/SKILL.md         # (generic)
│   │   ├── memory-compaction/SKILL.md          # (generic)
│   │   ├── memory-compaction/compact.py        # (generic)
│   │   ├── smart-memory/SKILL.md               # (generic)
│   │   ├── focused-subagent/SKILL.md           # (generic)
│   │   ├── tmux-control/SKILL.md              # (generic)
│   │   ├── release-chain/SKILL.md             # (optional)
│   │   ├── ux-design-chain/SKILL.md           # (optional)
│   │   └── brain-orchestrator/SKILL.md        # (optional)
│   └── extensions/                             # Extensions
│       ├── head-agent/                         # (constants.ts generated)
│       │   ├── index.ts, dashboard.ts, ...     # (20+ modules)
│       │   └── constants.ts                    # (GENERATED per-project)
│       ├── command-center/                     # (copied as-is)
│       └── instance-username.ts               # (copied as-is)
├── .agents/
│   ├── ORGANIZATION.md                         # Organization charter
│   ├── agent-memory/                           # Per-agent memory files
│   │   ├── dispatcher.md
│   │   ├── tech-lead.md
│   │   ├── backend-team.md
│   │   └── ...
│   ├── context-bus/                            # Cross-instance event bus
│   │   ├── config.json
│   │   └── events.jsonl                        # (gitignored)
│   ├── designs/                                # (for ux-design-chain)
│   ├── releases/                               # (for release-chain)
│   ├── dispatch/                               # (for smart-dispatcher tracking)
│   └── instance-registry.json                  # (gitignored)
├── AGENTS.md                                   # Project-level agent instructions
└── .gitignore                                  # (appended with .agents/ rules)
```

---

## Examples by Stack

### Next.js + Express Monorepo

```
Detected: TypeScript, Next.js, Express, Prisma, PostgreSQL, Docker, GitHub Actions
Domains: frontend (frontend/), backend (backend/), infrastructure (.github/, Docker)

Generated agents: dispatcher, tech-lead, reviewer, security-officer,
                  frontend-team, backend-team, infra-devops,
                  pi-extensions, pi-agents, pi-skills, pi-config
```

### Python Django Monolith

```
Detected: Python, Django, PostgreSQL, Celery, Docker
Domains: backend (src/, myapp/)

Generated agents: dispatcher, tech-lead, reviewer, security-officer,
                  dev-team (single team — no split),
                  pi-extensions, pi-agents, pi-skills, pi-config
```

### Go Microservices

```
Detected: Go, Gin, GORM, Docker, Kubernetes
Domains: services/auth/, services/users/, services/orders/

Generated agents: dispatcher, tech-lead, reviewer, security-officer,
                  auth-team, users-team, orders-team, infra-devops,
                  pi-extensions, pi-agents, pi-skills, pi-config
```

### Simple TypeScript Library

```
Detected: TypeScript, Vitest, ESLint
Domains: src/ (library code)

Generated agents: dispatcher (simplified), tech-lead, reviewer,
                  dev-team
```

---

## Quick Start

```bash
# Interactive bootstrap
npx pi-org-bootstrap init

# Non-interactive (use all defaults)
npx pi-org-bootstrap init --yes

# Force regenerate
npx pi-org-bootstrap init --force

# Specify project type directly
npx pi-org-bootstrap init --type fullstack-web

# Specify teams directly (skip detection)
npx pi-org-bootstrap init --teams frontend,backend,infra

# Check bootstrap status
npx pi-org-bootstrap status
```

## Zero External Dependencies

pi-org-bootstrap uses only Node.js built-ins:
- `fs/promises` for file operations
- `readline` for interactive prompts
- `path` for path manipulation
- No handlebars — uses simple `{{variable}}` template interpolation

## Requirements

- Node.js >= 18.0.0
- A git repository (recommended)

## License

MIT
