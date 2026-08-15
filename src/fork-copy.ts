import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const SUPPORTED_HEADER_VERSION = 3;

/**
 * UUIDv7 (time-ordered, omp-native session-id format) built from Node's
 * randomUUID entropy: 48-bit ms timestamp, version 7, RFC variant.
 */
function uuidv7(): string {
  const e = (randomUUID() + randomUUID()).replaceAll("-", "");
  const ts = Date.now().toString(16).padStart(12, "0");
  return `${ts.slice(0, 8)}-${ts.slice(8)}-7${e.slice(0, 3)}-8${e.slice(3, 6)}-${e.slice(6, 18)}`;
}
export interface ForkCopy {
  /** Absolute path of the fork copy JSONL (inside the original's session dir). */
  file: string;
  /** The fork copy's fresh session id (UUIDv7, omp-native format). */
  newId: string;
  /** Native lineage reference: omp source id; pi source file path. */
  parentSession: string;
  /** Absolute path of the copied artifact directory, or null if the original had none. */
  artifactDir: string | null;
}

interface SessionHeader {
  type: "session";
  version: number;
  id: string;
  cwd: string;
  parentSession: string | null;
  providerPromptCacheKey?: string;
  [key: string]: unknown;
}

/**
 * Creates the fork copy of a session file (ADR-0001, ADR-0002): a new JSONL
 * in the same session directory whose header carries a fresh UUIDv7 id,
 * parentSession = the original id, and the original's prompt-cache lineage
 * (providerPromptCacheKey = the original's key, or its session id — mirroring
 * omp's native forkFrom, which routes on the header id when no explicit key
 * exists); every other line is byte-identical. The session header is located
 * by scanning for the first session record: omp puts a title record on
 * line 1 (header on line 2), pi's header is line 1. The sibling artifact
 * directory (omp) is copied recursively when present, so artifact://
 * references keep resolving.
 */
export async function createForkCopy(sessionFile: string, host: "omp" | "pi" = "omp"): Promise<ForkCopy> {
  let text: string;
  try {
    text = await readFile(sessionFile, "utf8");
  } catch {
    throw new Error(
      `fork-in: session has no transcript yet — the agent writes the session file on the first turn; send a message before forking (${sessionFile})`,
    );
  }
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();

  const parsed = lines.map((line) => {
    try {
      return JSON.parse(line) as { type?: string };
    } catch {
      return { type: undefined };
    }
  });
  const headerIndex = parsed.findIndex((entry) => entry.type === "session");
  if (headerIndex === -1) {
    throw new Error(`fork-in: session file has no session header line: ${sessionFile}`);
  }

  let header: SessionHeader;
  try {
    header = JSON.parse(lines[headerIndex]!) as SessionHeader;
  } catch {
    throw new Error(`fork-in: session header (line ${headerIndex + 1}) is not JSON: ${sessionFile}`);
  }
  if (header.version !== SUPPORTED_HEADER_VERSION) {
    throw new Error(
      `fork-in: session header version ${String(header.version)} unsupported (expected ${SUPPORTED_HEADER_VERSION}): ${sessionFile}`,
    );
  }
  if (typeof header.id !== "string" || header.id === "") {
    throw new Error(`fork-in: session header has no session id: ${sessionFile}`);
  }

  const newId = uuidv7();
  const { providerPromptCacheKey: inheritedKey, ...rest } = header;
  const parentSession = host === "pi" ? sessionFile : header.id;
  const newHeader: SessionHeader = {
    ...rest,
    id: newId,
    parentSession,
    ...(host === "omp" ? { providerPromptCacheKey: inheritedKey ?? header.id } : {}),
  };
  const content = [
    ...lines.slice(0, headerIndex),
    JSON.stringify(newHeader),
    ...lines.slice(headerIndex + 1),
  ].join("\n") + "\n";

  const dir = dirname(sessionFile);
  const newFile = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, -1)}_${newId}.jsonl`);
  await mkdir(dir, { recursive: true });
  await writeFile(newFile, content, { flag: "wx" });

  const originalArtifactDir = sessionFile.slice(0, -".jsonl".length);
  let artifactDir: string | null = null;
  if (existsSync(originalArtifactDir)) {
    artifactDir = newFile.slice(0, -".jsonl".length);
    await cp(originalArtifactDir, artifactDir, { recursive: true });
  }

  return { file: newFile, newId, parentSession, artifactDir };
}
