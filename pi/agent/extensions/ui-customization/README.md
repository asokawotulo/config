# UI customization

> **Compatibility:** this extension is intentionally coupled to `@earendil-works/pi-coding-agent` **0.83.0**.

This extension monkey-patches Pi's interactive TUI to provide:

- a scrollable chat viewport;
- an editor that stays visible while older chat is displayed; and
- a responsive 30-column right sidebar ordered as Directory, Session, Context, Model, then Workflow.

## Why it is version-specific

Pi's public extension API does not currently expose a full-screen layout or sidebar API. The extension therefore depends on the root component order used by Pi 0.83.0:

1. header;
2. loaded resources;
3. chat;
4. pending messages;
5. status;
6. widgets above the editor;
7. editor;
8. widgets below the editor; and
9. footer.

It replaces the live TUI's `render()` method without modifying `node_modules`. A Pi update can change these internals. The extension validates the version and component shape and leaves the default UI active when validation fails.

Disable or review this extension before upgrading Pi.

## Scrolling

- Mouse wheel or trackpad: scroll chat by three rendered lines.
- Shift+Page Up / Shift+Page Down: scroll by one viewport.
- Reaching the bottom restores automatic following.
- While scrolled up, typing and newly streamed output preserve the current chat position.

The extension enables SGR mouse reporting while active. Hold Shift when selecting terminal text if your terminal uses Shift to bypass application mouse capture.

The sidebar appears at 100 terminal columns and wider. On narrower terminals it is hidden and Pi's original footer is restored.

## Dynamic workflows

The sidebar hydrates from the shared Dynamic Workflow event contract at session start and updates as runs progress. It shows every active workflow in the current session; when none are active, it keeps only the newest settled workflow visible. Each subagent has a status row; bounded activity and per-agent cost rows appear only when terminal height remains after the Context, Model, and workflow status rows are budgeted. All sidebar output remains within 30 columns.

Clicking a visible agent status row emits the shared `dynamic-workflows:open-agent` event for that exact session, run, and agent. The Dynamic Workflows extension owns suspending Pi, attaching to the zmx session, and resuming after detach. This UI extension never spawns an attach process. Clicks outside the visible sidebar (including all clicks in narrow mode) cannot emit an open-agent event; wheel and page scrolling continue to control chat history.

## Context and cost

The context used/window and percentage rows are muted at 50% or below (and when usage is unknown), accented above 50% through 80%, and shown as errors above 80%. In the active theme, accent is orange and error is red.

Context cost is partitioned into Total, Main, and Subagents. Settled `dynamic_workflow` tool-result usage is the persisted subagent source of truth. Live event costs are included only until the matching result is persisted, so the active-to-settled transition does not double-count. Visible agents may also show their individual cost when height permits.

## Recovery

Start Pi without extensions if the patched UI prevents normal use:

```bash
pi --no-extensions
```

If Pi is killed before shutdown and the terminal continues sending mouse events to applications, run:

```bash
reset
```

Normal shutdown, session replacement, and `/reload` disable mouse reporting and restore the original renderer.
