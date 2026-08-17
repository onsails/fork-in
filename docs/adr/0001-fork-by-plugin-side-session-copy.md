# Fork by plugin-side session copy, not omp fork APIs

> **Superseded for omp by ADR-0004** (2026-08-17). The plugin-side copy remains the Pi path.

The original decision below applies only to hosts without a detached native fork.

`/fork-in-herdr` needs a history-carrying fork that leaves the original surface untouched. The host's reachable conversation-fork APIs adopt the fork in the current process and surface. Pi has no detached native fork, so the plugin creates one JSONL copy with a fresh UUIDv7 id and `parentSession` set to the source path.

For omp, ADR-0004 selects native `--fork <absolute-source-file>`. OMP owns session format migration, lineage, prompt-cache behavior, blob resolution, and recursive artifact copying.

## Consequences

- Pi remains coupled to its supported JSONL session header version.
- Pi resumes its copy by absolute path.
- OMP no longer depends on plugin-side session parsing or manual artifact copying.
- If Pi later exposes an equivalent detached fork-to-file API, switch the Pi adapter and retire the copy.
