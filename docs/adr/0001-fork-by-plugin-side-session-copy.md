# Fork by plugin-side session copy, not omp fork APIs

> **Partially superseded by ADR-0002** (2026-08-15): the fork copy now
> *preserves* `providerPromptCacheKey` (matching omp's native
> `forkFrom`), and the header is located by scan, not fixed at line 2.
> The core decision — plugin-side copy, not agent fork APIs — stands.

`/fork-in-herdr` needs a history-carrying fork of the current agent session that leaves
the original tab untouched. The host's real conversation-fork API can't do this: omp's
`AgentSession.fork()` is not reachable from extension command contexts, and pi's
`ctx.fork()` adopts the fork in the current process and tab (Conversation-fork, not
Tab-fork). The reachable alternatives don't fork (`newSession` is empty-with-lineage,
`branch` truncates at the selected entry, copies no artifacts, and adopts the branch
in the current tab). We decided the plugin performs the fork itself: copy the session
JSONL with a fresh UUIDv7 id, `parentSession` = original id, preserve the original's
prompt-cache lineage (see ADR-0002), and recursively copy the sibling artifact
directory when present (omp only).

Rejected: patching omp to expose a `forkToFile()` extension-context method (composes
existing `SessionManager.forkFrom()` + artifact copy). Cleaner long-term, but forces a
private omp build until upstreamed; the probe (2026-08-14) showed the copy is simple
and stable on stock omp 17.2.15 — a fork copy resumed headlessly with full history and
working artifacts.

## Consequences

- The plugin is coupled to the on-disk session format (session header version 3).
  Originally the header was assumed to sit on line 2; ADR-0002 generalized this
  to a scan for the first session record (pi's header is line 1). Rewrite it by
  parse, not regex.
- omp resume-by-id only resolves files inside the current session directory
  (`~/.omp/agent/sessions/<cwd-slug>/`); the fork copy must be written there. pi
  resumes the copy by absolute path. The new herdr tab shares the cwd, so this
  holds by construction.
- Without the sibling artifact-dir copy, `artifact://` references in the copied
  transcript break on resume (blob refs survive; artifact logs do not). pi has no
  sibling artifact directory, so the copy is a no-op there.
- If either host later exposes a fork-to-file API reachable from extension commands,
  switch that host adapter to it and retire the manual copy; the command contract
  stays the same.
