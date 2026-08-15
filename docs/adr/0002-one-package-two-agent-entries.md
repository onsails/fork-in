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

- Under omp, the fork copy preserves prompt-cache lineage: the copied header carries
  `providerPromptCacheKey = original's key ?? original session id`, mirroring omp's
  native `SessionManager.forkFrom` (`session-manager.ts:2558`). A live fork test on
  2026-08-15 proved the copied session resumed warm (`cacheRead: 83456`, `input: 547`).
  A key-stripped control also resumed warm (`cacheRead: 75264`, `input: 2130`) because
  that provider caches identical transcript prefixes by content. Therefore the test
  proves warm fork behavior, but does not isolate the key's marginal effect. pi has no
  equivalent header field; it starts with its fresh session id on key-routed providers.
- Lineage uses each host's native representation: omp writes the source session id to
  `parentSession`; pi writes the source session file path.
- The session header is located by scanning for the first session record, not by
  fixed line: omp writes a title record on line 1 (header on line 2), pi writes the
  header on line 1.
- pi has no omp-style sibling artifact directory (bash output goes to the OS tmpdir,
  referenced by entry fields), so the recursive artifact copy is a no-op under pi.
- Live herdr verification on 2026-08-15 created and resumed both tab-forks: omp
  `proof-omp` → `proof-ompf1`; pi `proof-pi` → `proof-pif1`. Both forked agents were
  detected idle and displayed the source session's prior response.
