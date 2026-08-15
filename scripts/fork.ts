// Proof driver: fork a real session file with the plugin's createForkCopy,
// print the fork path + id. Usage: bun run scripts/fork.ts <session-file>
import { createForkCopy } from "../src/fork-copy";

const src = process.argv[2];
if (!src) throw new Error("usage: bun run scripts/fork.ts <session-file>");
const fork = await createForkCopy(src);
console.log(JSON.stringify(fork));
