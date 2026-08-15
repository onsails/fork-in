import { HerdrClient, type HerdrLike } from "./herdr-client";
import { forkLabel } from "./fork-label";
import { createForkCopy, type ForkCopy } from "./fork-copy";
import { TmuxDestination } from "./tmux-destination";

/**
 * The shared extension factory surface fork-in needs. omp and pi expose
 * this shape; the structural type avoids importing either host's internals.
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

/** The command context fields used by the shared HandlerCtx adapter. */
export interface ExtensionCommandCtx {
  cwd: string;
  isIdle(): boolean;
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
  sessionManager: { getSessionFile(): string | undefined };
}

/** Host agent description: herdr kind, bootstrap args, fork resume argv. */
export interface AgentHostSpec {
  kind: "omp" | "pi";
  agentArgs: readonly string[];
  resumeArgs: (fork: ForkCopy) => string[];
}

/**
 * A fork destination (herdr or tmux), injected so tests drive the pipeline
 * without spawning processes.
 */
export interface HandlerCtx {
  cwd: string;
  sessionFile: string;
  env: Record<string, string | undefined>;
  busy: boolean;
  notify: (message: string) => void;
  spec: AgentHostSpec;
  herdr?: HerdrLike;
  tmux?: TmuxDestination;
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

function handlerCtx(ctx: ExtensionCommandCtx, spec: AgentHostSpec): HandlerCtx {
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) throw new Error("fork-in: current session has no session file");
  return {
    cwd: ctx.cwd,
    sessionFile,
    env: process.env,
    busy: !ctx.isIdle(),
    notify: (message) => ctx.ui.notify(message, "info"),
    spec,
    herdr: new HerdrClient(spec.kind),
    tmux: new TmuxDestination(process.env),
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

/** Shared pipeline: guard, copy, hand to the destination, report recovery. */
async function runFork(ctx: HandlerCtx, command: string, forkInto: (fork: ForkCopy, label: string) => Promise<string>): Promise<void> {
  if (ctx.busy) {
    throw new Error(`${command}: agent is busy — wait for the current turn to finish`);
  }
  ctx.notify(`${command}: creating fork copy…`);
  const fork = await createForkCopy(ctx.sessionFile, ctx.spec.kind);
  try {
    const label = await forkInto(fork, "");
    ctx.notify(`${command}: forked to ${label} (session ${fork.newId})`);
    return;
  } catch (err) {
    throw new Error(
      `${command}: fork copy ${fork.newId} exists; if a window/tab was left open, resume it manually: ${ctx.spec.kind} ${[...ctx.spec.agentArgs, ...ctx.spec.resumeArgs(fork)].join(" ")}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function runForkInHerdr(ctx: HandlerCtx): Promise<void> {
  const command = "fork-in-herdr";
  const herdr = ctx.herdr ?? new HerdrClient(ctx.spec.kind);
  const { HERDR_ENV, HERDR_WORKSPACE_ID, HERDR_TAB_ID } = ctx.env;
  if (!HERDR_ENV || !HERDR_WORKSPACE_ID || !HERDR_TAB_ID) {
    throw new Error(`${command}: not running inside herdr (HERDR_ENV unset) — nothing to fork into`);
  }
  await runFork(ctx, command, async (fork) => {
    const original = await herdr.getTab(HERDR_TAB_ID);
    const labels = await herdr.listLabels(HERDR_WORKSPACE_ID);
    const label = forkLabel(original.label, labels);
    const paneId = await herdr.createTab({ workspaceId: HERDR_WORKSPACE_ID, cwd: ctx.cwd, label });
    ctx.notify(`${command}: starting ${ctx.spec.kind} in ${label}…`);
    // agent start requires the pane at its shell prompt; a fresh tab's
    // shell may still be initializing — retry briefly before surfacing.
    let lastError: unknown;
    for (let attempt = 0; attempt < AGENT_START_ATTEMPTS; attempt++) {
      try {
        await herdr.startAgent({
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
    return label;
  });
}

export async function runForkInTmux(ctx: HandlerCtx): Promise<void> {
  const command = "fork-in-tmux";
  const tmux = ctx.tmux ?? new TmuxDestination(ctx.env);
  if (!tmux.available()) {
    throw new Error(`${command}: not running inside tmux ($TMUX unset) — nothing to fork into`);
  }
  await runFork(ctx, command, async (fork) => {
    const source = await tmux.source();
    const names = await tmux.listWindowNames(source.sessionId);
    const label = forkLabel(source.windowName, names);
    ctx.notify(`${command}: starting ${ctx.spec.kind} in window ${label}…`);
    await tmux.spawn({
      source,
      cwd: ctx.cwd,
      label,
      argv: [ctx.spec.kind, ...ctx.spec.agentArgs, ...ctx.spec.resumeArgs(fork)],
    });
    return label;
  });
}


export function registerCommands(api: ExtensionApiLike, spec: AgentHostSpec): void {
  api.registerCommand("fork-in-herdr", {
    description: "Tab-fork: fork this conversation into a new herdr tab",
    handler: async (args, ctx) => {
      if (args.trim() !== "") throw new Error("fork-in-herdr takes no arguments");
      await runForkInHerdr(handlerCtx(ctx, spec));
    },
  });
  api.registerCommand("fork-in-tmux", {
    description: "Window-fork: fork this conversation into a new tmux window",
    handler: async (args, ctx) => {
      if (args.trim() !== "") throw new Error("fork-in-tmux takes no arguments");
      await runForkInTmux(handlerCtx(ctx, spec));
    },
  });
}
