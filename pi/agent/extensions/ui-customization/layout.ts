import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { DynamicWorkflowAgentTarget } from "../../lib/dynamic-workflow-events.ts";
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
  invalidate(): void;
  /** Zero-based row lookup retained from the latest sidebar render. */
  hitTestAgent?(row: number): DynamicWorkflowAgentTarget | undefined;
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
  private lastWidth = 0;
  private lastHeight = 0;
  private historyCache:
    | { width: number; lines: readonly string[] }
    | undefined;
  private idleScrollRequested = false;
  private agentActive = false;

  constructor(
    private readonly tui: TUI,
    private readonly root: Pi083Root,
    readonly scroll: ChatScrollState,
    private readonly sidebar: SidebarRenderer,
  ) {}

  /** Allow exactly the next render to reuse complete history for an idle scroll. */
  requestIdleScrollRender(idle: boolean): void {
    this.idleScrollRequested =
      idle && !this.agentActive && this.historyCache !== undefined;
  }

  setAgentActive(active: boolean): void {
    if (active === this.agentActive) return;
    this.agentActive = active;
    this.invalidateHistory();
  }

  invalidateHistory(): void {
    this.historyCache = undefined;
    this.idleScrollRequested = false;
  }

  invalidateSidebar(): void {
    this.sidebar.invalidate();
  }

  invalidateAll(): void {
    this.invalidateHistory();
    this.invalidateSidebar();
  }

  render(width: number): string[] {
    const height = Math.max(1, this.tui.terminal.rows);
    const sidebarVisible = width >= SIDEBAR_MIN_TERMINAL_WIDTH;
    const resized =
      this.lastWidth !== 0 &&
      (width !== this.lastWidth || height !== this.lastHeight);
    let useIdleHistory = this.idleScrollRequested && !resized;
    this.idleScrollRequested = false;

    if (resized) {
      this.invalidateAll();
      useIdleHistory = false;
    }

    this.lastWidth = width;
    this.lastHeight = height;
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
    const cachedHistory = this.historyCache;
    let reusedHistory = false;
    let historyLines: readonly string[];
    if (useIdleHistory && cachedHistory?.width === leftWidth) {
      historyLines = cachedHistory.lines;
      reusedHistory = true;
    } else {
      historyLines = renderComponents(this.root.history, leftWidth);
    }
    if (!reusedHistory && !this.agentActive) {
      this.historyCache = { width: leftWidth, lines: historyLines };
    }
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

  /** Hit-test one-based SGR terminal coordinates against the latest render. */
  hitTestSidebar(
    column: number,
    row: number,
  ): DynamicWorkflowAgentTarget | undefined {
    if (
      !this.lastSidebarVisible ||
      !Number.isInteger(column) ||
      !Number.isInteger(row) ||
      row < 1 ||
      row > this.lastHeight
    ) {
      return undefined;
    }
    const sidebarStart = this.lastWidth - SIDEBAR_WIDTH + 1;
    if (column < sidebarStart || column > this.lastWidth) return undefined;
    return this.sidebar.hitTestAgent?.(row - 1);
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
