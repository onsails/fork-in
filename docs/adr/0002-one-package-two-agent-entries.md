# One package, two agent entries: omp and pi

The plugin must register `/fork-in-herdr` in both omp and pi, whose extension
surfaces are near-identical (omp is pi-derived: same `registerCommand(name,
{description, handler(args, ctx)})`, same `cwd`/`isIdle()`/`ui.notify`/
`sessionManager.getSessionFile()`, same JSONL v3 session format). We ship one
package with two thin entries (`src/omp.ts`, `src/pi.ts`) — each agent's
manifest key (`omp.extensions` / `pi.extensions` in `package.json`) points at
its own entry — over a shared core that is parametrized only by an
`AgentHostSpec`: herdr's `agent start --kind`, bootstrap args to forward
(omp `--profile`; pi none), and the deterministic resume argv (omp
`--resume <id>`; pi `--session <path>`, because pi's `--resume` is an
interactive picker). Runtime host detection was rejected: static entries
cannot misdetect.

The fork copy now preserves the original's prompt-cache lineage:
`providerPromptCacheKey` = the original header's key, or its session id —
mirroring omp's native `SessionManager.forkFrom` — so the resumed fork reads
the parent's warm provider cache exactly like native `/fork`. pi headers have
no such field; preserving it is a forward-compatible no-op there today.

## Consequences

- Both agents' `/fork` (pi's `ctx.fork` included) switch the *current*
  process's session — Conversation-fork. The plugin-side copy remains the
  only mechanism that yields a separate, independent herdr tab.
- The session header is located by scanning for the first `type ===
  "session"` line (omp: line 2 behind a title record; pi: line 1).
- pi keeps no sibling artifact directory (bash logs go to the OS tmpdir and
  are referenced by entry fields); the artifact copy is a no-op under pi.
