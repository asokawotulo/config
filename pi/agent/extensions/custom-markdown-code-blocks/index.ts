import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { diffCodeBlockRenderer } from "./diff/index.ts";
import { installCustomMarkdownCodeBlocks } from "./markdown-renderer.ts";

/**
 * Experimental global Markdown enhancement for Pi 0.83.
 *
 * Pi does not yet expose a Markdown code-block renderer hook, so this patches
 * the shared Markdown component. The Symbol-backed state makes reloads of this
 * extension idempotent. Remove the patch once Pi exposes an official hook.
 */
export default function (pi: ExtensionAPI) {
  const setTheme = installCustomMarkdownCodeBlocks([diffCodeBlockRenderer]);

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui") setTheme(ctx.ui.theme);
  });
}
