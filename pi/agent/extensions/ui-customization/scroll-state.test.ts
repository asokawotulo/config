import { describe, expect, test } from "bun:test";
import { isMouseInput, parseLeftClick, parseScrollInput } from "./mouse.ts";
import { ChatScrollState } from "./scroll-state.ts";

describe("ChatScrollState", () => {
  test("follows new content while at the bottom", () => {
    const state = new ChatScrollState();
    state.reconcile(20, 5);
    expect(state.scrollTop).toBe(15);

    state.reconcile(25, 5);
    expect(state.scrollTop).toBe(20);
    expect(state.followingBottom).toBe(true);
  });

  test("keeps its absolute position when content arrives while scrolled up", () => {
    const state = new ChatScrollState();
    state.reconcile(20, 5);
    state.scrollBy(-6);
    expect(state.scrollTop).toBe(9);

    state.reconcile(30, 5);
    expect(state.scrollTop).toBe(9);
    expect(state.followingBottom).toBe(false);
  });

  test("resumes following after reaching the bottom", () => {
    const state = new ChatScrollState();
    state.reconcile(20, 5);
    state.scrollBy(-5);
    state.scrollBy(100);

    expect(state.scrollTop).toBe(15);
    expect(state.followingBottom).toBe(true);
  });
});

describe("scroll input parsing", () => {
  test("parses SGR wheel events", () => {
    expect(parseScrollInput("\x1b[<64;20;5M")).toBe("wheel-up");
    expect(parseScrollInput("\x1b[<65;20;5M")).toBe("wheel-down");
  });

  test("parses shifted page keys and ignores clicks", () => {
    expect(parseScrollInput("\x1b[5;2~")).toBe("page-up");
    expect(parseScrollInput("\x1b[6;2~")).toBe("page-down");
    expect(parseScrollInput("\x1b[<0;20;5M")).toBeUndefined();
    expect(isMouseInput("\x1b[<0;20;5M")).toBe(true);
    expect(isMouseInput("plain text")).toBe(false);
  });

  test("retains SGR left-click coordinates and ignores release or motion", () => {
    expect(parseLeftClick("\x1b[<0;101;12M")).toEqual({ column: 101, row: 12 });
    expect(parseLeftClick("\x1b[<16;101;12M")).toEqual({ column: 101, row: 12 });
    expect(parseLeftClick("\x1b[<0;101;12m")).toBeUndefined();
    expect(parseLeftClick("\x1b[<32;101;12M")).toBeUndefined();
    expect(parseLeftClick("\x1b[<2;101;12M")).toBeUndefined();
  });
});
