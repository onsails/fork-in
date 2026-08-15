# One package, two agent entries (omp and pi)

The plugin supports both omp and pi as host agents from one repository/package:
`package.json` carries both manifests — `omp: {extensions: ["./src/omp.ts"]}` and
`pi: {extensions: ["./src/pi.ts"]}` — over a shared core (`src/index.ts`). The two
agents share the extension surface this plugin needs (`registerCommand(name,
{description, handler(args, ctx)})`, `ctx.cwd`, `ctx.isIdle()`, `ctx.ui.notify`,
`ctx.sessionManager.getSessionFile()`) and the on-disk session format (JSONL, session
header version 3, `parentSession` lineage); omp is pi-derived. Per-host variance is
confined to a thin entry that supplies a host spec: herdr `--kind`, bootstrap args
(`--profile` passthrough, omp only), and the deterministic resume argv — omp
`--resume <id>` (id resolves only inside the current session dir), pi `--session
<path>` (pi's `--resume` is an interactive picker). pi's `ctx.fork()` was rejected
for the same reason as omp's `/fork`: it switches the current process to the fork —
Conversation-fork, not Tab-fork.

## Consequences

- The fork copy preserves prompt-cache lineage: the copied header carries
  `providerPromptCacheKey = original's key ?? original session id`, mirroring omp's
  native `SessionManager.forkFrom` (verified in oh-my-pi source,
  `session-manager.ts:2558`). Measured on the manifest/openai-completions provider
  (2026-08-15), the fork copy resumed with a warm prefix cache regardless of the key
  (warm first turn `cacheRead 74240/75291`; stripped-key control `75264/75291`) —
  that provider caches by content, not by key. The preserved key still matters for
  providers that route cache by key (omp threads `promptCacheKey` per request,
  `sdk.ts:3209`), and it is what native `/fork` does; dropping it was a divergence
  from omp's own fork semantics (ADR-0001's original "no prompt-cache key" stance is
  superseded).
- The session header is located by scanning for the first session record, not by
  fixed line: omp writes a title record on line 1 (header on line 2), pi writes the
  header on line 1.
- pi has no omp-style sibling artifact directory (bash output goes to the OS tmpdir,
  referenced by entry fields), so the recursive artifact copy is a no-op under pi.
