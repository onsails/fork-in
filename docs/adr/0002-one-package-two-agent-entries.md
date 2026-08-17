# One package, two agent entries (omp and pi)

The plugin supports omp and pi from one repository and package. `package.json` carries both manifest entries over shared core logic.

The two hosts share the extension surface needed by the plugin. Per-host variance is confined to a host spec: Herdr `--kind`, OMP launch overlays and native `--fork <absolute-source-file>`, or Pi's `--session <absolute-copy-path>`.

Pi's `ctx.fork()` was rejected because it switches the current process to the fork. That is a Conversation-fork, not a Tab-fork.

## Consequences

- OMP 17.3.5 or newer owns native fork lineage, prompt-cache behavior, and recursive artifacts.
- The plugin forwards OMP `--profile`, repeated `--config`, and `--session-dir` overlays.
- Pi uses a plugin-created JSONL copy with source-path `parentSession`.
- The session source path passed to OMP is absolute.
