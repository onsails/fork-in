import { spawn } from "node:child_process";

/**
 * Executes a herdr CLI invocation: argv without the leading "herdr",
 * returns stdout. Implementations must reject when herdr exits non-zero
 * (error text includes stderr).
 */
export interface Runner {
  run(argv: readonly string[]): Promise<string>;
}

/** Runs `herdr <argv...>` and captures stdout; rejects on non-zero exit. */
export const processRunner: Runner = {
  run: (argv) => {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const proc = spawn("herdr", [...argv], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk));
    proc.stderr.on("data", (chunk) => (stderr += chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`herdr ${argv[0]?.toString() ?? ""} failed (exit ${code}): ${stderr.trim()}`));
      } else {
        resolve(stdout);
      }
    });
    return promise;
  },
};

export interface AgentSession {
  kind: string;
  value: string;
}

export interface AgentRecord {
  agent: string;
  paneId: string;
  agentSession?: AgentSession;
}

function parseAgentRecord(out: string, operation: string): AgentRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error(`${operation} returned invalid JSON: ${out.slice(0, 200)}`);
  }
  if (parsed === null || typeof parsed !== "object" || !("result" in parsed) || parsed.result === null || typeof parsed.result !== "object" || !("agent" in parsed.result) || parsed.result.agent === null || typeof parsed.result.agent !== "object") {
    throw new Error(`${operation} returned unexpected shape: ${out.slice(0, 200)}`);
  }
  const record = parsed.result.agent;
  if (!("agent" in record) || typeof record.agent !== "string" || !("pane_id" in record) || typeof record.pane_id !== "string") {
    throw new Error(`${operation} returned unexpected shape: ${out.slice(0, 200)}`);
  }
  let agentSession: AgentSession | undefined;
  if ("agent_session" in record && record.agent_session !== undefined) {
    const session = record.agent_session;
    if (session === null || typeof session !== "object" || !("kind" in session) || typeof session.kind !== "string" || !("value" in session) || typeof session.value !== "string") {
      throw new Error(`${operation} returned unexpected agent_session shape: ${out.slice(0, 200)}`);
    }
    agentSession = { kind: session.kind, value: session.value };
  }
  return { agent: record.agent, paneId: record.pane_id, ...(agentSession ? { agentSession } : {}) };
}

function isAgentNotRunning(error: unknown): boolean {
  return error instanceof Error && /agent_not_running|agent not running|not found/i.test(error.message);
}

 /** The herdr operations the fork pipeline needs; tests substitute fakes. */
export interface HerdrLike {
  getTab(tabId: string): Promise<Tab>;
  listLabels(workspaceId: string): Promise<string[]>;
  createTab(opts: { workspaceId: string; cwd: string; label: string }): Promise<string>;
  startAgent(opts: { paneId: string; agentName: string; agentArgs: readonly string[] }): Promise<AgentRecord>;
  getAgent(paneId: string): Promise<AgentRecord | null>;
}

export interface Tab {
  tabId: string;
  label: string;
  workspaceId: string;
}
/**
 * The single choke point for every herdr interaction (spec: all invocations
 * JSON in, JSON out). Constructed with the Runner it should use; tests
 * substitute a recording fake.
 */
export class HerdrClient {
  #runner: Runner;
  #kind: "omp" | "pi";

  constructor(kind: "omp" | "pi" = "omp", runner: Runner = processRunner) {
    this.#kind = kind;
    this.#runner = runner;
  }

  async getTab(tabId: string): Promise<Tab> {
    const out = await this.#runner.run(["tab", "get", tabId]);
    const parsed = JSON.parse(out) as { result?: { tab?: { tab_id?: string; label?: string; workspace_id?: string } } };
    const tab = parsed.result?.tab;
    if (!tab?.tab_id || tab.label === undefined || !tab.workspace_id) {
      throw new Error(`herdr tab get returned unexpected shape: ${out.slice(0, 200)}`);
    }
    return { tabId: tab.tab_id, label: tab.label, workspaceId: tab.workspace_id };
  }

  async listLabels(workspaceId: string): Promise<string[]> {
    const out = await this.#runner.run(["tab", "list", "--workspace", workspaceId]);
    const parsed = JSON.parse(out) as { result?: { tabs?: { label?: string }[] } };
    const tabs = parsed.result?.tabs;
    if (!Array.isArray(tabs)) {
      throw new Error(`herdr tab list returned unexpected shape: ${out.slice(0, 200)}`);
    }
    return tabs.map((t) => t.label).filter((l): l is string => typeof l === "string");
  }

  async createTab(opts: { workspaceId: string; cwd: string; label: string }): Promise<string> {
    const out = await this.#runner.run([
      "tab",
      "create",
      "--workspace",
      opts.workspaceId,
      "--cwd",
      opts.cwd,
      "--label",
      opts.label,
      "--no-focus",
    ]);
    const parsed = JSON.parse(out) as { result?: { root_pane?: { pane_id?: string } } };
    const paneId = parsed.result?.root_pane?.pane_id;
    if (typeof paneId !== "string") {
      throw new Error(`herdr tab create response has no .result.root_pane.pane_id: ${out.slice(0, 200)}`);
    }
    return paneId;
  }

  async startAgent(opts: { paneId: string; agentName: string; agentArgs: readonly string[] }): Promise<AgentRecord> {
    const out = await this.#runner.run([
      "agent",
      "start",
      opts.agentName,
      "--kind",
      this.#kind,
      "--pane",
      opts.paneId,
      "--",
      ...opts.agentArgs,
    ]);
    return parseAgentRecord(out, "herdr agent start");
  }

  async getAgent(paneId: string): Promise<AgentRecord | null> {
    try {
      const out = await this.#runner.run(["agent", "get", paneId]);
      return parseAgentRecord(out, "herdr agent get");
    } catch (error) {
      if (isAgentNotRunning(error)) return null;
      throw error;
    }
  }
}
