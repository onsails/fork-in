# fork-in

A plugin for omp and pi that adds two commands: `/fork-in-herdr` forks the current agent conversation into a new herdr tab, `/fork-in-tmux` into a new tmux window. The new surface gets the full transcript and artifacts of the original, labeled `2` → `2f1`, `2f1` → `2f1f1`. The original keeps running untouched, with no focus switch.

**Why:** omp's and pi's built-in `/fork` continues your current surface on the fork. This plugin puts a divergent conversation in a separate surface.

## Install

Requires **omp 17.3.5 or newer** and herdr 0.8.x for `/fork-in-herdr`; pi 0.37+ for Pi; tmux for `/fork-in-tmux`.

```sh
omp plugin install https://github.com/onsails/fork-in
pi install git:github.com/onsails/fork-in
```

Each installer reads its own manifest entry and links the same package. Both commands are available in every session.

## Use

Inside a herdr tab running omp or pi, type `/fork-in-herdr`. Inside a tmux pane, type `/fork-in-tmux`.

1. The command refuses an unavailable surface or a busy agent. It changes nothing.
2. OMP uses its native `--fork <absolute-source-file>` operation. OMP 17.3.5 or newer copies session artifacts and preserves native lineage.
3. Pi creates one JSONL fork copy with a fresh UUIDv7 and `parentSession` set to the source path. Pi resumes that absolute copy path.
4. The new surface is adjacent and unfocused. Herdr creates a tab in the same workspace. tmux creates an adjacent window with `remain-on-exit on` and a pinned label.

OMP forwards the effective `--profile`, every `--config`, and the effective `--session-dir` overlay. Both `value` and `--flag=value` forms remain supported. The source session path is absolute.

The original surface is never modified. Herdr reports the observed child OMP session path after a successful start. If startup is ambiguous, the plugin checks the pane once and accepts only a matching live agent. It never launches a second native fork. tmux reports the surface label because tmux cannot expose the child OMP session identity synchronously.

If a new surface exists but startup fails, inspect the retained surface and rerun the source-based command shown in the error:

```sh
omp [forwarded overlays] --fork /absolute/path/to/source.jsonl
```

For Pi, use the reported `pi --session /absolute/path/to/fork.jsonl` command.

### Troubleshooting

- **"session has no transcript yet"** — send a message first. The host writes the session file after the first turn.
- New surface created but the agent did not start — inspect the retained surface. The error includes a rerunnable command.

## Develop

```sh
bun install
bun run typecheck
bun test
```

Tests use fake Herdr and tmux clients and real temporary session files. Domain vocabulary lives in `CONTEXT.md`. Fork decisions live in `docs/adr/0001`–`0004`.
