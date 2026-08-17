import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const SUPPORTED_HEADER_VERSION = 3;

function uuidv7(): string {
  const entropy = (randomUUID() + randomUUID()).replaceAll("-", "");
  const timestamp = Date.now().toString(16).padStart(12, "0");
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7${entropy.slice(0, 3)}-8${entropy.slice(3, 6)}-${entropy.slice(6, 18)}`;
}

export interface ForkCopy {
  file: string;
  newId: string;
  parentSession: string;
}

interface SessionHeader {
  type: "session";
  version: number;
  id: string;
  parentSession: string | null;
  [key: string]: unknown;
}

/** Creates the Pi session copy used when no detached native fork exists. */
export async function createForkCopy(sessionFile: string, host: "pi" = "pi"): Promise<ForkCopy> {
  void host;
  let text: string;
  try {
    text = await readFile(sessionFile, "utf8");
  } catch {
    throw new Error(`fork-in: session has no transcript yet — the agent writes the session file on the first turn; send a message before forking (${sessionFile})`);
  }
  const lines = text.trimEnd().split("\n");
  const headerIndex = lines.findIndex((line) => {
    try {
      return (JSON.parse(line) as { type?: string }).type === "session";
    } catch {
      return false;
    }
  });
  if (headerIndex === -1) throw new Error(`fork-in: session file has no session header line: ${sessionFile}`);
  let header: SessionHeader;
  try {
    header = JSON.parse(lines[headerIndex]!) as SessionHeader;
  } catch {
    throw new Error(`fork-in: session header (line ${headerIndex + 1}) is not JSON: ${sessionFile}`);
  }
  if (header.version !== SUPPORTED_HEADER_VERSION) {
    throw new Error(`fork-in: session header version ${String(header.version)} unsupported (expected ${SUPPORTED_HEADER_VERSION}): ${sessionFile}`);
  }
  if (typeof header.id !== "string" || header.id === "") throw new Error(`fork-in: session header has no session id: ${sessionFile}`);
  const newId = uuidv7();
  const newHeader: SessionHeader = { ...header, id: newId, parentSession: sessionFile };
  const content = [...lines.slice(0, headerIndex), JSON.stringify(newHeader), ...lines.slice(headerIndex + 1)].join("\n") + "\n";
  const dir = dirname(sessionFile);
  const newFile = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, -1)}_${newId}.jsonl`);
  await mkdir(dir, { recursive: true });
  await writeFile(newFile, content, { flag: "wx" });
  return { file: newFile, newId, parentSession: sessionFile };
}
