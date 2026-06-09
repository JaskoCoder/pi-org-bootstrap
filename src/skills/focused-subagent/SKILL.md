---
name: focused-subagent
description: "Spawns focused subagents for scoped tasks with full context bus logging. Use when delegating a narrow, well-defined task to a team that needs isolated execution with event tracking. Triggers on: spawn focused subagent, focused delegation, scoped task, isolated agent, context-aware delegation."
---

# Focused Subagent Spawning

## When to Use
- Delegating a narrow, well-scoped task (e.g., 'fix this specific bug in auth.ts')
- Running a task that needs isolation from the main agent context
- Tasks that should be tracked across instances via the context bus
- When multiple agents need to work on different parts of the same feature

## When NOT to Use
- Broad tasks that need full agent capabilities (use regular `delegate`)
- Tasks that require user interaction
- Quick one-off tasks that don't need tracking

## Usage Pattern

### Basic Focused Spawn
```
spawn_focused({
  agent: "backend-team",
  task: "Fix the null check in src/middleware/auth.ts line 42",
  scope: "backend/src/middleware/"
})
```

### With Parent Task Tracking
```
spawn_focused({
  agent: "frontend-team",
  task: "Implement the button component from the design spec",
  scope: "frontend/src/components/",
  context: "Design spec: .agents/designs/proposal-45.md",
  parentTask: "issue-2392"
})
```

### Parallel Focused Spawns
```
// Spawn multiple focused subagents for different parts of a feature
spawn_focused({ agent: "backend-team", task: "Add API endpoint", scope: "backend/src/routes/" })
spawn_focused({ agent: "frontend-team", task: "Add UI component", scope: "frontend/src/components/" })
// Both tracked via context bus, results merged back
```

## Context Bus Events Emitted

| Event | When |
|-------|------|
| `subagent_spawn` | When the subagent is created |
| `subagent_progress` | Periodic updates during execution |
| `subagent_complete` | When the subagent finishes (success or failure) |
| `state_change` | Agent status transitions |

## Integration with Other Tools
- Results appear in the context feed TUI widget
- Mail sent during focused execution is tagged with the parent task
- Memory updates are scoped to the subagent's team
- Pipeline status reflects focused subagent state
