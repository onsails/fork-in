// Cold control for the cache proof: same fork copy createForkCopy makes,
// but with providerPromptCacheKey stripped from the header — the pre-fix
// behavior. Usage: bun run scripts/fork-cold.ts <session-file>
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const src = process.argv[2];
if (!src) throw new Error("usage: bun run scripts/fork-cold.ts <session-file>");

const text = await Bun.file(src).text();
const lines = text.split("\n");
if (lines.at(-1) === "") lines.pop();
const headerIndex = lines.findIndex((line) => {
  try {
    return (JSON.parse(line) as { type?: string }).type === "session";
  } catch {
    return false;
  }
});
const header = JSON.parse(lines[headerIndex]!) as { id: string; providerPromptCacheKey?: string };
const newId = Bun.randomUUIDv7();
const cold: Record<string, unknown> = { ...header, id: newId, parentSession: header.id };
delete cold.providerPromptCacheKey;
const content = [...lines.slice(0, headerIndex), JSON.stringify(cold), ...lines.slice(headerIndex + 1)].join("\n") + "\n";
const dir = dirname(src);
const newFile = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, -1)}_${newId}.jsonl`);
await mkdir(dir, { recursive: true });
await writeFile(newFile, content, { flag: "wx" });
try {
  await copyFile(src.slice(0, -".jsonl".length), newFile.slice(0, -".jsonl".length));
} catch {
  // no artifact dir — fine
}
console.log(JSON.stringify({ file: newFile, newId, parentSession: header.id }));
