import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  type Component,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import uiCustomization, { observeInvalidation } from "./index.ts";
import {
  PatchedLayout,
  SIDEBAR_MIN_TERMINAL_WIDTH,
  type Pi083Root,
} from "./layout.ts";
import { ChatScrollState } from "./scroll-state.ts";

type EditorFactory = NonNullable<
  Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]
>;

class Lines implements Component {
  renderCalls = 0;

  constructor(readonly lines: string[]) {}

  render(): string[] {
    this.renderCalls += 1;
    return this.lines;
  }

  invalidate(): void {}
}

function identityTheme(): Theme {
  const identity = (text: string) => text;
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: identity,
  } as unknown as Theme;
}

describe("observeInvalidation", () => {
  test("preserves mutation calls and restores only wrappers it still owns", () => {
    const calls: Array<{
      method: string;
      receiver: unknown;
      args: unknown[];
    }> = [];
    const probe = {
      render: () => [],
      invalidate(this: unknown, ...args: unknown[]) {
        calls.push({ method: "invalidate", receiver: this, args });
        return "invalidate-result";
      },
      addChild(this: unknown, ...args: unknown[]) {
        calls.push({ method: "addChild", receiver: this, args });
        return "add-result";
      },
      removeChild(this: unknown, ...args: unknown[]) {
        calls.push({ method: "removeChild", receiver: this, args });
        return "remove-result";
      },
      clear(this: unknown, ...args: unknown[]) {
        calls.push({ method: "clear", receiver: this, args });
        return "clear-result";
      },
    };
    type Probe = typeof probe;
    const originals = {
      invalidate: probe.invalidate,
      addChild: probe.addChild,
      removeChild: probe.removeChild,
      clear: probe.clear,
    };
    let invalidations = 0;
    const cleanup = observeInvalidation(
      [probe as unknown as Component],
      () => invalidations += 1,
    );
    const receiver = { receiver: true };

    expect(probe.invalidate.call(receiver, "theme")).toBe("invalidate-result");
    expect(probe.addChild.call(receiver, "child", 1)).toBe("add-result");
    expect(probe.removeChild.call(receiver, "child", 2)).toBe("remove-result");
    expect(probe.clear.call(receiver, 3)).toBe("clear-result");
    expect(invalidations).toBe(4);
    expect(calls).toEqual([
      { method: "invalidate", receiver, args: ["theme"] },
      { method: "addChild", receiver, args: ["child", 1] },
      { method: "removeChild", receiver, args: ["child", 2] },
      { method: "clear", receiver, args: [3] },
    ]);

    const replacementClear: Probe["clear"] = function () {
      return "replacement";
    };
    probe.clear = replacementClear;
    cleanup();

    expect(probe.invalidate).toBe(originals.invalidate);
    expect(probe.addChild).toBe(originals.addChild);
    expect(probe.removeChild).toBe(originals.removeChild);
    expect(probe.clear).toBe(replacementClear);
  });

  test("structural mutation cancels an explicitly requested idle cache reuse", () => {
    const originalHistory = new Lines(
      Array.from({ length: 20 }, (_, index) => `line-${index}`),
    );
    const history = new Container();
    history.addChild(originalHistory);
    const empty = new Lines([]);
    const root: Pi083Root = {
      history: [history],
      fixed: [empty, empty, empty, new Lines(["editor"]), empty],
      footer: new Lines(["footer"]),
    };
    const tui = { terminal: { rows: 8 } } as TUI;
    const scroll = new ChatScrollState();
    const sidebar = {
      invalidations: 0,
      render: (width: number, height: number) =>
        Array.from({ length: height }, () => "#".repeat(width)),
      invalidate() {
        this.invalidations += 1;
      },
    };
    const layout = new PatchedLayout(tui, root, scroll, sidebar);
    const cleanup = observeInvalidation(root.history, () => layout.invalidateAll());

    layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);
    scroll.scrollBy(-3);
    layout.requestIdleScrollRender(true);
    const appended = new Lines(["structurally appended"]);
    history.addChild(appended);
    layout.render(SIDEBAR_MIN_TERMINAL_WIDTH);

    expect(originalHistory.renderCalls).toBe(2);
    expect(appended.renderCalls).toBe(1);
    expect(sidebar.invalidations).toBe(1);
    cleanup();
    expect(Object.hasOwn(history, "addChild")).toBe(false);
  });
});

describe("ui customization events", () => {
  test("session_tree invalidates history and sidebar before requesting a render", async () => {
    type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
    const handlers = new Map<string, Handler[]>();
    let sessionNameReads = 0;
    const pi = {
      on(event: string, handler: Handler) {
        const registered = handlers.get(event) ?? [];
        registered.push(handler);
        handlers.set(event, registered);
      },
      events: {
        on() {},
        emit() {},
      },
      exec: async () => ({
        code: 1,
        stdout: "",
        stderr: "",
        killed: false,
      }),
      getSessionName() {
        sessionNameReads += 1;
        return "tree test";
      },
      getThinkingLevel: () => "off",
    } as unknown as ExtensionAPI;
    uiCustomization(pi);

    const theme = identityTheme();
    let editorFactory: EditorFactory | undefined;
    let terminalInput: ((data: string) => unknown) | undefined;
    const context = {
      mode: "tui",
      cwd: "/repo",
      isIdle: () => true,
      ui: {
        theme,
        notify() {},
        setEditorComponent(factory: EditorFactory | undefined) {
          editorFactory = factory;
        },
        onTerminalInput(handler: (data: string) => unknown) {
          terminalInput = handler;
          return () => {};
        },
      },
      sessionManager: {
        getSessionId: () => "session",
        getEntries: () => [],
      },
      getContextUsage: () => ({
        tokens: 0,
        contextWindow: 100_000,
        percent: 0,
      }),
    } as unknown as ExtensionContext;

    handlers.get("session_start")![0]!({ type: "session_start" }, context);
    expect(editorFactory).toBeDefined();

    const history = new Lines(["history"]);
    const empty = new Lines([]);
    const components: Component[] = [
      history,
      empty,
      empty,
      empty,
      empty,
      empty,
      new Lines(["editor"]),
      empty,
      new Lines(["footer"]),
    ];
    const tui = new Container() as unknown as TUI;
    for (const component of components) tui.addChild(component);
    const terminalWrites: string[] = [];
    let renderRequests = 0;
    Object.assign(tui, {
      terminal: {
        rows: 20,
        columns: SIDEBAR_MIN_TERMINAL_WIDTH,
        write: (data: string) => terminalWrites.push(data),
      },
      requestRender: () => {
        renderRequests += 1;
      },
    });
    const editorTheme = {
      borderColor: (text: string) => text,
      selectList: {},
    } as EditorTheme;
    editorFactory!(tui, editorTheme, {} as never);
    await Promise.resolve();
    await Promise.resolve();

    tui.render(SIDEBAR_MIN_TERMINAL_WIDTH);
    const historyReadsBeforeTree = history.renderCalls;
    const sidebarReadsBeforeTree = sessionNameReads;
    terminalInput!("\x1b[5;2~");
    const requestsBeforeTree = renderRequests;

    handlers.get("session_tree")![0]!({ type: "session_tree" }, context);
    expect(renderRequests).toBe(requestsBeforeTree + 1);
    tui.render(SIDEBAR_MIN_TERMINAL_WIDTH);

    expect(history.renderCalls).toBe(historyReadsBeforeTree + 1);
    expect(sessionNameReads).toBe(sidebarReadsBeforeTree + 1);

    handlers.get("session_shutdown")![0]!({ type: "session_shutdown" }, context);
    expect(terminalWrites.length).toBeGreaterThanOrEqual(2);
  });
});
