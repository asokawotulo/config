export type DiffByteRange = {
  start: number;
  end: number;
};

export type DiffCell = {
  marker: " " | "+" | "-";
  text: string;
  changedBytes?: readonly DiffByteRange[];
};

export type DiffRow =
  | { type: "pair"; before: DiffCell; after: DiffCell }
  | { type: "meta"; text: string };

export type DiffBackgroundColorKey = "toolDiffAddedBg" | "toolDiffRemovedBg";

export type HighlightedDiffPair = {
  before: string;
  after: string;
};

export type DiffSourceRow = HighlightedDiffPair & {
  index: number;
};
