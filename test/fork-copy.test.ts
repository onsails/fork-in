import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * Writes a fixture session: <ts>_<uuid>.jsonl (title line, session header
 * line 2, one entry) plus a sibling artifact dir with entries.
 */
function writeFixture(dir: string, id: string): { file: string; artifactDir: string } {
  const name = `2026-08-14T22-55-27-165Z_${id}`;
  const file = join(dir, `${name}.jsonl`);
  writeFileSync(
    file,
    [
      JSON.stringify({ type: "title", v: 1, title: "fixture", updatedAt: "2026-08-14T22:55:27.165Z" }),
      JSON.stringify({
        type: "session",
        version: 3,
        id,
        timestamp: "2026-08-14T22:55:27.165Z",
        cwd: "/home/wb/dev/os/fork-in",
        parentSession: null,
        providerPromptCacheKey: id,
      }),
      JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-08-14T22:55:30.000Z" }),
    ].join("\n") + "\n",
  );
  const artifactDir = join(dir, name);
  mkdirSync(artifactDir);
  writeFileSync(join(artifactDir, "1.read.log"), "tool log");
  mkdirSync(join(artifactDir, "url-search"));
  writeFileSync(join(artifactDir, "url-search", "0.read.log"), "nested");
  return { file, artifactDir };
}

describe("createForkCopy", () => {
  it("copies the JSONL with a fresh UUIDv7 id and correct lineage", async () => {
    const oldId = "01a0028a-3480-7000-8a93-16440ac9433f";
    const { file } = writeFixture(sessionDir, oldId);
    const fork = await createForkCopy(file);
    expect(fork.file.startsWith(sessionDir)).toBe(true);
    expect(fork.file).not.toEqual(file);
    expect(fork.parentSession).toBe(oldId);
    // fresh UUIDv7: version nibble 7 at position 14, variant nibble 8/9/a/b at 19
    expect(fork.newId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(fork.newId).not.toBe(oldId);

    const lines = (await Bun.file(fork.file).text()).trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    // line 1 (title) and lines 3+ (entries) byte-identical
    const origLines = (await Bun.file(file).text()).trimEnd().split("\n");
    expect(lines[0]).toBe(origLines[0]);
    expect(lines[2]).toBe(origLines[2]);
    // header: new id, lineage, prompt-cache lineage preserved
    const header = JSON.parse(lines[1]!);
    expect(header.id).toBe(fork.newId);
    expect(header.parentSession).toBe(oldId);
    expect(header.providerPromptCacheKey).toBe(oldId);
    expect(header.cwd).toBe("/home/wb/dev/os/fork-in");
    expect(header.version).toBe(3);
  });

  it("copies the sibling artifact directory recursively", async () => {
    const oldId = "01a0028a-0f3f-7000-9bde-457df9d160a1";
    const { file, artifactDir } = writeFixture(sessionDir, oldId);
    const fork = await createForkCopy(file);

    expect(fork.artifactDir).not.toBeNull();
    expect(fork.artifactDir!.startsWith(sessionDir)).toBe(true);
    expect(readdirSync(fork.artifactDir!).sort()).toEqual(readdirSync(artifactDir).sort());
    expect(await Bun.file(join(fork.artifactDir!, "1.read.log")).text()).toBe("tool log");
    expect(await Bun.file(join(fork.artifactDir!, "url-search", "0.read.log")).text()).toBe("nested");
  });

  it("works when the session has no artifact directory", async () => {
    const oldId = "01a0027c-c7bd-7000-b453-51d950f04951";
    const { file } = writeFixture(sessionDir, oldId);
    const dir = file.slice(0, -".jsonl".length);
    rmSync(dir, { recursive: true, force: true });
    const fork = await createForkCopy(file);
    expect(await Bun.file(fork.file).exists()).toBe(true);
  });

  it("finds the session header at any line (pi: line 1, omp: line 2)", async () => {
    const piStyle = join(sessionDir, "pi-header-line1.jsonl");
    writeFileSync(
      piStyle,
      [
        JSON.stringify({ type: "session", version: 3, id: "01a0028a-3480-7000-8a93-16440ac9433f", timestamp: "t", cwd: "/", parentSession: null }),
        JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "t" }),
      ].join("\n") + "\n",
    );
    const fork = await createForkCopy(piStyle, "pi");
    const lines = (await Bun.file(fork.file).text()).trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    const header = JSON.parse(lines[0]!);
    expect(header.id).toBe(fork.newId);
    expect(header.parentSession).toBe(piStyle);
    expect(header).not.toHaveProperty("providerPromptCacheKey");
    expect(lines[1]).toContain('"m1"');
  });

  it("refuses a session file with no session header at all", async () => {
    const bad = join(sessionDir, "bad-header.jsonl");
    writeFileSync(
      bad,
      [
        JSON.stringify({ type: "title", v: 1, title: "" }),
        JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "t" }),
      ].join("\n") + "\n",
    );
    await expect(createForkCopy(bad)).rejects.toThrow(/no session header line/);
  });

  it("refuses a session whose transcript has not been written yet (ENOENT case)", async () => {
    const pending = join(sessionDir, "2026-08-15T01-06-27-312Z_01a002f4-b770-7000-8419-0719e32835fb.jsonl");
    await expect(createForkCopy(pending)).rejects.toThrow(/no transcript yet/);
  });

  it("refuses an unsupported session header version", async () => {
    const bad = join(sessionDir, "bad-version.jsonl");
    writeFileSync(
      bad,
      [
        JSON.stringify({ type: "session", version: 4, id: "x", cwd: "/" }),
      ].join("\n") + "\n",
    );
    await expect(createForkCopy(bad)).rejects.toThrow(/version/);
  });
});
