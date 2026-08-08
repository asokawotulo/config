import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type Focusable } from "@earendil-works/pi-tui";
import { dialogContentWidth, renderDialogBox } from "../../../shared/ui/index.ts";

export const WIDE_DIALOG_WIDTH = 100;
const DIALOG_COLUMN_GAP = 3;

export function dialogColumnWidths(width: number): { left: number; right: number } {
  const safeWidth = Math.max(1, width);
  if (safeWidth < WIDE_DIALOG_WIDTH) return { left: safeWidth, right: safeWidth };
  const right = Math.max(24, Math.floor(safeWidth * 0.25));
  return { left: safeWidth - right - DIALOG_COLUMN_GAP, right };
}

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
  const columns = dialogColumnWidths(safeWidth);
  const height = Math.max(left.length, right.length);
  return Array.from({ length: height }, (_, index) =>
    `${fit(left[index] ?? "", columns.left)}${" ".repeat(DIALOG_COLUMN_GAP)}${fit(right[index] ?? "", columns.right)}`,
  );
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
    const contentWidth = dialogContentWidth(safeWidth);
    const lines = renderDialogBox(this.theme, safeWidth, this.renderDialog(contentWidth));
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
