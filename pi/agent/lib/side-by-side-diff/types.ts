import type { Theme } from "@earendil-works/pi-coding-agent";

export type DiffHighlightCode = (code: string, language?: string) => string[];

export type SideBySideDiffRenderContext = {
  code: string;
  inheritedLanguage?: string;
  highlightCode?: DiffHighlightCode;
  width: number;
  paddingX: number;
  theme?: Theme;
  maxRows?: number;
};

export type DiffByteRange = {
  start: number;
  end: number;
};

export type DiffCell = {
  marker: " " | "+" | "-";
  text: string;
  lineNumber?: number;
  changedBytes?: readonly DiffByteRange[];
};

export type DiffRow =
  | { type: "pair"; before: DiffCell; after: DiffCell }
  | { type: "meta"; before: string; after: string };

export type DiffBackgroundColorKey = "toolDiffAddedBg" | "toolDiffRemovedBg";

export type HighlightedDiffPair = {
  before: string;
  after: string;
};

export type DiffSourceRow = HighlightedDiffPair & {
  index: number;
};
