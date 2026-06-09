---
name: tmux-control
description: "Manage tmux sessions for spawning and controlling parallel pi agent sessions. Use when needing to spawn background pi processes, run agents in separate tmux panes, capture output from running sessions, or clean up orphaned sessions. Triggers on: spawn tmux session, tmux control, parallel pi session, background agent, run in tmux, capture tmux output, kill session, split pane, pi headless mode."
---

# Tmux Control Skill

Manages tmux sessions for spawning parallel pi agent sessions. Enables
running multiple pi instances simultaneously in isolated tmux panes/windows
with full control over session lifecycle.

## When to Load

This skill activates when the task involves:
- Spawning pi agents in separate tmux sessions
- Running background research or execution tasks
- Capturing output from running pi sessions
- Managing multiple parallel agent sessions
- Cleaning up orphaned tmux sessions
- Splitting tmux windows for side-by-side agent work

## Prerequisites

Before using tmux commands, verify availability:

```bash
# Check if tmux is installed
which tmux && tmux -V

# Check if a tmux server is running (will fail if no sessions exist — that's OK)
tmux list-sessions 2>/dev/null || echo "No active sessions"
```

If tmux is not installed, install it:
```bash
apt-get install -y tmux   # Debian/Ubuntu
brew install tmux          # macOS
```

## Session Management

### Create a New Session

For pi agent sessions, use a naming convention `brain-{name}`:

```bash
# Create a detached session with generous terminal size
tmux new-session -d -s brain-{name} -x 200 -y 50

# Example: Create a research session
tmux new-session -d -s brain-research-1 -x 200 -y 50
```

### Check if a Session Exists

```bash
# Returns 0 if exists, 1 if not
tmux has-session -t brain-{name} 2>/dev/null
echo $?  # 0 = exists, 1 = not found
```

### List All Sessions

```bash
# List all tmux sessions
tmux list-sessions

# List only brain-* sessions
tmux list-sessions 2>/dev/null | grep '^brain-' || echo "No brain sessions"
```

### Kill a Session

```bash
# Kill a specific session
tmux kill-session -t brain-{name}

# Kill all brain-* sessions (cleanup)
tmux list-sessions 2>/dev/null | grep '^brain-' | cut -d: -f1 | xargs -I{} tmux kill-session -t {}
```

## Spawning Pi in Tmux

### Interactive Head Mode

Spawn pi in interactive (head) mode for ongoing work:

```bash
# Create session and start pi
tmux new-session -d -s brain-{name} -x 200 -y 50
tmux send-keys -t brain-{name} 'pi' Enter
```

The agent runs interactively in the session. Attach to monitor:
```bash
tmux attach -t brain-{name}
```

### Print Mode (Non-Interactive Task)

Spawn pi in print mode for a specific task with structured output:

```bash
# Create session and run a task
tmux new-session -d -s brain-{name} -x 200 -y 50
tmux send-keys -t brain-{name} 'pi -p "task description here"' Enter
```

The task runs to completion and output is captured.

### With Agent File

Spawn pi with a specific agent configuration:

```bash
tmux new-session -d -s brain-{name} -x 200 -y 50
tmux send-keys -t brain-{name} 'pi --append-system-prompt .pi/agents/{agent}.md -p "task"' Enter
```

## Sending Commands to Sessions

### Send a Command

```bash
# Send a command to the session (Enter key executes it)
tmux send-keys -t brain-{name} '{command}' Enter

# Example: Check what the agent is doing
tmux send-keys -t brain-{name} '/status' Enter

# Example: Send a steer message
tmux send-keys -t brain-{name} '/steer check the pipeline status' Enter
```

### Send Keys Without Executing

```bash
# Type text without pressing Enter (for composing a command)
tmux send-keys -t brain-{name} 'some text'
```

## Capturing Output

### Capture Recent Output

```bash
# Capture the last 50 lines of visible output
tmux capture-pane -t brain-{name} -p -S -50

# Capture last 100 lines
tmux capture-pane -t brain-{name} -p -S -100

# Capture the entire scrollback buffer
tmux capture-pane -t brain-{name} -p -S -3000
```

### Capture to File

```bash
# Save output to a file for later analysis
tmux capture-pane -t brain-{name} -p -S -200 > /tmp/brain-{name}-output.txt
```

### Read Specific Lines

After capturing, parse for specific content:

```bash
# Check if a task completed
tmux capture-pane -t brain-{name} -p -S -20 | grep -i "complete\|done\|error\|failed" || echo "Still running"
```

## Window & Pane Management

### Split a Window

```bash
# Horizontal split (30% width for new pane)
tmux split-window -t brain-{name} -h -p 30

# Vertical split (25% height for new pane)
tmux split-window -t brain-{name} -v -p 25

# Split and run a command in the new pane
tmux split-window -t brain-{name} -h -p 30 'pi -p "run tests"'
```

### Navigate Between Panes

```bash
# Target specific pane within a session
# Format: {session}:{window}.{pane}
tmux send-keys -t brain-{name}:0.0 'command' Enter
tmux send-keys -t brain-{name}:0.1 'command' Enter
```

## Session Tracking Pattern

When managing multiple sessions, track them in a state file:

```bash
# Track sessions in .agents/brain/sessions.json
mkdir -p .agents/brain

# Initialize tracking file if needed
if [ ! -f .agents/brain/sessions.json ]; then
  echo '{"sessions":[]}' > .agents/brain/sessions.json
fi
```

### Record a Spawned Session

```bash
# After creating a session, record it
SESSION_ID="brain-research-$(date +%s)"
TASK_DESCRIPTION="Investigate Redis clustering options"
SPAWNED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Use jq to append to sessions.json
jq --arg id "$SESSION_ID" \
   --arg task "$TASK_DESCRIPTION" \
   --arg at "$SPAWNED_AT" \
   '.sessions += [{"id": $id, "task": $task, "spawnedAt": $at, "status": "running"}]' \
   .agents/brain/sessions.json > .agents/brain/sessions.json.tmp && \
   mv .agents/brain/sessions.json.tmp .agents/brain/sessions.json
```

### Update Session Status

```bash
# Check if session still exists and update status
SESSION_ID="brain-research-1234"

if tmux has-session -t "$SESSION_ID" 2>/dev/null; then
  STATUS="running"
else
  STATUS="completed"
fi

jq --arg id "$SESSION_ID" \
   --arg status "$STATUS" \
   '(.sessions[] | select(.id == $id)).status = $status' \
   .agents/brain/sessions.json > .agents/brain/sessions.json.tmp && \
   mv .agents/brain/sessions.json.tmp .agents/brain/sessions.json
```

## Cleanup & Orphan Management

### Clean Up All Brain Sessions

```bash
# Kill all brain-* tmux sessions
tmux list-sessions 2>/dev/null | grep '^brain-' | cut -d: -f1 | while read s; do
  echo "Killing session: $s"
  tmux kill-session -t "$s"
done
```

### Prune Dead Sessions from Tracker

```bash
# Remove sessions from tracker that no longer exist in tmux
jq '.sessions |= map(select(
  .id as $id | 
  ($id | @sh | "tmux has-session -t " + . + " 2>/dev/null") | 
  true  # placeholder — filter in actual script
))' .agents/brain/sessions.json
```

In practice, use a script:

```bash
# Prune dead sessions
TMPFILE=$(mktemp)
jq -n '{"sessions": []}' > "$TMPFILE"

for session in $(jq -r '.sessions[].id' .agents/brain/sessions.json); do
  if tmux has-session -t "$session" 2>/dev/null; then
    jq --arg id "$session" '.sessions += [input | .sessions[] | select(.id == $id)]' \
       "$TMPFILE" <(jq --arg id "$session" '.sessions[] | select(.id == $id)' .agents/brain/sessions.json) \
       > "$TMPFILE.tmp" && mv "$TMPFILE.tmp" "$TMPFILE"
  else
    echo "Pruning dead session: $session"
  fi
done

mv "$TMPFILE" .agents/brain/sessions.json
```

## Complete Workflow: Spawn, Monitor, Capture

### Full Lifecycle

```bash
# 1. Create session
SESSION="brain-task-$(date +%s)"
tmux new-session -d -s "$SESSION" -x 200 -y 50

# 2. Start pi with a task
tmux send-keys -t "$SESSION" 'pi -p "Research horizontal scaling patterns for our Express API"' Enter

# 3. Wait and check status
sleep 10
tmux capture-pane -t "$SESSION" -p -S -20

# 4. Wait for completion (poll every 30s)
while tmux has-session -t "$SESSION" 2>/dev/null; do
  sleep 30
  # Check if pi exited
  LAST_LINE=$(tmux capture-pane -t "$SESSION" -p -S -5 | tail -1)
  if echo "$LAST_LINE" | grep -qE "(done|complete|error|exit)"; then
    break
  fi
done

# 5. Capture final output
tmux capture-pane -t "$SESSION" -p -S -200 > /tmp/"${SESSION}-output.txt"

# 6. Kill session
tmux kill-session -t "$SESSION"
```

## Error Handling

| Scenario | Detection | Recovery |
|----------|-----------|----------|
| tmux not installed | `which tmux` fails | Install tmux, report error |
| Session name collision | `tmux new-session` fails | Use unique name with timestamp |
| pi command fails | Output contains error | Capture output, report to caller |
| Session dies unexpectedly | `tmux has-session` returns 1 | Mark as error, capture last output |
| Terminal too small | Garbled output | Ensure `-x 200 -y 50` minimum |

## Safety Notes

- Always create sessions with `-d` (detached) to avoid taking over the terminal
- Use `-x 200 -y 50` minimum size to prevent pi rendering issues
- Kill sessions when done to avoid resource leaks
- Track all spawned sessions in `.agents/brain/sessions.json` for cleanup
- On system shutdown, clean up all `brain-*` sessions
