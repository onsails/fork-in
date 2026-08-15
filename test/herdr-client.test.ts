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
  result: { tabs: [{ label: "1" }, { label: "2" }, { label: "2f1" }] },
  type: "tab_list",
});
const TAB_CREATE = JSON.stringify({
  id: "cli:tab:create",
  result: { tab: { tab_id: "w14:t3", label: "2f2" }, root_pane: { pane_id: "w14:p5" } },
  type: "tab_created",
});

describe("herdr client", () => {
  it("currentTab reads label from tab get", async () => {
    const { client } = clientWith([{ argv: ["tab", "get", "w14:t1"], stdout: TAB_GET }]);
    const tab = await client.getTab("w14:t1");
    expect(tab).toEqual({ tabId: "w14:t1", label: "2", workspaceId: "w14" });
  });

  it("existingLabels reads every label from tab list", async () => {
    const { client } = clientWith([{ argv: ["tab", "list", "--workspace", "w14"], stdout: TAB_LIST }]);
    expect(await client.listLabels("w14")).toEqual(["1", "2", "2f1"]);
  });

  it("createForkTab passes workspace, cwd, label, no-focus; returns pane id", async () => {
    const { client, seen } = clientWith([
      { argv: ["tab", "create", "--workspace", "w14", "--cwd", "/repo", "--label", "2f2", "--no-focus"], stdout: TAB_CREATE },
    ]);
    const paneId = await client.createTab({ workspaceId: "w14", cwd: "/repo", label: "2f2" });
    expect(paneId).toBe("w14:p5");
  });

  it("startAgent passes kind as the agent name, pane, and agent args after --", async () => {
    const { client, seen } = clientWith([
      { argv: ["agent", "start", "fork-w14-2f1", "--kind", "omp", "--pane", "w14:p5", "--", "--resume", "abcd"], stdout: "{}" },
    ]);
    await client.startAgent({ paneId: "w14:p5", agentName: "fork-w14-2f1", agentArgs: ["--resume", "abcd"] });
    expect(seen).toEqual([["agent", "start", "fork-w14-2f1", "--kind", "omp", "--pane", "w14:p5", "--", "--resume", "abcd"]]);
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
