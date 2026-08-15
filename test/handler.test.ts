import { beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runForkInHerdr, registerForkInHerdr, ompSpec } from "../src/index";
import type { ExtensionApiLike, ExtensionCommandCtx, HandlerCtx, HerdrLike } from "../src/index";

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
    getTab: async (tabId) => {
      calls.push(`getTab:${tabId}`);

      if (failAt === "getTab") throw new Error("herdr tab get failed (exit 1): boom");
      return { tabId, label: "2", workspaceId: "w14" };
    },
    listLabels: async (ws) => {
      calls.push(`listLabels:${ws}`);
      if (failAt === "listLabels") throw new Error("herdr tab list failed (exit 1): boom");
      return ["1", "2", "2f1"];
    },
    createTab: async (opts) => {
      calls.push(`createTab:${opts.workspaceId}:${opts.cwd}:${opts.label}`);
      if (failAt === "createTab") throw new Error("herdr tab create failed (exit 1): boom");
      return "w14:p5";
    },
    startAgent: async (opts) => {
      calls.push(`startAgent:${opts.paneId}:${opts.agentName}:${opts.agentArgs.join(",")}`);
      if (failAt === "startAgent") throw new Error("herdr agent start failed (exit 1): timeout");
    },
  };
  return { herdr, calls };
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
  };
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

    const forkFile = readdirSync(sessionDir).find((f) => f.endsWith(".jsonl") && !f.endsWith(`${ORIGINAL_ID}.jsonl`));
    expect(forkFile).toBeDefined();
    const header = JSON.parse((await Bun.file(join(sessionDir, forkFile!)).text()).split("\n")[1]!) as {
      id: string;
      parentSession: string;
    };
    expect(header.parentSession).toBe(ORIGINAL_ID);
    expect(calls).toEqual([
      "getTab:w14:t1",
      "listLabels:w14",
      "createTab:w14:/repo:2f2",
      `startAgent:w14:p5:fork-w14-2f2:--resume,${header.id}`,
    ]);
    expect((await Bun.file(ctx.sessionFile).text()).trimEnd().split("\n")).toHaveLength(2);
  });

  it("forwards the running omp's profile to the forked omp", async () => {
    const { herdr, calls } = fakeHerdr();
  await runForkInHerdr(handlerCtx({ herdr, spec: { ...ompSpec(), agentArgs: ["--profile", "work"] } }));
    expect(calls.find((c) => c.startsWith("startAgent:"))).toMatch(/--profile,work,--resume,/);
  });

  it("retries agent start when the pane is not ready, then succeeds", async () => {
    const calls: string[] = [];
    let attempts = 0;
    const herdr: HerdrLike = {
      getTab: async (tabId) => ({ tabId, label: "2", workspaceId: "w14" }),
      listLabels: async () => ["2"],
      createTab: async () => "w14:p5",
      startAgent: async (opts) => {
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
    await expect(runForkInHerdr(ctx)).rejects.toThrow(/inside herdr/);
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
});

describe("registration", () => {
  it("registers /fork-in-herdr with a description and rejects arguments", async () => {
    let name = "";
    let description: string | undefined;
    let handler: ((args: string, ctx: ExtensionCommandCtx) => Promise<void>) | undefined;
    const api: ExtensionApiLike = {
      registerCommand: (n, options) => {
        name = n;
        description = options.description;
        handler = options.handler;
      },
    };
    registerForkInHerdr(api, ompSpec());
    expect(name).toBe("fork-in-herdr");
    expect(description).toMatch(/herdr/i);
    expect(handler).toBeDefined();
    await expect(handler!("extra", {} as ExtensionCommandCtx)).rejects.toThrow(/argument/);
  });
});
