import { renderSideBySideDiff } from "../../../lib/side-by-side-diff/renderer.ts";
import type { CustomCodeBlockRenderer } from "../types.ts";

export const diffCodeBlockRenderer: CustomCodeBlockRenderer = {
  language: "diff",
  render: renderSideBySideDiff,
};
