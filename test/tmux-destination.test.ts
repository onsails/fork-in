import { describe, expect, it } from "bun:test";
import { TmuxDestination, type TmuxRunner } from "../src/tmux-destination";

/** Recording runner with canned argv→stdout answers. */
function runnerWith(answers: { argv: string[]; stdout: string }[]) {
  const seen: string[][] = [];
  const runner: TmuxRunner = {
    run: async (argv) => {
      seen.push([...argv]);
      const hit = answers.find((a) => JSON.stringify(a.argv) === JSON.stringify([...argv]));
      if (!hit) throw new Error(`unexpected tmux argv: ${argv.join(" ")}`);
      return hit.stdout;
    },
  };
  return { runner, seen };
}

const ENV = { TMUX: "/tmp/tmux-1000/default,100,0", TMUX_PANE: "%11" };

describe("TmuxDestination", () => {
  it("is available only when $TMUX and $TMUX_PANE are set", () => {
    expect(new TmuxDestination(ENV).available()).toBe(true);
    expect(new TmuxDestination({}).available()).toBe(false);
    expect(new TmuxDestination({ TMUX_PANE: "%11" }).available()).toBe(false);
  });

  it("resolves the source pane identity via display-message", async () => {
    const { runner, seen } = runnerWith([
      { argv: ["display-message", "-p", "-t", "%11", "-F", "#{session_id} #{window_id} #{window_name}"], stdout: "$3 @7 work\n" },
    ]);
    const source = await new TmuxDestination(ENV, runner).source();
    expect(source).toEqual({ sessionId: "$3", windowId: "@7", windowName: "work", paneId: "%11" });
    expect(seen).toHaveLength(1);
  });

  it("refuses source() outside tmux", async () => {
    await expect(new TmuxDestination({}).source()).rejects.toThrow(/TMUX_PANE unset/);
  });

  it("lists window names in the session", async () => {
    const { runner } = runnerWith([
      { argv: ["list-windows", "-t", "$3", "-F", "#{window_name}"], stdout: "work\nlogs\nworkf1\n" },
    ]);
    expect(await new TmuxDestination(ENV, runner).listWindowNames("$3")).toEqual(["work", "logs", "workf1"]);
  });

  it("creates the adjacent unfocused window and pins its name", async () => {
    const { runner, seen } = runnerWith([
      {
        argv: ["new-window", "-d", "-a", "-t", "$3:@7", "-c", "/repo", "-n", "workf1", "-P", "-F", "#{pane_id}", "omp", "--fork", "/tmp/source.jsonl"],
        stdout: "%12\n",
      },
      { argv: ["display-message", "-p", "-t", "%12", "-F", "#{window_id}"], stdout: "@9\n" },
      { argv: ["set-option", "-w", "-t", "@9", "remain-on-exit", "on"], stdout: "" },
      { argv: ["set-option", "-w", "-t", "@9", "automatic-rename", "off"], stdout: "" },
    ]);
    const paneId = await new TmuxDestination(ENV, runner).spawn({
      source: { sessionId: "$3", windowId: "@7", windowName: "work", paneId: "%11" },
      cwd: "/repo",
      label: "workf1",
      argv: ["omp", "--fork", "/tmp/source.jsonl"],
    });
    expect(paneId).toBe("%12");
    expect(seen[2]).toEqual(["set-option", "-w", "-t", "@9", "remain-on-exit", "on"]);
    expect(seen[3]).toEqual(["set-option", "-w", "-t", "@9", "automatic-rename", "off"]);
  });

  it("propagates a tmux failure", async () => {
    const runner: TmuxRunner = {
      run: async (argv) => {
        if (argv[0] === "new-window") throw new Error("tmux new-window failed (exit 1): no server");
        return "";
      },
    };
    await expect(
      new TmuxDestination(ENV, runner).spawn({
        source: { sessionId: "$3", windowId: "@7", windowName: "work", paneId: "%11" },
        cwd: "/repo",
        label: "workf1",
        argv: ["omp"],
      }),
    ).rejects.toThrow(/no server/);
  });
});
