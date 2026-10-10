# UI customization

> **Compatibility:** the fullscreen adapter checks the host's transcript/dock layout contract at runtime, not its package version. An unfamiliar layout disables the sidebar and restores Pi's default footer.

This extension provides a 40-column session inspector that is visible by default. Press `Ctrl+B` or run `/sidebar` to hide or show it.

In fullscreen mode the inspector is a fixed-width `HStack` sibling of Pi's native transcript `ScrollView`. Pi's cloned editor/status dock remains below both columns at full terminal width, so the sidebar fills exactly the transcript region and never overlaps the editor. At fewer than 100 terminal columns the sidebar hides automatically and the transcript regains the full width.

The panel displays these sections in order:

1. Directory and Git branch/worktree
2. Session name
3. Context usage, latest prompt cache hit rate, and Total/Main/Subagent cost
4. Model and thinking level
5. Fabric execution/phase and worker status, cost, current tool, timing, model/thinking, calls/turns and actor ownership

Optional metadata rows disappear first when vertical space is limited. Worker cost is shown on its own line directly below the name, so long names cannot truncate the amount. Compact layouts keep each name/cost pair together. At most eight workers are displayed; the compact layout points to `/fabric` when more details are hidden.

## Keyboard binding

Pi normally binds `Ctrl+B` to editor cursor-left. `pi/agent/keybindings.json` narrows that action to the Left Arrow key so the extension can register `Ctrl+B` without a shortcut conflict warning. Left Arrow remains available for cursor movement.

## Footer

The fullscreen dock omits Pi's footer row. The extension also installs an empty custom footer through the public `ctx.ui.setFooter()` API, removing directory, session, context, cost, and model details below the editor in regular mode. Pi restores its built-in footer as part of extension UI reset.

## Fabric activity

The `asoka.fabric-sidebar` component in `fabric.json` reads `agents.self` and local/lineage `agents.list` once per second in the root TUI. It uses Fabric's public protocol, not private dashboard state, and never triggers a model turn. Reads are non-overlapping and late results are rejected after a session/branch change. Headless children do not poll.

The sidebar shows execution names and observed phases, worker status and current tool, elapsed time, actual model/thinking, calls/turns and actor ownership. Worker token/cache rows are omitted. A TODO in `fabricWorkerRows` reserves genuine context usage and latest-prompt cache hit rate for a future reliable data source; cumulative run counters remain in state for accounting. Parent links indent recursive workers. Idle actor queues, peer sessions and full transcripts remain in `/fabric`; the sidebar stays read-only.

Completed Fabric executions show Pi's recorded wrapper duration as Took. The duration comes from native execution events and persisted tool results, survives checkpoints and resume, and stays separate from worker elapsed time. Legacy results without a duration show Took ?. Nested timings are not added to the wrapper duration.

Terminal provider results are captured before audit trimming. Bounded, metadata-only `asoka.fabric-sidebar.v1` custom entries preserve worker/cost state without adding model context. Checkpoints bind to their exact active-branch boundary; `/tree` reconstructs that branch and does not reimport older off-branch registry runs. Restored unfinished workers are marked stale until observed live. Poll snapshots save at most every 30 seconds, with immediate saves for terminal results and shutdown. Limits are 128 worker records, 12 executions and 256 KiB per checkpoint; exceeded limits mark coverage incomplete.

Fabric owns worker cost accounting. There is no special accounting or replay support for historical dynamic-workflow results.

The duplicate editor-area Fabric panel is an above-editor widget, not a native footer status. `ui.widget: "hidden"` removes it while `ui.enabled: true` preserves `/fabric` and focused conversations. This does not suppress prewalk's separate armed/switching/error status. Set Widget back to Auto in `/fabric settings` if you want the upstream panel alongside the sidebar.

## Context and cost

Context usage is muted at 50% or below (and when unknown), accented above 50% through 80%, and shown as an error above 80%. When Pi reports cache activity, the latest assistant prompt's cache hit rate appears between context usage and total cost. Main includes assistant usage, direct tool billing and compaction. Subagents adds each verified Pi worker run once, across repeated run/wait/list observations and recursive records, using the Fabric ledger. Actor worker activations use their run IDs rather than actor IDs. Outer Fabric billing is not treated as inclusive worker usage. The display uses Reported instead of Total when live data, history or attribution is incomplete; Claude/Veda records remain visible but are not silently assumed to have Pi's billing semantics. Token counters are cumulative usage, not context occupancy. Full historical coverage cannot be recovered from a trimmed trace alone.

## Compatibility and lifecycle

Pi does not expose a public API for replacing only the fullscreen transcript region or observing renderer changes. `probeFullscreenLayout()` therefore validates the fullscreen `VStack`, primary transcript `ScrollView`, six-entry dock, component identities, synchronized stack arrays, and allocation options before changing the tree. Regular mode and a root that has not mounted yet are waiting states. A contract mismatch leaves Pi's layout untouched, warns once with a reason, and restores the default footer.

Private stack reads stay inside the adapter's validated inspection code. New package versions are admitted when they retain this contract. Additional dock entries, changed allocation rules, and malformed arrays are rejected rather than guessed at.

Run `bun test extensions/ui-customization/` from `pi/agent/` to check the layout adapter. The wheel-routing test sends native SGR input rather than calling Pi's private routing method. The layout suite also verifies the installed host's actual `createChatViewport()` factory. The adapter requires the current zero-minimum footer contract; it does not support older hosts that reserve a footer row. Private-layout behavioral changes still require smoke testing on a new host.

`SidebarLayoutAdapter` retains the canonical root object and changes its contents through the public `VStack.clear()` and `addChild()` methods. It snapshots the original component references and allocation options before installation. Restoration requires the complete installed root-entry contract to remain intact; the adapter does not overwrite another owner's component or option changes. It checks the active root before reporting an installation as active and can restore the saved canonical root while regular mode is active. The canonical mutation survives regular/fullscreen renderer remounts; the empty footer also retries installation when a fullscreen renderer first appears.

Pi continues to own transcript scrolling, wheel and page input, selection, scrollbar behavior, focus, alternate-screen entry/exit, and renderer switching. The inspector content has its own non-primary `ScrollView` selection region, so mouse-selected sidebar values exclude both the transcript and the one-column separator while wheel input continues chaining to the transcript. The extension creates no overlay, mouse interception, editor replacement, terminal-input listener, or `tui.render()` patch. Git refreshes remain generation-guarded so stale asynchronous results cannot update a replacement session.
