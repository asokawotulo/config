# Tool diffs

Overrides Pi's built-in `edit` and `write` tools so successful file mutations render with responsive Before/After panes in the interactive TUI.

The extension delegates schemas, prompt metadata, edit behavior, and file-mutation serialization to Pi's exported built-in tool definitions. `edit` uses Pi's persisted unified patch. `write` snapshots the target immediately before writing, while the built-in per-file mutation queue is held, and persists a generated patch for transcript reloads.

At fewer than 72 content columns, previews fall back to unified diff rendering. Wide previews show the real old and new file line numbers derived from each patch hunk. File headers and hunk metadata stay inside the Before/After panes with the center divider intact. Collapsed edit and write previews show at most 60 and 150 source rows respectively; expanding a tool shows the full patch. Settled previews cache rendered lines for the two most recently used terminal widths, promote a width when it is reused, and clear the cache when Pi invalidates the component, including after theme changes.

The tools register during extension loading so `/reload` can use their renderers while rebuilding historical transcript components. Pi displays an override warning because version 0.83 has no API for replacing only a built-in tool renderer.
