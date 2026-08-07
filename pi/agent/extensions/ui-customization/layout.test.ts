import { describe, expect, test } from "bun:test";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  PatchedLayout,
  SIDEBAR_MIN_TERMINAL_WIDTH,
  SIDEBAR_WIDTH,
  type Pi083Root,
} from "./layout.ts";
import { ChatScrollState } from "./scroll-state.ts";

class Lines implements Component {
  renderCalls = 0;

  constructor(public lines: string[]) {}
  render(): string[] {
    this.renderCalls += 1;
    return this.lines;
  }
  invalidate(): void {}
}

function makeLayout(rows: number) {
  const history = new Lines(Array.from({ length: 20 }, (_, index) => `line-${index}`));
  const editor = new Lines(["editor"]);
  const footer = new Lines(["footer"]);
  const empty = new Lines([]);
  const root: Pi083Root = {
    history: [history],
    fixed: [empty, empty, empty, editor, empty],
    footer,
  };
  const terminal = { rows };
  const tui = { terminal } as TUI;
  const scroll = new ChatScrollState();
  const sidebar = {
    invalidations: 0,
    render(width: number, height: number) {
      return Array.from({ length: height }, () => "#".repeat(width));
    },
    invalidate() {
      this.invalidations += 1;
    },
    hitTestAgent(row: number) {
      return row === 2
        ? { sessionId: "session", runId: "run", agentId: "agent" }
        : undefined;
    },
  };
  return {
    history,
    editor,
    footer,
    scroll,
    sidebar,
    terminal,
    layout: new PatchedLayout(tui, root, scroll, sidebar),
  };
}

describe("PatchedLayout", () => {
  test("keeps the editor visible while scrolled up", () => {
    const { layout, scroll, editor } = makeLayout(8);
    layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);
    scroll.scrollBy(-5);
    const before = layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);

    editor.lines = ["typed text"];
    const after = layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);

    expect(after[0]).toStartWith(before[0]!.slice(0, 20));
    expect(after.at(-1)).toContain("typed text");
  });

  test("reuses complete history only for an explicitly requested idle scroll", () => {
    const { editor, history, layout, scroll } = makeLayout(8);
    layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);
    expect(history.renderCalls).toBe(1);

    scroll.scrollBy(-3);
    layout.requestIdleScrollRender(true);
    layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);
    expect(history.renderCalls).toBe(1);
    expect(editor.renderCalls).toBe(2);

    layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);
    expect(history.renderCalls).toBe(2);
  });

  test("restores bottom-following after an idle cached scroll", () => {
    const { history, layout, scroll } = makeLayout(8);
    layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);

    scroll.scrollBy(-3);
    layout.requestIdleScrollRender(true);
    layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);
    expect(scroll.followingBottom).toBe(false);

    scroll.scrollBy(3);
    layout.requestIdleScrollRender(true);
    layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);
    expect(scroll.followingBottom).toBe(true);

    history.lines.push("followed line");
    expect(layout.render(SIDEBAR_MIN_TERMINAL_WIDTH).join("\n"))
      .toContain("followed line");
    expect(scroll.followingBottom).toBe(true);
  });

  test("keeps active-agent and invalidated renders fresh", () => {
    const { history, layout, scroll } = makeLayout(8);
    layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);

    layout.setAgentActive(true);
    scroll.scrollBy(-3);
    layout.requestIdleScrollRender(true);
    layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);
    layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);
    expect(history.renderCalls).toBe(3);

    layout.setAgentActive(false);
    scroll.scrollBy(100);
    history.lines.push("final transcript line");
    layout.requestIdleScrollRender(true);
    expect(layout.render(SIDEBAR_MIN_TERMINAL_WIDTH).join("\n"))
      .toContain("final transcript line");
    expect(history.renderCalls).toBe(4);

    layout.requestIdleScrollRender(true);
    layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);
    expect(history.renderCalls).toBe(4);

    history.lines.push("invalidated transcript line");
    layout.invalidateHistory();
    layout.requestIdleScrollRender(true);
    expect(layout.render(SIDEBAR_MIN_TERMINAL_WIDTH).join("\n"))
      .toContain("invalidated transcript line");
    expect(history.renderCalls).toBe(5);
  });

  test("invalidates history and sidebar caches on resize", () => {
    const { history, layout, sidebar, terminal } = makeLayout(8);
    layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);
    layout.requestIdleScrollRender(true);

    terminal.rows = 9;
    layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);

    expect(history.renderCalls).toBe(2);
    expect(sidebar.invalidations).toBe(1);
  });

  test("reserves columns for the sidebar in wide mode", () => {
    const { layout } = makeLayout(8);
    const width = SIDEBAR_MIN_TERMINAL_WIDTH;
    const lines = layout.render(width);

    expect(lines).toHaveLength(8);
    expect(lines.every((line) => visibleWidth(line) === width)).toBe(true);
    expect(lines.every((line) => line.endsWith("#".repeat(SIDEBAR_WIDTH)))).toBe(true);
  });

  test("restores the footer and hides the sidebar in narrow mode", () => {
    const { layout } = makeLayout(8);
    const width = SIDEBAR_MIN_TERMINAL_WIDTH - 1;
    const lines = layout.render(width);

    expect(lines.at(-1)).toContain("footer");
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    expect(layout.hitTestSidebar(width, 3)).toBeUndefined();
  });

  test("hit-tests only the latest visible sidebar bounds after resize", () => {
    const { layout } = makeLayout(8);
    layout.render(100);

    expect(layout.hitTestSidebar(70, 3)).toBeUndefined();
    expect(layout.hitTestSidebar(71, 3)).toEqual({
      sessionId: "session",
      runId: "run",
      agentId: "agent",
    });
    expect(layout.hitTestSidebar(71, 2)).toBeUndefined();

    layout.render(120);
    expect(layout.hitTestSidebar(71, 3)).toBeUndefined();
    expect(layout.hitTestSidebar(91, 3)).toEqual({
      sessionId: "session",
      runId: "run",
      agentId: "agent",
    });
  });
});
