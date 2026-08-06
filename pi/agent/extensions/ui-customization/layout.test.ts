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
  constructor(public lines: string[]) {}
  render(): string[] {
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
  const tui = { terminal: { rows } } as TUI;
  const scroll = new ChatScrollState();
  const sidebar = {
    render(width: number, height: number) {
      return Array.from({ length: height }, () => "#".repeat(width));
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
