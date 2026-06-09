/**
 * Agent tools for cron scheduling — register_cron and unregister_cron.
 *
 * These allow the agent (LLM) to autonomously schedule new tasks.
 * Custom tasks fire as agent messages (natural-language action descriptions),
 * not arbitrary code execution.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { CronScheduler } from "./cron-types.js";

export function registerCronTools(pi: ExtensionAPI, scheduler: CronScheduler): void {
  // ── Tool: register_cron ──────────────────────────────

  pi.registerTool({
    name: "register_cron",
    label: "Register Cron Task",
    description:
      "Register a new scheduled task for the pi agent. Use for setting up periodic monitoring, health checks, or maintenance tasks. " +
      "The task fires as a message to the agent with the specified action description — the agent decides how to act on it.",
    promptSnippet: "Register a scheduled recurring task for the agent",
    promptGuidelines: [
      "Use register_cron when the user asks to set up periodic monitoring, recurring checks, or automated maintenance tasks.",
      "Use register_cron when you detect a condition that needs ongoing monitoring (e.g., a growing log file, a flaky endpoint).",
      "register_cron custom tasks send natural-language messages to the agent — they cannot execute arbitrary code.",
    ],
    parameters: Type.Object({
      id: Type.String({
        description: "Unique task identifier (lowercase, hyphens only, e.g. 'check-disk-space')",
      }),
      description: Type.String({
        description: "What this task does",
      }),
      intervalMinutes: Type.Number({
        description: "Run interval in minutes (minimum: 1, maximum: 1440 = 24h)",
      }),
      category: StringEnum(["monitoring", "maintenance", "custom"] as const),
      action: Type.String({
        description:
          "Description of what the agent should do when this task fires. The agent will receive this as a follow-up message. " +
          "Example: 'Check disk usage on / and report if above 90%'",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const taskId = params.id;
      const taskDescription = params.description;
      const intervalMinutes = params.intervalMinutes;
      const taskCategory = params.category;
      const taskAction = params.action;

      // Validate ID format
      if (!/^[a-z][a-z0-9-]*$/.test(taskId)) {
        return {
          content: [{ type: "text" as const, text: `Invalid task ID "${taskId}": must be lowercase with hyphens, start with a letter.` }],
          details: {} as Record<string, unknown>,
          isError: true,
        };
      }

      // Validate interval
      if (intervalMinutes < 1 || intervalMinutes > 1440) {
        return {
          content: [{ type: "text" as const, text: `Interval must be between 1 and 1440 minutes, got ${intervalMinutes}.` }],
          details: {} as Record<string, unknown>,
          isError: true,
        };
      }

      // Check for duplicate
      if (scheduler.getTask(taskId)) {
        return {
          content: [{ type: "text" as const, text: `Task "${taskId}" already exists. Use a different ID or disable/remove the existing one first.` }],
          details: {} as Record<string, unknown>,
          isError: true,
        };
      }

      const validCategories = ["monitoring", "maintenance", "custom"];
      const category = validCategories.includes(taskCategory) ? taskCategory : "custom";

      // Register the task
      scheduler.register({
        id: taskId,
        description: taskDescription,
        intervalMs: intervalMinutes * 60 * 1000,
        enabled: true,
        builtin: false,
        category: category as "monitoring" | "maintenance" | "custom",
      });

      // Store the action template
      scheduler.setTaskAction(taskId, taskAction);

      // Register executor that sends a message to the agent
      scheduler.registerExecutor(taskId, async (_taskCtx) => {
        const currentAction = scheduler.getTaskAction(taskId);
        if (currentAction) {
          try {
            pi.sendUserMessage(
              `[Cron: ${taskId}] Scheduled task triggered. Action: ${currentAction}`,
              { deliverAs: "followUp" },
            );
          } catch {
            // Agent might not be idle, log it
          }
        }
      });

      return {
        content: [{
          type: "text" as const,
          text: `Registered cron task "${taskId}" — runs every ${intervalMinutes} minute(s). Action: ${taskAction}. Use /cron to manage.`,
        }],
        details: {} as Record<string, unknown>,
      };
    },
  });

  // ── Tool: unregister_cron ────────────────────────────

  pi.registerTool({
    name: "unregister_cron",
    label: "Unregister Cron Task",
    description: "Remove a previously registered cron task. Cannot remove built-in tasks.",
    promptSnippet: "Remove a scheduled cron task",
    promptGuidelines: [
      "Use unregister_cron when a periodic task is no longer needed.",
      "Built-in tasks (health-check, log-rotate, session-cleanup, memory-check) cannot be removed — only disabled via /cron disable.",
    ],
    parameters: Type.Object({
      id: Type.String({ description: "Task ID to remove" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const taskId = params.id;
      const removed = scheduler.unregister(taskId);
      if (!removed) {
        return {
          content: [{ type: "text" as const, text: `Task "${taskId}" not found or is a built-in task (cannot remove built-in tasks). Use /cron disable instead.` }],
          details: {} as Record<string, unknown>,
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: `Removed cron task "${taskId}".` }],
        details: {} as Record<string, unknown>,
      };
    },
  });
}
