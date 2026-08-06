import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type Focusable } from "@earendil-works/pi-tui";

export const WIDE_DIALOG_WIDTH = 100;
/** Internal render marker removed before output; used to keep the selected row visible. */
export const DIALOG_SELECTION_MARKER = "\uE000";

function fit(line: string, width: number): string {
  const clipped = truncateToWidth(line, Math.max(1, width), "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/** Join dialog regions responsively without allowing either region to overflow. */
export function layoutDialogColumns(left: string[], right: string[], width: number): string[] {
  const safeWidth = Math.max(1, width);
  if (safeWidth < WIDE_DIALOG_WIDTH) {
    return [...left.map((line) => fit(line, safeWidth)), "", ...right.map((line) => fit(line, safeWidth))];
  }
  const gap = 3;
  const leftWidth = Math.min(30, Math.max(24, Math.floor(safeWidth * 0.28)));
  const rightWidth = safeWidth - leftWidth - gap;
  const height = Math.max(left.length, right.length);
  return Array.from({ length: height }, (_, index) =>
    `${fit(left[index] ?? "", leftWidth)}${" ".repeat(gap)}${fit(right[index] ?? "", rightWidth)}`,
  );
}

export function selectedLine(theme: Theme, selected: boolean, text: string): string {
  const prefix = selected ? theme.fg("accent", "> ") : "  ";
  return `${selected ? DIALOG_SELECTION_MARKER : ""}${prefix}${selected ? theme.fg("accent", text) : theme.fg("text", text)}`;
}

export function checkbox(theme: Theme, checked: boolean): string {
  return theme.fg(checked ? "success" : "muted", checked ? "[x]" : "[ ]");
}

/** Shared base for form dialogs: caching, focus propagation, framing, and safe-width output. */
export abstract class DialogComponent<Result> implements Component, Focusable {
  private cachedWidth?: number;
  private cachedLines?: string[];
  private _focused = false;

  protected constructor(
    protected readonly theme: Theme,
    protected readonly done: (result: Result | undefined) => void,
    private readonly requestRender: () => void,
  ) {}

  get focused(): boolean { return this._focused; }
  set focused(value: boolean) {
    if (this._focused === value) return;
    this._focused = value;
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.propagateFocus(value);
    this.requestRender();
  }

  protected propagateFocus(_focused: boolean): void {}

  protected changed(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.propagateFocus(this._focused);
    this.requestRender();
  }

  protected abstract renderDialog(width: number): string[];

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    if (this.cachedWidth === safeWidth && this.cachedLines) return this.cachedLines;
    const border = this.theme.fg("borderAccent", "─".repeat(safeWidth));
    const lines = [border, ...this.renderDialog(safeWidth), border]
      .map((line) => truncateToWidth(line, safeWidth, ""));
    this.cachedWidth = safeWidth;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  abstract handleInput(data: string): void;
}
