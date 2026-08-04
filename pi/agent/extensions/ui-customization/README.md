# UI customization

> **Compatibility:** this extension is intentionally coupled to `@earendil-works/pi-coding-agent` **0.83.0**.

This extension monkey-patches Pi's interactive TUI to provide:

- a scrollable chat viewport;
- an editor that stays visible while older chat is displayed; and
- a responsive right sidebar with directory, Git worktree, session, context, cost, model, and thinking information.

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
