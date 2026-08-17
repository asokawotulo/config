# Custom Markdown code blocks

Adds streaming custom fenced-code renderers to Pi's Markdown transcript. Each renderer is registered by language and lives in its own folder with its own rendering logic and types.

## Diff

The built-in custom renderer displays `diff` fences as responsive Before/After panes. Add an inherited language after a colon to preserve Pi's normal syntax highlighting:

````markdown
```diff:typescript
 export const config = {
-  timeout: 1_000,
+  timeout: 5_000,
   retries: 3,
 };
```
````

Plain `diff` fences retain normal diff foreground colors. In `diff:<language>` fences, source text uses the inherited language's syntax colors while `+` and `-` markers retain diff colors. Unsupported languages fall back safely to Pi's normal code-block foreground.

Changed byte ranges use two extension-consumed values from the active user theme. Paired replacement lines highlight only their changed UTF-8 ranges; unpaired additions and removals retain full-pane backgrounds:

```json
"toolDiffAddedBg": "#2b5926",
"toolDiffRemovedBg": "#592636"
```

These values are accepted by Pi's theme loader but are not native `ThemeBg` tokens. The extension converts their foreground ANSI representation into a background. If a theme omits them, additions use `toolSuccessBg` and removals use `toolErrorBg`.

Pi and terminal SGR colors support six-digit `#RRGGBB`, not per-cell alpha. Do not use eight-digit values such as `#00FF0055`: Pi 0.83 rejects them while constructing the theme. To approximate transparency, pre-blend the foreground with the terminal background and store the resulting solid RGB value. For example, 33% green and red over `#1A1D20` are approximately `#116815` and `#661315`.

At fewer than 72 content columns, the renderer delegates back to Pi's normal unified `diff` rendering. At wider widths, long source and metadata lines wrap within the frame instead of being truncated. Before/After cells remain top-aligned, with markers shown only on the first visual line and syntax and diff backgrounds preserved across continuation lines.

Replacement runs use ordered, language-agnostic code-point profiles to keep related lines paired while displaying intervening additions and removals against blank cells. The more expensive Myers diff runs only for selected line pairs to calculate their UTF-8 change ranges. Alignment work is bounded, with positional alignment retained as a fallback for unusually large runs; the renderer remains intended for focused planning snippets rather than moved-line or language-semantic analysis.

## Adding a renderer

1. Create a folder beside `diff/`.
2. Keep its renderer-specific types and tests inside that folder.
3. Export a `CustomCodeBlockRenderer` descriptor from the folder's `index.ts`.
4. Register the descriptor in the extension's root `index.ts`.

Returning `undefined` from a renderer delegates that block to Pi's original Markdown renderer.

## Implementation note

The renderer-neutral diff alignment, highlighting, theming, and responsive pane logic lives in `../../lib/side-by-side-diff/` and is shared with the `tool-diffs` extension. This extension only adapts that renderer to fenced Markdown.

This extension uses a transitional contract validated with Pi 0.83 and 0.84.1–0.84.2. Pi 0.83 has no Markdown extension hook; Pi 0.84.1–0.84.2 exposes `registerMarkdownTransformer`, but that API can return only Markdown strings rather than custom TUI components. The extension therefore still patches the shared `Markdown.prototype.render` method and stores patch state under `asoka.pi.custom-markdown-code-blocks` so reloads are idempotent.

On Pi 0.84.1–0.84.2, the adapter applies `MarkdownOptions.transform` exactly once to the complete source at the available content width before discovering custom fences. Ordinary Markdown and custom-renderer fallbacks delegate with `transform` removed so it cannot run again, while all other options, including `renderLatex`, are retained. Pi 0.83 follows the same path with no transform option. Replace the patch when Pi exposes an official code-block component renderer hook.
