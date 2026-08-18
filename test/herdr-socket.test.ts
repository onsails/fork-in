import { afterEach, describe, expect, it } from "bun:test";
import { unlinkSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { HerdrSocket } from "../src/herdr-socket";

const servers: { server: Server; path: string }[] = [];

/** Starts a fake herdr socket: NDJSON in, one NDJSON response per request. */
async function fakeServer(respond: (request: Record<string, unknown>) => Record<string, unknown>) {
  const path = `/tmp/fih-sock-${process.pid}-${crypto.randomUUID()}.sock`;
  const requests: Record<string, unknown>[] = [];
  const server = createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const request = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>;
      requests.push(request);
      socket.end(`${JSON.stringify({ id: request.id, ...respond(request) })}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  servers.push({ server, path });
  return { path, requests };
}

afterEach(() => {
  for (const { server, path } of servers.splice(0)) {
    server.close();
    try {
      unlinkSync(path);
    } catch {
      // Server may never have created the file.
    }
  }
});

describe("herdr socket", () => {
  it("sends tab.move as newline-delimited JSON and resolves on a result", async () => {
    const { path, requests } = await fakeServer(() => ({ result: { type: "ok" } }));
    await new HerdrSocket(path).moveTab({ tabId: "w14:tF", insertIndex: 2 });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "tab.move", params: { tab_id: "w14:tF", insert_index: 2 } });
    expect(requests[0]!.id).toMatch(/^fork-in:/);
  });

  it("rejects with the server error code and message", async () => {
    const { path } = await fakeServer(() => ({ error: { code: "tab_not_found", message: "tab w14:tZZ not found" } }));
    await expect(new HerdrSocket(path).moveTab({ tabId: "w14:tZZ", insertIndex: 0 })).rejects.toThrow(/tab_not_found: tab w14:tZZ not found/);
  });

  it("fails fast when no socket path is configured", async () => {
    await expect(new HerdrSocket("").moveTab({ tabId: "w14:tF", insertIndex: 0 })).rejects.toThrow(/HERDR_SOCKET_PATH/);
  });

  it("rejects when the socket is unreachable", async () => {
    await expect(new HerdrSocket("/tmp/fih-sock-does-not-exist.sock").moveTab({ tabId: "w14:tF", insertIndex: 0 })).rejects.toThrow(/tab\.move/);
  });
});
