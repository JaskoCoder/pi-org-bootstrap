/**
 * Extension tool registration — delegate, delegate_parallel, send_mail,
 * check_mail, pipeline_status, pipeline_run, sprint_plan, update_agent_memory.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";
import type { AgentState, PipelineState } from "./types.js";
import { MEMORY_MANDATE, TEAMS, TEAM_ORDER } from "./constants.js";
import { ad, rj, wj, readFileToString } from "./helpers.js";

/** Shortcut: read pipeline state with proper typing. */
const readPipelineState = (dir: string) => rj<PipelineState>(path.join(dir, "pipeline", "state.json"));

/** Validate agent name to prevent path traversal. Returns sanitized name or throws. */
function safeAgentName(name: string): string {
  // Only allow lowercase alphanumeric, hyphens, and underscores
  if (!/^[a-z0-9_-]+$/.test(name)) {
    throw new Error("Invalid agent name: must contain only lowercase letters, numbers, hyphens, and underscores");
  }
  // Double-check resolved path stays within agent-memory directory
  return name;
}
import { spawnAgent } from "./spawner.js";
import type { ExtensionSharedContext } from "./extension-context.js";

/** Append a task completion entry to the agent's memory file. */
async function appendMemoryEntry(cwd: string, teamName: string, taskDesc: string, output: string): Promise<void> {
  const memFile = path.join(ad(cwd), "agent-memory", teamName + ".md");
  await fs.mkdir(path.dirname(memFile), { recursive: true });
  const ts = new Date().toISOString().split("T")[0];
  const summaryLines = output.split("\n").filter(l => l.trim()).slice(-3);
  const summary = summaryLines.join(" | ");
  const entry = "\n[" + ts + "] Task: " + taskDesc.slice(0, 80) + " → " + summary.slice(0, 200);
  await fs.appendFile(memFile, entry);
}

export function registerTools(sctx: ExtensionSharedContext, getInstanceId?: () => string): void {
  const { pi, agentStates, mailSystem, refresh, scheduleAgentIdle, clearAgentIdle, emitBusEvent } = sctx;

  // ── Tool: delegate ──
  pi.registerTool({
    name: "delegate",
    label: "Delegate to Team",
    description: "Delegate a task to a team agent. Spawns isolated subagent, returns result.",
    promptSnippet: "Delegate a task to a team agent",
    promptGuidelines: [
      "Use delegate for any task that should be handled by a specialized team.",
      "For cross-team work, delegate sequentially with context from previous output.",
      "After delegating, check if the team has unread mail using check_mail — they may have context from other agents.",
      "Use send_mail to pass important context to teams before or after delegation.",
    ],
    parameters: Type.Object({
      team: StringEnum([...TEAM_ORDER] as const),
      task: Type.String({ description: "Clear task description" }),
      context: Type.Optional(Type.String({ description: "Context from previous work" })),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      const team = TEAMS[params.team];
      if (!team) return { content: [{ type: "text", text: "Unknown team. Available: " + Object.keys(TEAMS).join(", ") }], details: {}, isError: true };

      const agent = agentStates[params.team];

      let delegationStatus: AgentState["status"] = "working";
      if (params.team.includes("review")) delegationStatus = "reviewing";
      else if (params.team.includes("security") || params.team.includes("sec")) delegationStatus = "scanning";
      else if ((params.team.includes("infra") || params.team.includes("devops") || params.team.includes("ops")) && params.task.toLowerCase().includes("deploy")) delegationStatus = "deploying";

      clearAgentIdle(params.team);
      agent.status = delegationStatus;
      agent.task = params.task;
      agent.snippet = null;
      agent.preview = "";
      agent.startedAt = Date.now();
      agent.sessionTotal++;
      refresh(ctx);

      // Context bus: delegation.started event
      emitBusEvent?.(ctx.cwd, "delegation.started", params.team, { taskDescription: params.task.slice(0, 100) }).catch(() => {});

      let fullTask = params.task;
      if (params.context) fullTask = "## Context\n" + params.context + "\n\n## Task\n" + params.task;

      const unread = mailSystem.getUnread(params.team);
      if (unread.length > 0) {
        const mailContext = unread.map(m => "[" + m.from + "] " + m.subject + ": " + m.body.slice(0, 300)).join("\n");
        fullTask += "\n\n## Your Unread Mail\n" + mailContext;
      }

      const memoryName = params.team;
      const memory = await readFileToString(path.join(ad(ctx.cwd), "agent-memory", memoryName + ".md"));
      const memSnippet = memory ? "\n\n## Your Memory\n" + memory.slice(0, 1500) : "";
      const pState = await readPipelineState(ad(ctx.cwd));
      const stateSnippet = pState ? "\n\n## Pipeline\nSprint #" + (pState.currentSprint?.number || "?") + ". Status: " + JSON.stringify(pState.teams?.[params.team] || {}) : "";

      onUpdate?.({ content: [{ type: "text", text: "Delegating to " + team.label + "..." }], details: {} });

      // ── Multi-instance task claiming ──
      const iid = getInstanceId?.() || "";
      let taskKey = "";
      let hadClaim = false;
      if (iid) {
        const { claim: regClaim } = await import("./instance-registry.js");
        taskKey = `${params.team}:${simpleDelegateHash(params.task)}`;
        const claimed = await regClaim(ctx.cwd, iid, taskKey);
        if (!claimed) {
          agent.status = "idle";
          agent.task = null;
          agent.startedAt = null;
          refresh(ctx);
          return {
            content: [{ type: "text", text: `Task "${params.task.slice(0, 60)}" is already being handled by another pi instance. Skip it or wait for it to complete.` }],
            details: { claimed: false },
            isError: true,
          };
        }
        hadClaim = true;
        // Context bus: task.claimed event
        emitBusEvent?.(ctx.cwd, "task.claimed", params.team, { taskDescription: params.task.slice(0, 100), team: params.team }).catch(() => {});
      }

      const systemPrompt = "You are the " + params.team + " agent. Scope: " + team.scope + ". " + team.desc + ". Work autonomously and report clearly.\n\n## Inter-Agent Communication\nYou can send messages to other agents using send_mail(to, subject, body). Available recipients: " + TEAM_ORDER.filter(t => t !== params.team).join(", ") + ", all.\nYour unread mail from other agents is included in your task context above — read it before starting work.\nUse send_mail to coordinate handoffs, share findings, or notify the next agent in a pipeline.\n\n## ⚠️ GitHub Workflow (MANDATORY)\nAll code changes MUST go through GitHub Issues and PRs:\n1. Create a branch: git checkout -b {type}/issue-{N}-{description}\n2. Make your changes\n3. Pre-flight checks (typecheck, lint, test)\n4. Commit: git commit -m \"type(scope): description closes #N\"\n5. Push: git push -u origin {branch}\n6. Open PR: gh pr create --title \"type(scope): description\" --body \"Closes #N\" --label \"team:" + params.team + "\"\n\nNEVER push directly to main. Always use branches and PRs.\n\n" + MEMORY_MANDATE.replace(/\{team\}/g, params.team) + memSnippet + stateSnippet;
      const result = await spawnAgent(ctx.cwd, team.file, systemPrompt, fullTask, params.team, agentStates, mailSystem, signal);

      // Mark injected mail as read now that the agent has consumed it
      mailSystem.markRead(params.team);

      agent.status = "done";
      agent.lastDuration = agent.startedAt ? Date.now() - agent.startedAt : null;
      agent.preview = "";
      const outputLines = result.output.split("\n").filter(l => l.trim());
      agent.snippet = outputLines[0] || null;
      if (agent.snippet && agent.snippet.length > 22) agent.snippet = agent.snippet.slice(0, 19) + "...";
      if (result.exitCode === 0) agent.sessionOk++;
      if (result.exitCode === 0) {
        await appendMemoryEntry(ctx.cwd, params.team, params.task, result.output);
      }
      agent.sessionCost += result.cost;
      agent.startedAt = null;

      scheduleAgentIdle(params.team);

      // Context bus: delegation.completed event
      emitBusEvent?.(ctx.cwd, "delegation.completed", params.team, {
        taskDescription: params.task.slice(0, 100),
        exitCode: result.exitCode,
        cost: result.cost,
        duration: agent.lastDuration,
      }).catch(() => {});

      // ── Release task claim after delegation ──
      if (hadClaim && taskKey && iid) {
        try {
          const { release: regRelease } = await import("./instance-registry.js");
          await regRelease(ctx.cwd, iid, taskKey);
          // Context bus: task.released event
          emitBusEvent?.(ctx.cwd, "task.released", params.team, { taskDescription: params.task.slice(0, 100), team: params.team }).catch(() => {});
        } catch {
          // Best-effort release
        }
      }

      if (pState) {
        if (!pState.teams) pState.teams = {};
        const teamState = pState.teams[params.team];
        if (!teamState) pState.teams[params.team] = { currentTask: null, status: "idle", completedThisSprint: 0 };
        const ts = pState.teams[params.team]!;
        if (result.exitCode === 0) {
          ts.currentTask = null;
          ts.status = "idle";
          ts.completedThisSprint = (ts.completedThisSprint || 0) + 1;
        }
        pState.lastUpdated = new Date().toISOString();
        await wj(path.join(ad(ctx.cwd), "pipeline", "state.json"), pState);
      }

      refresh(ctx);

      const icon = result.exitCode === 0 ? "+" : "x";
      const usage = result.cost > 0 ? " | $" + result.cost.toFixed(4) : "";
      return {
        content: [{ type: "text", text: "[" + icon + "] " + team.label + " done!\n\n" + (result.output || "(no output)") + (result.error ? "\n\n! " + result.error.slice(0, 300) : "") + usage }],
        details: { team: params.team, exitCode: result.exitCode, cost: result.cost },
        isError: result.exitCode !== 0,
      };
    },
  });

  // ── Tool: delegate_parallel ──
  const DelegationItem = Type.Object({
    team: StringEnum([...TEAM_ORDER] as const),
    task: Type.String(),
  });

  pi.registerTool({
    name: "delegate_parallel",
    label: "Delegate Parallel",
    description: "Send independent tasks to multiple teams at once. Max 4.",
    promptSnippet: "Delegate to multiple teams simultaneously",
    parameters: Type.Object({ tasks: Type.Array(DelegationItem) }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (params.tasks.length > 4) return { content: [{ type: "text", text: "Max 4 parallel tasks." }], details: {}, isError: true };

      for (const t of params.tasks) {
        const agent = agentStates[t.team];
        clearAgentIdle(t.team);
        agent.status = t.team.includes("review") ? "reviewing" : (t.team.includes("security") || t.team.includes("sec")) ? "scanning" : "working";
        agent.task = t.task;
        agent.preview = "";
        agent.startedAt = Date.now();
        agent.sessionTotal++;
      }
      refresh(ctx);

      const spawnResults: { team: string; spawnResult: import("./types.js").SpawnResult }[] = [];
      await Promise.all(params.tasks.map(async (item) => {
        const team = TEAMS[item.team];
        if (!team) { spawnResults.push({ team: item.team, spawnResult: { agent: item.team, exitCode: 1, output: "", error: "Unknown team", turns: 0, cost: 0 } }); return; }
        const memP = await readFileToString(path.join(ad(ctx.cwd), "agent-memory", item.team + ".md"));
        const memSnippetP = memP ? "\n\n## Your Memory\n" + memP.slice(0, 1500) : "";
        let itemTask = item.task;
        const itemUnread = mailSystem.getUnread(item.team);
        if (itemUnread.length > 0) {
          const mailCtx = itemUnread.map(m => "[" + m.from + "] " + m.subject + ": " + m.body.slice(0, 300)).join("\n");
          itemTask += "\n\n## Your Unread Mail\n" + mailCtx;
        }
        const sp = "You are the " + item.team + " agent. Scope: " + team.scope + ". " + team.desc + ". Work autonomously.\n\n## Inter-Agent Communication\nYou can send messages to other agents using send_mail(to, subject, body). Available recipients: " + TEAM_ORDER.filter(t => t !== item.team).join(", ") + ", all.\nYour unread mail from other agents is included in your task context above — read it before starting work.\nUse send_mail to coordinate handoffs, share findings, or notify the next agent in a pipeline.\n\n## ⚠️ GitHub Workflow (MANDATORY)\nAll code changes MUST go through GitHub Issues and PRs:\n1. Create a branch: git checkout -b {type}/issue-{N}-{description}\n2. Make your changes\n3. Pre-flight checks (typecheck, lint, test)\n4. Commit: git commit -m \"type(scope): description closes #N\"\n5. Push: git push -u origin {branch}\n6. Open PR: gh pr create --title \"type(scope): description\" --body \"Closes #N\" --label \"team:" + item.team + "\"\n\nNEVER push directly to main. Always use branches and PRs.\n\n" + MEMORY_MANDATE.replace(/\{team\}/g, item.team) + memSnippetP;
        const r = await spawnAgent(ctx.cwd, team.file, sp, itemTask, item.team, agentStates, mailSystem, signal);
        // Mark injected mail as read now that the agent has consumed it
        mailSystem.markRead(item.team);
        spawnResults.push({ team: item.team, spawnResult: r });
      }));

      const results: { team: string; output: string; error: string; exitCode: number }[] = [];
      for (const { team: teamKey, spawnResult: r } of spawnResults) {
        results.push({ team: teamKey, output: r.output, error: r.error, exitCode: r.exitCode });

        const agent = agentStates[teamKey];

        if (r.exitCode === 0) {
          const taskDesc = params.tasks.find(t => t.team === teamKey)?.task || "";
          await appendMemoryEntry(ctx.cwd, teamKey, taskDesc, r.output);
        }

        agent.status = "done";
        agent.lastDuration = agent.startedAt ? Date.now() - agent.startedAt : null;
        agent.preview = "";
        agent.snippet = r.output.split("\n").filter((l: string) => l.trim())[0]?.slice(0, 22) || null;
        if (r.exitCode === 0) agent.sessionOk++;
        agent.sessionCost += r.cost;
        agent.startedAt = null;
        scheduleAgentIdle(teamKey);
      }

      const pState = await readPipelineState(ad(ctx.cwd));
      if (pState) {
        if (!pState.teams) pState.teams = {};
        for (const r of results) {
          if (!pState.teams[r.team]) pState.teams[r.team] = { currentTask: null, status: "idle", completedThisSprint: 0 };
          const ts = pState.teams[r.team]!;
          if (r.exitCode === 0) {
            ts.currentTask = null;
            ts.status = "idle";
            ts.completedThisSprint = (ts.completedThisSprint || 0) + 1;
          }
        }
        pState.lastUpdated = new Date().toISOString();
        await wj(path.join(ad(ctx.cwd), "pipeline", "state.json"), pState);
      }

      refresh(ctx);

      const ok = results.filter(r => r.exitCode === 0).length;
      const summary = results.map(r => "[" + (r.exitCode === 0 ? "+" : "x") + "] " + (TEAMS[r.team]?.label || r.team) + ": " + r.output.slice(0, 150)).join("\n\n");
      return { content: [{ type: "text", text: "Parallel: " + ok + "/" + results.length + " ok\n\n" + summary }], details: {} };
    },
  });

  // ── Tool: send_mail ──
  pi.registerTool({
    name: "send_mail",
    label: "Send Mail",
    description: "Send a message to another agent or all agents. The recipient will see it when they are next delegated a task, or when they call check_mail. Messages appear in the dashboard widget.",
    promptSnippet: "Send a message to another agent",
    promptGuidelines: [
      "Use send_mail to pass context, handoffs, or coordination messages between agents.",
      "When a sub-agent finishes, use send_mail to notify the next agent in the pipeline.",
      "Use 'all' as recipient to broadcast important updates.",
    ],
    parameters: Type.Object({
      to: StringEnum([...TEAM_ORDER, "all"] as const),
      subject: Type.String({ description: "Brief subject line" }),
      body: Type.String({ description: "Message content" }),
    }),
    async execute(_id, params, _sig, _upd, ctx) {
      const from = "head-agent";
      mailSystem.sendMail(from, params.to, params.subject, params.body);
      // Context bus: mail.sent event
      emitBusEvent?.(ctx.cwd, "mail.sent", from, { to: params.to, subject: params.subject, bodyPreview: params.body.slice(0, 100) }).catch(() => {});
      refresh(ctx);
      const toLabel = params.to === "all" ? "all agents" : (TEAMS[params.to]?.label || params.to);
      return { content: [{ type: "text", text: "Mail sent to " + toLabel + ": " + params.subject }], details: {} };
    },
  });

  // ── Tool: check_mail ──
  pi.registerTool({
    name: "check_mail",
    label: "Check Mail",
    description: "Check unread mail for an agent. Returns messages sent by other agents.",
    promptSnippet: "Check an agent's unread mail",
    promptGuidelines: [
      "Check mail before delegating to a team — they may have important context from other agents.",
      "After delegating, the team's unread mail is automatically included in their task context.",
    ],
    parameters: Type.Object({
      agent: Type.String({ description: "Agent name to check mail for" }),
    }),
    async execute(_id, params, _sig, _upd, _ctx) {
      const unread = mailSystem.getUnread(params.agent);
      if (!unread.length) return { content: [{ type: "text", text: "No unread mail for " + params.agent }], details: {} };
      // Context bus: mail.read event
      emitBusEvent?.(_ctx.cwd, "mail.read", params.agent, { agent: params.agent, count: unread.length }).catch(() => {});
      const summary = unread.map(m => {
        const from = TEAMS[m.from]?.label || m.from;
        return "[" + from + "] " + m.subject + ": " + m.body.slice(0, 200);
      }).join("\n");
      return { content: [{ type: "text", text: "Unread mail for " + params.agent + " (" + unread.length + "):\n" + summary }], details: {} };
    },
  });

  // ── Tool: pipeline_status ──
  pi.registerTool({
    name: "pipeline_status", label: "Pipeline Status", description: "Check org state.", promptSnippet: "Check pipeline status",
    parameters: Type.Object({ section: Type.Optional(StringEnum(["all", "sprint", "teams", "bugs", "pipeline"] as const)) }),
    async execute(_id, params, _sig, _upd, ctx) {
      const state = await readPipelineState(ad(ctx.cwd));
      if (!state) return { content: [{ type: "text", text: "No state found." }], details: {} };
      const s = params.section || "all";
      const l: string[] = [];
      if (s === "all" || s === "sprint") { const sp = state.currentSprint || {}; l.push("Sprint #" + (sp.number || "?") + ": " + (sp.name || "none") + " [" + (sp.status || "?") + "]"); }
      if (s === "all" || s === "teams") { l.push("Teams:"); for (const n of TEAM_ORDER) { const t: Partial<import("./types.js").PipelineTeamState> = state.teams?.[n] || {}; const a = agentStates[n]; l.push("  " + (TEAMS[n]?.label || n) + ": " + (a.status !== "idle" ? a.status : t.status || "idle") + " | " + (t.currentTask || "no task") + " | ses: " + a.sessionOk + "/" + a.sessionTotal); } }
      if (s === "all" || s === "bugs") { const t = state.triage || {}; l.push("Bugs: " + (t.open || []).length + " open, " + (t.inProgress || []).length + " active"); }
      if (s === "all" || s === "pipeline") { const p = state.pipeline || {}; l.push("Pipeline: " + (p.lastRunStatus || "never")); }
      if (s === "all") {
        const st = state.stats || {};
        l.push("Reported: " + (st.totalBugsReported || 0) + " | Resolved: " + (st.totalBugsResolved || 0) + " | Deploys: " + (st.totalDeployments || 0));
        for (const n of TEAM_ORDER) {
          const unread = mailSystem.getUnread(n);
          if (unread.length > 0) l.push("Mail " + (TEAMS[n]?.label || n) + ": " + unread.length + " unread");
        }
      }
      return { content: [{ type: "text", text: l.join("\n") }], details: {} };
    },
  });

  // ── Tool: pipeline_run ──
  pi.registerTool({
    name: "pipeline_run", label: "Run Pipeline", description: "Run CI/CD stages.", promptSnippet: "Run pipeline",
    parameters: Type.Object({ stage: StringEnum(["lint", "test", "build", "full"] as const) }),
    async execute(_id, params, _sig, _upd, ctx) {
      const { execFileSync } = await import("node:child_process");
      const ALLOWED_COMMANDS: Record<string, readonly string[]> = {
        lint:   ["npx", "tsc", "--noEmit"],
        test:   ["npm", "test"],
        build:  ["npm", "run", "build"],
      } as const;
      const run = (cwd: string, key: keyof typeof ALLOWED_COMMANDS) => {
        const cmd = ALLOWED_COMMANDS[key];
        if (!cmd) return "x Unknown command key";
        try {
          execFileSync(cmd[0], cmd.slice(1), { cwd: path.resolve(ctx.cwd, cwd), timeout: 120000, stdio: "pipe" });
          return "+ pass";
        } catch (e: unknown) {
          const msg = e instanceof Error ? (e as Error & { stderr?: Buffer }).stderr?.toString() || e.message : String(e);
          return "x " + msg.split("\n").slice(-3).join("\n");
        }
      };
      // Find the infrastructure/ops team for pipeline status display
      const pipelineTeam = TEAM_ORDER.find(n => n.includes("infra") || n.includes("devops") || n.includes("ops")) || TEAM_ORDER[0];
      if (agentStates[pipelineTeam]) {
        agentStates[pipelineTeam].status = "deploying";
        agentStates[pipelineTeam].task = "Pipeline: " + params.stage;
        agentStates[pipelineTeam].preview = "";
        agentStates[pipelineTeam].startedAt = Date.now();
        clearAgentIdle(pipelineTeam);
      }
      refresh(ctx);
      const l: string[] = []; let ok = true;
      if (params.stage === "lint" || params.stage === "full") { l.push("Lint:"); const r = run(".", "lint"); l.push("  " + r); if (r.includes("x ")) ok = false; }
      if (ok && (params.stage === "test" || params.stage === "full")) { l.push("Tests:"); const r = run(".", "test"); l.push("  " + r); if (r.includes("x ")) ok = false; }
      if (ok && (params.stage === "build" || params.stage === "full")) { l.push("Build:"); const r = run(".", "build"); l.push("  " + r); if (r.includes("x ")) ok = false; }
      if (agentStates[pipelineTeam]) {
        agentStates[pipelineTeam].status = "done";
        agentStates[pipelineTeam].lastDuration = agentStates[pipelineTeam].startedAt ? Date.now() - agentStates[pipelineTeam].startedAt : null;
        agentStates[pipelineTeam].startedAt = null;
        agentStates[pipelineTeam].preview = "";
        agentStates[pipelineTeam].snippet = ok ? "All checks passed" : "Some checks failed";
        scheduleAgentIdle(pipelineTeam);
      }
      // Context bus: pipeline_event
      emitBusEvent?.(ctx.cwd, "pipeline_event", pipelineTeam, { stage: params.stage, status: ok ? "success" : "failed" }).catch(() => {});
      const state = (await readPipelineState(ad(ctx.cwd)) ?? {}) as PipelineState;
      state.pipeline = state.pipeline || {}; state.pipeline.lastRun = new Date().toISOString(); state.pipeline.lastRunStatus = ok ? "success" : "failed"; state.lastUpdated = new Date().toISOString();
      await wj(path.join(ad(ctx.cwd), "pipeline", "state.json"), state);
      refresh(ctx);
      return { content: [{ type: "text", text: "Pipeline " + (ok ? "[+] passed" : "[x] failed") + "\n\n" + l.join("\n") }], details: {} };
    },
  });

  // ── Tool: sprint_plan ──
  pi.registerTool({
    name: "sprint_plan", label: "Plan Sprint", description: "Plan a sprint.", promptSnippet: "Plan a sprint",
    parameters: Type.Object({ name: Type.String(), goals: Type.Array(Type.String()), assignments: Type.Array(Type.Object({ team: Type.String(), tasks: Type.Array(Type.String()) })) }),
    async execute(_id, params, _sig, _upd, ctx) {
      const dir = ad(ctx.cwd); const state = (await readPipelineState(dir) ?? {}) as PipelineState;
      const num = (state.currentSprint?.number || 0) + 1;
      state.currentSprint = { number: num, name: params.name, startDate: new Date().toISOString().split("T")[0], endDate: new Date(Date.now() + 604800000).toISOString().split("T")[0], status: "active", goals: params.goals };
      for (const a of params.assignments) { if (!state.teams) state.teams = {}; state.teams[a.team] = { currentTask: a.tasks.join(", "), status: "assigned", completedThisSprint: 0 }; }
      state.lastUpdated = new Date().toISOString();
      await wj(path.join(dir, "pipeline", "state.json"), state);
      refresh(ctx);
      // Context bus: pipeline_event
      emitBusEvent?.(ctx.cwd, "pipeline_event", "head-agent", { stage: "sprint_plan", status: "success", sprintNumber: num, sprintName: params.name }).catch(() => {});
      return { content: [{ type: "text", text: "[+] Sprint #" + num + ": " + params.name + "\n" + params.goals.map(g => "- " + g).join("\n") }], details: {} };
    },
  });

  // ── Tool: update_agent_memory ──
  pi.registerTool({
    name: "update_agent_memory", label: "Update Memory", description: "Save to agent memory.", promptSnippet: "Save agent memory",
    parameters: Type.Object({ agent: Type.String(), content: Type.String() }),
    async execute(_id, params, _sig, _upd, ctx) {
      const safeName = safeAgentName(params.agent);
      const memoryDir = path.join(ad(ctx.cwd), "agent-memory");
      const f = path.join(memoryDir, safeName + ".md");
      // Verify resolved path is still within agent-memory (defense in depth)
      const resolved = path.resolve(f);
      if (!resolved.startsWith(path.resolve(memoryDir) + path.sep)) {
        return { content: [{ type: "text", text: "Invalid agent name: path traversal detected" }], details: {}, isError: true };
      }
      await fs.mkdir(path.dirname(f), { recursive: true });
      await fs.writeFile(f, await readFileToString(f) + "\n\n" + params.content);
      // Context bus: memory.updated event
      emitBusEvent?.(ctx.cwd, "memory.updated", safeName, { agent: safeName, summary: params.content.slice(0, 100) }).catch(() => {});
      return { content: [{ type: "text", text: "Memory updated: " + safeName }], details: {} };
    },
  });
}

// ─── Helpers ─────────────────────────────────────────────

/** Simple deterministic hash for task deduplication. */
function simpleDelegateHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
