import type {
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type OverlayOptions,
  type TUI,
} from "@earendil-works/pi-tui";

type DialogKeybinding = Parameters<KeybindingsManager["matches"]>[1];

export interface DialogStatus {
  type: "warning" | "error";
  text: string;
}

export interface DialogFrameOptions {
  title?: string;
  header?: string[];
  body: string[];
  status?: DialogStatus;
  hints: string[];
}

export abstract class DialogComponent implements Component {
  private cachedWidth?: number;
  private cachedLines?: string[];

  protected constructor(
    protected readonly tui: TUI,
    protected readonly theme: Theme,
    protected readonly keybindings: KeybindingsManager,
  ) {}

  protected abstract renderContent(width: number): string[];

  protected refresh(): void {
    this.clearCache();
    this.tui.requestRender();
  }

  protected matchesBinding(data: string, binding: DialogKeybinding): boolean {
    return this.keybindings.matches(data, binding);
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    this.cachedLines = this.renderContent(width);
    this.cachedWidth = width;
    return this.cachedLines;
  }

  invalidate(): void {
    this.clearCache();
  }

  private clearCache(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

export function formatDialogHints(hints: string[]): string {
  return hints.filter(Boolean).join(" • ");
}

export function keybindingHint(
  keybindings: KeybindingsManager | undefined,
  binding: DialogKeybinding,
  description: string,
  fallback: string,
): string {
  const keys = keybindings?.getKeys(binding) ?? [];
  return `${keys.length > 0 ? keys.join("/") : fallback} ${description}`;
}

export function renderDialogFrame(
  theme: Theme,
  width: number,
  options: DialogFrameOptions,
): string[] {
  const safeWidth = Math.max(1, width);
  const border = theme.fg("borderAccent", "─".repeat(safeWidth));
  const lines: string[] = [border];

  if (options.title) {
    lines.push(` ${theme.fg("accent", theme.bold(options.title))}`);
  } else if (options.header) {
    lines.push(...options.header);
  }

  if (options.title || options.header) lines.push("");
  lines.push(...options.body);
  lines.push("");

  if (options.status) {
    const statusLines = wrapTextWithAnsi(
      theme.fg(options.status.type, options.status.text),
      Math.max(1, safeWidth - 1),
    );
    lines.push(...statusLines.map((line) => ` ${line}`));
  }

  const hintLines = wrapTextWithAnsi(
    theme.fg("dim", formatDialogHints(options.hints)),
    Math.max(1, safeWidth - 1),
  );
  lines.push(...(hintLines.length > 0 ? hintLines : [""]).map((line) => ` ${line}`));
  lines.push(border);

  return lines.map((line) => {
    const truncated = truncateToWidth(line, safeWidth, "");
    const padding = " ".repeat(
      Math.max(0, safeWidth - visibleWidth(truncated)),
    );
    return theme.bg("customMessageBg", truncated + padding);
  });
}

export function centeredDialogOverlay(
  sizing: Pick<OverlayOptions, "width" | "minWidth" | "maxHeight">,
): OverlayOptions {
  return {
    ...sizing,
    anchor: "center",
    margin: 1,
  };
}
