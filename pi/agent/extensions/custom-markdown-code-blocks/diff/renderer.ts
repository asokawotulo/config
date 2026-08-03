import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CodeBlockRenderContext } from "../types.ts";
import { applyDiffBackground } from "./theme.ts";
import type {
  DiffBackgroundColorKey,
  DiffCell,
  DiffRow,
  DiffSourceRow,
  HighlightedDiffPair,
} from "./types.ts";

const MIN_SIDE_BY_SIDE_WIDTH = 72;

function isMetadataLine(line: string): boolean {
  return (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("@@") ||
    line === "\\ No newline at end of file"
  );
}

export function alignUnifiedDiff(code: string): DiffRow[] {
  const lines = code.split("\n");
  const rows: DiffRow[] = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index] ?? "";

    if (isMetadataLine(line)) {
      rows.push({ type: "meta", text: line });
      index++;
      continue;
    }

    if (line.startsWith("-")) {
      const removed: string[] = [];
      while (
        index < lines.length &&
        (lines[index] ?? "").startsWith("-") &&
        !isMetadataLine(lines[index] ?? "")
      ) {
        removed.push((lines[index] ?? "").slice(1));
        index++;
      }

      const added: string[] = [];
      while (
        index < lines.length &&
        (lines[index] ?? "").startsWith("+") &&
        !isMetadataLine(lines[index] ?? "")
      ) {
        added.push((lines[index] ?? "").slice(1));
        index++;
      }

      const count = Math.max(removed.length, added.length);
      for (let row = 0; row < count; row++) {
        rows.push({
          type: "pair",
          before: {
            marker: removed[row] === undefined ? " " : "-",
            text: removed[row] ?? "",
          },
          after: {
            marker: added[row] === undefined ? " " : "+",
            text: added[row] ?? "",
          },
        });
      }
      continue;
    }

    if (line.startsWith("+")) {
      rows.push({
        type: "pair",
        before: { marker: " ", text: "" },
        after: { marker: "+", text: line.slice(1) },
      });
      index++;
      continue;
    }

    const context = line.startsWith(" ") ? line.slice(1) : line;
    rows.push({
      type: "pair",
      before: { marker: " ", text: context },
      after: { marker: " ", text: context },
    });
    index++;
  }

  return rows;
}

function padToWidth(text: string, width: number): string {
  const truncated = truncateToWidth(text, Math.max(0, width), "");
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function fillLabel(label: string, width: number): string {
  if (width <= 0) return "";
  const value = ` ${label} `;
  if (visibleWidth(value) >= width) return truncateToWidth(value, width, "");
  return value + "─".repeat(width - visibleWidth(value));
}

function highlightDiffRows(
  rows: readonly DiffRow[],
  inheritedLanguage: string | undefined,
  highlightCode: CodeBlockRenderContext["highlightCode"],
): ReadonlyMap<number, HighlightedDiffPair> {
  if (!inheritedLanguage || !highlightCode) return new Map();

  const highlighted = new Map<number, HighlightedDiffPair>();
  for (let index = 0; index < rows.length; ) {
    if (rows[index]?.type === "meta") {
      index++;
      continue;
    }

    const segment: DiffSourceRow[] = [];
    while (index < rows.length && rows[index]?.type === "pair") {
      const row = rows[index];
      if (row?.type === "pair") {
        segment.push({ index, before: row.before.text, after: row.after.text });
      }
      index++;
    }

    const beforeLines = highlightCode(
      segment.map((row) => row.before).join("\n"),
      inheritedLanguage,
    );
    const afterLines = highlightCode(
      segment.map((row) => row.after).join("\n"),
      inheritedLanguage,
    );
    for (let segmentIndex = 0; segmentIndex < segment.length; segmentIndex++) {
      const row = segment[segmentIndex]!;
      highlighted.set(row.index, {
        before: beforeLines[segmentIndex] ?? row.before,
        after: afterLines[segmentIndex] ?? row.after,
      });
    }
  }
  return highlighted;
}

function backgroundKeyForCell(cell: DiffCell): DiffBackgroundColorKey | undefined {
  if (cell.marker === "-") return "toolDiffRemovedBg";
  if (cell.marker === "+") return "toolDiffAddedBg";
  return undefined;
}

function renderDiffCell(
  cell: DiffCell,
  highlightedText: string | undefined,
  width: number,
  theme?: Theme,
): string {
  let value: string;
  if (highlightedText !== undefined) {
    const marker = !theme
      ? cell.marker
      : cell.marker === "-"
        ? theme.fg("toolDiffRemoved", cell.marker)
        : cell.marker === "+"
          ? theme.fg("toolDiffAdded", cell.marker)
          : theme.fg("toolDiffContext", cell.marker);
    value = `${marker} ${highlightedText}`;
  } else {
    value = `${cell.marker} ${cell.text}`;
    if (theme) {
      const color =
        cell.marker === "-"
          ? "toolDiffRemoved"
          : cell.marker === "+"
            ? "toolDiffAdded"
            : "toolDiffContext";
      value = theme.fg(color, value);
    }
  }

  const padded = padToWidth(value, width);
  const backgroundKey = backgroundKeyForCell(cell);
  return theme && backgroundKey ? applyDiffBackground(theme, backgroundKey, padded) : padded;
}

export function renderSideBySideDiff({
  code,
  inheritedLanguage,
  highlightCode,
  width,
  paddingX,
  theme,
}: CodeBlockRenderContext): string[] | undefined {
  const contentWidth = width - paddingX * 2;
  if (contentWidth < MIN_SIDE_BY_SIDE_WIDTH) return undefined;

  const paneSpace = contentWidth - 7;
  const beforeWidth = Math.floor(paneSpace / 2);
  const afterWidth = paneSpace - beforeWidth;
  const margin = " ".repeat(paddingX);
  const border = (value: string) => theme?.fg("mdCodeBlockBorder", value) ?? value;
  const lines: string[] = [];
  const rows = alignUnifiedDiff(code);
  const highlightedRows = highlightDiffRows(rows, inheritedLanguage, highlightCode);

  lines.push(
    margin +
      border(`┌─${fillLabel("Before", beforeWidth)}─┬─${fillLabel("After", afterWidth)}─┐`) +
      margin,
  );

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!;
    if (row.type === "meta") {
      const metadata = theme?.fg("muted", row.text) ?? row.text;
      lines.push(
        margin + border("│ ") + padToWidth(metadata, contentWidth - 4) + border(" │") + margin,
      );
      continue;
    }

    lines.push(
      margin +
        border("│ ") +
        renderDiffCell(
          row.before,
          highlightedRows.get(rowIndex)?.before,
          beforeWidth,
          theme,
        ) +
        border(" │ ") +
        renderDiffCell(
          row.after,
          highlightedRows.get(rowIndex)?.after,
          afterWidth,
          theme,
        ) +
        border(" │") +
        margin,
    );
  }

  lines.push(
    margin +
      border(`└─${"─".repeat(beforeWidth)}─┴─${"─".repeat(afterWidth)}─┘`) +
      margin,
  );
  return lines.map((line) => padToWidth(line, width));
}
