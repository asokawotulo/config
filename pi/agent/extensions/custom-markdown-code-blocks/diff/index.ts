import type { CustomCodeBlockRenderer } from "../types.ts";
import { renderSideBySideDiff } from "./renderer.ts";

export const diffCodeBlockRenderer: CustomCodeBlockRenderer = {
  language: "diff",
  render: renderSideBySideDiff,
};
