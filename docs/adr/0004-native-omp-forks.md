# Native OMP forks and host-selected session creation

Date: 2026-08-17

## Decision

Use OMP's native `--fork` operation for `/fork-in-herdr` and `/fork-in-tmux`. Require OMP 17.3.5 or newer because that release preserves sibling artifact directories recursively.

Pass the absolute source session file to `--fork`. Forward the effective `--profile`, every `--config`, and the effective `--session-dir` overlay. Preserve original token forms and order. Do not forward unrelated launch flags.

Keep the plugin-created JSONL fork copy for Pi. Pi has no detached native fork equivalent. The copy uses a fresh UUIDv7 and a source-path `parentSession`.

Herdr performs one `agent start` call. Herdr 0.8.0 owns its shell-readiness retry. If the start result is ambiguous, query the pane once. Accept recovery only when the live agent record contains the expected host and a matching child session path. Never issue a second native fork.

tmux performs one `new-window` launch. It cannot observe the child OMP session identity synchronously. Keep the retained window inspectable and report its surface label.

## Consequences

- OMP owns format migration, prompt-cache lineage, blob resolution, and recursive artifact copying.
- The plugin does not duplicate OMP session internals.
- Herdr success includes the observed child session path.
- tmux recovery uses the source-based OMP command and retained-window inspection.
- Pi remains coupled to JSONL header version 3 until it gains a detached native fork.

## Supersession

ADR-0001's plugin-side-copy decision is superseded for OMP and retained for Pi. ADR-0002's OMP resume, prompt-cache, and manual-copy consequences are superseded. ADR-0003's shared pipeline remains, but its session creation step is host-selected and Herdr's plugin retry is removed.
