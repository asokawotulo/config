import { describe, expect, test } from "bun:test";
import type {
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import {
  centeredDialogOverlay,
  DialogComponent,
  keybindingHint,
  renderDialogFrame,
} from "./dialog.ts";

const ansi = (open: string, close: string, text: string) =>
  `\u001b[${open}m${text}\u001b[${close}m`;
const theme = {
  fg: (_color: string, text: string) => ansi("38;5;7", "39", text),
  bg: (_color: string, text: string) => ansi("48;5;236", "49", text),
  bold: (text: string) => ansi("1", "22", text),
} as unknown as Theme;
const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");

describe("shared dialog frame", () => {
  test("renders a full-width panel background and standard layout", () => {
    const lines = renderDialogFrame(theme, 24, {
      title: "Shared dialog",
      body: [" body"],
      status: { type: "warning", text: "Check this" },
      hints: ["enter confirm", "esc close"],
    });

    expect(lines.every((line) => visibleWidth(line) === 24)).toBe(true);
    expect(lines.every((line) => line.includes("\u001b[48;5;236m"))).toBe(
      true,
    );
    expect(lines.map(stripAnsi)).toEqual([
      "────────────────────────",
      " Shared dialog          ",
      "                        ",
      " body                   ",
      "                        ",
      " Check this             ",
      " enter confirm • esc    ",
      " close                  ",
      "────────────────────────",
    ]);
  });

  test("supports a custom header and narrow widths", () => {
    const lines = renderDialogFrame(theme, 8, {
      header: [" tabs"],
      body: [" a body that is too wide"],
      hints: [],
    });

    expect(lines.map(stripAnsi)).toEqual([
      "────────",
      " tabs   ",
      "        ",
      " a body ",
      "        ",
      "        ",
      "────────",
    ]);
    expect(lines.every((line) => visibleWidth(line) === 8)).toBe(true);
  });

  test("provides centered overlay defaults without replacing sizing", () => {
    expect(
      centeredDialogOverlay({
        width: "75%",
        minWidth: 40,
        maxHeight: "90%",
      }),
    ).toEqual({
      width: "75%",
      minWidth: 40,
      maxHeight: "90%",
      anchor: "center",
      margin: 1,
    });
  });

  test("formats hints from configured keybindings", () => {
    const keybindings = {
      getKeys: () => ["ctrl+j", "enter"],
    } as unknown as KeybindingsManager;

    expect(
      keybindingHint(
        keybindings,
        "tui.select.confirm",
        "choose",
        "enter",
      ),
    ).toBe("ctrl+j/enter choose");
    expect(
      keybindingHint(undefined, "tui.select.cancel", "close", "esc"),
    ).toBe("esc close");
  });
});

describe("DialogComponent", () => {
  test("caches by width and clears the cache on refresh and invalidation", () => {
    let renders = 0;
    let requests = 0;
    const tui = {
      requestRender: () => requests++,
    } as unknown as TUI;
    const keybindings = {} as KeybindingsManager;

    class TestDialog extends DialogComponent {
      constructor() {
        super(tui, theme, keybindings);
      }

      protected renderContent(width: number): string[] {
        renders++;
        return [String(width)];
      }

      triggerRefresh(): void {
        this.refresh();
      }
    }

    const dialog = new TestDialog();
    expect(dialog.render(20)).toEqual(["20"]);
    expect(dialog.render(20)).toEqual(["20"]);
    expect(renders).toBe(1);

    dialog.render(21);
    expect(renders).toBe(2);

    dialog.triggerRefresh();
    expect(requests).toBe(1);
    dialog.render(21);
    expect(renders).toBe(3);

    dialog.invalidate();
    dialog.render(21);
    expect(renders).toBe(4);
  });
});
