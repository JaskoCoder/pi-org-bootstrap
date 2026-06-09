---
name: smart-dispatcher
description: "Enhances the dispatcher's routing intelligence with file-path-aware team mapping, cross-cutting task detection with auto-splitting, and task size estimation. Use when triaging GitHub issues, routing tasks to teams, parsing issue bodies for affected files, splitting cross-cutting work across teams, estimating task complexity, or applying size labels. Triggers on: triage, route, dispatch, assign to team, parse issue, cross-cutting, auto-split, task size, size estimate, affected files, file path routing, issue triage, smart routing, dispatcher intelligence."
---

# Smart Dispatcher Routing Skill

Enhances the dispatcher agent with intelligent routing that goes beyond
label-based rules. Adds three capabilities: file-path-aware routing,
cross-cutting task detection with auto-splitting, and task size estimation.

## When to Load

This skill activates when the task involves:
- **Triage** — parsing new GitHub issues and routing them to teams
- **Routing** — deciding which team should handle a task
- **Dispatching** — assigning work across the agent organization
- **File path analysis** — determining scope from affected files
- **Cross-cutting detection** — recognizing tasks that span multiple domains
- **Size estimation** — labeling issues with size taxonomy

## Architecture

```
Issue Input
    │
    ▼
┌─────────────────────────┐
│  1. File Path Parser    │  Extract affected files from issue body/diff
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  2. Team Mapper         │  Map file paths → teams
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  3. Cross-Cut Detector  │  Detect multi-domain tasks
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  4. Size Estimator      │  XS/S/M/L/XL from file count + keywords
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  5. Route & Execute     │  delegate / delegate_parallel + labels
└─────────────────────────┘
```

---

## Capability 1: File-Path-Aware Routing

### File Path Extraction

Parse file paths from GitHub issue bodies and PR diffs.

#### From Issue Body

```bash
# Extract the issue body
gh issue view {number} --json body --jq '.body'
```

Scan the body for file path patterns:

```
# File path detection regex (apply to issue body):
# 1. Explicit paths: `path/to/file.ts` or `path/to/file.tsx`
# 2. Markdown code blocks referencing files: ```typescript:path/to/file.ts
# 3. "In file", "touches file", "update file", "modify file" phrases
# 4. Stack traces with file references: "at something (path/to/file.ts:42)"
# 5. Diff hunks: --- a/path/to/file.ts or +++ b/path/to/file.ts
```

#### From PR Diff

```bash
# Get the list of files changed in a PR
gh pr diff {number} --name-only
```

#### From Recent Commits

```bash
# Files changed in the last N commits touching an issue
gh api repos/{owner}/{repo}/commits --jq '.[].files[].filename'
```

### Team Mapping Rules

Map extracted file paths to teams using these rules (evaluated in order, first match wins).

<!-- BOOTSTRAP:TEAM-MAPPING-START -->
| File Path Pattern | Team | Rationale |
|---|---|---|
| `src/**` | `dev-team` | Main source code |
<!-- BOOTSTRAP:TEAM-MAPPING-END -->

> **Note (for bootstrap users):** The table above is a default placeholder.
> When you run `pi-org-bootstrap init`, the scanner detects your project's
> directory structure and populates this table with mappings specific to your
> stack. For example:
> - A Node.js monorepo with `frontend/` + `backend/` → `frontend-team` + `backend-team`
> - A Python project with `app/` + `migrations/` → `backend-team`
> - A Rust workspace with crates → one team per crate
>
> You can also manually edit this section in your agent's configuration to
> add custom mappings.

### Team Mapping Implementation

<!-- BOOTSTRAP:TEAM-MAPPING-IMPL-START -->
```
FUNCTION mapFileToTeam(filePath):
    # Order matters — first match wins
    # Default: map everything to dev-team
    if filePath matches "src/"          → dev-team

    # Fallback: check for common patterns in filename
    if filePath matches "\.(test|spec)\."    → team of the source file (strip test suffix)
    if filePath matches "\.(md|mdx)$"        → docs → determine from content

    # Unknown
    → "unknown" (flag for manual triage)
```
<!-- BOOTSTRAP:TEAM-MAPPING-IMPL-END -->

### Output Format

After parsing an issue, produce a routing report:

```json
{
  "issue": 1234,
  "affectedFiles": [
    "backend/src/routes/auth.ts",
    "frontend/src/components/LoginForm.tsx",
    "docker-compose.yml"
  ],
  "teamMapping": {
    "backend-team": ["backend/src/routes/auth.ts"],
    "frontend-team": ["frontend/src/components/LoginForm.tsx"],
    "infra-devops": ["docker-compose.yml"]
  },
  "isCrossCutting": true,
  "estimatedSize": "M",
  "recommendedAction": "delegate_parallel"
}
```

---

## Capability 2: Cross-Cutting Task Detection & Auto-Splitting

### Detection Criteria

A task is **cross-cutting** when the file path analysis maps to **2 or more teams**.

<!-- BOOTSTRAP:CROSS-CUTTING-INDICATORS-START -->
Additional cross-cutting indicators (from issue body text analysis):

| Indicator | Pattern |
|---|---|
| Full-stack | "endpoint AND component", "API AND UI", "backend AND frontend" |
| Feature with infra | "new feature AND deploy", "add service AND docker" |
| Schema + UI | "migration AND form", "schema AND component" |
| Config cascade | "env variable AND application code" |
<!-- BOOTSTRAP:CROSS-CUTTING-INDICATORS-END -->

### Auto-Splitting Protocol

When a cross-cutting task is detected:

#### Step 1: Analyze Scope Per Team

```
For each team in teamMapping:
    1. List the files they own from affectedFiles
    2. Extract the relevant description from the issue body
    3. Determine dependencies (does this team need output from another?)
    4. Estimate sub-task size
```

#### Step 2: Determine Execution Order

```
# Rule: Prefer parallel execution unless there are dependencies

PARALLEL (use delegate_parallel):
    - Backend creates API endpoint + Frontend creates component (independent)
    - Infra updates Docker config + Backend updates env vars (independent)
    - Multiple teams fix independent bugs in their domains

SEQUENTIAL (use delegate with handoff):
    - Backend creates migration → Frontend consumes new schema fields
    - Backend creates API → Frontend integrates it
    - Infra sets up env → Backend reads new config

# Dependency detection heuristics:
DEPENDENCY if:
    - One team's sub-task references "new endpoint", "new field", "new table" (producer)
    - Another team's sub-task references "integrate with", "consume", "call", "use the new" (consumer)
```

#### Step 3: Generate Sub-Tasks

For each team, craft a precise sub-task description:

```
FORMAT:
"[Cross-cutting] {Original issue title} — {Team} scope

Parent issue: #{issue_number}
Parent task ID: {parent_task_id}

## Your Scope
Files: {list of files for this team}
Description: {relevant excerpt from issue}

## Dependencies
{What you need from other teams, or "None — independent of other teams"}

## Deliverables
{What this team must produce}

## Integration Notes
{How your output connects to other teams' work}

Branch: {type}/issue-{N}-{description}
Commit: {type}(scope): description closes #{N}"
```

#### Step 4: Execute Via Delegation

**Parallel execution:**

```
delegate_parallel({
  tasks: [
    {
      team: "backend-team",
      task: "[Cross-cutting] Add auth endpoint — backend scope\nParent: #1234\n\nFiles: backend/src/routes/auth.ts\nCreate the /api/auth endpoint..."
    },
    {
      team: "frontend-team",
      task: "[Cross-cutting] Add login component — frontend scope\nParent: #1234\n\nFiles: frontend/src/components/LoginForm.tsx\nCreate the login form component..."
    }
  ]
})
```

**Sequential execution:**

```
# Phase 1: Producer team
delegate(backend-team, "[Cross-cutting] Create endpoint — backend scope\nParent: #1234\n...")

# After completion, hand off context:
send_mail(frontend-team, "Endpoint ready for #1234", "The backend team has completed the endpoint. See PR #1235 for integration details.")

# Phase 2: Consumer team
delegate(frontend-team, "[Cross-cutting] Integrate — frontend scope\nParent: #1234\nThe endpoint is now available. Build the UI...")
```

#### Step 5: Track With Context Bus

Log cross-cutting splits to the context bus:

```bash
# Log the split event
echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"cross-cutting-split\",\"agent\":\"dispatcher\",\"payload\":{\"issue\":$ISSUE_NUM,\"parentTask\":\"$PARENT_ID\",\"subTasks\":$(echo $SUB_TASKS | jq -c .),\"executionMode\":\"parallel\"}}" >> .agents/context-bus/events.jsonl
```

Track parent-child relationships:

```json
{
  "parentTaskId": "dispatch-1234",
  "parentIssue": 1234,
  "subTasks": [
    {
      "team": "backend-team",
      "scope": "auth endpoint",
      "status": "delegated",
      "branch": "feat/issue-1234-auth-endpoint"
    },
    {
      "team": "frontend-team",
      "scope": "login component",
      "status": "delegated",
      "branch": "feat/issue-1234-login-component"
    }
  ],
  "executionMode": "parallel",
  "createdAt": "2026-06-09T12:00:00Z"
}
```

Store tracking data at `.agents/dispatch/tracking-{issue}.json`.

### Cross-Cut Completeness Check

After all sub-tasks complete, verify:

```
1. Read tracking file: .agents/dispatch/tracking-{issue}.json
2. Check all subTasks[].status == "completed"
3. If any failed → re-delegate with error context
4. Apply completion label: gh issue edit {number} --add-label "status:resolved"
5. Notify tech-lead: send_mail(tech-lead, "Cross-cutting #${issue} complete")
```

---

## Capability 3: Task Size Estimation

### Estimation Factors

Task size is estimated from three signals:

#### Signal 1: File Count

| Files Mentioned | Size Contribution |
|---|---|
| 1 file | XS |
| 2-3 files | S |
| 4-6 files | M |
| 7-10 files | L |
| 11+ files | XL |

#### Signal 2: Complexity Keywords

Scan the issue title and body for these keywords:

| Keyword | Size Bump |
|---|---|
| `fix`, `typo`, `rename`, `log`, `comment` | −1 (simpler than file count suggests) |
| `refactor`, `migrate`, `restructure` | +1 |
| `new feature`, `new endpoint`, `new page` | +1 |
| `integration`, `cross-cutting`, `full-stack` | +2 |
| `architecture`, `rewrite`, `overhaul`, `redesign` | +2 |
| `migration`, `breaking change`, `schema change` | +2 |
| `performance`, `optimization`, `benchmark` | +1 |
| `test`, `coverage`, `spec` | +0 (neutral) |
| `docs`, `readme`, `comment` | −1 |
| `security`, `auth`, `encryption` | +1 |

#### Signal 3: Cross-Cutting Indicator

| Indicator | Size Bump |
|---|---|
| Single team | +0 |
| 2 teams | +1 |
| 3+ teams | +2 |

### Estimation Algorithm

```
FUNCTION estimateSize(affectedFiles, issueBody, teamCount):
    # Step 1: Base size from file count
    fileCount = length(affectedFiles)

    if fileCount == 0:    base = 1    # S (no files = likely small config/docs)
    if fileCount == 1:    base = 0    # XS
    if fileCount <= 3:    base = 1    # S
    if fileCount <= 6:    base = 2    # M
    if fileCount <= 10:   base = 3    # L
    if fileCount > 10:    base = 4    # XL

    # Step 2: Keyword adjustments
    keywordBump = sum of all keyword matches from Signal 2 table

    # Step 3: Cross-cutting adjustment
    crossCutBump = 0 if teamCount == 1
    crossCutBump = 1 if teamCount == 2
    crossCutBump = 2 if teamCount >= 3

    # Step 4: Compute final score
    score = base + keywordBump + crossCutBump

    # Step 5: Clamp to [0, 4]
    score = max(0, min(4, score))

    # Step 6: Map to label
    sizes = ["XS", "S", "M", "L", "XL"]
    return sizes[score]
```

### Label Application

After estimation, apply the size label:

```bash
gh issue edit {number} --add-label "size:{XS|S|M|L|XL}"
```

### Estimation Output

Include the estimation in the triage report:

```json
{
  "issue": 1234,
  "sizeEstimate": {
    "label": "M",
    "fileCount": 5,
    "baseSize": "M",
    "keywordBumps": ["refactor (+1)"],
    "crossCutBump": "+1 (2 teams)",
    "finalScore": 3,
    "confidence": "high"
  }
}
```

**Confidence levels:**
- `high` — issue body contains explicit file paths and clear scope
- `medium` — file paths inferred from description, some ambiguity
- `low` — vague description, no file paths, size is a guess

---

## Full Triage Protocol

When triaging an issue, follow this sequence:

### Step 1: Fetch Issue Data

```bash
# Get full issue details
gh issue view {number} --json number,title,body,labels,assignees

# Check for linked PRs
gh pr list --search "fixes #{number}" --json number,title

# If PR exists, get affected files
gh pr diff {pr_number} --name-only 2>/dev/null
```

### Step 2: Parse File Paths

Extract file paths from the issue body using the patterns in Capability 1.
If no file paths found, scan the issue text for domain keywords:

<!-- BOOTSTRAP:DOMAIN-KEYWORDS-START -->
| Domain Keywords | Implied Files |
|---|---|
| "API", "endpoint", "route", "database", "query" | `src/` (application code) |
| "page", "component", "UI", "button", "form", "layout" | `src/` (UI code) |
| "docker", "deploy", "CI", "pipeline", "container" | infra files |
| "test", "spec", "coverage" | test files |
<!-- BOOTSTRAP:DOMAIN-KEYWORDS-END -->

### Step 3: Map to Teams

Apply the team mapping rules from Capability 1.

### Step 4: Detect Cross-Cutting

If 2+ teams are mapped → activate auto-splitting (Capability 2).

### Step 5: Estimate Size

Apply the size estimation algorithm (Capability 3).

### Step 6: Apply Labels

<!-- BOOTSTRAP:LABEL-TAXONOMY-START -->
```bash
# Team labels (one per team)
for team in "${teams[@]}"; do
  gh issue edit {number} --add-label "team:${team}"
done

# Size label
gh issue edit {number} --add-label "size:${sizeEstimate}"

# Cross-cutting label (if applicable)
if isCrossCutting; then
  gh issue edit {number} --add-label "scope:cross-cutting"
fi
```
<!-- BOOTSTRAP:LABEL-TAXONOMY-END -->

### Step 7: Route

Based on the routing report:

| Scenario | Action |
|---|---|
| Single team, clear scope | `delegate(team, task)` |
| Cross-cutting, independent | `delegate_parallel(tasks)` |
| Cross-cutting, dependent | Sequential `delegate` with `send_mail` handoffs |
| Unknown team | Apply `status:needs-triage`, notify `tech-lead` |
| Security-related | Route to `security-officer` first |

### Step 8: Log & Track

```bash
# Save routing report
cat > .agents/dispatch/tracking-{number}.json << 'EOF'
{
  "issue": {number},
  "routedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "affectedFiles": [...],
  "teams": [...],
  "isCrossCutting": false,
  "sizeEstimate": "M",
  "executionMode": "single",
  "subTasks": []
}
EOF

# Log to context bus
echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"triage-complete\",\"agent\":\"dispatcher\",\"payload\":{\"issue\":$NUMBER,\"teams\":$(echo $TEAMS | jq -c .),\"size\":\"$SIZE\",\"crossCutting\":$CROSS_CUT}}" >> .agents/context-bus/events.jsonl
```

---

## Integration with Existing Dispatcher

This skill augments (not replaces) the existing dispatcher routing rules in
`.pi/agents/dispatcher.md` (or whatever your primary dispatcher agent file is).
The existing rules handle:

- **Severity-based routing** (critical → security-officer, high → team, etc.)
- **Feature request flow** (tech-lead → team → reviewer)
- **UI/UX chain** (design pipeline before frontend implementation)
- **PR review routing** (dual-approval process)

**Layering rule:** Smart-dispatcher runs FIRST to gather intelligence (file paths,
teams, size), then the existing severity/priority rules determine the execution
urgency and flow.

```
Issue arrives
    │
    ▼
Smart Dispatcher (this skill)
    ├── Parse file paths
    ├── Map teams
    ├── Detect cross-cutting
    └── Estimate size
    │
    ▼
Existing Dispatcher Rules (dispatcher.md)
    ├── Severity assessment (critical/high/medium/low)
    ├── Priority routing (security-first, blocker-first)
    ├── UI/UX chain detection
    └── PR review routing
    │
    ▼
Execute (delegate / delegate_parallel)
```

---

## Error Handling

| Scenario | Action |
|---|---|
| Issue body has no file paths | Fall back to domain keyword analysis (Step 2 fallback) |
| File path doesn't match any rule | Map as "unknown", flag for manual triage, notify tech-lead |
| Cross-cutting split with dependency cycle | Break cycle by identifying the root producer, route first |
| Size estimate seems wrong (too large/small) | Include confidence level; low-confidence estimates get `status:needs-review` |
| `gh issue view` fails (permissions) | Retry once; if still fails, notify infra-devops |
| `delegate_parallel` fails for a sub-task | Re-delegate failed sub-task individually with error context |
| Tracking file already exists (re-triage) | Archive old tracking, create new; log as re-triage event |
| Issue references non-existent files | Treat as new files to create; map to team by directory pattern |

---

## Directory Structure

```
.agents/dispatch/           ← Tracking data (created by this skill)
├── tracking-{issue}.json   ← Per-issue routing reports
└── README.md               ← Auto-generated index (optional)

.pi/skills/smart-dispatcher/
└── SKILL.md                ← This file
```

Tracking directory is created automatically:

```bash
mkdir -p .agents/dispatch
```

---

## Quick Reference Card

```
# Full triage (all 3 capabilities)
gh issue view {N} --json body → parse paths → map teams → detect cross-cut → estimate size → route

# Quick file-path routing only
gh pr diff {N} --name-only → map each file → unique teams → route

# Quick size estimate only
Count files + scan keywords → compute score → apply label

# Cross-cutting split
Detect 2+ teams → analyze dependencies → parallel or sequential → delegate → track
```
