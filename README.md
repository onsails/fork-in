# fork-in

A plugin for omp and pi that adds two commands: `/fork-in-herdr` forks your current agent conversation into a new herdr tab, `/fork-in-tmux` into a new tmux window. The new surface gets the full transcript and artifacts of the original, labeled `2` → `2f1`, `2f1` → `2f1f1` — and your original keeps running untouched, with no focus switch.

**Why:** omp's and pi's built-in `/fork` continues your current surface on the fork; when you want to explore a divergent approach in parallel — a risky refactor, a side question — you need the fork in a *separate* surface, side by side with your work in progress.

## Install

Requires omp 17.2.x (or pi 0.37+) and herdr 0.8.x for `/fork-in-herdr`; tmux for `/fork-in-tmux`.

```sh
omp plugin install https://github.com/onsails/fork-in
pi install git:github.com/onsails/fork-in
```

Each installer reads its own manifest entry and links the same package. Both commands are then available in every session. pi supports project-local installation with `pi install -l …`; omp installs this git package at user scope.

## Use

Inside a herdr tab running omp or pi, type `/fork-in-herdr`; inside a tmux pane, type `/fork-in-tmux` (no arguments). Each command:

1. Refuses outside its surface (`HERDR_ENV`/`TMUX` unset) or while the agent is mid-turn — nothing is touched in either case.
2. Creates a fork copy of your session: fresh session id, native `parentSession` lineage (omp: source id; pi: source path), omp prompt-cache lineage preserved, artifacts directory copied recursively (omp).
3. Creates the new surface beside the original — herdr tab in the same workspace, or tmux window adjacent to the current one, neither taking focus — labeled `<original-label>f<n>` (first free `n`), and starts the same agent in it resumed at the fork copy — omp by session id, pi by session file path.

The original surface is never modified. If the new surface is created but the agent fails to start, the error names the exact recovery command — `omp --resume <id>` (plus any `--profile` you launched with) or `pi --session <file>`. A tmux fork window stays open after agent exit (`remain-on-exit`), so a failed start stays inspectable; its label is pinned (`automatic-rename off`).

### Troubleshooting

- **"session has no transcript yet"** — the host writes the session file only after the first turn. Send a message first, then fork.
- **"session header version N unsupported"** — the on-disk session format changed; the plugin pins header version 3. File an issue.
- New surface created but the agent did not start — inspect the retained surface. The error includes the exact recovery command.

## Develop

```sh
bun install
bun x tsc --noEmit   # typecheck
bun test             # unit suite (destination seams; no real herdr/tmux/agent)
```

`omp plugin install /path/to/this/repo` links the local checkout for development. Tests exercise the registered-command seam with fake herdr/tmux clients and real temp session files; domain vocabulary lives in `CONTEXT.md`, the fork-mechanism decisions in `docs/adr/0001`–`0003`, the full spec in [issue #1](https://github.com/onsails/fork-in/issues/1).
