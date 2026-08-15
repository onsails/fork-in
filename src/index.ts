import { HerdrClient } from "./herdr-client";
import { forkLabel } from "./fork-label";
import { createForkCopy, type ForkCopy } from "./fork-copy";

/**
 * The omp extension factory surface fork-in-herdr needs. omp's real
 * ExtensionAPI is broader; this structural type keeps the plugin
 * compilable without importing omp internals.
 */
export interface ExtensionApiLike {
  registerCommand(
    name: string,
    options: {
      description?: string;
      handler: (args: string, ctx: ExtensionCommandCtx) => Promise<void>;
    },
  ): void;
}

/**
 * omp's ExtensionCommandContext as seen through this plugin's narrow
 * adapter (HandlerCtx). Only what /fork-in-herdr reads.
 */
export interface ExtensionCommandCtx {
  cwd: string;
  isIdle(): boolean;
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
  sessionManager: { getSessionFile(): string | undefined };
}

/**
 * The plugin's single herdr choke point and environment, injected so tests
 * drive the handler without spawning processes.
 */
export interface HandlerCtx {
  herdr: HerdrLike;
  cwd: string;
  sessionFile: string;
  env: Record<string, string | undefined>;
  busy: boolean;
  notify: (message: string) => void;
  /** Host agent description: herdr kind, bootstrap args, fork resume argv. */
  spec: AgentHostSpec;
}

export interface HerdrLike {
  getTab(tabId: string): Promise<{ tabId: string; label: string; workspaceId: string }>;
  listLabels(workspaceId: string): Promise<string[]>;
  createTab(opts: { workspaceId: string; cwd: string; label: string }): Promise<string>;
  startAgent(opts: { paneId: string; agentName: string; agentArgs: readonly string[] }): Promise<void>;
}

function ompProcessArgs(): string[] {
  // Drop argv[0]/argv[1] (runtime + script); keep bootstrap flags like --profile.
  const scriptArgs = process.argv.slice(2);
  const profile = scriptArgs.findIndex((a) => a === "--profile" || a.startsWith("--profile="));
  if (profile === -1) return [];
  const flag = scriptArgs[profile]!;
  if (flag.includes("=")) return [flag];
  const value = scriptArgs[profile + 1];
  return value === undefined ? [flag] : [flag, value];
}

/** The omp entry's host description: launch flags and herdr kind for omp. */
export function ompSpec(): AgentHostSpec {
  return { kind: "omp", agentArgs: ompProcessArgs(), resumeArgs: (fork) => ["--resume", fork.newId] };
}

/** The pi entry's host description: launch flags and herdr kind for pi. */
export function piSpec(): AgentHostSpec {
  return { kind: "pi", agentArgs: [], resumeArgs: (fork) => ["--session", fork.file] };
}

export interface AgentHostSpec {
  kind: "omp" | "pi";
  agentArgs: readonly string[];
  resumeArgs: (fork: ForkCopy) => string[];
}

export type HerdrKind = AgentHostSpec["kind"];

function handlerCtx(ctx: ExtensionCommandCtx, spec: AgentHostSpec): HandlerCtx {
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) throw new Error("fork-in-herdr: current session has no session file");
  return {
    herdr: new HerdrClient(spec.kind),
    cwd: ctx.cwd,
    sessionFile,
    env: process.env,
    busy: !ctx.isIdle(),
    notify: (message) => ctx.ui.notify(message, "info"),
    spec,
  };
}

/**
 * herdr agent name: unique among live agents ([a-z][a-z0-9_-]{0,31}),
 * derived from workspace id + fork label, which forkLabel made unique in
 * the workspace.
 */
function agentName(workspaceId: string, label: string): string {
  return `fork-${workspaceId}-${label}`.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
}

const AGENT_START_ATTEMPTS = 4;
const AGENT_START_RETRY_DELAY_MS = 500;

export async function runForkInHerdr(ctx: HandlerCtx): Promise<void> {
  const { HERDR_ENV, HERDR_WORKSPACE_ID, HERDR_TAB_ID } = ctx.env;
  if (!HERDR_ENV || !HERDR_WORKSPACE_ID || !HERDR_TAB_ID) {
    throw new Error("fork-in-herdr: not running inside herdr (HERDR_ENV unset) — nothing to fork into");
  }
  if (ctx.busy) {
    throw new Error("fork-in-herdr: agent is busy — wait for the current turn to finish");
  }

  ctx.notify("fork-in-herdr: creating fork copy…");
  const fork = await createForkCopy(ctx.sessionFile);

  try {
    const original = await ctx.herdr.getTab(HERDR_TAB_ID);
    const labels = await ctx.herdr.listLabels(HERDR_WORKSPACE_ID);
    const label = forkLabel(original.label, labels);
    const paneId = await ctx.herdr.createTab({ workspaceId: HERDR_WORKSPACE_ID, cwd: ctx.cwd, label });
    ctx.notify(`fork-in-herdr: starting omp in ${label}…`);
    // agent start requires the pane at its shell prompt; a fresh tab's
    // shell may still be initializing — retry briefly before surfacing.
    let lastError: unknown;
    for (let attempt = 0; attempt < AGENT_START_ATTEMPTS; attempt++) {
      try {
        await ctx.herdr.startAgent({
          paneId,
          agentName: agentName(HERDR_WORKSPACE_ID, label),
          agentArgs: [...ctx.spec.agentArgs, ...ctx.spec.resumeArgs(fork)],
        });
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < AGENT_START_ATTEMPTS - 1) {
          const { promise, resolve } = Promise.withResolvers<void>();
          setTimeout(resolve, AGENT_START_RETRY_DELAY_MS);
          await promise;
        }
      }
    }
    if (lastError !== undefined) throw lastError;
    ctx.notify(`fork-in-herdr: forked to ${label} (session ${fork.newId})`);
  } catch (err) {
    throw new Error(
      `fork-in-herdr: fork copy ${fork.newId} exists; if a tab was left open, start omp manually with: omp --resume ${fork.newId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function registerForkInHerdr(pi: ExtensionApiLike, spec: AgentHostSpec): void {
  pi.registerCommand("fork-in-herdr", {
    description: "Tab-fork: fork this conversation into a new herdr tab",
    handler: async (args, ctx) => {
      if (args.trim() !== "") {
        throw new Error("fork-in-herdr takes no arguments");
      }
      await runForkInHerdr(handlerCtx(ctx, spec));
    },
  });
}

