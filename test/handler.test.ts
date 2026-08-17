import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentRecord, HerdrLike } from "../src/herdr-client";
import type { ExtensionApiLike, ExtensionCommandCtx, HandlerCtx } from "../src/index";
import { ompProcessArgs, ompSpec, piSpec, registerCommands, runForkInHerdr, runForkInTmux } from "../src/index";
import type { TmuxDestination } from "../src/tmux-destination";

const ORIGINAL_ID = "01a0028a-3480-7000-8a93-16440ac9433f";
let sessionDir: string;

function fixtureSession(id: string): string {
  const file = join(sessionDir, `2026-08-14T22-55-27-165Z_${id}.jsonl`);
  writeFileSync(file, [
    JSON.stringify({ type: "title", v: 1, title: "", updatedAt: "2026-08-14T22:55:27.165Z" }),
    JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-08-14T22:55:27.165Z", cwd: "/repo", parentSession: null }),
  ].join("\n") + "\n");
  return file;
}

const OMP_CHILD = "/tmp/child-session.jsonl";

function agentRecord(paneId: string, kind = "omp", value = OMP_CHILD): AgentRecord {
  return { agent: kind, paneId, agentSession: { kind: "path", value } };
}

function fakeHerdr(options: { start?: AgentRecord | Error; get?: AgentRecord | null | Error } = {}) {
  const calls: string[] = [];
  const herdr: HerdrLike = {
    getTab: async (tabId) => { calls.push(`getTab:${tabId}`); return { tabId, label: "2", workspaceId: "w14" }; },
    listLabels: async (workspaceId) => { calls.push(`listLabels:${workspaceId}`); return ["1", "2", "2f1"]; },
    createTab: async (opts) => { calls.push(`createTab:${opts.workspaceId}:${opts.cwd}:${opts.label}`); return "w14:p5"; },
    startAgent: async (opts) => {
      calls.push(`startAgent:${opts.paneId}:${opts.agentName}:${opts.agentArgs.join(",")}`);
      if (options.start instanceof Error) throw options.start;
      return options.start ?? agentRecord(opts.paneId, opts.agentArgs[0] === "--session" ? "pi" : "omp", opts.agentArgs[0] === "--session" ? opts.agentArgs[1]! : OMP_CHILD);
    },
    getAgent: async (paneId) => {
      calls.push(`getAgent:${paneId}`);
      if (options.get instanceof Error) throw options.get;
      return options.get ?? null;
    },
  };
  return { herdr, calls };
}

function fakeTmux(env: Record<string, string | undefined>, fail = false) {
  const calls: string[][] = [];
  const tmux = {
    available: () => env.TMUX !== undefined && env.TMUX_PANE !== undefined,
    source: async () => { calls.push(["display-message"]); return { sessionId: "$3", windowId: "@7", windowName: "work", paneId: "%11" }; },
    listWindowNames: async () => { calls.push(["list-windows"]); return ["work", "logs"]; },
    spawn: async (opts: { label: string; argv: readonly string[] }) => {
      calls.push(["new-window", opts.label, ...opts.argv]);
      if (fail) throw new Error("tmux new-window failed (exit 1): no server");
      return "%12";
    },
  } as unknown as TmuxDestination;
  return { tmux, calls };
}

function handlerCtx(overrides: Partial<HandlerCtx> = {}): HandlerCtx {
  return {
    herdr: fakeHerdr().herdr,
    cwd: "/repo",
    sessionFile: fixtureSession(ORIGINAL_ID),
    env: { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w14", HERDR_TAB_ID: "w14:t1", HERDR_PANE_ID: "w14:p1" },
    busy: false,
    notify: () => {},
    spec: ompSpec(),
    ...overrides,
  };
}

let originalArgv: string[];

beforeEach(() => {
  sessionDir = `/tmp/fih-handler-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  mkdirSync(sessionDir, { recursive: true });
  // `ompSpec()` reads the ambient process argv; pin it so native-fork argv
  // assertions never inherit the test runner's own flags.
  originalArgv = process.argv;
  process.argv = [process.argv[0] ?? "bun", "fork-in-test"];
});

afterEach(() => {
  process.argv = originalArgv;
});

describe("ompProcessArgs", () => {
  it("forwards repeated overlays, equals forms, and last-one-wins values", () => {
    expect(ompProcessArgs(["--profile", "old", "--config=a", "--config", "b", "--profile=new", "--session-dir", "/s2", "--session-dir=/s3"])).toEqual(["--config=a", "--config", "b", "--profile=new", "--session-dir=/s3"]);
  });

  it("does not mistake another flag's value for an overlay", () => {
    expect(ompProcessArgs(["--prompt", "--profile", "--config=x", "--profile", "work"])).toEqual(["--config=x", "--profile", "work"]);
  });
});

describe("runForkInHerdr", () => {
  it("uses native OMP fork without creating a plugin file and reports child path", async () => {
    const { herdr, calls } = fakeHerdr();
    const ctx = handlerCtx({ herdr });
    const before = readdirSync(sessionDir);
    await runForkInHerdr(ctx);
    expect(readdirSync(sessionDir)).toEqual(before);
    expect(calls).toEqual(["getTab:w14:t1", "listLabels:w14", "createTab:w14:/repo:2f2", `startAgent:w14:p5:fork-w14-2f2:--fork,${resolve(ctx.sessionFile)}`]);
  });

  it("forwards OMP overlays to Herdr and native fork", async () => {
    const { herdr, calls } = fakeHerdr();
    const spec = { ...ompSpec(), prepareFork: async (file: string) => ({ argv: ["--profile", "work", "--config=a", "--config", "b", "--session-dir", "/isolated", "--fork", resolve(file)], recoveryArgs: [], sourceFile: resolve(file) }) };
    await runForkInHerdr(handlerCtx({ herdr, spec }));
    expect(calls.at(-1)).toContain("--profile,work,--config=a,--config,b,--session-dir,/isolated,--fork,");
  });
  it("creates one Pi copy and resumes its absolute path", async () => {
    const { herdr, calls } = fakeHerdr();
    await runForkInHerdr(handlerCtx({ herdr, spec: piSpec() }));
    expect(calls.at(-1)).toMatch(/startAgent:w14:p5:fork-w14-2f2:--session,\/.*\.jsonl$/);
  });

  it("reconciles an ambiguous start with one matching live agent lookup", async () => {
    const { herdr, calls } = fakeHerdr({ start: new Error("accepted but response lost"), get: agentRecord("w14:p5") });
    await runForkInHerdr(handlerCtx({ herdr }));
    expect(calls.filter((call) => call.startsWith("startAgent:"))).toHaveLength(1);
    expect(calls).toContain("getAgent:w14:p5");
  });

  it("reports a source-based recovery command when no agent exists", async () => {
    const { herdr } = fakeHerdr({ start: new Error("start failed"), get: null });
    const ctx = handlerCtx({ herdr });
    await expect(runForkInHerdr(ctx)).rejects.toThrow(new RegExp(`omp --fork ${resolve(ctx.sessionFile)}`));
  });

  it("refuses outside herdr or while busy before touching anything", async () => {
    const { herdr, calls } = fakeHerdr();
    const ctx = handlerCtx({ herdr, env: {} });
    const before = readdirSync(sessionDir);
    await expect(runForkInHerdr(ctx)).rejects.toThrow(/not running inside herdr/);
    expect(calls).toEqual([]);
    expect(readdirSync(sessionDir)).toEqual(before);
    await expect(runForkInHerdr(handlerCtx({ herdr, busy: true }))).rejects.toThrow(/busy/);
  });
});

describe("runForkInTmux", () => {
  const tmuxEnv = { TMUX: "/tmp/tmux-0/default,100,0", TMUX_PANE: "%11" };

  it("launches native OMP fork once", async () => {
    const { tmux, calls } = fakeTmux(tmuxEnv);
    const ctx = handlerCtx({ tmux });
    await runForkInTmux(ctx);
    expect(calls.find((call) => call[0] === "new-window")).toEqual(["new-window", "workf1", "omp", "--fork", resolve(ctx.sessionFile)]);
  });

  it("reports source-based recovery on tmux spawn failure", async () => {
    const { tmux } = fakeTmux(tmuxEnv, true);
    const ctx = handlerCtx({ tmux });
    await expect(runForkInTmux(ctx)).rejects.toThrow(new RegExp(`omp --fork ${resolve(ctx.sessionFile)}`));
  });

  it("starts Pi with its copied absolute path", async () => {
    const { tmux, calls } = fakeTmux(tmuxEnv);
    await runForkInTmux(handlerCtx({ tmux, spec: piSpec() }));
    expect(calls.find((call) => call[0] === "new-window")?.slice(2, 4)).toEqual(["pi", "--session"]);
    expect(calls.find((call) => call[0] === "new-window")?.at(-1)).toMatch(/^\/.*\.jsonl$/);
  });

  it("refuses outside tmux", async () => {
    const { tmux, calls } = fakeTmux({});
    await expect(runForkInTmux(handlerCtx({ tmux }))).rejects.toThrow(/not running inside tmux/);
    expect(calls).toEqual([]);
  });
});

describe("registration", () => {
  it("registers both commands and rejects arguments", async () => {
    const registered: { name: string; description: string | undefined; handler: (args: string, ctx: ExtensionCommandCtx) => Promise<void> }[] = [];
    const api: ExtensionApiLike = { registerCommand: (name, options) => registered.push({ name, description: options.description, handler: options.handler }) };
    registerCommands(api, ompSpec());
    expect(registered.map((entry) => entry.name)).toEqual(["fork-in-herdr", "fork-in-tmux"]);
    await expect(registered[0]!.handler("extra", {} as ExtensionCommandCtx)).rejects.toThrow(/argument/);
    await expect(registered[1]!.handler("extra", {} as ExtensionCommandCtx)).rejects.toThrow(/argument/);
  });
});
