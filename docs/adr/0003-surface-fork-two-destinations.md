# Surface-fork: one pipeline, two destinations (herdr and tmux)

The plugin grew a second command: `/fork-in-tmux` alongside `/fork-in-herdr`.
Both share one pipeline (guards → fork copy → destination) and differ only in
the destination adapter. We extracted the destination seam instead of forking
the handler: herdr needs tab lookup, label listing, tab creation, and agent
start with shell-readiness retries; tmux resolves the source pane from
`$TMUX_PANE` and execs the agent argv directly in a new window — no shell, no
retries.

tmux specifics that shaped the adapter: the source window is targeted by
stable `session_id:window_id` (never numeric index — renumbering and multiple
clients make indices ambiguous); the window is created with `-d -a` (adjacent,
unfocused); the fork label is applied against all window names in the source
session (one fork-label rule for both hosts); `remain-on-exit on` keeps a
failed start inspectable and `automatic-rename off` pins the label. Agent
argv is passed as separate `new-window` arguments, so no shell quoting.

Rejected: inferring the host or agent from `pane_current_command`/process
trees — the host is already known statically from the entry file (`omp.ts` /
`pi.ts`) that registered the commands. Rejected: hiding each command when its
destination is unavailable — both always register and refuse at runtime with
an actionable error, keeping behavior predictable across surfaces.

## Consequences

- Both commands exist under both hosts: omp/pi × herdr/tmux are all supported;
  the host chooses the resumed agent, the command chooses the destination.
- Fork labels share one rule across herdr tabs and tmux windows; neither host
  guarantees label uniqueness, so the rule counts only sibling surfaces.
- The repo/package was renamed to `fork-in` (commands unchanged; GitHub
  redirects the old URL). ADR-0001/0002's session-copy decisions are
  destination-neutral and unchanged.
