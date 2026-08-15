# fork-in-herdr

A plugin for omp and pi that adds `/fork-in-herdr`: fork your current agent conversation into a new herdr tab. The new tab gets the full transcript and artifacts of the original, labeled `2` → `2f1`, `2f1` → `2f1f1` — and your original tab keeps running untouched.

**Why:** omp's and pi's built-in `/fork` continues your current tab on the fork; when you want to explore a divergent approach in parallel — a risky refactor, a side question — you need the fork in a *separate* herdr tab, side by side with your work in progress.

## Install

Requires omp 17.2.x (or pi 0.37+) and herdr 0.8.x.

```
omp plugin install https://github.com/onsails/fork-in-herdr
```

That's it — omp links the plugin from git into `~/.omp/plugins` and `/fork-in-herdr` is available in every session. Use `--scope project` to install only into the current project. Update later with `omp plugin upgrade`. For pi, load the entry with `pi -e ./src/pi.ts`, or link the repo into `~/.pi/agent/extensions/fork-in-herdr` (pi reads `pi.extensions` from the package manifest; upgrade pi if it lacks a package installer).

## Use

Inside a herdr tab running omp or pi, type `/fork-in-herdr` (no arguments). The command:

1. Refuses outside herdr (`HERDR_ENV` unset) or while the agent is mid-turn — nothing is touched in either case.
2. Creates a fork copy of your session: fresh session id, `parentSession` = original, prompt-cache lineage preserved, artifacts directory copied recursively (omp).
3. Creates a new herdr tab in the same workspace, labeled `<original-label>f<n>` (first free `n`), and starts the same agent kind in it resumed at the fork copy — omp by session id, pi by session file path.

The original tab is never modified. If the tab is created but the agent fails to start, the error message names the recovery command — `omp --resume <id>` (omp) or `pi --session <file>` (pi).

### Troubleshooting

- **"session has no transcript yet"** — omp writes the session file only after the first turn. Send a message first, then fork.
- **"session header version N unsupported"** — the on-disk session format changed; the plugin pins header version 3. File an issue.
- Fork tab was created but omp didn't start — the shell tab stays open on purpose (inspect it), and the error carries the `omp --resume <id>` recovery line.

## Develop

```sh
bun install
bun x tsc --noEmit   # typecheck
bun test             # unit suite (handler seam; no real herdr/omp)
```

`omp plugin install /path/to/this/repo` links the local checkout for development. Tests exercise the registered-command seam with a fake herdr client and real temp session files; domain vocabulary lives in `CONTEXT.md`, the fork-mechanism decisions in `docs/adr/0001`–`0002`, the full spec in [issue #1](https://github.com/onsails/fork-in-herdr/issues/1).
