# pi-org-bootstrap

Self-assembling autonomous agent framework for [pi coding agent](https://github.com/mariozechner/pi-coding-agent).

**One command to generate a complete autonomous agent organization tailored to your project's tech stack.**

```bash
npx pi-org-bootstrap init
```

## How It Works

1. **Scans** your project — detects languages, frameworks, databases, structure, and CI/CD
2. **Asks** a few questions — project type, team structure, features, interaction mode
3. **Generates** a complete agent organization — roles, memory files, context bus, extensions

## Quick Start

```bash
# Interactive bootstrap
npx pi-org-bootstrap init

# Non-interactive (use all defaults)
npx pi-org-bootstrap init --yes

# Force regenerate
npx pi-org-bootstrap init --force

# Check status
npx pi-org-bootstrap status
```

## What Gets Generated

```
your-project/
├── .pi/
│   ├── bootstrap.json              # Bootstrap configuration
│   ├── agents/                     # Agent definitions
│   │   ├── dispatcher.md
│   │   ├── tech-lead.md
│   │   ├── reviewer.md
│   │   ├── <team-name>.md          # One per detected domain
│   │   └── ...
│   └── extensions/                 # Extension configs
│       ├── constants.ts
│       └── head-agent-config.json
├── .agents/
│   ├── ORGANIZATION.md             # Organization charter
│   ├── agent-memory/               # Per-agent memory files
│   │   ├── dispatcher.md
│   │   ├── <team-name>.md
│   │   └── ...
│   ├── context-bus/                # Cross-instance event logging
│   │   ├── config.json
│   │   └── README.md
│   └── instance-registry.json
└── AGENTS.md                       # Project-level agent instructions
```

## Stack Detection

The scanner automatically detects:

| Detector | What it finds |
|----------|--------------|
| **Node.js** | package.json → React, Next.js, Vue, Svelte, Express, NestJS, Fastify, Prisma, Drizzle, Tailwind, BullMQ |
| **Python** | requirements.txt, pyproject.toml → Django, Flask, FastAPI, SQLAlchemy, PyTorch, pandas |
| **Docker** | Dockerfile, docker-compose.yml → services, databases |
| **CI/CD** | .github/workflows/ → GitHub Actions stages |

## Agent Roles

### Universal Roles (always generated)
- **Dispatcher** — Central coordinator, triages and routes work
- **Tech Lead** — Architect, designs solutions and defines standards
- **Reviewer** — Quality gate, reviews all code changes
- **Security Officer** — Security audits, can block deployments

### Domain Roles (auto-detected from your stack)
Based on detected directories and frameworks:
- `frontend-team` — if Next.js, React, Vue, etc.
- `backend-team` — if Express, NestJS, Django, etc.
- `infra-devops` — if Docker, CI/CD detected
- `ai-ml-team` — if AI/ML frameworks detected
- `mobile-team` — if mobile directories detected

### Pi Meta Roles (for head agent mode)
- `pi-extensions` — Manages extensions
- `pi-agents` — Manages agent configurations
- `pi-skills` — Manages skill files
- `pi-config` — Manages pi settings

## Features

Toggle features during setup:

| Feature | Description |
|---------|-------------|
| **Memory system** | Per-agent memory files with compaction |
| **Context bus** | Cross-instance event logging |
| **Smart dispatcher** | File-path-aware task routing |
| **Release chain** | Changelog → version → deploy → health check |
| **Tmux control** | Parallel agent sessions |
| **UX design chain** | UI/UX research → design → evaluate pipeline |
| **Brain wiki** | Obsidian knowledge base integration |

## CLI Commands

```bash
# Full interactive bootstrap
npx pi-org-bootstrap init

# Non-interactive with defaults
npx pi-org-bootstrap init --yes

# Force overwrite
npx pi-org-bootstrap init --force

# Specify project type
npx pi-org-bootstrap init --type fullstack-web

# Specify teams directly
npx pi-org-bootstrap init --teams frontend,backend,infra

# Show bootstrap status
npx pi-org-bootstrap status

# Show help
npx pi-org-bootstrap help
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
