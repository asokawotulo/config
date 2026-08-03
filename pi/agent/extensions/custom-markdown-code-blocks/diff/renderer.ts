import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CodeBlockRenderContext } from "../types.ts";
import type { DiffCell, DiffRow } from "./types.ts";

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

function styleCell(cell: DiffCell, theme?: Theme): string {
  const value = `${cell.marker} ${cell.text}`;
  if (!theme) return value;
  if (cell.marker === "-") return theme.fg("toolDiffRemoved", value);
  if (cell.marker === "+") return theme.fg("toolDiffAdded", value);
  return theme.fg("toolDiffContext", value);
}

export function renderSideBySideDiff({
  code,
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

  lines.push(
    margin +
      border(`┌─${fillLabel("Before", beforeWidth)}─┬─${fillLabel("After", afterWidth)}─┐`) +
      margin,
  );

  for (const row of alignUnifiedDiff(code)) {
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
        padToWidth(styleCell(row.before, theme), beforeWidth) +
        border(" │ ") +
        padToWidth(styleCell(row.after, theme), afterWidth) +
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
