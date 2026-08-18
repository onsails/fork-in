import { describe, expect, it } from "bun:test";
import { HerdrClient, processRunner, type Runner } from "../src/herdr-client";

function clientWith(commands: { argv: string[]; stdout: string }[]) {
  const seen: string[][] = [];
  const runner: Runner = {
    run: async (argv) => {
      seen.push([...argv]);
      const hit = commands.find((c) => JSON.stringify(c.argv) === JSON.stringify([...argv]));
      if (!hit) throw new Error(`unexpected herdr argv: ${argv.join(" ")}`);
      return hit.stdout;
    },
  };
  return { client: new HerdrClient("omp", runner), seen };
}

const TAB_GET = JSON.stringify({
  id: "cli:tab:get",
  result: { tab: { tab_id: "w14:t1", label: "2", workspace_id: "w14" } },
  type: "tab_info",
});
const TAB_LIST = JSON.stringify({
  id: "cli:tab:list",
  result: { tabs: [
    { tab_id: "w14:t0", label: "1" },
    { tab_id: "w14:t1", label: "2" },
    { tab_id: "w14:t9", label: "2f1" },
  ] },
  type: "tab_list",
});
const TAB_CREATE = JSON.stringify({
  id: "cli:tab:create",
  result: { tab: { tab_id: "w14:t3", label: "2f2" }, root_pane: { pane_id: "w14:p5", tab_id: "w14:t3" } },
  type: "tab_created",
});

describe("herdr client", () => {
  it("currentTab reads label from tab get", async () => {
    const { client } = clientWith([{ argv: ["tab", "get", "w14:t1"], stdout: TAB_GET }]);
    const tab = await client.getTab("w14:t1");
    expect(tab).toEqual({ tabId: "w14:t1", label: "2", workspaceId: "w14" });
  });

  it("listTabs returns tab ids and labels in visual order", async () => {
    const { client } = clientWith([{ argv: ["tab", "list", "--workspace", "w14"], stdout: TAB_LIST }]);
    expect(await client.listTabs("w14")).toEqual([
      { tabId: "w14:t0", label: "1" },
      { tabId: "w14:t1", label: "2" },
      { tabId: "w14:t9", label: "2f1" },
    ]);
  });

  it("createForkTab passes workspace, cwd, label, no-focus; returns tab and pane ids", async () => {
    const { client } = clientWith([
      { argv: ["tab", "create", "--workspace", "w14", "--cwd", "/repo", "--label", "2f2", "--no-focus"], stdout: TAB_CREATE },
    ]);
    const created = await client.createTab({ workspaceId: "w14", cwd: "/repo", label: "2f2" });
    expect(created).toEqual({ paneId: "w14:p5", tabId: "w14:t3" });
  });

  it("moveTab delegates to the socket mover", async () => {
    const moved: { tabId: string; insertIndex: number }[] = [];
    const client = new HerdrClient("omp", processRunner, { moveTab: async (opts) => { moved.push(opts); } });
    await client.moveTab({ tabId: "w14:tF", insertIndex: 2 });
    expect(moved).toEqual([{ tabId: "w14:tF", insertIndex: 2 }]);
  });

  it("startAgent parses the returned agent record", async () => {
    const record = JSON.stringify({ result: { agent: { agent: "fork-w14-2f1", pane_id: "w14:p5", agent_session: { kind: "omp", value: "/tmp/child.jsonl" } } } });
    const { client, seen } = clientWith([
      { argv: ["agent", "start", "fork-w14-2f1", "--kind", "omp", "--pane", "w14:p5", "--", "--fork", "/tmp/source.jsonl"], stdout: record },
    ]);
    await expect(client.startAgent({ paneId: "w14:p5", agentName: "fork-w14-2f1", agentArgs: ["--fork", "/tmp/source.jsonl"] })).resolves.toEqual({ agent: "fork-w14-2f1", paneId: "w14:p5", agentSession: { kind: "omp", value: "/tmp/child.jsonl" } });
    expect(seen).toHaveLength(1);
  });

  it("looks up an agent and handles explicit not-running errors", async () => {
    const record = JSON.stringify({ result: { agent: { agent: "fork-w14-2f1", pane_id: "w14:p5", agent_session: { kind: "omp", value: "/tmp/child.jsonl" } } } });
    const { client } = clientWith([{ argv: ["agent", "get", "w14:p5"], stdout: record }]);
    await expect(client.getAgent("w14:p5")).resolves.toEqual({ agent: "fork-w14-2f1", paneId: "w14:p5", agentSession: { kind: "omp", value: "/tmp/child.jsonl" } });
  });

  it("rejects a malformed agent_session shape", async () => {
    const record = JSON.stringify({ result: { agent: { agent: "fork-w14-2f1", pane_id: "w14:p5", agent_session: { kind: "omp" } } } });
    const { client } = clientWith([{ argv: ["agent", "start", "fork-w14-2f1", "--kind", "omp", "--pane", "w14:p5", "--", "--fork", "/tmp/source.jsonl"], stdout: record }]);
    await expect(client.startAgent({ paneId: "w14:p5", agentName: "fork-w14-2f1", agentArgs: ["--fork", "/tmp/source.jsonl"] })).rejects.toThrow(/agent_session shape/);
  });

  it("preserves malformed and transport failures during agent lookup", async () => {
    const malformed = clientWith([{ argv: ["agent", "get", "w14:p5"], stdout: "{}" }]).client;
    await expect(malformed.getAgent("w14:p5")).rejects.toThrow(/unexpected shape/);
    const failing = new HerdrClient("omp", { run: async () => { throw new Error("transport failed"); } });
    await expect(failing.getAgent("w14:p5")).rejects.toThrow("transport failed");
  });

  it("returns null for an explicit not-running error", async () => {
    const client = new HerdrClient("omp", { run: async () => { throw new Error("agent_not_running"); } });
    await expect(client.getAgent("w14:p5")).resolves.toBeNull();
  });

  it("passes agent arguments after --", async () => {
    const record = JSON.stringify({ result: { agent: { agent: "fork-w14-2f1", pane_id: "w14:p5" } } });
    const { client } = clientWith([{ argv: ["agent", "start", "fork-w14-2f1", "--kind", "omp", "--pane", "w14:p5", "--", "--fork", "/tmp/source.jsonl"], stdout: record }]);
    await client.startAgent({ paneId: "w14:p5", agentName: "fork-w14-2f1", agentArgs: ["--fork", "/tmp/source.jsonl"] });
  });

  it("passes pi as the Herdr agent kind", async () => {
    const seen: string[][] = [];
    const runner: Runner = {
      run: async (argv) => {
        seen.push([...argv]);
        return JSON.stringify({ result: { agent: { agent: "fork-w14-2f2", pane_id: "w14:p6", agent_session: { kind: "pi", value: "/tmp/fork.jsonl" } } } });
      },
    };
    const client = new HerdrClient("pi", runner);
    await client.startAgent({ paneId: "w14:p6", agentName: "fork-w14-2f2", agentArgs: ["--session", "/tmp/fork.jsonl"] });
    expect(seen).toEqual([["agent", "start", "fork-w14-2f2", "--kind", "pi", "--pane", "w14:p6", "--", "--session", "/tmp/fork.jsonl"]]);
  });

  it("fails loudly on a malformed tab-create response", async () => {
    const { client } = clientWith([
      { argv: ["tab", "create", "--workspace", "w14", "--cwd", "/repo", "--label", "x", "--no-focus"], stdout: '{"id":"cli:tab:create","result":{}}' },
    ]);
    await expect(client.createTab({ workspaceId: "w14", cwd: "/repo", label: "x" })).rejects.toThrow(/root_pane/);
  });

  it("propagates a non-zero herdr exit through the client", async () => {
    const runner: Runner = {
      run: async () => {
        throw new Error("herdr tab failed (exit 1): boom");
      },
    };
    await expect(new HerdrClient("omp", runner).getTab("w14:t1")).rejects.toThrow("herdr tab failed (exit 1): boom");
  });

  it("processRunner surfaces exit code and stderr", async () => {
    // `herdr tab get` with no tab id exits non-zero with usage on stderr.
    await expect(processRunner.run(["tab", "get"])).rejects.toThrow(/exit \d+/);
  });
});
