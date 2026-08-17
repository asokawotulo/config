# UI customization

> **Compatibility:** the fullscreen adapter supports the shared `@earendil-works/pi-coding-agent` **0.84.0–0.84.2** fullscreen layout shape; 0.84.0 is the minimum supported host version.

This extension provides a 50-column session inspector that is visible by default. Press `Ctrl+B` or run `/sidebar` to hide or show it.

In fullscreen mode the inspector is a fixed-width `HStack` sibling of Pi's native transcript `ScrollView`. Pi's cloned editor/status dock remains below both columns at full terminal width, so the sidebar fills exactly the transcript region and never overlaps the editor. At fewer than 100 terminal columns the sidebar hides automatically and the transcript regains the full width.

The panel displays these sections in order:

1. Directory and Git branch/worktree
2. Session name
3. Context usage, latest prompt cache hit rate, and Total/Main/Subagent cost
4. Model and thinking level
5. Current workflows and agent status

Optional workflow activity, agent costs, extra agents, cost details, Git metadata, and thinking level are removed first when vertical space is limited. Workflow summaries are retained ahead of agent details; if the transcript region is still too short, the compact layout reports how many additional session workflows are hidden.

## Keyboard binding

Pi normally binds `Ctrl+B` to editor cursor-left. `pi/agent/keybindings.json` narrows that action to the Left Arrow key so the extension can register `Ctrl+B` without a shortcut conflict warning. Left Arrow remains available for cursor movement.

## Footer

The fullscreen dock omits Pi's footer row. The extension also installs an empty custom footer through the public `ctx.ui.setFooter()` API, removing directory, session, context, cost, and model details below the editor in regular mode. Pi restores its built-in footer as part of extension UI reset.

## Dynamic workflows

The panel hydrates every workflow from the current Pi session through the shared Dynamic Workflow event contract, orders runs newest-first, and updates as they progress. It is read-only; use `/workflows` to inspect runs, open attachable zmx agents, or interrupt and terminate agents.

Settled `dynamic_workflow` tool-result usage is the persisted subagent source of truth. Live event costs are included only until the matching result is persisted, avoiding double-counting during the active-to-settled transition.

## Context and cost

Context usage is muted at 50% or below (and when unknown), accented above 50% through 80%, and shown as an error above 80%. When Pi reports cache activity, the latest assistant prompt's cache hit rate appears between context usage and total cost. Cost is partitioned into Total, Main, and Subagents when panel height permits.

## Compatibility and lifecycle

Pi does not expose a public API for replacing only the fullscreen transcript region or observing renderer changes. The local adapter therefore validates the shared Pi 0.84.0–0.84.2 fullscreen `VStack`, transcript `ScrollView`, six-row dock, synchronized stack arrays, renderer mode, and package version before changing the tree. On a mismatch it leaves Pi's layout untouched and warns once.

The adapter mutates only the canonical root's transcript and dock component slots. It updates both private stack arrays, restores only slots it still owns, and can restore the canonical root while regular mode is active. The canonical mutation survives regular/fullscreen renderer remounts; the empty footer also retries installation when a fullscreen renderer first appears.

Pi continues to own transcript scrolling, wheel and page input, selection, scrollbar behavior, focus, alternate-screen entry/exit, and renderer switching. The inspector content has its own non-primary `ScrollView` selection region, so mouse-selected sidebar values exclude both the transcript and the one-column separator while wheel input continues chaining to the transcript. The extension creates no overlay, mouse interception, editor replacement, terminal-input listener, or `tui.render()` patch. Git refreshes remain generation-guarded so stale asynchronous results cannot update a replacement session.
