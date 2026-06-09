/**
 * Agent spawning — spawns a pi sub-agent process and collects structured output.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentState, SpawnResult } from "./types.js";
import type { MailSystem } from "./mail.js";

// ─── Sub-agent JSON event types ───────────────────────

interface MessageUpdateEvent {
  type: "message_update";
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
}

interface ToolExecutionStartEvent {
  type: "tool_execution_start";
  toolName: string;
  toolCallId: string;
  args?: string | Record<string, unknown>;
}

interface ToolExecutionEndEvent {
  type: "tool_execution_end";
  toolName: string;
  toolCallId: string;
  isError?: boolean;
}

interface MessageEndEvent {
  type: "message_end";
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
    usage?: { cost?: { total?: number } };
    errorMessage?: string;
    stopReason?: string;
  };
}

type SubAgentEvent = MessageUpdateEvent | ToolExecutionStartEvent | ToolExecutionEndEvent | MessageEndEvent;

/** Parsed arguments from send_mail tool calls intercepted in sub-agent output. */
interface SendMailArgs {
  to?: string;
  subject?: string;
  body?: string;
}

export function spawnAgent(
  cwd: string, agentFile: string, systemPrompt: string, task: string,
  agentKey: string, agentStates: Record<string, AgentState>,
  mailSystem: MailSystem,
  signal?: AbortSignal,
): Promise<SpawnResult> {
  return new Promise(async (resolve) => {
    const args = ["--mode", "json", "-p", "--no-session"];
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-head-"));
    const promptFile = path.join(tmpDir, "prompt.md");
    await fs.writeFile(promptFile, systemPrompt, { mode: 0o600 });
    args.push("--append-system-prompt", promptFile);
    const agentPath = path.join(cwd, ".pi", "agents", agentFile);
    if (fsSync.existsSync(agentPath)) args.push("--append-system-prompt", agentPath);
    args.push(`Task: ${task}`);
    const currentScript = process.argv[1];
    let command: string, cmdArgs: string[];
    if (currentScript && fsSync.existsSync(currentScript)) { command = process.execPath; cmdArgs = [currentScript, ...args]; }
    else { command = "pi"; cmdArgs = args; }
    const result: SpawnResult = { agent: agentFile.replace(".md", ""), exitCode: 0, output: "", error: "", turns: 0, cost: 0 };
    let buffer = "", wasAborted = false;
    const proc = spawn(command, cmdArgs, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PI_SUB_AGENT: "1" } });

    const pendingToolArgs: Record<string, SendMailArgs> = {};

    const processLine = (line: string) => {
      if (!line.trim()) return;
      let event: SubAgentEvent; try { event = JSON.parse(line) as SubAgentEvent; } catch (e) {
        const trimmed = line.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          process.stderr.write("[head-agent] spawnAgent: malformed JSON from sub-agent: " + (e instanceof Error ? e.message : String(e)) + " | line: " + trimmed.slice(0, 200) + "\n");
        }
        return;
      }

      if (event.type === "message_update" && event.message?.role === "assistant") {
        for (const part of event.message.content ?? []) {
          if (part.type === "text" && part.text) {
            agentStates[agentKey].preview = part.text;
          }
        }
      }

      if (event.type === "tool_execution_start" && event.toolName === "send_mail") {
        try {
          const a = typeof event.args === "string" ? JSON.parse(event.args) : event.args;
          if (a?.to) pendingToolArgs[event.toolCallId] = a;
        } catch (e) { process.stderr.write("[head-agent] spawnAgent: failed to parse send_mail args: " + (e instanceof Error ? e.message : String(e)) + "\n"); }
      }

      if (event.type === "tool_execution_end" && event.toolName === "send_mail" && !event.isError) {
        const a = pendingToolArgs[event.toolCallId];
        if (a?.to && a?.subject) {
          mailSystem.sendMail(agentKey, a.to, a.subject, a.body || "");
        }
        delete pendingToolArgs[event.toolCallId];
      }

      // Intercept check_mail calls — sub-agent checks its own local (empty) mailboxes.
      // Actual mail is injected via task context by the delegate tool.
      if (event.type === "tool_execution_start" && event.toolName === "check_mail") {
        try {
          const a = typeof event.args === "string" ? JSON.parse(event.args) : event.args;
          const target = a?.agent || agentKey;
          const unread = mailSystem.getUnread(target);
          if (unread.length > 0) {
            process.stderr.write("[head-agent] spawnAgent: sub-agent " + agentKey + " checked mail for " + target + " (" + unread.length + " unread) — mail context is in task prompt\n");
          }
        } catch (e) { /* ignore parse errors for check_mail args */ }
      }

      if (event.type === "message_end" && event.message?.role === "assistant") {
        const msg = event.message;
        for (const part of msg.content ?? []) {
          if (part.type === "text" && part.text) {
            // Accumulate text across all turns instead of overwriting.
            // The last assistant message may have no text (e.g. tool-result-only),
            // so we must never lose text from earlier messages.
            result.output += (result.output ? "\n" : "") + part.text;
          }
        }
        result.turns++;
        if (msg.usage?.cost?.total) result.cost += msg.usage.cost.total;
        if (msg.errorMessage) result.error = msg.errorMessage;
        if (msg.stopReason === "error" || msg.stopReason === "aborted") result.exitCode = 1;
      }
    };

    proc.stdout.on("data", (data: Buffer) => { buffer += data.toString(); const lines = buffer.split("\n"); buffer = lines.pop() || ""; for (const l of lines) processLine(l); });
    proc.stderr.on("data", (data: Buffer) => { result.error += data.toString(); });
    proc.on("close", async (code) => { if (buffer.trim()) processLine(buffer); result.exitCode = code ?? 0; try { await fs.unlink(promptFile); await fs.rmdir(tmpDir); } catch (e) { process.stderr.write("[head-agent] spawnAgent: cleanup failed: " + (e instanceof Error ? e.message : String(e)) + "\n"); } if (wasAborted) result.error = "Aborted"; resolve(result); });
    proc.on("error", async () => { result.exitCode = 1; try { await fs.unlink(promptFile); await fs.rmdir(tmpDir); } catch {} resolve(result); });
    if (signal) { if (signal.aborted) { wasAborted = true; proc.kill("SIGTERM"); } else signal.addEventListener("abort", () => { wasAborted = true; proc.kill("SIGTERM"); }, { once: true }); }
  });
}
