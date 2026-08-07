import {
  getLanguageFromPath,
  highlightCode,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Text, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { renderSideBySideDiff } from "../../lib/side-by-side-diff/renderer.ts";

export type WriteDiffDetails =
  | { kind: "diff"; path: string; patch: string; created: boolean }
  | { kind: "no-change"; path: string; created: boolean }
  | { kind: "snapshot-unavailable"; path: string };

type TextContent = { type: string; text?: string };

type RenderableResult = {
  content?: TextContent[];
  details?: unknown;
};

function resultText(result: RenderableResult): string {
  return (
    result.content
      ?.filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text ?? "")
      .join("\n") ?? ""
  );
}

function renderUnifiedDiff(patch: string, width: number, theme: Theme): string[] {
  const renderWidth = Math.max(1, width);
  return patch.replace(/\n$/, "").split("\n").flatMap((line) => {
    const color =
      line.startsWith("+") && !line.startsWith("+++")
        ? "toolDiffAdded"
        : line.startsWith("-") && !line.startsWith("---")
          ? "toolDiffRemoved"
          : line.startsWith(" ")
            ? "toolDiffContext"
            : "muted";
    return wrapTextWithAnsi(theme.fg(color, line), renderWidth);
  });
}

const MAX_CACHED_WIDTHS = 2;

export class ToolDiffComponent implements Component {
  private readonly renderedByWidth = new Map<number, string[]>();

  constructor(
    private readonly patch: string,
    private readonly path: string,
    private readonly theme: Theme,
    private readonly maxRows?: number,
  ) {}

  render(width: number): string[] {
    const cached = this.renderedByWidth.get(width);
    if (cached !== undefined) {
      this.renderedByWidth.delete(width);
      this.renderedByWidth.set(width, cached);
      return cached;
    }

    const language = getLanguageFromPath(this.path);
    const sideBySide = renderSideBySideDiff({
      code: this.patch.replace(/\n$/, ""),
      inheritedLanguage: language,
      highlightCode: (code, inheritedLanguage) => highlightCode(code, inheritedLanguage),
      width,
      paddingX: 0,
      theme: this.theme,
      maxRows: this.maxRows,
    });
    const rendered = sideBySide ?? renderUnifiedDiff(this.patch, width, this.theme);
    if (this.renderedByWidth.size >= MAX_CACHED_WIDTHS) {
      const leastRecentlyUsedWidth = this.renderedByWidth.keys().next().value;
      if (leastRecentlyUsedWidth !== undefined) {
        this.renderedByWidth.delete(leastRecentlyUsedWidth);
      }
    }
    this.renderedByWidth.set(width, rendered);
    return rendered;
  }

  invalidate(): void {
    this.renderedByWidth.clear();
  }
}

export function renderMutationHeader(
  label: "edit" | "write",
  args: { path?: unknown; file_path?: unknown },
  theme: Theme,
  lastComponent?: Component,
): Component {
  const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : "";
  const component = lastComponent instanceof Text ? lastComponent : new Text("", 0, 0);
  const suffix = path ? ` ${theme.fg("toolTitle", path)}` : "";
  component.setText(`${theme.fg("toolTitle", theme.bold(label))}${suffix}`);
  return component;
}

export function renderError(result: RenderableResult, theme: Theme): Component {
  return new Text(theme.fg("error", resultText(result) || "Tool execution failed"), 0, 0);
}

export function renderStatus(result: RenderableResult, theme: Theme): Component {
  return new Text(theme.fg("muted", resultText(result)), 0, 0);
}
