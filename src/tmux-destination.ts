import { spawn } from "node:child_process";

/** Runs `tmux <argv...>` and captures stdout; rejects on non-zero exit. */
export const tmuxRunner = {
  run: (argv: readonly string[]): Promise<string> => {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const proc = spawn("tmux", [...argv], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk));
    proc.stderr.on("data", (chunk) => (stderr += chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`tmux ${argv[0]?.toString() ?? ""} failed (exit ${code}): ${stderr.trim()}`));
      }
    });
    return promise;
  },
};

export type TmuxRunner = typeof tmuxRunner;

/** Identity of the pane the command runs in, resolved from $TMUX_PANE. */
export interface TmuxSource {
  sessionId: string;
  windowId: string;
  windowName: string;
  paneId: string;
}

/**
 * The tmux destination: creates the fork window adjacent to the source
 * window with -d (no focus switch), launches the agent argv directly (no
 * shell), and keeps the window open after agent exit for inspection.
 */
export class TmuxDestination {
  #runner: TmuxRunner;
  #env: Record<string, string | undefined>;

  constructor(env: Record<string, string | undefined>, runner: TmuxRunner = tmuxRunner) {
    this.#env = env;
    this.#runner = runner;
  }

  /** True when the command runs inside a tmux pane ($TMUX set). */
  available(): boolean {
    return this.#env.TMUX !== undefined && this.#env.TMUX_PANE !== undefined;
  }

  /** Resolves the source pane's session/window identity from $TMUX_PANE. */
  async source(): Promise<TmuxSource> {
    const paneId = this.#env.TMUX_PANE;
    if (paneId === undefined) {
      throw new Error("fork-in-tmux: not running inside tmux ($TMUX_PANE unset)");
    }
    const out = await this.#runner.run([
      "display-message",
      "-p",
      "-t",
      paneId,
      "-F",
      "#{session_id} #{window_id} #{window_name}",
    ]);
    const parts = out.trim().split(" ");
    if (parts.length !== 3 || !parts[0] || !parts[1]) {
      throw new Error(`fork-in-tmux: tmux display-message returned unexpected shape: ${out.slice(0, 200)}`);
    }
    return { sessionId: parts[0]!, windowId: parts[1]!, windowName: parts[2]!, paneId };
  }

  /** Lists every window name in the source session. */
  async listWindowNames(sessionId: string): Promise<string[]> {
    const out = await this.#runner.run([
      "list-windows",
      "-t",
      sessionId,
      "-F",
      "#{window_name}",
    ]);
    return out
      .split("\n")
      .map((name) => name.trimEnd())
      .filter((name) => name !== "");
  }

  /**
   * Creates the fork window: adjacent to the source window (-a), unfocused
   * (-d), named with the fork label, cwd set, agent argv exec'd directly.
   * Returns the new pane id. Window stays open after agent exit
   * (remain-on-exit) so a failed start is inspectable.
   */
  async spawn(opts: {
    source: TmuxSource;
    cwd: string;
    label: string;
    argv: readonly string[];
  }): Promise<string> {
    const paneId = await this.#runner.run([
      "new-window",
      "-d",
      "-a",
      "-t",
      `${opts.source.sessionId}:${opts.source.windowId}`,
      "-c",
      opts.cwd,
      "-n",
      opts.label,
      "-P",
      "-F",
      "#{pane_id}",
      ...opts.argv,
    ]);
    const newWindowId = await this.#runner.run([
      "display-message",
      "-p",
      "-t",
      paneId.trim(),
      "-F",
      "#{window_id}",
    ]);
    // Both options target the fork window: keep it open after agent exit
    // (remain-on-exit) and pin its fork label (automatic-rename off).
    await this.#runner.run(["set-option", "-w", "-t", newWindowId.trim(), "remain-on-exit", "on"]);
    await this.#runner.run(["set-option", "-w", "-t", newWindowId.trim(), "automatic-rename", "off"]);
    return paneId.trim();
  }
}
