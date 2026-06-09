/**
 * Instance Bridge — Dual-mode worker communication.
 *
 * Architecture:
 *   Workers can be spawned in two modes:
 *   1. **tmux pane** (preferred when inside tmux) — splits the current pane,
 *      runs interactive `pi` for visual display, communicates via tmux send-keys.
 *   2. **RPC child process** (fallback when not in tmux) — headless `pi --mode rpc`,
 *      communicates via JSON-RPC over stdin/stdout.
 *
 * RPC Protocol:
 *   Commands are JSON objects sent to stdin, one per line (JSONL).
 *   Responses have `type: "response"` and match the command's `id`.
 *   Events stream to stdout as JSON lines (agent_start, message_update, etc.).
 *
 * Important: We use a custom JSONL reader (not Node readline) because
 * Node readline splits on U+2028/U+2029 which are valid inside JSON strings.
 */
import { ChildProcess, spawn, execSync, execFileSync } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

// ─── JSONL Reader ────────────────────────────────────────
// Strict JSONL: split on \n only. Do NOT use Node readline
// (it splits on U+2028/U+2029 which are valid inside JSON strings).

function attachJsonlReader(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): void {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  (stream as any).on("data", (chunk: Buffer | string) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) break;

      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      // Strip optional \r from \r\n
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.length > 0) onLine(line);
    }
  });

  (stream as any).on("end", () => {
    buffer += decoder.end();
    if (buffer.length > 0) {
      let remaining = buffer;
      if (remaining.endsWith("\r")) remaining = remaining.slice(0, -1);
      if (remaining.length > 0) onLine(remaining);
    }
  });
}

// ─── Environment Detection ──────────────────────────────

/**
 * Check if the current process is running inside a tmux session.
 * tmux sets the TMUX environment variable when attached.
 */
export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

// ─── Tmux Pane Helpers ───────────────────────────────────

/**
 * Split the current tmux pane and return the new pane's ID.
 * Returns null if the split fails (e.g., pane too small).
 */
function splitCurrentPane(direction: "-h" | "-v", cwd: string): string | null {
  try {
    const paneId = execFileSync(
      "tmux",
      ["split-window", "-P", "-F", "#{pane_id}", direction, "-c", cwd],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 },
    ).trim();
    return paneId || null;
  } catch {
    return null;
  }
}

/**
 * Send text to a tmux pane as literal keystrokes, then press Enter.
 * Uses -l flag to send text literally (no key name interpretation).
 */
function sendKeysToPane(paneId: string, text: string): boolean {
  try {
    // Send text literally
    execFileSync("tmux", ["send-keys", "-t", paneId, "-l", text], {
      stdio: "pipe", timeout: 3000,
    });
    // Send Enter
    execFileSync("tmux", ["send-keys", "-t", paneId, "Enter"], {
      stdio: "pipe", timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture the visible output from a tmux pane.
 * Returns the raw text with ANSI codes stripped.
 */
function capturePaneOutput(paneId: string, lines: number = 30): string | null {
  try {
    const output = execFileSync(
      "tmux",
      ["capture-pane", "-t", paneId, "-p", "-S", "-" + String(lines)],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 3000 },
    );
    if (!output) return null;
    // Strip ANSI escape codes for cleaner text
    return output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Check if a tmux pane still exists.
 */
function isPaneAlive(paneId: string): boolean {
  try {
    execFileSync(
      "tmux",
      ["display-message", "-t", paneId, "-p", "#{pane_id}"],
      { stdio: "pipe", timeout: 2000 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a tmux pane by ID.
 */
function killPane(paneId: string): void {
  try {
    execFileSync("tmux", ["kill-pane", "-t", paneId], { stdio: "pipe", timeout: 3000 });
  } catch { /* already gone */ }
}

/**
 * Rebalance all panes in the current tmux window using tiled layout.
 */
export function rebalanceLayout(): void {
  try {
    execFileSync("tmux", ["select-layout", "tiled"], { stdio: "pipe", timeout: 3000 });
  } catch { /* ignore */ }
}

// ─── RPC Worker ──────────────────────────────────────────

export interface RpcWorker {
  type: "rpc";
  process: ChildProcess;
  instanceId?: string;
  username?: string;
  sendRpcCommand(cmd: object): Promise<any>;
  sendMessage(text: string): Promise<boolean>;
  getLastAssistantText(): Promise<string | null>;
  getState(): Promise<any>;
  kill(): void;
  isAlive(): boolean;
  getSessionName(): string | undefined;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Spawn a new pi instance as a child process in RPC mode.
 * Returns an RpcWorker that communicates via JSON-RPC over stdin/stdout.
 */
export function spawnRpcWorker(cwd: string, sessionName?: string): RpcWorker {
  const args = ["--mode", "rpc", "--no-session"];
  const proc = spawn("pi", args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      // If a session name is provided, set it so the worker can identify itself
      ...(sessionName ? { PI_SESSION_NAME: sessionName } : {}),
    },
  });

  // RPC state
  const pendingRequests = new Map<string, PendingRequest>();
  let nextId = 1;
  let lastAssistantText: string | null = null;
  let isDead = false;
  let sessionName_: string | undefined = sessionName;

  // Attach JSONL reader to stdout
  attachJsonlReader(proc.stdout!, (line: string) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      // Skip malformed JSON
      return;
    }

    // Response: match to pending request by id
    if (msg.type === "response" && msg.id) {
      const pending = pendingRequests.get(msg.id);
      if (pending) {
        pendingRequests.delete(msg.id);
        clearTimeout(pending.timer);
        pending.resolve(msg);
      }
      return;
    }

    // Event: extract useful data
    if (msg.type === "agent_end") {
      // After agent finishes, capture the last assistant text
      // We'll request it on demand via getLastAssistantText()
    }

    if (msg.type === "message_end" && msg.message?.role === "assistant") {
      // Track the last assistant message text
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        const textBlocks = content.filter((c: any) => c.type === "text");
        if (textBlocks.length > 0) {
          lastAssistantText = textBlocks.map((c: any) => c.text).join("\n");
        }
      } else if (typeof content === "string") {
        lastAssistantText = content;
      }
    }


  });

  // stderr logging
  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    // Only log errors, not routine stderr
    if (text.includes("error") || text.includes("Error")) {
      process.stderr.write("[rpc-worker:stderr] " + text);
    }
  });

  // Handle process exit
  proc.on("exit", () => {
    isDead = true;
    // Reject all pending requests
    for (const [id, pending] of pendingRequests) {
      pendingRequests.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new Error("Worker process exited"));
    }
  });

  // Helper: send RPC command and wait for response
  function sendRpcCommand(cmd: object): Promise<any> {
    return new Promise((resolve, reject) => {
      if (isDead || proc.killed) {
        reject(new Error("Worker process is dead"));
        return;
      }

      const id = String(nextId++);
      const cmdWithId = { ...cmd, id };

      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error("RPC request timed out: " + (cmd as any).type));
      }, 60_000); // 60s timeout

      pendingRequests.set(id, { resolve, reject, timer });

      try {
        proc.stdin!.write(JSON.stringify(cmdWithId) + "\n");
      } catch (e) {
        pendingRequests.delete(id);
        clearTimeout(timer);
        reject(new Error("Failed to write to worker stdin: " + e));
      }
    });
  }

  return {
    type: "rpc" as const,
    process: proc,

    sendRpcCommand,

    async sendMessage(text: string): Promise<boolean> {
      try {
        // For slash commands, use prompt directly
        // For natural language, use prompt with streamingBehavior
        const cmd: any = {
          type: "prompt",
          message: text,
          streamingBehavior: "steer", // Queue if already streaming
        };
        const resp = await sendRpcCommand(cmd);
        return resp.success === true;
      } catch {
        return false;
      }
    },

    async getLastAssistantText(): Promise<string | null> {
      // First try cached value from message_end events
      if (lastAssistantText) return lastAssistantText;

      // Otherwise query via RPC
      try {
        const resp = await sendRpcCommand({ type: "get_last_assistant_text" });
        if (resp.success && resp.data) {
          return resp.data.text || null;
        }
        return null;
      } catch {
        return null;
      }
    },

    async getState(): Promise<any> {
      try {
        const resp = await sendRpcCommand({ type: "get_state" });
        if (resp.success && resp.data) {
          // Extract session name from state if available
          if (resp.data.sessionName) {
            sessionName_ = resp.data.sessionName;
          }
          return resp.data;
        }
        return null;
      } catch {
        return null;
      }
    },

    kill(): void {
      isDead = true;
      try {
        // Send abort first for graceful shutdown
        proc.stdin?.write(JSON.stringify({ type: "abort" }) + "\n");
      } catch { /* ignore */ }
      try {
        proc.kill("SIGTERM");
        // Force kill after 3 seconds
        setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch { /* already dead */ }
        }, 3000);
      } catch { /* already dead */ }
    },

    isAlive(): boolean {
      return !isDead && !proc.killed;
    },

    getSessionName(): string | undefined {
      return sessionName_;
    },
  };
}

// ─── Tmux Worker ─────────────────────────────────────────

export interface TmuxWorker {
  type: "tmux";
  paneId: string;
  instanceId?: string;
  username?: string;
  sendMessage(text: string): Promise<boolean>;
  getLastAssistantText(): Promise<string | null>;
  getState(): Promise<any>;
  isAlive(): boolean;
  kill(): void;
}

/**
 * Spawn a new pi instance in a split tmux pane.
 *
 * How it works:
 *   1. Splits the current tmux pane (alternates horizontal/vertical)
 *   2. Runs `pi` (interactive mode) in the new pane — user sees the full TUI
 *   3. The worker registers in the instance pool just like any other pi instance
 *   4. Communication via `tmux send-keys` (since panes are in the same session)
 *   5. Output capture via `tmux capture-pane`
 *
 * Requires: Running inside tmux (`process.env.TMUX` must be set).
 */
export function spawnTmuxWorker(
  cwd: string,
  sessionName?: string,
  existingTmuxCount?: number,
): TmuxWorker {
  // Decide split direction: alternate h/v for balanced layout
  const count = existingTmuxCount ?? 0;
  const direction = count % 2 === 0 ? "-h" : "-v";

  // Split the current pane
  const paneId = splitCurrentPane(direction, cwd);
  if (!paneId) {
    throw new Error("Failed to split tmux pane — pane may be too small");
  }

  // Rebalance layout after split
  try {
    rebalanceLayout();
  } catch { /* best effort */ }

  // The tmux pane is ready immediately after split-window returns.
  // No artificial delay needed — send-keys will queue if the shell
  // hasn't started its input reader yet.

  // Start pi in the new pane
  // If a session name is provided, set it via tmux set-environment (safe — no shell interpolation)
  if (sessionName) {
    try {
      execFileSync("tmux", ["set-environment", "-t", paneId, "PI_SESSION_NAME", sessionName], {
        stdio: "pipe", timeout: 3000,
      });
    } catch { /* best effort */ }
  }
  try {
    // Send the pi command as literal text (not a key name)
    execFileSync("tmux", ["send-keys", "-t", paneId, "-l", "pi"], {
      stdio: "pipe", timeout: 3000,
    });
    execFileSync("tmux", ["send-keys", "-t", paneId, "Enter"], {
      stdio: "pipe", timeout: 3000,
    });
  } catch (e: any) {
    // Clean up the pane if we can't start pi
    try { killPane(paneId); } catch { /* ignore */ }
    throw new Error("Failed to start pi in new pane: " + (e.message || String(e)));
  }

  // ── Tmux Worker object ──
  return {
    type: "tmux" as const,
    paneId,
    instanceId: undefined,
    username: undefined,

    async sendMessage(text: string): Promise<boolean> {
      if (!isPaneAlive(paneId)) return false;
      return sendKeysToPane(paneId, text);
    },

    async getLastAssistantText(): Promise<string | null> {
      // Best-effort capture — tmux capture-pane returns raw terminal content
      // which may include prompts, ANSI artifacts, and partial output.
      // This is a rough approximation; RPC workers return structured parsed text.
      const raw = capturePaneOutput(paneId, 50);
      if (!raw) return null;

      // Strip common prompt lines (e.g., "❯ ", "$ ", "pi> ", ANSI prompts)
      const lines = raw.split("\n");
      const cleaned = lines
        .filter(line => {
          const trimmed = line.trim();
          // Skip empty lines, pure prompts, and common shell/prompt patterns
          if (trimmed.length === 0) return false;
          if (/^[❯››>\$#]\s*$/.test(trimmed)) return false;
          if (/^\[?\w+@\w+[^\]]*\]?[\$#]\s*$/.test(trimmed)) return false;
          return true;
        })
        .join("\n");

      return cleaned || null;
    },

    async getState(): Promise<any> {
      // No structured state for tmux workers — they're interactive sessions
      return { paneId, type: "tmux", interactive: true };
    },

    isAlive(): boolean {
      return isPaneAlive(paneId);
    },

    kill(): void {
      // Try to send Ctrl-C first for graceful shutdown
      try {
        execFileSync("tmux", ["send-keys", "-t", paneId, "C-c"], {
          stdio: "pipe", timeout: 2000,
        });
      } catch { /* ignore */ }
      // Kill the pane, then rebalance once
      killPane(paneId);
      try {
        rebalanceLayout();
      } catch { /* not in tmux, ignore */ }
    },
  };
}

// ─── Tmux Helpers (for optional fleet view ONLY) ─────────

export function isTmuxAvailable(): boolean {
  try {
    execSync("which tmux", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function listSessions(prefix?: string): string[] {
  try {
    const output = execSync("tmux list-sessions -F '#{session_name}'", {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    });
    const sessions = output.trim().split("\n").filter(s => s.length > 0);
    if (prefix) return sessions.filter(s => s.startsWith(prefix));
    return sessions;
  } catch {
    return [];
  }
}

export function sessionExists(sessionName: string): boolean {
  try {
    execSync("tmux has-session -t " + sessionName, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ─── View / Layout (tmux optional visual monitoring) ─────

const FLEET_SESSION = "brain-fleet";

/**
 * Union type for any worker in the pool.
 */
export type PoolWorker = RpcWorker | TmuxWorker;

/**
 * Open a tiled view of all workers.
 *
 * When inside tmux: workers are already visible as split panes.
 * Just rebalance the layout. Returns a message saying so.
 *
 * When NOT in tmux: tries the old fleet session approach
 * (only works for tmux-based worker sessions, not RPC).
 */
export function openFleetView(): { success: boolean; attachCmd: string; error?: string; isTmuxPanes?: boolean } {
  if (isInsideTmux()) {
    // Workers are already visible as split panes — just rebalance
    try {
      rebalanceLayout();
    } catch { /* ignore */ }
    return {
      success: true,
      attachCmd: "",
      isTmuxPanes: true,
    };
  }

  if (!isTmuxAvailable()) {
    return { success: false, attachCmd: "", error: "tmux not installed" };
  }

  const workers = listSessions("brain-worker-");
  if (workers.length === 0) {
    return {
      success: false,
      attachCmd: "",
      error: "No tmux worker sessions to display. RPC workers run as child processes, not tmux sessions. Fleet view is only available for tmux-based workers.",
    };
  }

  try {
    // Kill existing fleet session if any
    try {
      execSync("tmux kill-session -t " + FLEET_SESSION + " 2>/dev/null", { stdio: "pipe" });
    } catch { /* didn't exist — fine */ }

    // Create a NEW detached session — never touches the user's current session
    execSync(
      "tmux new-session -d -s " + FLEET_SESSION + " -x 220 -y 50",
      { stdio: "pipe", timeout: 5000 },
    );

    // Pane 0: attach to first worker
    execSync(
      "tmux send-keys -t " + FLEET_SESSION + " 'tmux attach -t " + workers[0] + "' Enter",
      { stdio: "pipe", timeout: 3000 },
    );

    // Split for each additional worker
    for (let i = 1; i < workers.length; i++) {
      const splitDir = i % 2 === 1 ? "-h" : "-v";
      execSync(
        "tmux split-window -t " + FLEET_SESSION + " " + splitDir,
        { stdio: "pipe", timeout: 3000 },
      );
      execSync(
        "tmux select-layout -t " + FLEET_SESSION + " tiled",
        { stdio: "pipe", timeout: 3000 },
      );

      const panes = execSync(
        "tmux list-panes -t " + FLEET_SESSION + " -F '#{pane_index}'",
        { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8", timeout: 3000 },
      ).trim().split("\n").filter(Boolean);

      const lastPane = panes[panes.length - 1];
      if (lastPane) {
        execSync(
          "tmux send-keys -t " + FLEET_SESSION + "." + lastPane + " 'tmux attach -t " + workers[i] + "' Enter",
          { stdio: "pipe", timeout: 3000 },
        );
      }
    }

    execSync(
      "tmux select-layout -t " + FLEET_SESSION + " tiled",
      { stdio: "pipe", timeout: 3000 },
    );

    return {
      success: true,
      attachCmd: "tmux attach -t " + FLEET_SESSION,
    };
  } catch (e: any) {
    return { success: false, attachCmd: "", error: e.message || String(e) };
  }
}

/**
 * Close the fleet view session/window.
 */
export function closeFleetView(): boolean {
  try {
    execSync("tmux kill-session -t brain-fleet 2>/dev/null", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
