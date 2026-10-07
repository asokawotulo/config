import { describe, expect, spyOn, test } from "bun:test";
import {
  HStack,
  ScrollView,
  TuiAltScreen,
  TuiMainScreen,
  VStack,
  type Component,
  type Terminal,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  SidebarLayoutAdapter,
  probeFullscreenLayout,
  SIDEBAR_MIN_TERMINAL_WIDTH,
} from "./layout.ts";
import { SIDEBAR_WIDTH } from "./sidebar.ts";

const VIEWPORT_TUI = Symbol.for("@earendil-works/pi-tui/viewport");
// Test-only upstream import to verify the current host layout.
const chatViewportModule = new URL(
  "modes/interactive/chat-viewport.js",
  import.meta.resolve("@earendil-works/pi-coding-agent"),
);

class Lines implements Component {
  constructor(public lines: string[]) {}
  render(): string[] {
    return this.lines;
  }
  invalidate(): void {}
}

class TestTerminal implements Terminal {
  writes: string[] = [];
  kittyProtocolActive = false;
  constructor(
    public columns: number,
    public rows: number,
  ) {}
  private onInput?: (data: string) => void;
  start(onInput: (data: string) => void): void { this.onInput = onInput; }
  stop(): void { this.onInput = undefined; }
  input(data: string): void {
    if (!this.onInput) throw new Error("Terminal is not started");
    this.onInput(data);
  }
  async drainInput(): Promise<void> {}
  write(data: string): void {
    this.writes.push(data);
  }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
}

interface RuntimeStack {
  children: Component[];
  entries: Array<Record<string, unknown> & { component: Component }>;
}

interface RuntimeAltScreenFields {
  layoutRoot?: Component;
  currentLayout?: {
    root: {
      children: Array<{
        rect: { width: number; height: number };
        children: Array<{ rect: { width: number; height: number } }>;
      }>;
    };
    primaryScrollView?: ScrollView;
  };
}

function runtime(tui: TuiAltScreen): RuntimeAltScreenFields {
  return tui as unknown as RuntimeAltScreenFields;
}

function stack(component: Component): RuntimeStack {
  return component as unknown as RuntimeStack;
}

function makeCanonical(
  options: {
    columns?: number;
    rows?: number;
    documentRows?: number;
    editorRows?: number;
  } = {},
) {
  const terminal = new TestTerminal(options.columns ?? 120, options.rows ?? 30);
  const tui = new TuiAltScreen(terminal);
  const components: Component[] = [
    new Lines(
      Array.from({ length: options.documentRows ?? 80 }, (_, i) => `line-${i}`),
    ),
    new Lines([]),
    new Lines([]),
    new Lines([]),
    new Lines(
      Array.from({ length: options.editorRows ?? 3 }, (_, i) => `editor-${i}`),
    ),
    new Lines([]),
    new Lines(["footer"]),
  ];
  for (const component of components) tui.addChild(component);
  const transcript = new ScrollView(components[0]!, {
    follow: "end",
    primary: true,
    overscroll: "chain",
  });
  const dock = new VStack([
    { component: components[1]!, shrink: 1, minSize: 0 },
    { component: components[2]!, shrink: 1, minSize: 0 },
    { component: components[3]!, shrink: 1, minSize: 0 },
    { component: components[4]!, shrink: 1, minSize: 3 },
    { component: components[5]!, shrink: 1, minSize: 0 },
    { component: components[6]!, shrink: 1, minSize: 0 },
  ]);
  const root = new VStack([
    { component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    { component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
  ]);
  tui.setLayoutRoot(root);
  const sidebar = new Lines(["sidebar"]);
  const adapter = new SidebarLayoutAdapter(tui, sidebar);
  return {
    adapter,
    components,
    dock,
    root,
    sidebar,
    terminal,
    transcript,
    tui,
  };
}

function renderNative(tui: TuiAltScreen): void {
  tui.start();
  tui.renderNow(true);
}

describe("fullscreen layout contract", () => {
  test(
    "accepts the host's actual chat viewport factory and preserves native layout",
    async () => {
      const { createChatViewport } = await import(chatViewportModule.href);
      const fixture = makeCanonical();
      const c = fixture.components;
      const viewport = createChatViewport({
        document: c[0],
        pendingMessages: c[1],
        status: c[2],
        widgetsAbove: c[3],
        editor: c[4],
        widgetsBelow: c[5],
        footer: c[6],
      });
      fixture.tui.setLayoutRoot(viewport.root);
      expect(probeFullscreenLayout(fixture.tui).status).toBe("ready");
      expect(fixture.adapter.setSidebarVisible(true)).toEqual({
        status: "installed",
      });
      renderNative(fixture.tui);
      const frame = runtime(fixture.tui).currentLayout!;
      expect(
        frame.root.children[0]!.children.map((child) => child.rect.width),
      ).toEqual([120 - SIDEBAR_WIDTH, SIDEBAR_WIDTH]);
      expect(frame.root.children[1]!.rect.width).toBe(120);
      expect(frame.primaryScrollView).toBe(viewport.transcript);
      expect(fixture.adapter.uninstall()).toBe(true);
      expect(viewport.root.children[0]).toBe(viewport.transcript);
      fixture.tui.stop();
    },
  );

  test("accepts the canonical structure without a version argument", () => {
    const fixture = makeCanonical();
    const probe = probeFullscreenLayout(fixture.tui);
    expect(probe.status).toBe("ready");
    if (probe.status !== "ready") throw new Error("Expected canonical layout");
    expect(probe.snapshot.root).toBe(fixture.root);
    expect(probe.snapshot.rootEntries[0]).not.toBe(
      stack(fixture.root).entries[0],
    );
    expect(probe.snapshot.dockEntries[0]).not.toBe(
      stack(fixture.dock).entries[0],
    );
  });

  test("preserves the current footer contract across install and uninstall", () => {
    const fixture = makeCanonical();
    const originalEntries = stack(fixture.dock).entries.map((entry) => ({ ...entry }));
    expect(fixture.adapter.setSidebarVisible(true)).toEqual({ status: "installed" });
    expect(fixture.adapter.uninstall()).toBe(true);
    expect(stack(fixture.dock).entries).toEqual(originalEntries);
    expect(probeFullscreenLayout(fixture.tui).status).toBe("ready");
  });

  test("rejects legacy footer minimums and changes to other dock entries", () => {
    for (const minimum of [undefined, -1, 1, 2, "0"]) {
      const fixture = makeCanonical();
      stack(fixture.dock).entries[5]!.minSize = minimum;
      expect(probeFullscreenLayout(fixture.tui)).toEqual({
        status: "incompatible",
        reason: "dock-contract-mismatch",
      });
    }
    const fixture = makeCanonical();
    stack(fixture.dock).entries[0]!.minSize = 1;
    expect(probeFullscreenLayout(fixture.tui)).toEqual({
      status: "incompatible",
      reason: "dock-contract-mismatch",
    });
  });

  test("distinguishes regular mode, unmounted roots, and missing capabilities", () => {
    expect(
      probeFullscreenLayout(new TuiMainScreen(new TestTerminal(120, 30))),
    ).toEqual({ status: "waiting" });
    const fixture = makeCanonical();
    fixture.tui.setLayoutRoot(undefined);
    expect(probeFullscreenLayout(fixture.tui)).toEqual({ status: "waiting" });
    expect(probeFullscreenLayout({ mode: "fullscreen" } as TUI)).toEqual({
      status: "incompatible",
      reason: "missing-viewport-capability",
    });
  });

  test("rejects counts, ordering, allocation options, and synchronization drift", () => {
    const wrongCount = makeCanonical();
    wrongCount.tui.children.pop();
    expect(probeFullscreenLayout(wrongCount.tui)).toEqual({
      status: "incompatible",
      reason: "dock-contract-mismatch",
    });
    const wrongOrder = makeCanonical();
    const dock = stack(wrongOrder.dock);
    [dock.children[0], dock.children[1]] = [
      dock.children[1]!,
      dock.children[0]!,
    ];
    expect(probeFullscreenLayout(wrongOrder.tui)).toEqual({
      status: "incompatible",
      reason: "unsynchronized-entries",
    });
    const wrongOptions = makeCanonical();
    stack(wrongOptions.root).entries[0]!.grow = 2;
    expect(probeFullscreenLayout(wrongOptions.tui)).toEqual({
      status: "incompatible",
      reason: "unexpected-root",
    });
    const mismatched = makeCanonical();
    stack(mismatched.root).children[0] = new Lines([]);
    expect(probeFullscreenLayout(mismatched.tui)).toEqual({
      status: "incompatible",
      reason: "unsynchronized-entries",
    });
  });

  test("rejects missing, malformed, and sparse arrays without mutation or exceptions", () => {
    for (const target of ["root", "dock"] as const) {
      for (const field of ["children", "entries"] as const) {
        for (const value of [undefined, null, {}, [null], Array(2)]) {
          const fixture = makeCanonical();
          Object.assign(fixture[target], { [field]: value });
          expect(fixture.adapter.reconcile()).toEqual({
            status: "incompatible",
            reason: "unsynchronized-entries",
          });
          expect(
            (fixture[target] as unknown as Record<string, unknown>)[field],
          ).toBe(value);
        }
      }
    }
    for (const target of ["tui", "transcript"] as const) {
      const fixture = makeCanonical();
      Object.assign(fixture[target], { children: undefined });
      expect(probeFullscreenLayout(fixture.tui)).toEqual({
        status: "incompatible",
        reason: "dock-contract-mismatch",
      });
    }
  });

  test("rejects additional dock rows without modifying the host", () => {
    const fixture = makeCanonical();
    fixture.dock.addChild(new Lines(["unknown row"]));
    const before = [...stack(fixture.root).entries];
    expect(fixture.adapter.reconcile()).toEqual({
      status: "incompatible",
      reason: "dock-contract-mismatch",
    });
    expect(stack(fixture.root).entries).toEqual(before);
    expect(fixture.dock.children).toHaveLength(7);
  });
});

describe("SidebarLayoutAdapter", () => {
  test("waits for a root and installs once it is mounted", () => {
    const fixture = makeCanonical();
    fixture.tui.setLayoutRoot(undefined);
    expect(fixture.adapter.reconcile()).toEqual({ status: "waiting" });
    fixture.tui.setLayoutRoot(fixture.root);
    expect(fixture.adapter.reconcile()).toEqual({ status: "installed" });
  });

  test("uses public stack methods and restores copied options and original components", () => {
    const fixture = makeCanonical();
    const before = stack(fixture.root).entries.map((entry) => ({ ...entry }));
    const clear = spyOn(fixture.root, "clear");
    const add = spyOn(fixture.root, "addChild");
    try {
      fixture.adapter.reconcile();
      expect(clear).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledTimes(2);
      expect(fixture.adapter.uninstall()).toBe(true);
      expect(clear).toHaveBeenCalledTimes(2);
      expect(add).toHaveBeenCalledTimes(4);
      expect(stack(fixture.root).entries).toEqual(before);
      expect(fixture.root.children[0]).toBe(fixture.transcript);
      expect(fixture.root.children[1]).toBe(fixture.dock);
      expect(fixture.adapter.reconcile()).toEqual({ status: "installed" });
    } finally {
      clear.mockRestore();
      add.mockRestore();
    }
  });

  test("detects active-root replacement without changing either root", () => {
    const fixture = makeCanonical();
    fixture.adapter.reconcile();
    const installed = [...fixture.root.children];
    const replacement = makeCanonical().root;
    const replacementEntries = [...stack(replacement).entries];
    fixture.tui.setLayoutRoot(replacement);
    expect(fixture.adapter.reconcile()).toEqual({
      status: "incompatible",
      reason: "ownership-lost",
    });
    expect(fixture.adapter.uninstall()).toBe(false);
    expect(fixture.root.children).toEqual(installed);
    expect(stack(replacement).entries).toEqual(replacementEntries);
  });

  test("does not overwrite another owner's changed allocation options", () => {
    const fixture = makeCanonical();
    fixture.adapter.reconcile();
    stack(fixture.root).entries[0]!.grow = 2;
    expect(fixture.adapter.reconcile()).toEqual({
      status: "incompatible",
      reason: "ownership-lost",
    });
    expect(fixture.adapter.uninstall()).toBe(false);
    expect(stack(fixture.root).entries[0]!.grow).toBe(2);
  });

  test("revalidates the canonical dock before reinstalling", () => {
    const fixture = makeCanonical();
    fixture.adapter.reconcile();
    fixture.adapter.uninstall();
    fixture.dock.addChild(new Lines(["new dock row"]));
    expect(fixture.adapter.reconcile()).toEqual({
      status: "incompatible",
      reason: "dock-contract-mismatch",
    });
    expect(fixture.root.children).toEqual([fixture.transcript, fixture.dock]);
  });

  test("installs only owned root siblings and preserves all original dock entries", () => {
    const fixture = makeCanonical();
    const originalDockChildren = [...stack(fixture.dock).children];
    const originalDockEntries = [...stack(fixture.dock).entries];

    expect(fixture.adapter.reconcile()).toEqual({ status: "installed" });
    const root = stack(fixture.root);
    expect(root.children[0]).toBeInstanceOf(HStack);
    expect(root.children[1]).toBeInstanceOf(VStack);
    expect(root.children[1]).not.toBe(fixture.dock);
    expect(stack(root.children[1]!).children).toEqual(
      originalDockChildren.slice(0, 5),
    );
    expect(stack(fixture.dock).children).toEqual(originalDockChildren);
    expect(stack(fixture.dock).entries).toEqual(originalDockEntries);
    expect(root.entries[0]!.component).toBe(root.children[0]!);
    expect(root.entries[1]!.component).toBe(root.children[1]!);
  });

  test("reserves the configured sidebar width only beside the transcript and keeps the editor dock full-width", () => {
    const fixture = makeCanonical({ columns: 120, rows: 30 });
    fixture.adapter.reconcile();
    fixture.adapter.setSidebarVisible(true);
    renderNative(fixture.tui);

    const frame = runtime(fixture.tui).currentLayout!;
    expect(
      frame.root.children[0]!.children.map((child) => child.rect.width),
    ).toEqual([120 - SIDEBAR_WIDTH, SIDEBAR_WIDTH]);
    expect(frame.root.children[1]!.rect.width).toBe(120);
    expect(frame.root.children[1]!.children[3]!.rect.width).toBe(120);
    expect(frame.root.children[1]!.children).toHaveLength(5);
  });

  test("fills exactly the native transcript height across terminal and editor sizes", () => {
    for (const [rows, editorRows] of [
      [30, 3],
      [18, 6],
      [7, 8],
    ] as const) {
      const fixture = makeCanonical({ rows, editorRows });
      let height = 0;
      const sidebar: Component = {
        render: () => Array.from({ length: height }, () => "sidebar"),
        invalidate() {},
      };
      const adapter = new SidebarLayoutAdapter(fixture.tui, sidebar);
      height = adapter.getTranscriptHeight();
      expect(adapter.reconcile()).toEqual({ status: "installed" });
      adapter.setSidebarVisible(true);
      height = adapter.getTranscriptHeight();
      renderNative(fixture.tui);

      expect(fixture.transcript.viewportHeight).toBe(height);
      expect(
        runtime(fixture.tui).currentLayout!.root.children[0]!.rect.height,
      ).toBe(height);
      expect(
        runtime(fixture.tui).currentLayout!.root.children[0]!.children[1]!.rect
          .height,
      ).toBe(height);
    }
  });

  test("auto-hides narrowly without changing transcript scrolling or dock allocation", () => {
    const fixture = makeCanonical({ columns: SIDEBAR_MIN_TERMINAL_WIDTH - 1 });
    fixture.adapter.reconcile();
    fixture.adapter.setSidebarVisible(true);
    renderNative(fixture.tui);

    const frame = runtime(fixture.tui).currentLayout!;
    expect(frame.root.children[0]!.children).toHaveLength(1);
    expect(frame.root.children[0]!.children[0]!.rect.width).toBe(
      fixture.terminal.columns,
    );
    expect(frame.root.children[1]!.rect.width).toBe(fixture.terminal.columns);
    expect(frame.primaryScrollView).toBe(fixture.transcript);
  });

  test("is idempotent and restores only when it still owns both root slots", () => {
    const fixture = makeCanonical();
    fixture.adapter.reconcile();
    const installed = [...stack(fixture.root).children];
    expect(fixture.adapter.reconcile()).toEqual({ status: "installed" });
    expect(stack(fixture.root).children).toEqual(installed);
    expect(fixture.adapter.uninstall()).toBe(true);
    expect(stack(fixture.root).children).toEqual([
      fixture.transcript,
      fixture.dock,
    ]);
    expect(fixture.adapter.uninstall()).toBe(false);

    fixture.adapter.reconcile();
    const laterOwner = new Lines(["later owner"]);
    stack(fixture.root).entries[0]!.component = laterOwner;
    stack(fixture.root).children[0] = laterOwner;
    expect(fixture.adapter.uninstall()).toBe(false);
    expect(stack(fixture.root).children[0]).toBe(laterOwner);
  });

  test("survives fullscreen to regular to fullscreen remount and restores the canonical root while regular", () => {
    const first = makeCanonical();
    let current: TUI = first.tui;
    const tuiReference = new Proxy({} as TUI, {
      get: (_target, key) => Reflect.get(current, key, current),
      set: (_target, key, value) => Reflect.set(current, key, value, current),
      has: (_target, key) => Reflect.has(current, key),
      getPrototypeOf: () => Reflect.getPrototypeOf(current),
    });
    const adapter = new SidebarLayoutAdapter(tuiReference, first.sidebar);
    expect(adapter.reconcile()).toEqual({ status: "installed" });
    const installedTranscriptColumn = stack(first.root).children[0];

    first.tui.setLayoutRoot(undefined);
    current = new TuiMainScreen(first.terminal);
    expect(adapter.reconcile()).toEqual({ status: "waiting" });
    expect(stack(first.root).children[0]).toBe(installedTranscriptColumn);

    const second = new TuiAltScreen(first.terminal);
    for (const component of first.components) second.addChild(component);
    second.setLayoutRoot(first.root);
    current = second;
    expect(adapter.reconcile()).toEqual({ status: "installed" });

    current = new TuiMainScreen(first.terminal);
    expect(adapter.uninstall()).toBe(true);
    expect(stack(first.root).children).toEqual([first.transcript, first.dock]);
  });

  test("leaves overlays empty and native wheel scrolling targeted at the primary transcript", () => {
    const fixture = makeCanonical({ rows: 12, documentRows: 100 });
    fixture.adapter.reconcile();
    fixture.adapter.setSidebarVisible(true);
    renderNative(fixture.tui);
    const before = fixture.transcript.scrollTop;

    expect(fixture.tui.hasOverlay()).toBe(false);
    expect(runtime(fixture.tui).currentLayout!.primaryScrollView).toBe(
      fixture.transcript,
    );
    // Send real SGR input rather than depending on routeWheel's private signature.
    fixture.terminal.input("\x1b[<64;1;1M");
    expect(fixture.transcript.scrollTop).toBe(before - 1);
    fixture.tui.stop();
  });

  test("rejects a second owner without replacing its custom root", () => {
    const fixture = makeCanonical();
    const customRoot = new VStack([new Lines(["custom"])]);
    fixture.tui.setLayoutRoot(customRoot);
    expect(fixture.adapter.reconcile()).toEqual({
      status: "incompatible",
      reason: "unexpected-root",
    });
    expect(runtime(fixture.tui).layoutRoot).toBe(customRoot);
    expect(
      (fixture.tui as unknown as Record<PropertyKey, unknown>)[VIEWPORT_TUI],
    ).toBe(true);
  });
});
