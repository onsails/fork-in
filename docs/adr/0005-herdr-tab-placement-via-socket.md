# Herdr tab placement goes through the socket API, not the CLI

A Surface-fork must land beside the original tab (CONTEXT.md, "Surface-fork"), but herdr's `tab create` CLI always appends at the end of the workspace and 0.8.0 exposes no move subcommand. The socket protocol does expose `tab.move` with an `insert_index` (protocol 19), so the plugin speaks newline-delimited JSON to `$HERDR_SOCKET_PATH` for that one method (`src/herdr-socket.ts`). Every other herdr interaction stays on the CLI through `HerdrClient`. Placement is best-effort: when `tab.move` fails — older server without the method, a concurrent reorder — the fork is kept at the end and the user is warned. Repeated forks from the same original stack: each new fork inserts at the original's index + 1, matching tmux `new-window -a`.

## Considered Options

- Add `--insert-index` to `tab create` (or a `tab move` subcommand) in herdr upstream and call it: cleaner layering and one atomic call, but couples the fix to an upstream release; rejected in favor of shipping plugin-side.
- Speak the socket protocol for everything: larger rewrite that abandons the CLI choke point for no gain.
