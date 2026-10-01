import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { diffCodeBlockRenderer } from "./diff/index.ts";
import { installCustomMarkdownCodeBlocks } from "./markdown-renderer.ts";

/**
 * Global Markdown enhancement for custom fenced-code renderers.
 *
 * Pi exposes string-only Markdown transformers, but not a custom
 * code-block component hook, so this patches the shared Markdown
 * component. The Symbol-backed state makes extension reloads idempotent.
 */
export default function (pi: ExtensionAPI) {
  const setTheme = installCustomMarkdownCodeBlocks([diffCodeBlockRenderer]);

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui") setTheme(ctx.ui.theme);
  });
}
