export type DiffCell = {
  marker: " " | "+" | "-";
  text: string;
};

export type DiffRow =
  | { type: "pair"; before: DiffCell; after: DiffCell }
  | { type: "meta"; text: string };
