import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type OverlayHandle,
  type OverlayOptions,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  SUPACODE_NOTIFICATION_EVENT,
  type SupacodeNotification,
} from "../../lib/supacode-events.ts";

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

type DialogFactory<Result> = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (result: Result) => void,
) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>;

export interface ShowDialogOptions {
  notification: SupacodeNotification;
  overlayOptions: OverlayOptions | (() => OverlayOptions);
  onHandle?: (handle: OverlayHandle) => void;
}

export const DIALOG_PADDING_X = 1;
export const DIALOG_PADDING_Y = 1;

/** Width available to dialog content inside the border and horizontal padding. */
export function dialogContentWidth(width: number): number {
  return Math.max(1, Math.max(1, width) - 2 - DIALOG_PADDING_X * 2);
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

/** Add the standard padded, fully bordered dialog surface around content lines. */
export function renderDialogBox(theme: Theme, width: number, content: string[]): string[] {
  const safeWidth = Math.max(1, width);
  if (safeWidth < 4) {
    const horizontal = safeWidth === 1 ? "─" : `┌${"─".repeat(Math.max(0, safeWidth - 2))}┐`;
    const vertical = safeWidth === 1 ? "│" : `│${" ".repeat(Math.max(0, safeWidth - 2))}│`;
    const bottom = safeWidth === 1 ? "─" : `└${"─".repeat(Math.max(0, safeWidth - 2))}┘`;
    return [horizontal, ...content.map(() => vertical), bottom]
      .map((line) => theme.bg("customMessageBg", theme.fg("borderAccent", line)));
  }
  const innerWidth = safeWidth - 2;
  const contentWidth = dialogContentWidth(safeWidth);
  const horizontal = theme.fg("borderAccent", "─".repeat(innerWidth));
  const left = theme.fg("borderAccent", "│");
  const right = theme.fg("borderAccent", "│");
  const blank = `${left}${" ".repeat(innerWidth)}${right}`;
  const rows = content.map((line) => {
    const clipped = truncateToWidth(line, contentWidth, "");
    const trailing = " ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)));
    return `${left}${" ".repeat(DIALOG_PADDING_X)}${clipped}${trailing}${" ".repeat(DIALOG_PADDING_X)}${right}`;
  });
  const lines = [
    `${theme.fg("borderAccent", "┌")}${horizontal}${theme.fg("borderAccent", "┐")}`,
    ...Array.from({ length: DIALOG_PADDING_Y }, () => blank),
    ...rows,
    ...Array.from({ length: DIALOG_PADDING_Y }, () => blank),
    `${theme.fg("borderAccent", "└")}${horizontal}${theme.fg("borderAccent", "┘")}`,
  ];
  return lines.map((line) => theme.bg("customMessageBg", line));
}

export function renderDialogFrame(
  theme: Theme,
  width: number,
  options: DialogFrameOptions,
): string[] {
  const safeWidth = Math.max(1, width);
  const contentWidth = dialogContentWidth(safeWidth);
  const lines: string[] = [];

  if (options.title) {
    lines.push(theme.fg("accent", theme.bold(options.title)));
  } else if (options.header) {
    lines.push(...options.header);
  }

  if (options.title || options.header) lines.push("");
  lines.push(...options.body);
  lines.push("");

  if (options.status) {
    lines.push(...wrapTextWithAnsi(
      theme.fg(options.status.type, options.status.text),
      contentWidth,
    ));
  }

  const hintLines = wrapTextWithAnsi(
    theme.fg("dim", formatDialogHints(options.hints)),
    contentWidth,
  );
  lines.push(...(hintLines.length > 0 ? hintLines : [""]));
  return renderDialogBox(theme, safeWidth, lines);
}

/** Show a visible custom dialog and notify once after its overlay is mounted. */
export function showDialog<Result>(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  factory: DialogFactory<Result>,
  options: ShowDialogOptions,
): Promise<Result> {
  let notified = false;
  return ctx.ui.custom(factory, {
    overlay: true,
    overlayOptions: options.overlayOptions,
    onHandle: (handle) => {
      if (!notified) {
        notified = true;
        pi.events.emit(SUPACODE_NOTIFICATION_EVENT, options.notification);
      }
      options.onHandle?.(handle);
    },
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
