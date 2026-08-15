# Universal plugin: one package, two agent entries

The plugin is universal: one repo installs under both omp and pi. omp and pi
share the pi-derived extension surface (`registerCommand(name, {description,
handler(args, ctx)})`, `ctx.cwd`, `ctx.isIdle()`, `ctx.ui.notify`,
`ctx.sessionManager.getSessionFile()`) and the JSONL v3 session format
(`{"type":"session","version":3,...}` header, `parentSession` lineage). The
package therefore carries two manifests — `omp: {extensions: ["./src/omp.ts"]}`
and `pi: {extensions: ["./src/pi.ts"]}` — over a shared core; the entries
differ only in launch flags: omp resumes by id (`omp --resume <newId>`), pi by
path (`pi --session <file>`; pi's `--resume` is an interactive picker). pi's
session header is line 1 (omp's is line 2 behind a title record), so the fork
copy locates the header by scan, not position. pi has no sibling artifact
directory; the artifact copy is a no-op there.

pi's reachable `ctx.fork(entryId)` was rejected again for the same reason as
omp's in ADR-0001: it switches the current process to the fork —
Conversation-fork semantics — and cannot produce a separate herdr tab.

## Consequences

- The fork copy preserves the prompt-cache lineage:
  `providerPromptCacheKey` = the original's key, or its session id when absent
  — mirroring omp's native `SessionManager.forkFrom()`. On content-prefix
  caching providers (e.g. proxies pooling models) this is a no-op; on
  session-keyed providers it routes the fork's first request to the parent's
  warm cache shard, matching native `/fork` and `/tan` precedent. Measured
  2026-08-15 on a manifest proxy: both key-preserving and key-stripped forks
  hit cache on the first resumed turn (~81k tokens cacheRead), because that
  backend caches by content prefix.
- omp's `--profile` bootstrap flags are forwarded to the fork's omp; pi has no
  equivalent (`agentArgs: []`).
- herdr's `agent start --kind pi` currently times out on pi 0.37 because the
  remote detection manifest (2026.06.10.1) defines no idle rule for pi's
  footer. The tab-fork path is identical to omp's (same createTab + startAgent
  calls, `--kind pi`); unblock by fixing herdr's pi detection, not this plugin.
