import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createForkCopy } from "../src/fork-copy";

let sessionDir: string;

beforeAll(() => {
  sessionDir = `/tmp/fih-test-${process.pid}-${Date.now()}`;
  mkdirSync(sessionDir, { recursive: true });
});

afterAll(() => {
  rmSync(sessionDir, { recursive: true, force: true });
});

function writeFixture(dir: string, id: string): string {
  const name = `2026-08-14T22-55-27-165Z_${id}`;
  const file = join(dir, `${name}.jsonl`);
  writeFileSync(
    file,
    [
      JSON.stringify({ type: "title", v: 1, title: "fixture", updatedAt: "2026-08-14T22:55:27.165Z" }),
      JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-08-14T22:55:27.165Z", cwd: "/repo", parentSession: null }),
      JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-08-14T22:55:30.000Z" }),
    ].join("\n") + "\n",
  );
  return file;
}

describe("createForkCopy", () => {
  it("copies JSONL with a fresh UUIDv7 id and source-path lineage", async () => {
    const oldId = "01a0028a-3480-7000-8a93-16440ac9433f";
    const file = writeFixture(sessionDir, oldId);
    const fork = await createForkCopy(file);
    expect(fork.file.startsWith(sessionDir)).toBe(true);
    expect(fork.file).not.toEqual(file);
    expect(fork.parentSession).toBe(file);
    expect(fork.newId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(fork.newId).not.toBe(oldId);

    const lines = (await Bun.file(fork.file).text()).trimEnd().split("\n");
    const origLines = (await Bun.file(file).text()).trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(origLines[0]);
    expect(lines[2]).toBe(origLines[2]);
    const header = JSON.parse(lines[1]!);
    expect(header.id).toBe(fork.newId);
    expect(header.parentSession).toBe(file);
    expect(header).not.toHaveProperty("providerPromptCacheKey");
  });

  it("does not create an artifact directory", async () => {
    const file = writeFixture(sessionDir, "01a0027c-c7bd-7000-b453-51d950f04951");
    const fork = await createForkCopy(file);
    expect(await Bun.file(fork.file).exists()).toBe(true);
    expect(await Bun.file(fork.file.slice(0, -".jsonl".length)).exists()).toBe(false);
  });

  it("finds the session header after a title record", async () => {
    const file = writeFixture(sessionDir, "01a0028a-3480-7000-8a93-16440ac9433f");
    const fork = await createForkCopy(file);
    const header = JSON.parse((await Bun.file(fork.file).text()).split("\n")[1]!);
    expect(header.parentSession).toBe(file);
  });

  it("refuses a session file with no session header", async () => {
    const bad = join(sessionDir, "bad-header.jsonl");
    writeFileSync(bad, `${JSON.stringify({ type: "title" })}\n${JSON.stringify({ type: "message" })}\n`);
    await expect(createForkCopy(bad)).rejects.toThrow(/no session header line/);
  });

  it("refuses a missing transcript", async () => {
    const pending = join(sessionDir, "missing.jsonl");
    await expect(createForkCopy(pending)).rejects.toThrow(/no transcript yet/);
  });

  it("refuses an unsupported session header version", async () => {
    const bad = join(sessionDir, "bad-version.jsonl");
    writeFileSync(bad, `${JSON.stringify({ type: "session", version: 4, id: "x" })}\n`);
    await expect(createForkCopy(bad)).rejects.toThrow(/version/);
  });
});
