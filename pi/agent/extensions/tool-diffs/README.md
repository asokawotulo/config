# Tool diffs

## Fabric integration boundary

This extension remains disabled in the normal configuration. The installed Fabric implementation captures its `edit`/`write` execution overrides, but renders nested mutations itself instead of calling our native `renderResult`. Removing edit/write from Fabric's `codePreview.tools` selects plain-text fallback, not `ToolDiffComponent`.

Run `bun test extensions/tool-diffs/` from `pi/agent/` to check the native overrides and historical replay. These tests do not certify Fabric's nested diff rendering. Keep Fabric diffs until a supported nested-renderer hook exists.

## Native Pi rendering

Overrides Pi's built-in `edit` and `write` tools so successful file mutations render with responsive Before/After panes in the interactive TUI.

Each override starts from Pi's exported built-in definition, retaining its parameters, argument preparation, prompt metadata, and render shell while replacing only execution and the call/result renderers. Execution still delegates to the built-in definitions: `edit` uses Pi's persisted unified patch, while `write` snapshots the target immediately before writing with the built-in per-file mutation queue held and persists a generated patch for transcript reloads.

At fewer than 72 content columns, previews fall back to unified diff rendering. Wide previews show the real old and new file line numbers derived from each patch hunk. File headers and hunk metadata stay inside the Before/After panes with the center divider intact. Collapsed edit and write previews show at most 60 and 150 rendered rows respectively; expanding a tool shows the full patch. Settled previews cache rendered lines for the two most recently used terminal widths, promote a width when it is reused, and clear the cache when Pi invalidates the component, including after theme changes.

The tools register during extension loading so `/reload` can use their renderers while rebuilding historical transcript components. Pi displays its normal warning because these are same-name built-in tool overrides.
