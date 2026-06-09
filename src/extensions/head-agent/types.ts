/**
 * Shared types for the Head Agent extension.
 */

// ─── Team Definitions ─────────────────────────────────────

export interface TeamDef {
  file: string;
  label: string;
  color: string;
  scope: string;
  desc: string;
}

// ─── Per-Agent State ──────────────────────────────────────

export interface AgentState {
  status: "idle" | "working" | "reviewing" | "scanning" | "deploying" | "done";
  task: string | null;
  snippet: string | null;
  preview: string;
  startedAt: number | null;
  lastDuration: number | null;
  sessionTotal: number;
  sessionOk: number;
  sessionCost: number;
  statusTimeout: ReturnType<typeof setTimeout> | null;
}

// ─── Mail System ──────────────────────────────────────────

export interface MailMessage {
  id: number;
  from: string;
  to: string;          // agent name or "all"
  subject: string;
  body: string;
  timestamp: number;
  read: boolean;
}

// ─── Autonomous Debug Loop State Machine ──────────────────

export type DebugPhase =
  | "idle" | "running" | "initializing" | "scanning" | "triaging" | "fixing"
  | "testing" | "user-simulating" | "reviewing" | "reflecting"
  | "sleeping" | "paused" | "completed" | "error";

export interface DebugObjective {
  id: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  status: "pending" | "in-progress" | "completed" | "abandoned";
  createdAt: string;
  completedAt: string | null;
  relatedFindings: string[];
  source: "scan" | "test" | "user-sim" | "wiki" | "manual";
}

export interface DebugMemoryEntry {
  timestamp: string;
  phase: DebugPhase;
  summary: string;
  findings: number;
  fixes: number;
  tests: number;
  errors: number;
  cost: number;
}

export interface DebugKnownFinding {
  hash: string;
  description: string;
  severity: string;
  issueNumber: string | null;
  status: "new" | "filed" | "fixing" | "resolved" | "wontfix" | "failed";
  firstSeen: string;
  lastSeen: string;
  failCount: number;
  cooldownUntil: number;
}

export interface ScopeStats {
  lastScannedAt: string | null;
  findingsCount: number;
  consecutiveEmptyScans: number;
}

export interface AutonomousDebugState {
  id: string;
  status: DebugPhase;
  startedAt: string;
  lastPhaseAt: string;
  totalCycles: number;
  totalRuntime: number;
  objectives: DebugObjective[];
  currentObjectiveId: string | null;
  objectiveReviewCycle: number;
  lastObjectiveReviewAt: string | null;
  recentMemory: DebugMemoryEntry[];
  compressedSummary: string | null;
  knownFindings: Record<string, DebugKnownFinding>;
  scopeIndex: number;
  scopeHistory: Record<string, ScopeStats>;
  fixQueue: string[];
  fixesThisCycle: number;
  maxFixesPerCycle: number;
  lastTestRun: string | null;
  testFailures: string[];
  consecutiveErrors: number;
  maxConsecutiveErrors: number;
  backoffUntil: string | null;
  deadLoopFindings: string[];
  consecutiveEmptyCycles?: number;
  maxCycles: number;
  maxCost: number;
  maxRuntimeMs: number;
  sleepBetweenCycles: number;
  totalCost: number;
  contextBudget: {
    l1Wiki: number;
    l2AgentMemory: number;
    l3RecentMemory: number;
    l3Summary: number;
    iterationPrompt: number;
  };
  scopeFilter: string;
  errors: string[];
}

// ─── Spawner ──────────────────────────────────────────────

export interface SpawnResult {
  agent: string;
  exitCode: number;
  output: string;
  error: string;
  turns: number;
  cost: number;
}

// ─── Extension closure dependencies ───────────────────────

// ─── Pipeline State ──────────────────────────────────────

export interface PipelineTeamState {
  currentTask: string | null;
  status: string;
  completedThisSprint: number;
}

export interface PipelineState {
  currentSprint?: {
    number?: number;
    name?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    goals?: string[];
  };
  teams?: Partial<Record<string, PipelineTeamState>>;
  triage?: {
    open?: unknown[];
    inProgress?: unknown[];
  };
  stats?: {
    totalBugsResolved?: number;
    totalBugsReported?: number;
    totalDeployments?: number;
  };
  pipeline?: {
    lastRun?: string;
    lastRunStatus?: string;
  };
  lastUpdated?: string;
}

/** Interface for the mutable state that modules closing over the extension need. */
export interface ExtensionState {
  agentStates: Record<string, AgentState>;
  mailboxes: Record<string, MailMessage[]>;
  globalInbox: MailMessage[];
  mailCounter: number;
  headAgentPreview: string;
  headAgentActive: boolean;
  metaMode: boolean;
  debugAbortController: AbortController | null;
  cronScheduler: import("./cron-types.js").CronScheduler | null;
  /** Context bus event emitter — set during session_start */
  emitBusEvent?: (cwd: string, type: import("./context-bus.js").ContextEventType, agent: string, payload: Record<string, unknown>, parentTask?: string) => Promise<void>;
}
