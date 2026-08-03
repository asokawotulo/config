import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { diffArrays } from "diff";
import type { CodeBlockRenderContext } from "../types.ts";
import { applyDiffBackground, getDiffBackgroundAnsi } from "./theme.ts";
import type {
  DiffBackgroundColorKey,
  DiffByteRange,
  DiffCell,
  DiffRow,
  DiffSourceRow,
  HighlightedDiffPair,
} from "./types.ts";

const MIN_SIDE_BY_SIDE_WIDTH = 72;
const MAX_ALIGNED_LINE_PAIRS = 10_000;
const MAX_ALIGNED_BYTES = 64 * 1024;
const MAX_BYTE_DIFF_EDIT_LENGTH = 512;
const MAX_BYTE_DIFF_TIME_MS = 5;
// Slightly cheaper than pairing two unrelated lines, so ordinary replacements
// stay paired while stronger code-point profile similarity determines where gaps belong.
const GAP_SCORE = -0.55;
const ANSI_SEQUENCE = /^\x1b\[[0-?]*[ -/]*[@-~]/;
const ANSI_SEQUENCES = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const textEncoder = new TextEncoder();

type ByteDiff = {
  before: readonly DiffByteRange[];
  after: readonly DiffByteRange[];
};

type LineProfile = {
  grams: ReadonlyMap<string, number>;
  count: number;
};

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function createLineProfile(value: string): LineProfile {
  const characters = Array.from(value.trimStart());
  if (characters.length === 0) return { grams: new Map(), count: 0 };

  const grams = new Map<string, number>();
  const gramSize = characters.length === 1 ? 1 : 2;
  const count = characters.length - gramSize + 1;
  for (let index = 0; index < count; index++) {
    const gram = characters.slice(index, index + gramSize).join("\0");
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return { grams, count };
}

function lineSimilarity(before: LineProfile, after: LineProfile): number {
  if (before.count === 0 || after.count === 0) {
    return before.count === after.count ? 1 : 0;
  }

  const [smaller, larger] =
    before.grams.size <= after.grams.size
      ? [before.grams, after.grams]
      : [after.grams, before.grams];
  let common = 0;
  for (const [gram, count] of smaller) {
    common += Math.min(count, larger.get(gram) ?? 0);
  }
  return (common * 2) / (before.count + after.count);
}

function diffByteRanges(before: string, after: string): ByteDiff {
  // Diff code points so a range cannot split a UTF-8 sequence, then measure the
  // resulting offsets as bytes for stable projection onto highlighted output.
  const changes = diffArrays(Array.from(before), Array.from(after), {
    maxEditLength: MAX_BYTE_DIFF_EDIT_LENGTH,
    timeout: MAX_BYTE_DIFF_TIME_MS,
  });
  const beforeRanges: DiffByteRange[] = [];
  const afterRanges: DiffByteRange[] = [];
  if (!changes) {
    const beforeLength = byteLength(before);
    const afterLength = byteLength(after);
    return {
      before: beforeLength === 0 ? [] : [{ start: 0, end: beforeLength }],
      after: afterLength === 0 ? [] : [{ start: 0, end: afterLength }],
    };
  }
  let beforeOffset = 0;
  let afterOffset = 0;

  for (const change of changes) {
    const length = change.value.reduce((total, value) => total + byteLength(value), 0);
    if (change.removed) {
      beforeRanges.push({ start: beforeOffset, end: beforeOffset + length });
      beforeOffset += length;
    } else if (change.added) {
      afterRanges.push({ start: afterOffset, end: afterOffset + length });
      afterOffset += length;
    } else {
      beforeOffset += length;
      afterOffset += length;
    }
  }

  return { before: beforeRanges, after: afterRanges };
}

function positionalReplacementRows(removed: readonly string[], added: readonly string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const count = Math.max(removed.length, added.length);
  for (let index = 0; index < count; index++) {
    const before = removed[index];
    const after = added[index];
    rows.push({
      type: "pair",
      before: { marker: before === undefined ? " " : "-", text: before ?? "" },
      after: { marker: after === undefined ? " " : "+", text: after ?? "" },
    });
  }
  return rows;
}

export function alignReplacementRun(
  removed: readonly string[],
  added: readonly string[],
): DiffRow[] {
  if (removed.length === 0) return positionalReplacementRows(removed, added);
  if (added.length === 0) return positionalReplacementRows(removed, added);

  const totalBytes = [...removed, ...added].reduce((total, line) => total + byteLength(line), 0);
  if (
    removed.length * added.length > MAX_ALIGNED_LINE_PAIRS ||
    totalBytes > MAX_ALIGNED_BYTES
  ) {
    return positionalReplacementRows(removed, added);
  }

  const beforeProfiles = removed.map(createLineProfile);
  const afterProfiles = added.map(createLineProfile);
  const scores = Array.from({ length: removed.length + 1 }, () =>
    Array<number>(added.length + 1).fill(Number.NEGATIVE_INFINITY),
  );
  const steps = Array.from({ length: removed.length + 1 }, () =>
    Array<"pair" | "remove" | "add" | undefined>(added.length + 1),
  );
  scores[0]![0] = 0;
  for (let beforeIndex = 1; beforeIndex <= removed.length; beforeIndex++) {
    scores[beforeIndex]![0] = beforeIndex * GAP_SCORE;
    steps[beforeIndex]![0] = "remove";
  }
  for (let afterIndex = 1; afterIndex <= added.length; afterIndex++) {
    scores[0]![afterIndex] = afterIndex * GAP_SCORE;
    steps[0]![afterIndex] = "add";
  }

  for (let beforeIndex = 1; beforeIndex <= removed.length; beforeIndex++) {
    for (let afterIndex = 1; afterIndex <= added.length; afterIndex++) {
      const similarity = lineSimilarity(
        beforeProfiles[beforeIndex - 1]!,
        afterProfiles[afterIndex - 1]!,
      );
      const pairScore = scores[beforeIndex - 1]![afterIndex - 1]! + similarity * 2 - 1;
      const removeScore = scores[beforeIndex - 1]![afterIndex]! + GAP_SCORE;
      const addScore = scores[beforeIndex]![afterIndex - 1]! + GAP_SCORE;

      if (pairScore >= removeScore && pairScore >= addScore) {
        scores[beforeIndex]![afterIndex] = pairScore;
        steps[beforeIndex]![afterIndex] = "pair";
      } else if (removeScore >= addScore) {
        scores[beforeIndex]![afterIndex] = removeScore;
        steps[beforeIndex]![afterIndex] = "remove";
      } else {
        scores[beforeIndex]![afterIndex] = addScore;
        steps[beforeIndex]![afterIndex] = "add";
      }
    }
  }

  const rows: DiffRow[] = [];
  let beforeIndex = removed.length;
  let afterIndex = added.length;
  while (beforeIndex > 0 || afterIndex > 0) {
    const step = steps[beforeIndex]![afterIndex];
    if (step === "pair") {
      const before = removed[beforeIndex - 1]!;
      const after = added[afterIndex - 1]!;
      const byteDiff = diffByteRanges(before, after);
      rows.push({
        type: "pair",
        before: { marker: "-", text: before, changedBytes: byteDiff.before },
        after: { marker: "+", text: after, changedBytes: byteDiff.after },
      });
      beforeIndex--;
      afterIndex--;
    } else if (step === "remove") {
      rows.push({
        type: "pair",
        before: { marker: "-", text: removed[beforeIndex - 1]! },
        after: { marker: " ", text: "" },
      });
      beforeIndex--;
    } else {
      rows.push({
        type: "pair",
        before: { marker: " ", text: "" },
        after: { marker: "+", text: added[afterIndex - 1]! },
      });
      afterIndex--;
    }
  }

  return rows.reverse();
}

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

      rows.push(...alignReplacementRun(removed, added));
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

function applyByteRangeBackground(
  theme: Theme,
  key: DiffBackgroundColorKey,
  renderedText: string,
  sourceText: string,
  ranges: readonly DiffByteRange[],
): string {
  if (ranges.length === 0) return renderedText;
  if (renderedText.replace(ANSI_SEQUENCES, "") !== sourceText) {
    return applyDiffBackground(theme, key, renderedText);
  }

  const background = getDiffBackgroundAnsi(theme, key);
  let result = "";
  let renderedOffset = 0;
  let sourceByteOffset = 0;
  let rangeIndex = 0;
  let backgroundActive = false;

  while (renderedOffset < renderedText.length) {
    const remainder = renderedText.slice(renderedOffset);
    const ansi = ANSI_SEQUENCE.exec(remainder)?.[0];
    if (ansi) {
      result += ansi;
      if (backgroundActive && ansi === "\x1b[0m") result += background;
      renderedOffset += ansi.length;
      continue;
    }

    const character = String.fromCodePoint(renderedText.codePointAt(renderedOffset)!);
    while (ranges[rangeIndex] && ranges[rangeIndex]!.end <= sourceByteOffset) rangeIndex++;
    const range = ranges[rangeIndex];
    const changed = range !== undefined && range.start <= sourceByteOffset;
    if (changed !== backgroundActive) {
      result += changed ? background : "\x1b[49m";
      backgroundActive = changed;
    }
    result += character;
    renderedOffset += character.length;
    sourceByteOffset += byteLength(character);
  }

  if (backgroundActive) result += "\x1b[49m";
  return result;
}

function renderDiffCell(
  cell: DiffCell,
  highlightedText: string | undefined,
  width: number,
  theme?: Theme,
): string {
  const color =
    cell.marker === "-"
      ? "toolDiffRemoved"
      : cell.marker === "+"
        ? "toolDiffAdded"
        : "toolDiffContext";
  const marker = theme ? theme.fg(color, cell.marker) : cell.marker;
  let source = highlightedText ?? cell.text;
  if (theme && highlightedText === undefined) source = theme.fg(color, source);

  const backgroundKey = backgroundKeyForCell(cell);
  if (theme && backgroundKey && cell.changedBytes !== undefined) {
    source = applyByteRangeBackground(
      theme,
      backgroundKey,
      source,
      cell.text,
      cell.changedBytes,
    );
  }

  const value = padToWidth(`${marker} ${source}`, width);
  return theme && backgroundKey && cell.changedBytes === undefined
    ? applyDiffBackground(theme, backgroundKey, value)
    : value;
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
