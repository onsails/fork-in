# One package, two agent entries (omp and pi)

`/fork-in-herdr` must work in both omp and pi when either runs inside a herdr
tab. omp is pi-derived: the extension factory surface
(`registerCommand(name, {description, handler(args, ctx)})` with
`ctx.cwd`, `ctx.isIdle()`, `ctx.ui.notify`, `ctx.sessionManager.getSessionFile()`),
the JSONL v3 session format, and `parentSession` lineage are common to both.

We ship one package with per-agent entry files. `package.json` carries both
manifest keys — `omp: {extensions: ["./src/omp.ts"]}` and
`pi: {extensions: ["./src/pi.ts"]}` — pointing at thin entries that differ
only in the host description: herdr agent kind, bootstrap args to forward
(omp `--profile`; pi has none), and the deterministic resume argv for the
fork copy (`omp --resume <id>`; `pi --session <path>`, because pi's
`--resume` is an interactive picker). Everything else (fork copy, labels,
herdr client) is shared in `src/index.ts`.

The fork copy also preserves the original's prompt-cache lineage:
`providerPromptCacheKey` = the original's key, or its session id when the
header has none — mirroring omp's native `SessionManager.forkFrom()`
(`providerPromptCacheKey: sourceHeader?.providerPromptCacheKey ?? sourceHeader?.id`).
Sessions forked this way share the parent's provider prompt-cache identity,
like omp's own `/tan` background sessions. The header is located by scanning
for the first session record (omp puts a title on line 1; pi's header is
line 1).

Rejected: pi's `ctx.fork(entryId)` — it switches the current process onto
the fork (Conversation-fork semantics), so it cannot produce a separate
herdr tab with an independent process; omp's equivalents were rejected in
ADR-0001 for the same reason. Runtime host detection in one entry — static
per-entry kinds are simpler and testable.

## Consequences

- Two entry files must stay in sync; drift is caught by the registration
  test asserting the shared command name.
- Session-format coupling now spans both agents' writers; the tolerant
  header scan covers the known line-1/line-2 difference.
- pi has no omp-style sibling artifact directory; the artifact copy is a
  no-op there.
- Verified end-to-end on stock omp 17.3.3 and pi 0.37.8 inside herdr
  (2026-08-15): tab-fork in each host resumed the fork copy with full
  history; omp fork-turn provider usage showed the cached prefix
  (cacheRead ≈ 23k) on first turn after resume.
