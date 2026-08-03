# Custom Markdown code blocks

Adds streaming custom fenced-code renderers to Pi's Markdown transcript. Each renderer is registered by language and lives in its own folder with its own rendering logic and types.

## Diff

The built-in custom renderer displays `diff` fences as responsive Before/After panes:

````markdown
```diff
 export const config = {
-  timeout: 1_000,
+  timeout: 5_000,
   retries: 3,
 };
```
````

At fewer than 72 content columns, the renderer delegates back to Pi's normal unified code-block rendering. Replacement runs are aligned by position; this is intended for focused planning snippets rather than a semantic diff viewer.

## Adding a renderer

1. Create a folder beside `diff/`.
2. Keep its renderer-specific types and tests inside that folder.
3. Export a `CustomCodeBlockRenderer` descriptor from the folder's `index.ts`.
4. Register the descriptor in the extension's root `index.ts`.

Returning `undefined` from a renderer delegates that block to Pi's original Markdown renderer.

## Implementation note

Pi 0.83 does not expose a Markdown code-block renderer hook. This extension patches the shared `Markdown.prototype.render` method and stores patch state under `asoka.pi.custom-markdown-code-blocks` so reloads are idempotent. It should be replaced by the official extension API if Pi adds a code-block renderer hook.
