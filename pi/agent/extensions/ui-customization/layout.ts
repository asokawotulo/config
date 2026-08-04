import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { ChatScrollState } from "./scroll-state.ts";

export const PI_083_ROOT_CHILD_COUNT = 9;
export const SIDEBAR_WIDTH = 30;
export const SIDEBAR_MIN_TERMINAL_WIDTH = 100;

export interface Pi083Root {
  history: Component[];
  fixed: Component[];
  footer: Component;
}

export interface SidebarRenderer {
  render(width: number, height: number): string[];
}

export interface TuiWithMutableRender extends TUI {
  render(width: number): string[];
}

export function resolvePi083Root(tui: TUI): Pi083Root | undefined {
  if (tui.children.length !== PI_083_ROOT_CHILD_COUNT) return undefined;
  if (!tui.children.every(isComponent)) return undefined;

  const [
    header,
    resources,
    chat,
    pending,
    status,
    aboveEditor,
    editor,
    belowEditor,
    footer,
  ] = tui.children;

  if (
    !header ||
    !resources ||
    !chat ||
    !pending ||
    !status ||
    !aboveEditor ||
    !editor ||
    !belowEditor ||
    !footer
  ) {
    return undefined;
  }

  return {
    history: [header, resources, chat],
    fixed: [pending, status, aboveEditor, editor, belowEditor],
    footer,
  };
}

function isComponent(value: unknown): value is Component {
  return (
    typeof value === "object" &&
    value !== null &&
    "render" in value &&
    typeof value.render === "function" &&
    "invalidate" in value &&
    typeof value.invalidate === "function"
  );
}

export class PatchedLayout {
  private lastSidebarVisible = false;

  constructor(
    private readonly tui: TUI,
    private readonly root: Pi083Root,
    readonly scroll: ChatScrollState,
    private readonly sidebar: SidebarRenderer,
  ) {}

  render(width: number): string[] {
    const height = Math.max(1, this.tui.terminal.rows);
    const sidebarVisible = width >= SIDEBAR_MIN_TERMINAL_WIDTH;
    const leftWidth = sidebarVisible
      ? Math.max(1, width - SIDEBAR_WIDTH)
      : width;

    if (sidebarVisible !== this.lastSidebarVisible) {
      this.lastSidebarVisible = sidebarVisible;
      this.scroll.followingBottom = true;
    }

    const fixedComponents = sidebarVisible
      ? this.root.fixed
      : [...this.root.fixed, this.root.footer];
    let fixedLines = renderComponents(fixedComponents, leftWidth);
    if (fixedLines.length > height) {
      fixedLines = fixedLines.slice(-height);
    }

    const viewportHeight = Math.max(0, height - fixedLines.length);
    const historyLines = renderComponents(this.root.history, leftWidth);
    this.scroll.reconcile(historyLines.length, viewportHeight);

    const visibleHistory =
      viewportHeight === 0
        ? []
        : historyLines.slice(
            this.scroll.scrollTop,
            this.scroll.scrollTop + viewportHeight,
          );
    const historyPadding = Array.from(
      { length: Math.max(0, viewportHeight - visibleHistory.length) },
      () => "",
    );
    const leftLines = [...visibleHistory, ...historyPadding, ...fixedLines];

    while (leftLines.length < height) leftLines.unshift("");
    if (!sidebarVisible) {
      return leftLines.map((line) => truncateToWidth(line, width, ""));
    }

    const sidebarLines = this.sidebar.render(SIDEBAR_WIDTH, height);
    return composeColumns(leftLines, sidebarLines, leftWidth, SIDEBAR_WIDTH, height);
  }
}

export function renderComponents(
  components: readonly Component[],
  width: number,
): string[] {
  return components.flatMap((component) => component.render(width));
}

export function composeColumns(
  leftLines: readonly string[],
  rightLines: readonly string[],
  leftWidth: number,
  rightWidth: number,
  height: number,
): string[] {
  const lines: string[] = [];
  for (let row = 0; row < height; row += 1) {
    const left = truncateToWidth(leftLines[row] ?? "", leftWidth, "");
    const paddedLeft = left + " ".repeat(Math.max(0, leftWidth - visibleWidth(left)));
    const right = truncateToWidth(rightLines[row] ?? "", rightWidth, "");
    lines.push(truncateToWidth(paddedLeft + right, leftWidth + rightWidth, ""));
  }
  return lines;
}
