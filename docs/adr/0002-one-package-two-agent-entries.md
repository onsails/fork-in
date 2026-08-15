# One package, two agent entries (omp and pi)

`/fork-in-herdr` must run inside both omp and pi: the two agents share a
pi-derived extension surface (`registerCommand(name, {description, handler(args, ctx)})`
with `ctx.cwd`, `ctx.isIdle()`, `ctx.ui.notify`, `ctx.sessionManager.getSessionFile()`)
and a compatible session format (JSONL, `{"type":"session","version":3,...}` header,
`parentSession` lineage). We ship one package whose `package.json` declares both
manifests — `omp: {extensions: ["./src/omp.ts"]}` and `pi: {extensions: ["./src/pi.ts"]}` —
and one shared core. The thin per-agent entries differ only in host facts: herdr's
`agent start --kind` (omp|pi), launch flags (`omp --resume <id>` with `--profile`
passthrough; `pi --session <path>`, since pi's `--resume` is an interactive picker),
and bootstrap-arg capture (pi has no `--profile`).

The fork copy now preserves the parent's prompt-cache lineage:
`providerPromptCacheKey = the original header's key, or the original session id`
— mirroring omp's native `SessionManager.forkFrom()` — instead of dropping it.
On providers with explicit cache routing (Anthropic-style) the resumed fork's
first turn hits the parent's warm cache, matching native `/fork` semantics;
concurrent key sharing follows omp's own `/tan` precedent. pi headers carry no
such field, so there it is a future-proofing no-op.

Rejected: runtime host detection in a single entry (heuristic bug farm); using
pi's `ctx.fork()` (switches the *current* process to the fork — Conversation-fork
semantics, cannot produce a separate herdr tab).

## Consequences

- Source must stay loadable by pi's jiti transform, not just Bun: no optional
  catch binding inside callback position (a `findIndex` predicate with `try {}
  catch {}` failed to parse and silently skipped extension discovery). Parse
  all lines up front instead.
- pi's session header is line 1 (no title record); omp's is line 2. The fork
  copy scans for the first session record instead of assuming a position.
- pi has no sibling artifact directory (bash logs go to OS tmpdir referenced
  by entry fields); the artifact copy is a no-op there.
- omp resume-by-id resolves inside the current session directory, so the fork
  copy is written beside the original in both agents (harmless symmetry for pi).
- Cache-key A/B was verified structurally in omp source (header key adopted on
  resume, routed per request) and end-to-end resume+cacheRead observed on
  OpenAI content-addressed caching, where the key is not the deciding factor.
