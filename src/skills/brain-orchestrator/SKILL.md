---
name: brain-orchestrator
description: "Guides the orchestrator agent in managing a multi-agent project ecosystem. Use when coordinating multi-team workflows, querying project status, spawning research sessions, maintaining mental model state, planning sprints, monitoring agent health, triaging issues, or making project-level recommendations. Triggers on: orchestrate, project status, project health, sprint planning, agent coordination, triage queue, mental model, project overview, system status, cross-team coordination."
---

# Brain Orchestrator Skill

Guides the orchestrator agent in managing a multi-agent project ecosystem.
Provides workflows for status queries, cross-team coordination, mental model
maintenance, sprint planning, and issue triage.

## When to Load

This skill activates when the task involves:
- Querying overall project status or health
- Coordinating work across multiple teams
- Spawning research sessions for deep investigation
- Maintaining or updating the mental model
- Planning sprints or tracking objectives
- Monitoring agent health and escalating issues
- Triaging the issue queue
- Making recommendations based on current project state

## Mental Model

### Location

The mental model lives at `.agents/brain/mental-model.json`:

```
.agents/brain/
├── mental-model.json        ← Structured project state
├── mental-model-log.jsonl   ← Append-only changelog
├── chat-history.json        ← Last 100 chat messages
└── sessions.json            ← Tracked tmux sessions
```

### Reading the Mental Model

Always read the mental model before making decisions:

```bash
# Read current mental model
cat .agents/brain/mental-model.json 2>/dev/null || echo "No mental model found"

# Quick summary — extract key fields
jq '{sprint: .project.currentSprint, health: .project.overallHealth, active: [.work.activeIssues[] | .number], risks: .insights.risks}' \
   .agents/brain/mental-model.json 2>/dev/null
```

### Updating the Mental Model

Update incrementally based on new information:

```bash
# Update overall health
jq '.project.overallHealth = "yellow" | .lastUpdated = "now"' \
   .agents/brain/mental-model.json > .agents/brain/mental-model.json.tmp && \
   mv .agents/brain/mental-model.json.tmp .agents/brain/mental-model.json

# Add an active issue
jq --arg num 1234 --arg title "Issue title" --arg team "team-name" \
   '.work.activeIssues += [{"number": ($num|tonumber), "title": $title, "status": "in-progress", "assignedTo": $team, "blockers": []}]' \
   .agents/brain/mental-model.json > .agents/brain/mental-model.json.tmp && \
   mv .agents/brain/mental-model.json.tmp .agents/brain/mental-model.json

# Log the change
echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"action\":\"update\",\"field\":\"work.activeIssues\",\"detail\":\"Added #1234\"}" \
   >> .agents/brain/mental-model-log.jsonl
```

### Initializing the Mental Model

If no mental model exists, create one:

```bash
mkdir -p .agents/brain
cat > .agents/brain/mental-model.json << 'MODEL'
{
  "version": 1,
  "lastUpdated": "",
  "project": {
<!-- BOOTSTRAP:PROJECT-INFO-START -->
    "name": "PROJECT_NAME",
    "description": "PROJECT_DESCRIPTION",
<!-- BOOTSTRAP:PROJECT-INFO-END -->
    "currentSprint": 0,
    "sprintGoal": "",
    "overallHealth": "green"
  },
  "architecture": {
    "stack": [],
    "keyDecisions": [],
    "activePatterns": [],
    "techDebt": []
  },
  "work": {
    "activeIssues": [],
    "recentCompletions": [],
    "triageQueue": []
  },
  "agents": {
    "teams": {}
  },
  "insights": {
    "summary": "",
    "risks": [],
    "recommendations": [],
    "lastInsightUpdate": ""
  }
}
MODEL

# Set timestamp
jq --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '.lastUpdated = $ts' \
   .agents/brain/mental-model.json > .agents/brain/mental-model.json.tmp && \
   mv .agents/brain/mental-model.json.tmp .agents/brain/mental-model.json
```

## Status Queries

### Project Overview

Gather current project state from multiple sources:

```bash
# GitHub: open issues by label
gh issue list --state open --json number,title,labels --jq '.[] | "\(.number) \(.title) [\(.labels | map(.name) | join(","))]"'

# GitHub: current sprint issues
gh issue list --state open --label "sprint:current" --json number,title,assignees

# Pipeline: last run status
cat .agents/pipeline/state.json 2>/dev/null | jq '{status: .lastRunStatus, time: .lastRunTime}'

# Instances: active agents
cat .agents/instance-registry.json 2>/dev/null | jq '[.[] | {id: .instanceId, agent: .agent, task: .currentTask}]'

# Context bus: recent events (last 20)
tail -20 .agents/context-bus/events.jsonl 2>/dev/null | jq -r '[.timestamp, .type, .agent // "system"] | join(" | ")'
```

### Team Health Check

```bash
# Read each team's memory for recent context
<!-- BOOTSTRAP:TEAM-LIST-START -->
for team in backend-team frontend-team infra-devops; do
<!-- BOOTSTRAP:TEAM-LIST-END -->
  echo "=== $team ==="
  head -30 ".agents/agent-memory/${team}.md" 2>/dev/null || echo "(no memory)"
  echo
done
```

### Pipeline Status

```bash
# Quick pipeline check
cat .agents/pipeline/state.json 2>/dev/null | jq '.'

# Or use the pipeline_status tool for live data
```

## Cross-Team Coordination

### Delegation Pattern

When coordinating work across teams, use this pattern:

1. **Assess** — Read the mental model and identify which teams are needed
2. **Notify** — Send mail to teams with context before delegating
3. **Delegate** — Use `delegate` or `delegate_parallel` for the actual work
4. **Track** — Update the mental model with delegation status
5. **Verify** — Check results and update completions

### Sequential Coordination

For tasks with dependencies between teams:

```
1. Read mental model → understand current state
2. send_mail(producer-team, context about what consumer-team needs)
3. delegate(producer-team, "Create X for Y")
4. Wait for completion
5. send_mail(consumer-team, context about the new deliverable)
6. delegate(consumer-team, "Integrate with X")
7. Update mental model → mark issues as complete
```

### Parallel Coordination

For independent tasks across teams:

```
1. Read mental model → identify independent work items
2. send_mail(all, "Starting parallel work on X, Y, Z")
3. delegate_parallel([
     {team: "team-a", task: "Fix #X"},
     {team: "team-b", task: "Implement #Y"},
     {team: "team-c", task: "Update configuration"}
   ])
4. Update mental model → track all active issues
```

## Research Sessions

### Spawning Research via Tmux

When deep investigation is needed, spawn a research session:

```bash
# Use the tmux-control skill pattern
SESSION="research-$(date +%s)"
tmux new-session -d -s "$SESSION" -x 200 -y 50
tmux send-keys -t "$SESSION" 'pi -p "Research: <topic description>"' Enter

# Track the session
jq --arg id "$SESSION" \
   --arg task "Research: <topic>" \
   --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
   '.sessions += [{"id": $id, "task": $task, "spawnedAt": $at, "status": "running"}]' \
   .agents/brain/sessions.json > .agents/brain/sessions.json.tmp && \
   mv .agents/brain/sessions.json.tmp .agents/brain/sessions.json
```

### Reading Research Results

```bash
# Check if session is still running
tmux has-session -t "$SESSION" 2>/dev/null && echo "Running" || echo "Completed"

# Capture output
tmux capture-pane -t "$SESSION" -p -S -200
```

## Sprint Planning

### Create a Sprint Plan

Use the `sprint_plan` tool with data from the mental model:

1. **Gather data:**
   ```bash
   # Open issues needing triage
   gh issue list --state open --label "type:feature" --json number,title,labels

   # Current blockers
   jq '.work.activeIssues[] | select(.status == "blocked")' .agents/brain/mental-model.json
   ```

2. **Plan the sprint:**
   - Define clear sprint goals (2-4 objectives)
   - Assign issues to teams based on domain expertise
   - Consider team capacity (check active issues)
   - Set priorities based on dependencies

3. **Execute the plan:**
   ```
   sprint_plan({
     name: "Sprint #N: Goal",
     goals: ["Goal 1", "Goal 2"],
     assignments: [
       {team: "team-a", tasks: ["Fix #X", "Implement #Y"]},
       {team: "team-b", tasks: ["Design #Z"]}
     ]
   })
   ```

### Track Sprint Progress

```bash
# Check issues in the sprint
gh issue list --label "sprint:N" --json number,title,state

# Update mental model with progress
CURRENT_SPRINT=$(jq '.project.currentSprint' .agents/brain/mental-model.json)
echo "Sprint #${CURRENT_SPRINT} status:"
gh issue list --label "sprint:${CURRENT_SPRINT}" --state open --json number | jq length
echo "issues remaining"
```

## Issue Triage

### Triage Queue Management

```bash
# Get untriaged issues (no team label)
gh issue list --state open --json number,title,labels --jq '.[] | select(.labels | length == 0) | "\(.number) \(.title)"'

# Triage an issue to a team
gh issue edit {number} --add-label "team:backend,priority:high"

# Update mental model triage queue
ISSUES=$(gh issue list --state open --json number,title,labels --jq '[.[] | select(.labels | map(.name) | contains(["type:bug"]) | not) | {number, title, priority: "untriaged"}]')
echo "$ISSUES" | jq --slurpfile issues - \
   '.work.triageQueue = $issues[0]' \
   .agents/brain/mental-model.json > .agents/brain/mental-model.json.tmp && \
   mv .agents/brain/mental-model.json.tmp .agents/brain/mental-model.json
```

### Priority Assessment

When triaging, consider:

| Priority | Criteria |
|----------|----------|
| **critical** | Production down, data loss, security vulnerability |
| **high** | Feature blocked, CI broken, user-facing bug |
| **medium** | Feature request with clear value, non-blocking bug |
| **low** | Nice-to-have, cosmetic, tech debt |

## Agent Health Monitoring

### Check Agent States

```bash
# Instance registry — who's online
cat .agents/instance-registry.json 2>/dev/null | jq -r '.[] | "\(.instanceId) \(.agent) \(.status)"'

# Recent agent activity from context bus
tail -50 .agents/context-bus/events.jsonl 2>/dev/null | \
  jq -r '[.timestamp[11:19], .type, (.agent // "system"), (.payload.taskDescription // .payload.message // "")[0:60]] | join(" | ")'

# Check for errors
tail -100 .agents/context-bus/events.jsonl 2>/dev/null | \
  jq 'select(.type == "error" or .level == "error")'
```

### Escalation Protocol

When an agent is unhealthy:

1. **Detect** — Error events in context bus or missing heartbeat
2. **Assess** — Check agent memory for known issues
3. **Notify** — Send mail to tech-lead with diagnosis
4. **Recover** — Either re-delegate the task or spawn a new instance
5. **Document** — Update mental model with the incident

```
# Escalation via mail
send_mail(tech-lead, 
  "Agent {agent} unhealthy",
  "Agent {agent} has reported errors. Recent context: {summary}. Recommending {action}."
)
```

## Recommendation Engine

### Generate Recommendations

Based on current mental model state, produce recommendations:

```bash
# Count open issues per team
gh issue list --state open --json labels --jq '[.[] | .labels[0].name // "unlabeled"] | group_by(.) | map({team: .[0], count: length}) | .[] | "\(.team): \(.count) issues"'

# Check pipeline health
PIPELINE_STATUS=$(cat .agents/pipeline/state.json 2>/dev/null | jq -r '.lastRunStatus // "unknown"')

# Check for stale issues (no activity in 7 days)
gh issue list --state open --json number,updatedAt --jq ".[] | select((now - (.updatedAt | sub(\"\\\\.[0-9]+Z$\"; \"Z\") | strptime(\"%Y-%m-%dT%H:%M:%SZ\") | mktime)) / 86400 > 7) | .number"
```

### Recommendation Categories

| Category | When to Recommend |
|----------|-------------------|
| **Blocker resolution** | Critical/high issues with no progress |
| **Tech debt payoff** | Sprint capacity available, debt items in model |
| **Health improvement** | Agent errors, pipeline failures |
| **Process improvement** | Recurring issues, slow reviews |
| **Architecture** | New patterns needed, scaling concerns |

## Periodic Maintenance

### Full Mental Model Refresh (Every 10 Minutes)

Rebuild the mental model from source data:

1. Re-read all agent memory files
2. Re-read pipeline state
3. Re-run `gh issue list` for triage queue
4. Re-check instance registry
5. Evaluate project health: green/yellow/red

### Insight Refresh (Every 30 Minutes or On Demand)

Generate LLM-powered insights:

1. Feed current model + recent events to LLM
2. Generate updated summary (2-3 sentences)
3. Identify risks from error patterns and blockers
4. Produce recommendations from triage queue + capacity

### Session Cleanup

On startup or periodically:
```bash
# Prune dead tmux sessions from tracker
# (See tmux-control skill for full cleanup workflow)
```

## Workflow: Full Status Report

When asked for a project status report, follow this sequence:

```
1. Read mental model: cat .agents/brain/mental-model.json
2. Check pipeline: cat .agents/pipeline/state.json
3. Check instances: cat .agents/instance-registry.json
4. Recent events: tail -20 .agents/context-bus/events.jsonl
5. Open issues: gh issue list --state open --json number,title,labels
6. Active PRs: gh pr list --state open --json number,title,reviewDecision
7. Synthesize into a structured report:
   - Sprint status (goal, progress, blockers)
   - Team status (active/idle, current tasks)
   - Pipeline health
   - Risks and recommendations
8. Update mental model insights section
```

## Integration with Other Skills

| Skill | When to Use Together |
|-------|---------------------|
| `tmux-control` | Spawning research or execution sessions |
| `memory-maintenance` | Updating agent memory files after orchestration |
| `focused-subagent` | Delegating scoped tasks with context bus tracking |
| `smart-dispatcher` | Intelligent issue triage and routing |

## Constraints

- The orchestrator does NOT write code — it coordinates
- Always read the mental model before making decisions
- Always update the mental model after actions
- Log all changes to `mental-model-log.jsonl` for audit
- Use `send_mail` to notify teams before delegating
- Use `claim_task` before starting work to prevent duplicates
