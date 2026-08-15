import { beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionApiLike, ExtensionCommandCtx, HandlerCtx } from "../src/index";
import { runForkInHerdr, runForkInTmux, registerCommands, ompSpec, piSpec } from "../src/index";
import type { HerdrLike } from "../src/herdr-client";
import type { TmuxDestination } from "../src/tmux-destination";

const ORIGINAL_ID = "01a0028a-3480-7000-8a93-16440ac9433f";
let sessionDir: string;

function fixtureSession(id: string): string {
  const file = join(sessionDir, `2026-08-14T22-55-27-165Z_${id}.jsonl`);
  writeFileSync(
    file,
    [
      JSON.stringify({ type: "title", v: 1, title: "", updatedAt: "2026-08-14T22:55:27.165Z" }),
      JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-08-14T22:55:27.165Z", cwd: "/repo", parentSession: null }),
    ].join("\n") + "\n",
  );
  return file;
}

/** Recording HerdrLike with canned happy responses; optional failure point. */
function fakeHerdr(failAt?: "getTab" | "listLabels" | "createTab" | "startAgent") {
  const calls: string[] = [];
  const herdr: HerdrLike = {
    getTab: async (tabId: string) => {
      calls.push(`getTab:${tabId}`);
      if (failAt === "getTab") throw new Error("herdr tab get failed (exit 1): boom");
      return { tabId, label: "2", workspaceId: "w14" };
    },
    listLabels: async (ws: string) => {
      calls.push(`listLabels:${ws}`);
      if (failAt === "listLabels") throw new Error("herdr tab list failed (exit 1): boom");
      return ["1", "2", "2f1"];
    },
    createTab: async (opts: { workspaceId: string; cwd: string; label: string }) => {
      calls.push(`createTab:${opts.workspaceId}:${opts.cwd}:${opts.label}`);
      if (failAt === "createTab") throw new Error("herdr tab create failed (exit 1): boom");
      return "w14:p5";
    },
    startAgent: async (opts: { paneId: string; agentName: string; agentArgs: readonly string[] }) => {
      calls.push(`startAgent:${opts.paneId}:${opts.agentName}:${opts.agentArgs.join(",")}`);
      if (failAt === "startAgent") throw new Error("herdr agent start failed (exit 1): timeout");
    },
  };
  return { herdr, calls };
}

/** TmuxDestination fake: records argv, canned source/pane answers. */
function fakeTmux(env: Record<string, string | undefined>, failAt?: "spawn") {
  const calls: string[][] = [];
  const tmux = {
    available: () => env.TMUX !== undefined && env.TMUX_PANE !== undefined,
    source: async () => {
      calls.push(["display-message"]);
      return { sessionId: "$3", windowId: "@7", windowName: "work", paneId: "%11" };
    },
    listWindowNames: async () => {
      calls.push(["list-windows"]);
      return ["work", "logs"];
    },
    spawn: async (opts: { label: string; argv: readonly string[] }) => {
      calls.push(["new-window", opts.label, ...opts.argv]);
      if (failAt === "spawn") throw new Error("tmux new-window failed (exit 1): no server");
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
    spec: { kind: "omp", agentArgs: [], resumeArgs: (fork) => ["--resume", fork.newId] },
    ...overrides,
  } as HandlerCtx;
}

beforeEach(() => {
  sessionDir = `/tmp/fih-handler-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  mkdirSync(sessionDir, { recursive: true });
});

describe("runForkInHerdr", () => {
  it("copies the session, labels 2f2, starts omp resumed by the new id, keeps the original", async () => {
    const { herdr, calls } = fakeHerdr();
    const ctx = handlerCtx({ herdr });
    await runForkInHerdr(ctx);
    const forkFiles = readdirSync(sessionDir).filter((f) => f !== `2026-08-14T22-55-27-165Z_${ORIGINAL_ID}.jsonl`);
    expect(forkFiles).toHaveLength(1);
    const forkHeader = JSON.parse((await Bun.file(join(sessionDir, forkFiles[0]!)).text()).split("\n")[1]!);
    expect(forkHeader.parentSession).toBe(ORIGINAL_ID);
    const forkId = forkHeader.id;
    expect(calls).toEqual([
      "getTab:w14:t1",
      "listLabels:w14",
      "createTab:w14:/repo:2f2",
      `startAgent:w14:p5:fork-w14-2f2:--resume,${forkId}`,
    ]);
    expect((await Bun.file(ctx.sessionFile).text()).trimEnd().split("\n")).toHaveLength(2);
  });

  it("forwards the running omp's profile to the forked omp", async () => {
    const { herdr, calls } = fakeHerdr();
    await runForkInHerdr(handlerCtx({ herdr, spec: { ...ompSpec(), agentArgs: ["--profile", "work"] } }));
    expect(calls.find((c) => c.startsWith("startAgent:"))).toMatch(/--profile,work,--resume,/);
  });

  it("starts pi with the fork copy's absolute session path", async () => {
    const { herdr, calls } = fakeHerdr();
    await runForkInHerdr(handlerCtx({ herdr, spec: piSpec() }));
    expect(calls.find((c) => c.startsWith("startAgent:"))).toMatch(/:--session,\/.*\.jsonl$/);
  });

  it("retries agent start when the pane is not ready, then succeeds", async () => {
    const calls: string[] = [];
    let attempts = 0;
    const herdr: HerdrLike = {
      getTab: async (tabId: string) => ({ tabId, label: "2", workspaceId: "w14" }),
      listLabels: async () => ["2"],
      createTab: async () => "w14:p5",
      startAgent: async (opts: { agentName: string }) => {
        attempts++;
        calls.push(`startAgent:${opts.agentName}`);
        if (attempts < 3) throw new Error("pane not ready");
      },
    };
    await runForkInHerdr(handlerCtx({ herdr }));
    expect(attempts).toBe(3);
    expect(calls).toEqual(["startAgent:fork-w14-2f1", "startAgent:fork-w14-2f1", "startAgent:fork-w14-2f1"]);
  });

  it("refuses outside herdr before touching anything", async () => {
    const { herdr, calls } = fakeHerdr();
    const ctx = handlerCtx({ herdr, env: {} });
    const before = readdirSync(sessionDir);
    await expect(runForkInHerdr(ctx)).rejects.toThrow(/not running inside herdr/);
    expect(calls).toEqual([]);
    expect(readdirSync(sessionDir)).toEqual(before);
  });

  it("refuses while the agent is busy before touching anything", async () => {
    const { herdr, calls } = fakeHerdr();
    const ctx = handlerCtx({ herdr, busy: true });
    const before = readdirSync(sessionDir);
    await expect(runForkInHerdr(ctx)).rejects.toThrow(/busy/);
    expect(calls).toEqual([]);
    expect(readdirSync(sessionDir)).toEqual(before);
  });

  it("reports the session id when tab creation fails after the copy exists", async () => {
    const { herdr } = fakeHerdr("createTab");
    await expect(runForkInHerdr(handlerCtx({ herdr }))).rejects.toThrow(/omp --resume/);
  });

  it("reports the session id when agent start fails after retries", async () => {
    const { herdr } = fakeHerdr("startAgent");
    await expect(runForkInHerdr(handlerCtx({ herdr }))).rejects.toThrow(/omp --resume/);
  });

  it("includes omp profile args in the recovery command", async () => {
    const { herdr } = fakeHerdr("createTab");
    const spec = { ...ompSpec(), agentArgs: ["--profile", "work"] };
    await expect(runForkInHerdr(handlerCtx({ herdr, spec }))).rejects.toThrow(/omp --profile work --resume/);
  });
});

describe("runForkInTmux", () => {
  const tmuxEnv = { TMUX: "/tmp/tmux-0/default,100,0", TMUX_PANE: "%11" };

  it("labels the window workf1 and execs omp argv directly", async () => {
    const { tmux, calls } = fakeTmux(tmuxEnv);
    const ctx = handlerCtx({ tmux });
    await runForkInTmux(ctx);
    const spawnCall = calls.find((c) => c[0] === "new-window")!;
    expect(spawnCall[1]).toBe("workf1");
    expect(spawnCall[2]).toBe("omp");
    expect(spawnCall.at(-1)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("starts pi resumed by the fork copy's path", async () => {
    const { tmux, calls } = fakeTmux(tmuxEnv);
    await runForkInTmux(handlerCtx({ tmux, spec: piSpec() }));
    const spawnCall = calls.find((c) => c[0] === "new-window")!;
    expect(spawnCall[2]).toBe("pi");
    expect(spawnCall.at(-1)).toMatch(/\.jsonl$/);
  });

  it("picks the first free fork number among session window names", async () => {
    const calls: string[][] = [];
    const tmux = {
      available: () => true,
      source: async () => ({ sessionId: "$3", windowId: "@7", windowName: "work", paneId: "%11" }),
      listWindowNames: async () => ["work", "workf1", "workf2"],
      spawn: async (opts: { label: string }) => {
        calls.push(["new-window", opts.label]);
        return "%12";
      },
    } as unknown as TmuxDestination;
    await runForkInTmux(handlerCtx({ tmux }));
    expect(calls[0]![1]).toBe("workf3");
  });

  it("refuses outside tmux before touching anything", async () => {
    const { tmux, calls } = fakeTmux({});
    const ctx = handlerCtx({ tmux });
    const before = readdirSync(sessionDir);
    await expect(runForkInTmux(ctx)).rejects.toThrow(/not running inside tmux/);
    expect(calls).toEqual([]);
    expect(readdirSync(sessionDir)).toEqual(before);
  });

  it("reports the recovery argv when window spawn fails after the copy exists", async () => {
    const { tmux } = fakeTmux(tmuxEnv, "spawn");
    await expect(runForkInTmux(handlerCtx({ tmux }))).rejects.toThrow(/omp --resume/);
  });
});

describe("registration", () => {
  it("registers both commands with descriptions and rejects arguments", async () => {
    const registered: { name: string; description: string | undefined; handler: (args: string, ctx: ExtensionCommandCtx) => Promise<void> }[] = [];
    const api: ExtensionApiLike = {
      registerCommand: (n: string, options: { description?: string; handler: (args: string, ctx: ExtensionCommandCtx) => Promise<void> }) => {
        registered.push({ name: n, description: options.description, handler: options.handler });
      },
    };
    registerCommands(api, ompSpec());
    expect(registered.map((r) => r.name)).toEqual(["fork-in-herdr", "fork-in-tmux"]);
    expect(registered[0]!.description).toMatch(/herdr/i);
    expect(registered[1]!.description).toMatch(/tmux/i);
    await expect(registered[0]!.handler("extra", {} as ExtensionCommandCtx)).rejects.toThrow(/argument/);
    await expect(registered[1]!.handler("extra", {} as ExtensionCommandCtx)).rejects.toThrow(/argument/);
  });
});
