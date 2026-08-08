import { describe, expect, test } from "bun:test";
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
  Pi0840SidebarLayoutAdapter,
  resolvePi0840FullscreenLayout,
  SIDEBAR_MIN_TERMINAL_WIDTH,
  SUPPORTED_PI_VERSION,
} from "./layout.ts";

const VIEWPORT_TUI = Symbol.for("@earendil-works/pi-tui/viewport");

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
  start(): void {}
  stop(): void {}
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
    { component: components[6]!, shrink: 1, minSize: 1 },
  ]);
  const root = new VStack([
    { component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    { component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
  ]);
  tui.setLayoutRoot(root);
  const sidebar = new Lines(["sidebar"]);
  const adapter = new Pi0840SidebarLayoutAdapter(
    tui,
    sidebar,
    SUPPORTED_PI_VERSION,
  );
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

describe("Pi 0.84.0 fullscreen layout guard", () => {
  test("accepts the installed runtime shape and rejects version, mode, counts, order, options, and synchronization drift", () => {
    expect(
      resolvePi0840FullscreenLayout(
        makeCanonical().tui,
        SUPPORTED_PI_VERSION,
      ),
    ).toBeDefined();
    expect(
      resolvePi0840FullscreenLayout(makeCanonical().tui, "0.84.1"),
    ).toBeDefined();
    expect(
      resolvePi0840FullscreenLayout(makeCanonical().tui, "0.83.0"),
    ).toBeUndefined();

    const regular = new TuiMainScreen(new TestTerminal(120, 30));
    expect(resolvePi0840FullscreenLayout(regular)).toBeUndefined();

    const wrongCount = makeCanonical();
    wrongCount.tui.children.pop();
    expect(resolvePi0840FullscreenLayout(wrongCount.tui)).toBeUndefined();

    const wrongOrder = makeCanonical();
    const dock = stack(wrongOrder.dock);
    [dock.children[0], dock.children[1]] = [
      dock.children[1]!,
      dock.children[0]!,
    ];
    expect(resolvePi0840FullscreenLayout(wrongOrder.tui)).toBeUndefined();

    const wrongOptions = makeCanonical();
    stack(wrongOptions.root).entries[0]!.grow = 2;
    expect(resolvePi0840FullscreenLayout(wrongOptions.tui)).toBeUndefined();

    const mismatched = makeCanonical();
    stack(mismatched.root).children[0] = new Lines([]);
    expect(resolvePi0840FullscreenLayout(mismatched.tui)).toBeUndefined();
  });
});

describe("Pi0840SidebarLayoutAdapter", () => {
  test("installs only owned root siblings and preserves all original dock entries", () => {
    const fixture = makeCanonical();
    const originalDockChildren = [...stack(fixture.dock).children];
    const originalDockEntries = [...stack(fixture.dock).entries];

    expect(fixture.adapter.reconcile()).toBe("installed");
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

  test("reserves 50 columns only beside the transcript and keeps the editor dock full-width", () => {
    const fixture = makeCanonical({ columns: 120, rows: 30 });
    fixture.adapter.reconcile();
    fixture.adapter.setSidebarVisible(true);
    renderNative(fixture.tui);

    const frame = runtime(fixture.tui).currentLayout!;
    expect(
      frame.root.children[0]!.children.map((child) => child.rect.width),
    ).toEqual([70, 50]);
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
      const adapter = new Pi0840SidebarLayoutAdapter(
        fixture.tui,
        sidebar,
        SUPPORTED_PI_VERSION,
      );
      height = adapter.getTranscriptHeight();
      expect(adapter.reconcile()).toBe("installed");
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
    expect(fixture.adapter.reconcile()).toBe("installed");
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
    const adapter = new Pi0840SidebarLayoutAdapter(
      tuiReference,
      first.sidebar,
      SUPPORTED_PI_VERSION,
    );
    expect(adapter.reconcile()).toBe("installed");
    const installedTranscriptColumn = stack(first.root).children[0];

    first.tui.setLayoutRoot(undefined);
    current = new TuiMainScreen(first.terminal);
    expect(adapter.reconcile()).toBe("waiting");
    expect(stack(first.root).children[0]).toBe(installedTranscriptColumn);

    const second = new TuiAltScreen(first.terminal);
    for (const component of first.components) second.addChild(component);
    second.setLayoutRoot(first.root);
    current = second;
    expect(adapter.reconcile()).toBe("installed");

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
    (
      fixture.tui as unknown as {
        routeWheel(event: { direction: number; x: number; y: number }): void;
      }
    ).routeWheel({ direction: -1, x: 0, y: 0 });
    expect(fixture.transcript.scrollTop).toBe(before - 1);
  });

  test("rejects a second owner without replacing its custom root", () => {
    const fixture = makeCanonical();
    const customRoot = new VStack([new Lines(["custom"])]);
    fixture.tui.setLayoutRoot(customRoot);
    expect(fixture.adapter.reconcile()).toBe("incompatible");
    expect(runtime(fixture.tui).layoutRoot).toBe(customRoot);
    expect(
      (fixture.tui as unknown as Record<PropertyKey, unknown>)[VIEWPORT_TUI],
    ).toBe(true);
  });
});
