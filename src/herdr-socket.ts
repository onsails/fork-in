import { randomUUID } from "node:crypto";
import { connect } from "node:net";

/** Moves a tab within its workspace's visual order. Tests substitute fakes. */
export interface TabMover {
  moveTab(opts: { tabId: string; insertIndex: number }): Promise<void>;
}

/**
 * Speaks the herdr socket protocol — newline-delimited JSON over the unix
 * socket at HERDR_SOCKET_PATH — for the one operation the herdr CLI does not
 * expose: tab.move (ADR 0005). One short-lived connection per call.
 */
export class HerdrSocket implements TabMover {
  #path: string | undefined;

  constructor(path: string | undefined = process.env.HERDR_SOCKET_PATH) {
    this.#path = path;
  }

  async moveTab(opts: { tabId: string; insertIndex: number }): Promise<void> {
    await this.#call("tab.move", { tab_id: opts.tabId, insert_index: opts.insertIndex });
  }

  #call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const path = this.#path;
    if (!path) return Promise.reject(new Error(`HERDR_SOCKET_PATH unset — cannot reach the herdr socket for ${method}`));
    const id = `fork-in:${randomUUID()}`;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const socket = connect(path);
    let buffer = "";
    socket.on("connect", () => socket.write(`${JSON.stringify({ id, method, params })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      socket.end();
      const line = buffer.slice(0, newline);
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        reject(new Error(`herdr socket ${method} returned invalid JSON: ${line.slice(0, 200)}`));
        return;
      }
      if (parsed === null || typeof parsed !== "object") {
        reject(new Error(`herdr socket ${method} returned unexpected shape: ${line.slice(0, 200)}`));
        return;
      }
      if ("error" in parsed && parsed.error !== null && typeof parsed.error === "object") {
        const { code, message } = parsed.error as { code?: unknown; message?: unknown };
        reject(new Error(`herdr socket ${method} failed: ${typeof code === "string" ? code : "error"}: ${typeof message === "string" ? message : "unknown"}`));
        return;
      }
      resolve((parsed as { result?: unknown }).result);
    });
    socket.on("error", (error) => reject(new Error(`herdr socket ${method} failed: ${error.message}`)));
    return promise;
  }
}
