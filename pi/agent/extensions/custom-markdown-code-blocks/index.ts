import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { diffCodeBlockRenderer } from "./diff/index.ts";
import { installCustomMarkdownCodeBlocks } from "./markdown-renderer.ts";

/**
 * Transitional global Markdown enhancement for Pi 0.83 and 0.84.1.
 *
 * Pi 0.84.1 exposes string-only Markdown transformers, but not a custom
 * code-block component hook, so this still patches the shared Markdown
 * component. The Symbol-backed state makes extension reloads idempotent.
 */
export default function (pi: ExtensionAPI) {
  const setTheme = installCustomMarkdownCodeBlocks([diffCodeBlockRenderer]);

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui") setTheme(ctx.ui.theme);
  });
}
