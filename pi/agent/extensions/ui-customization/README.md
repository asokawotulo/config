# UI customization

> **Compatibility:** the fullscreen adapter checks the host's transcript/dock layout contract at runtime, not its package version. An unfamiliar layout disables the sidebar and restores Pi's default footer.

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

Pi does not expose a public API for replacing only the fullscreen transcript region or observing renderer changes. `probeFullscreenLayout()` therefore validates the fullscreen `VStack`, primary transcript `ScrollView`, six-entry dock, component identities, synchronized stack arrays, and allocation options before changing the tree. Regular mode and a root that has not mounted yet are waiting states. A contract mismatch leaves Pi's layout untouched, warns once with a reason, and restores the default footer.

Private stack reads stay inside the adapter's validated inspection code. New package versions are admitted when they retain this contract. Additional dock entries, changed allocation rules, and malformed arrays are rejected rather than guessed at.

Automated checks have passed against Pi 0.84.4 and 0.85.1. These are test results, not a runtime allowlist. Run `bun test extensions/ui-customization/` from `pi/agent/`. The layout suite also uses the installed host's actual `createChatViewport()` factory when present; that test is skipped on 0.84.4, which predates the extracted factory. Private-layout behavioral changes still require smoke testing on a new host.

`SidebarLayoutAdapter` retains the canonical root object and changes its contents through the public `VStack.clear()` and `addChild()` methods. It snapshots the original component references and allocation options before installation. Restoration requires the complete installed root-entry contract to remain intact; the adapter does not overwrite another owner's component or option changes. It checks the active root before reporting an installation as active and can restore the saved canonical root while regular mode is active. The canonical mutation survives regular/fullscreen renderer remounts; the empty footer also retries installation when a fullscreen renderer first appears.

Pi continues to own transcript scrolling, wheel and page input, selection, scrollbar behavior, focus, alternate-screen entry/exit, and renderer switching. The inspector content has its own non-primary `ScrollView` selection region, so mouse-selected sidebar values exclude both the transcript and the one-column separator while wheel input continues chaining to the transcript. The extension creates no overlay, mouse interception, editor replacement, terminal-input listener, or `tui.render()` patch. Git refreshes remain generation-guarded so stale asynchronous results cannot update a replacement session.
