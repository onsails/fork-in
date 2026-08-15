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
  — mirroring omp's native `SessionManager.forkFrom()` (session-manager.ts:
  `providerPromptCacheKey: sourceHeader?.providerPromptCacheKey ?? sourceHeader?.id`).
  On content-prefix caching providers this is a no-op; on session-keyed
  providers it routes the fork's requests through the parent's cache lineage,
  matching native `/fork` and `/tan` precedent. Verification on 2026-08-15
  (local `manifest` model proxy, content-prefix caching): key-preserving and
  key-stripped forks resumed identically (both warm, `cacheRead` 25,792 on
  the first resumed turn over a ~2.8k-token unique transcript) — the proxy
  cannot distinguish the regimes, so the keyed-provider benefit is
  source-verified, not measured. Proving the keyed effect requires a
  session-keyed provider (e.g. Anthropic direct).
- omp's `--profile` bootstrap flags are forwarded to the fork's omp; pi has no
  equivalent (`agentArgs: []`).
- `herdr agent start --kind pi` timed out on pi 0.37.8 in every attempt
  (2026-08-15): pi runs and loads extensions in the pane, but herdr's
  readiness detection never fires; root cause not isolated (observed with
  `herdr-agent-state.ts` v8 loaded and extensions green). The tab-fork path
  is identical to omp's (same createTab + startAgent calls, `--kind pi`);
  unblock by fixing herdr's pi detection, not this plugin.
