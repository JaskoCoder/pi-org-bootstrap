/**
 * Shared mutable context for extension modules.
 *
 * Commands and tools close over the same mutable state defined in the main
 * extension entry point. This interface documents the shared dependency bag
 * passed to registration functions.
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentState, ExtensionState } from "./types.js";
import type { MailSystem } from "./mail.js";
import type { CronScheduler } from "./cron-types.js";

export interface ExtensionSharedContext {
  pi: ExtensionAPI;
  agentStates: Record<string, AgentState>;
  mailSystem: MailSystem;
  extState: ExtensionState;
  cronScheduler: CronScheduler;
  /** Whether the dashboard widget is active */
  widgetActive: boolean;
  setWidgetActive: (v: boolean) => void;
  /** Register the dashboard widget factory */
  registerWidgetFactory: (ctx: ExtensionContext) => void;
  /** Trigger a TUI re-render */
  refresh: (ctx?: ExtensionContext) => void;
  /** Schedule agent status to go idle after a delay */
  scheduleAgentIdle: (key: string) => void;
  /** Clear a pending idle timeout */
  clearAgentIdle: (key: string) => void;
  /** Dashboard widget key */
  WIDGET_KEY: string;
  /** Run autonomous debug cycle */
  runAutonomousCycle: (ctx: ExtensionContext) => Promise<void>;
  /** Abort controller for the debug loop */
  debugAbortController: AbortController | null;
  setDebugAbortController: (ac: AbortController | null) => void;
  /** Meta-mode toggle (head vs pi meta-agent) */
  metaMode: boolean;
  setMetaMode: (v: boolean) => void;
  /** Emit an event to the context bus */
  emitBusEvent?: (cwd: string, type: import("./context-bus.js").ContextEventType, agent: string, payload: Record<string, unknown>, parentTask?: string) => Promise<void>;
}
