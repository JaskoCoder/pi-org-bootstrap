/**
 * Register context-related tools and commands — spawn_focused tool + /feed command.
 *
 * spawn_focused: Spawns a focused subagent for scoped tasks with full context bus tracking.
 * /feed: Toggle and filter the context feed widget.
 */
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";
import { TEAM_ORDER } from "./constants.js";
import type { ExtensionSharedContext } from "./extension-context.js";
import { spawnAgent } from "./spawner.js";
import type { ContextEventType } from "./context-bus.js";
import type { FeedWidgetState } from "./context-feed-widget.js";
import { emitEvent } from "./context-bus.js";

// ─── spawn_focused Tool ──────────────────────────────────

export function registerContextTools(
  sctx: ExtensionSharedContext,
  getInstanceId: () => string,
  feedState: FeedWidgetState,
  feedRefresh: () => void,
): void {
  const { pi, agentStates, mailSystem, refresh } = sctx;

  // ── Tool: spawn_focused ──
  pi.registerTool({
    name: "spawn_focused",
    label: "Spawn Focused Subagent",
    description: "Spawn a focused subagent for a scoped task. Inherits parent context, runs in isolation, emits events to context bus.",
    promptSnippet: "Spawn a focused subagent for a scoped task",
    promptGuidelines: [
      "Use spawn_focused when you need a team to handle a well-scoped, isolated task.",
      "The subagent inherits parent context and its results are tracked in the context bus.",
      "Use delegate for standard team delegation; use spawn_focused for targeted, scoped work.",
    ],
    parameters: Type.Object({
      agent: StringEnum([...TEAM_ORDER] as const),
      task: Type.String({ description: "Focused task description" }),
      scope: Type.Optional(Type.String({ description: "File/directory scope for the subagent" })),
      context: Type.Optional(Type.String({ description: "Additional context to inject" })),
      parentTask: Type.Optional(Type.String({ description: "Parent task ID for tracking" })),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      const instanceId = getInstanceId();
      const teamLabel = params.agent;

      // Emit spawn event
      await emitEvent(ctx.cwd, {
        instanceId,
        agent: params.agent,
        type: "subagent.spawned",
        payload: {
          taskDescription: params.task.slice(0, 100),
          scope: params.scope || null,
          parentTask: params.parentTask || null,
        },
        parentTask: params.parentTask,
      });

      // Mark agent state
      const agent = agentStates[params.agent];
      if (agent) {
        agent.status = "working";
        agent.task = params.task.slice(0, 60);
        agent.preview = "";
        agent.startedAt = Date.now();
        agent.sessionTotal++;
      }
      refresh(ctx);

      onUpdate?.({ content: [{ type: "text", text: "Spawning focused subagent: " + teamLabel + "..." }], details: {} });

      // Build task with scope
      let fullTask = "## Focused Task\n" + params.task;
      if (params.scope) fullTask += "\n\n## Scope\nRestrict your work to: " + params.scope;
      if (params.context) fullTask += "\n\n## Additional Context\n" + params.context;

      // Inject unread mail
      const unread = mailSystem.getUnread(params.agent);
      if (unread.length > 0) {
        const mailCtx = unread.map(m => "[" + m.from + "] " + m.subject + ": " + m.body.slice(0, 300)).join("\n");
        fullTask += "\n\n## Your Unread Mail\n" + mailCtx;
      }

      const systemPrompt = "You are a focused subagent for the " + params.agent + " team. Execute the assigned task precisely and autonomously. Report clear results.\n\n## Constraints\n- Work ONLY within the specified scope\n- Do NOT modify files outside the scope\n- Provide a clear summary of changes made";

      const result = await spawnAgent(
        ctx.cwd, teamLabel + ".md", systemPrompt, fullTask,
        params.agent, agentStates, mailSystem, signal,
      );

      // Mark mail as read
      mailSystem.markRead(params.agent);

      // Update agent state
      if (agent) {
        agent.status = "done";
        agent.lastDuration = agent.startedAt ? Date.now() - agent.startedAt : null;
        agent.preview = "";
        const outputLines = result.output.split("\n").filter(l => l.trim());
        agent.snippet = (outputLines[0] || "").slice(0, 22);
        if (result.exitCode === 0) agent.sessionOk++;
        agent.sessionCost += result.cost;
        agent.startedAt = null;
      }

      // Emit complete event
      await emitEvent(ctx.cwd, {
        instanceId,
        agent: params.agent,
        type: "subagent.completed",
        payload: {
          taskDescription: params.task.slice(0, 100),
          exitCode: result.exitCode,
          cost: result.cost,
          turns: result.turns,
          status: result.exitCode === 0 ? "success" : "error",
          outputPreview: result.output.slice(0, 200),
        },
        parentTask: params.parentTask,
      });

      refresh(ctx);

      const icon = result.exitCode === 0 ? "+" : "x";
      return {
        content: [{
          type: "text",
          text: "[" + icon + "] Focused subagent " + teamLabel + " done!\n\n" +
            (result.output || "(no output)") +
            (result.error ? "\n\n! " + result.error.slice(0, 300) : "") +
            (result.cost > 0 ? "\nCost: $" + result.cost.toFixed(4) : ""),
        }],
        details: {
          team: params.agent,
          exitCode: result.exitCode,
          cost: result.cost,
          focused: true,
        },
        isError: result.exitCode !== 0,
      };
    },
  });

  // ── Command: /feed ──
  pi.registerCommand("feed", {
    description: "Toggle context feed widget visibility or filter events",
    getArgumentCompletions(prefix: string) {
      const options = [
        { value: "agent:backend-team", label: "agent:backend-team", description: "Filter: backend events" },
        { value: "agent:frontend-team", label: "agent:frontend-team", description: "Filter: frontend events" },
        { value: "agent:tech-lead", label: "agent:tech-lead", description: "Filter: tech lead events" },
        { value: "type:delegation.started", label: "type:delegation.started", description: "Filter: delegation start events" },
        { value: "type:delegation.completed", label: "type:delegation.completed", description: "Filter: delegation complete events" },
        { value: "type:mail.sent", label: "type:mail.sent", description: "Filter: mail sent events" },
        { value: "type:mail.read", label: "type:mail.read", description: "Filter: mail read events" },
        { value: "type:task.claimed", label: "type:task.claimed", description: "Filter: task claimed events" },
        { value: "type:task.released", label: "type:task.released", description: "Filter: task released events" },
        { value: "type:memory.updated", label: "type:memory.updated", description: "Filter: memory updated events" },
        { value: "type:state.changed", label: "type:state.changed", description: "Filter: state change events" },
        { value: "type:debug_cycle", label: "type:debug_cycle", description: "Filter: debug cycle events" },
        { value: "type:cron_fire", label: "type:cron_fire", description: "Filter: cron events" },
        { value: "type:subagent.spawned", label: "type:subagent.spawned", description: "Filter: subagent spawns" },
        { value: "type:subagent.completed", label: "type:subagent.completed", description: "Filter: subagent completions" },
        { value: "clear", label: "clear", description: "Clear all filters" },
      ];
      return options.filter(o => o.value.startsWith(prefix));
    },
    handler: async (args, ctx) => {
      const arg = (args || "").trim();

      if (!arg) {
        // Toggle visibility
        feedState.visible = !feedState.visible;
        feedRefresh();
        ctx.ui.notify(
          "Context Feed: " + (feedState.visible ? "visible" : "hidden"),
          feedState.visible ? "info" : "warning",
        );
        return;
      }

      if (arg === "clear") {
        feedState.filter = {};
        feedState.visible = true;
        feedRefresh();
        ctx.ui.notify("Context Feed: filters cleared", "info");
        return;
      }

      // Parse filter arguments: "agent:backend-team", "type:mail", "instance:CometCorgi"
      const parts = arg.split(",");
      for (const part of parts) {
        const trimmed = part.trim();
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx === -1) continue;
        const key = trimmed.slice(0, colonIdx);
        const value = trimmed.slice(colonIdx + 1);

        if (key === "agent") {
          feedState.filter.agent = value;
        } else if (key === "type") {
          feedState.filter.type = value as ContextEventType;
        } else if (key === "instance") {
          // Match partial instance ID — will be resolved in widget render
          feedState.filter.instanceId = value;
        }
      }

      feedState.visible = true;
      feedRefresh();
      const filterDesc = Object.entries(feedState.filter)
        .map(([k, v]) => k + ":" + v)
        .join(", ");
      ctx.ui.notify("Context Feed: filtering by " + filterDesc, "info");
    },
  });
}
