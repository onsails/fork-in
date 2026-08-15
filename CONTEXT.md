# fork-in

A plugin for omp and pi whose `/fork-in-herdr` and `/fork-in-tmux` commands fork the current agent session into a new surface — a herdr tab or a tmux window — beside the original.

## Language

**Surface**:
A user-visible terminal interaction container: a herdr tab or a tmux window. Holds panes, has a user-visible **label**.
_Avoid_: destination, container, window (for herdr), tab (for tmux)

**Workspace**:
A herdr container of tabs; the outermost unit of the terminal workspace. A tmux session plays the same role for tmux windows, but is a separate term.
_Avoid_: session, window

**Tab**:
A herdr surface. Identified as `<workspace-id>:t<n>`.
_Avoid_: window, agent session, "the fork" (as a noun for the surface itself)

**Window**:
A tmux surface. Has a name and a stable `@<id>` independent of its index.
_Avoid_: tab, pane

**Pane**:
A single terminal surface inside a tab or window. A pane holds at most one recognized foreground process.
_Avoid_: split, frame

**Agent**:
The recognized interactive process running inside a pane (omp, pi, claude, …). An agent is not a pane: a pane exists with or without one.
_Avoid_: bot, assistant

**Host**:
The agent the plugin is running inside — omp or pi. One entry file per host; shared logic is host-neutral.
_Avoid_: agent kind

**Agent session**:
The host's persisted conversation: a JSONL transcript (session header version 3) plus, under omp, a sibling artifact directory. Identified by its session id.
_Avoid_: omp session, pi session, conversation (when meaning the file)

**Label**:
The user-visible name string of a surface. herdr defaults labels to tab numbers ("1", "2"); tmux names windows after the running command. Neither host guarantees label uniqueness.
_Avoid_: title

**Fork label**:
The new surface's label: original label with `f<n>` appended — `2` → `2f1`, `2f2`…; `2f1` → `2f1f1`. `<n>` counts existing forks of that label among the sibling surfaces. One rule for both hosts.
_Avoid_: `-fork` suffix, `fork-2`, numbering the surfaces themselves

**Surface-fork**:
Creating a new surface beside the original whose agent process resumes a forked copy of the original surface's agent session. The plugin's core operation.
_Avoid_: duplicating, cloning, bare "fork"

**Tab-fork**:
A Surface-fork whose target is a herdr tab (`/fork-in-herdr`).
_Avoid_: applying "fork" to both target kinds without a qualifier

**Window-fork**:
A Surface-fork whose target is a tmux window (`/fork-in-tmux`).
_Avoid_: calling a tmux window a tab

**Conversation-fork**:
An agent's built-in fork (`/fork` in omp or pi): duplicates the conversation inside the *same* pane/process. A different concept from Surface-fork; do not conflate.
_Avoid_: applying "fork" to both concepts without a qualifier

**Fork copy**:
The plugin-created agent-session file: a copy of the original session's transcript with a fresh session id and native `parentSession` lineage. Under omp, it also preserves the original's prompt-cache lineage. The new surface's agent resumes this file.
_Avoid_: clone, duplicate session

**Original surface**:
The surface where the fork command runs. A Surface-fork never modifies it.
