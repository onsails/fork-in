# fork-in

A plugin for omp and pi whose `/fork-in-herdr` and `/fork-in-tmux` commands fork the current agent session into a new surface: a herdr tab or a tmux window.

## Language

**Surface**:
A user-visible terminal interaction container: a herdr tab or a tmux window. Holds panes and has a user-visible **label**.
_Avoid_: destination, container, window (for herdr), tab (for tmux)

**Workspace**:
A herdr container of tabs. A tmux session plays the same role for tmux windows, but is a separate term.
_Avoid_: session, window

**Tab**:
A herdr surface. Identified as `<workspace-id>:t<n>`.
_Avoid_: window, agent session, "the fork" as a noun for the surface itself

**Window**:
A tmux surface. Has a name and a stable `@<id>` independent of its index.
_Avoid_: tab, pane

**Pane**:
A single terminal surface inside a tab or window. A pane holds at most one recognized foreground process.
_Avoid_: split, frame

**Agent**:
The recognized interactive process running inside a pane. An agent is not a pane.
_Avoid_: bot, assistant

**Host**:
The agent the plugin is running inside: omp or pi. One entry file exists per host.
_Avoid_: agent kind

**Agent session**:
The host's persisted conversation: a JSONL transcript with a session header and host-specific supporting data. OMP may have a sibling artifact directory. The session has a host-defined identity.
_Avoid_: omp session, pi session, conversation when meaning the file

**Native OMP fork**:
An OMP-created child agent session from a source session file. OMP owns its lineage, prompt-cache, format migration, blob resolution, and artifact copying.

**Label**:
The user-visible name string of a surface. Herdr defaults labels to tab numbers. tmux names windows after the running command.
_Avoid_: title

**Fork label**:
The new surface's label: original label with `f<n>` appended. `<n>` counts existing forks of that label among sibling surfaces.
_Avoid_: `-fork` suffix, `fork-2`, numbering surfaces themselves

**Surface-fork**:
Creating a new surface beside the original whose agent process resumes a forked copy of the original surface's agent session. The plugin's core operation.
_Avoid_: duplicating, cloning, bare "fork"

**Tab-fork**:
A Surface-fork whose target is a herdr tab.

**Window-fork**:
A Surface-fork whose target is a tmux window.

**Conversation-fork**:
An agent's built-in `/fork`: duplicates the conversation inside the same pane/process. This differs from Surface-fork.

**Fork copy**:
The Pi-only plugin-created agent-session file. It is a JSONL copy with a fresh UUIDv7 and `parentSession` set to the source session path. OMP uses Native OMP fork instead.

**Original surface**:
The surface where the fork command runs. A Surface-fork never modifies it.
