import { resolve } from "node:path";
import { HerdrClient, type AgentRecord, type HerdrLike } from "./herdr-client";
import { forkLabel } from "./fork-label";
import { createForkCopy } from "./fork-copy";
import { TmuxDestination } from "./tmux-destination";

export interface ExtensionApiLike {
  registerCommand(
    name: string,
    options: {
      description?: string;
      handler: (args: string, ctx: ExtensionCommandCtx) => Promise<void>;
    },
  ): void;
}

export interface ExtensionCommandCtx {
  cwd: string;
  isIdle(): boolean;
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
  sessionManager: { getSessionFile(): string | undefined };
}

export interface HostForkLaunch {
  argv: string[];
  recoveryArgs: string[];
  sourceFile: string;
  copiedFile?: string;
}

export interface AgentHostSpec {
  kind: "omp" | "pi";
  prepareFork: (sessionFile: string) => Promise<HostForkLaunch>;
}

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

interface OverlayToken {
  index: number;
  args: string[];
  kind: "profile" | "config" | "session-dir";
}

const OMP_VALUE_FLAGS: Record<string, true> = {
  "--model": true,
  "--provider": true,
  "--extension": true,
  "--prompt": true,
  "--system-prompt": true,
  "--session": true,
  "--session-dir": true,
  "--profile": true,
  "--config": true,
  "--thinking": true,
  "--api-key": true,
};

/** Returns the effective OMP bootstrap overlays without importing OMP internals. */
export function ompProcessArgs(argv: readonly string[] = process.argv.slice(2)): string[] {
  const tokens: OverlayToken[] = [];
  let lastProfile: OverlayToken | undefined;
  let lastSessionDir: OverlayToken | undefined;
  const configs: OverlayToken[] = [];

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    const equalsIndex = token.indexOf("=");
    const flag = equalsIndex === -1 ? token : token.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : token.slice(equalsIndex + 1);
    const consumesNext = equalsIndex === -1 && OMP_VALUE_FLAGS[flag] === true;
    const next = argv[index + 1];
    const args = inlineValue === undefined && consumesNext && next !== undefined ? [token, next] : [token];

    if (flag === "--profile") lastProfile = { index, args, kind: "profile" };
    if (flag === "--config") configs.push({ index, args, kind: "config" });
    if (flag === "--session-dir") lastSessionDir = { index, args, kind: "session-dir" };
    if (consumesNext && next !== undefined) index++;
  }

  tokens.push(...(lastProfile ? [lastProfile] : []), ...configs, ...(lastSessionDir ? [lastSessionDir] : []));
  tokens.sort((left, right) => left.index - right.index);
  return tokens.flatMap((token) => token.args);
}

export function ompSpec(): AgentHostSpec {
  return {
    kind: "omp",
    prepareFork: async (sessionFile) => {
      const sourceFile = resolve(sessionFile);
      const args = [...ompProcessArgs(), "--fork", sourceFile];
      return { argv: args, recoveryArgs: args, sourceFile };
    },
  };
}

export function piSpec(): AgentHostSpec {
  return {
    kind: "pi",
    prepareFork: async (sessionFile) => {
      const sourceFile = resolve(sessionFile);
      const fork = await createForkCopy(sourceFile);
      return { argv: ["--session", fork.file], recoveryArgs: ["--session", fork.file], sourceFile, copiedFile: fork.file };
    },
  };
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

function agentName(workspaceId: string, label: string): string {
  return `fork-${workspaceId}-${label}`.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
}

interface ForkResult {
  label: string;
  sessionPath?: string;
}

function recoveryCommand(ctx: HandlerCtx, launch: HostForkLaunch): string {
  return `${ctx.spec.kind} ${launch.recoveryArgs.join(" ")}`;
}

async function runFork(
  ctx: HandlerCtx,
  command: string,
  forkInto: (launch: HostForkLaunch, label: string) => Promise<ForkResult>,
): Promise<void> {
  if (ctx.busy) throw new Error(`${command}: agent is busy — wait for the current turn to finish`);
  ctx.notify(`${command}: preparing fork…`);
  const launch = await ctx.spec.prepareFork(ctx.sessionFile);
  try {
    const result = await forkInto(launch, "");
    const identity = result.sessionPath ? ` (session ${result.sessionPath})` : "";
    ctx.notify(`${command}: forked to ${result.label}${identity}`);
  } catch (error) {
    throw new Error(
      `${command}: new surface may exist; inspect it and retry with: ${recoveryCommand(ctx, launch)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function matchingAgent(record: AgentRecord | null, ctx: HandlerCtx, paneId: string, launch: HostForkLaunch): string | undefined {
  const session = record?.agentSession;
  if (!record || record.paneId !== paneId || record.agent !== ctx.spec.kind || !session || session.kind !== "path" || session.value === "") return undefined;
  if (ctx.spec.kind === "omp" && session.value === launch.sourceFile) return undefined;
  if (ctx.spec.kind === "pi" && session.value !== launch.copiedFile) return undefined;
  return session.value;
}

export async function runForkInHerdr(ctx: HandlerCtx): Promise<void> {
  const command = "fork-in-herdr";
  const herdr = ctx.herdr ?? new HerdrClient(ctx.spec.kind);
  const { HERDR_ENV, HERDR_WORKSPACE_ID, HERDR_TAB_ID } = ctx.env;
  if (!HERDR_ENV || !HERDR_WORKSPACE_ID || !HERDR_TAB_ID) {
    throw new Error(`${command}: not running inside herdr (HERDR_ENV unset) — nothing to fork into`);
  }
  await runFork(ctx, command, async (launch) => {
    const original = await herdr.getTab(HERDR_TAB_ID);
    const tabs = await herdr.listTabs(HERDR_WORKSPACE_ID);
    const label = forkLabel(original.label, tabs.map((tab) => tab.label));
    const created = await herdr.createTab({ workspaceId: HERDR_WORKSPACE_ID, cwd: ctx.cwd, label });
    const paneId = created.paneId;
    const sourceIndex = tabs.findIndex((tab) => tab.tabId === HERDR_TAB_ID);
    if (sourceIndex !== -1) {
      try {
        await herdr.moveTab({ tabId: created.tabId, insertIndex: sourceIndex + 1 });
      } catch (error) {
        ctx.notify(`${command}: could not place ${label} next to the current tab (${error instanceof Error ? error.message : String(error)}); it stays at the end`);
      }
    }
    try {
      const started = await herdr.startAgent({
        paneId,
        agentName: agentName(HERDR_WORKSPACE_ID, label),
        agentArgs: launch.argv,
      });
      const sessionPath = matchingAgent(started, ctx, paneId, launch);
      if (!sessionPath) throw new Error(`${command}: herdr start returned no matching child session path`);
      return { label, sessionPath };
    } catch (startError) {
      try {
        const recovered = matchingAgent(await herdr.getAgent(paneId), ctx, paneId, launch);
        if (recovered) return { label, sessionPath: recovered };
      } catch {
        // Preserve the original start failure when reconciliation itself fails.
      }
      throw startError;
    }
  });
}

export async function runForkInTmux(ctx: HandlerCtx): Promise<void> {
  const command = "fork-in-tmux";
  const tmux = ctx.tmux ?? new TmuxDestination(ctx.env);
  if (!tmux.available()) throw new Error(`${command}: not running inside tmux ($TMUX unset) — nothing to fork into`);
  await runFork(ctx, command, async (launch) => {
    const source = await tmux.source();
    const names = await tmux.listWindowNames(source.sessionId);
    const label = forkLabel(source.windowName, names);
    ctx.notify(`${command}: starting ${ctx.spec.kind} in window ${label}…`);
    await tmux.spawn({ source, cwd: ctx.cwd, label, argv: [ctx.spec.kind, ...launch.argv] });
    return { label };
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

export default function forkIn(api: ExtensionApiLike): void {
  const host = process.argv[0]?.endsWith("/pi") || process.argv[0] === "pi" ? "pi" : "omp";
  registerCommands(api, host === "pi" ? piSpec() : ompSpec());
}
