# Surface-fork: one pipeline, two destinations (herdr and tmux)

The plugin has `/fork-in-herdr` and `/fork-in-tmux`. Both share one pipeline: guards, host-selected session fork, destination, and recovery reporting.

Herdr needs tab lookup, label listing, tab creation, and one agent start. Herdr 0.8.0 owns shell-readiness retries. The plugin does not retry `agent start`.

tmux resolves the source pane from `$TMUX_PANE` and execs the agent argv directly in a new adjacent window. It does not poll OMP readiness. `remain-on-exit on` keeps startup errors inspectable, and `automatic-rename off` pins the label.

## Consequences

- Both commands exist under both hosts.
- OMP uses native `--fork`; Pi uses its plugin-created copy.
- Herdr can report the observed child OMP session path.
- tmux cannot report child session identity synchronously and reports only the surface label.
- Fork labels share one rule across herdr tabs and tmux windows.
