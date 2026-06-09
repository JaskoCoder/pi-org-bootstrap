/**
 * Register coordination tools — LLM-callable tools for multi-instance management.
 *
 * These tools allow the head agent to:
 * - Claim/release tasks to prevent duplicate work across instances
 * - View active instances and their current tasks
 * - Sync the registry state
 */
import { Type } from "typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  claim,
  release,
  getActive,
} from "./instance-registry.js";

/**
 * Register coordination tools on the pi API.
 * @param pi Extension API
 * @param getCwd Returns current working directory (may change over session lifetime)
 * @param instanceId This instance's unique ID
 */
export function registerCoordinationTools(
  pi: ExtensionAPI,
  getCwd: () => string,
  instanceId: string,
): void {

  // ── Tool: claim_task ──
  pi.registerTool({
    name: "claim_task",
    label: "Claim Task",
    description: "Claim a task to prevent duplicate work by other instances. Returns success/failure.",
    promptSnippet: "Claim a task to prevent duplication across instances",
    promptGuidelines: [
      "Use claim_task before delegating work to prevent duplicate work by other pi instances.",
      "If claim fails (already claimed), inform the user and skip the task.",
      "Always release_task when the delegation is complete.",
    ],
    parameters: Type.Object({
      team: Type.String({ description: "Team name the task is for" }),
      taskDescription: Type.String({ description: "Brief description of the task to claim" }),
    }),
    async execute(_id, params, _sig, _upd, _ctx) {
      const cwd = getCwd();
      // Generate a task key from team + description hash
      const taskKey = `${params.team}:${simpleHash(params.taskDescription)}`;
      const claimed = await claim(cwd, instanceId, taskKey);
      if (claimed) {
        return {
          content: [{ type: "text", text: `Task claimed successfully: ${params.team}/${params.taskDescription.slice(0, 60)}` }],
          details: { taskKey, claimed: true },
        };
      } else {
        return {
          content: [{ type: "text", text: `Task already claimed by another instance: ${params.team}/${params.taskDescription.slice(0, 60)}` }],
          details: { taskKey, claimed: false },
          isError: true,
        };
      }
    },
  });

  // ── Tool: release_task ──
  pi.registerTool({
    name: "release_task",
    label: "Release Task",
    description: "Release a previously claimed task so other instances can pick it up.",
    promptSnippet: "Release a task claim",
    parameters: Type.Object({
      team: Type.String({ description: "Team name the task was for" }),
      taskDescription: Type.String({ description: "Brief description of the task to release" }),
    }),
    async execute(_id, params, _sig, _upd, _ctx) {
      const cwd = getCwd();
      const taskKey = `${params.team}:${simpleHash(params.taskDescription)}`;
      await release(cwd, instanceId, taskKey);
      return {
        content: [{ type: "text", text: `Task released: ${params.team}/${params.taskDescription.slice(0, 60)}` }],
        details: { taskKey },
      };
    },
  });

  // ── Tool: sync_registry ──
  pi.registerTool({
    name: "sync_registry",
    label: "Sync Registry",
    description: "Read the instance registry and show active instances and their tasks.",
    promptSnippet: "Sync and view the instance registry",
    parameters: Type.Object({}),
    async execute(_id, _params, _sig, _upd, _ctx) {
      const cwd = getCwd();
      const active = await getActive(cwd);
      const lines: string[] = [`Active instances: ${active.length}`];
      for (const inst of active) {
        const isMe = inst.instanceId === instanceId;
        const tag = isMe ? " (this instance)" : "";
        const claimsStr = inst.claims.length > 0
          ? inst.claims.map(c => c.replace(/^task:/, "")).join(", ")
          : "no tasks claimed";
        const ago = Math.round((Date.now() - inst.lastHeartbeat) / 1000);
        lines.push(
          `  ${inst.instanceId}${tag} — heartbeat ${ago}s ago — claims: ${claimsStr}`,
        );
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { instanceCount: active.length },
      };
    },
  });

  // ── Tool: get_active_instances ──
  pi.registerTool({
    name: "get_active_instances",
    label: "Get Active Instances",
    description: "Returns list of other active instances with their current tasks.",
    promptSnippet: "List other active pi instances",
    parameters: Type.Object({}),
    async execute(_id, _params, _sig, _upd, _ctx) {
      const cwd = getCwd();
      const active = await getActive(cwd);
      const others = active.filter(i => i.instanceId !== instanceId);
      if (others.length === 0) {
        return {
          content: [{ type: "text", text: "No other active instances found." }],
          details: { otherCount: 0 },
        };
      }
      const summary = others.map(inst => {
        const claimsStr = inst.claims.length > 0
          ? inst.claims.map(c => c.replace(/^task:/, "")).join(", ")
          : "idle";
        const ago = Math.round((Date.now() - inst.lastHeartbeat) / 1000);
        return `${inst.meta.hostname} (pid ${inst.meta.pid}, heartbeat ${ago}s ago): ${claimsStr}`;
      });
      return {
        content: [{ type: "text", text: `Other active instances (${others.length}):\n${summary.join("\n")}` }],
        details: { otherCount: others.length },
      };
    },
  });
}

// ─── Helpers ─────────────────────────────────────────────

/** Simple deterministic hash for task descriptions (not cryptographic). */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
