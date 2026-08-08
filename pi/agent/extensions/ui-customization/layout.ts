import { VERSION } from "@earendil-works/pi-coding-agent";
import {
  HStack,
  isViewportTUI,
  ScrollView,
  VStack,
  type Component,
  type TUI,
  type ViewportTUI,
} from "@earendil-works/pi-tui";
import { SIDEBAR_WIDTH } from "./sidebar.ts";

export const SUPPORTED_PI_VERSION = "0.84.0";
export const SUPPORTED_PI_VERSIONS = new Set(["0.84.0", "0.84.1"]);
export const SIDEBAR_MIN_TERMINAL_WIDTH = 100;

interface RuntimeStackEntry {
  component: Component;
  basis?: number | "auto";
  grow?: number;
  shrink?: number;
  minSize?: number;
  maxSize?: number;
  visible?: (viewport: { width: number; height: number }) => boolean;
}

interface RuntimeStack extends Component {
  children: Component[];
  entries: RuntimeStackEntry[];
  gap: number;
  align: "stretch" | "start" | "center" | "end";
}

interface RuntimeFullscreenTui extends ViewportTUI {
  layoutRoot?: Component;
}

export interface Pi0840FullscreenLayout {
  tui: RuntimeFullscreenTui;
  root: RuntimeStack;
  transcript: ScrollView;
  dock: RuntimeStack;
}

type InstallResult = "installed" | "waiting" | "incompatible";

function runtimeStack(component: Component): RuntimeStack {
  return component as RuntimeStack;
}

function isComponent(value: unknown): value is Component {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Component).render === "function" &&
    typeof (value as Component).invalidate === "function"
  );
}

function hasExactEntry(
  entry: RuntimeStackEntry | undefined,
  component: Component,
  options: Omit<RuntimeStackEntry, "component">,
): boolean {
  if (!entry || entry.component !== component) return false;
  const expected = { component, ...options };
  const actualKeys = Object.keys(entry).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every(
      (key, index) =>
        key === expectedKeys[index] &&
        entry[key as keyof RuntimeStackEntry] ===
          expected[key as keyof typeof expected],
    )
  );
}

function hasSynchronizedEntries(stack: RuntimeStack, count: number): boolean {
  return (
    stack.children.length === count &&
    stack.entries.length === count &&
    stack.entries.every(
      (entry, index) => entry.component === stack.children[index],
    )
  );
}

/** Version-pinned validation of Pi 0.84.0's private fullscreen layout tree. */
export function resolvePi0840FullscreenLayout(
  tui: TUI,
  version = VERSION,
): Pi0840FullscreenLayout | undefined {
  if (
    !SUPPORTED_PI_VERSIONS.has(version) ||
    tui.mode !== "fullscreen" ||
    !isViewportTUI(tui)
  ) {
    return undefined;
  }

  const fullscreenTui = tui as RuntimeFullscreenTui;
  const rootComponent = fullscreenTui.layoutRoot;
  if (!(rootComponent instanceof VStack)) return undefined;
  const root = runtimeStack(rootComponent);
  if (
    root.gap !== 0 ||
    root.align !== "stretch" ||
    !hasSynchronizedEntries(root, 2)
  ) {
    return undefined;
  }

  const transcript = root.children[0];
  const dockComponent = root.children[1];
  if (
    !(transcript instanceof ScrollView) ||
    !(dockComponent instanceof VStack)
  ) {
    return undefined;
  }
  const dock = runtimeStack(dockComponent);
  if (
    transcript.primary !== true ||
    transcript.overscroll !== "chain" ||
    root.entries[0]?.component !== transcript ||
    root.entries[1]?.component !== dockComponent ||
    !hasExactEntry(root.entries[0], transcript, {
      basis: 0,
      grow: 1,
      shrink: 1,
      minSize: 1,
    }) ||
    !hasExactEntry(root.entries[1], dockComponent, {
      basis: "auto",
      grow: 0,
      shrink: 1,
      minSize: 1,
    }) ||
    dock.gap !== 0 ||
    dock.align !== "stretch" ||
    !hasSynchronizedEntries(dock, 6) ||
    tui.children.length !== 7 ||
    !tui.children.every(isComponent) ||
    transcript.children.length !== 1 ||
    transcript.children[0] !== tui.children[0]
  ) {
    return undefined;
  }

  const dockMinimums = [0, 0, 0, 3, 0, 1] as const;
  for (let index = 0; index < dockMinimums.length; index += 1) {
    const component = tui.children[index + 1];
    if (
      !component ||
      dock.children[index] !== component ||
      !hasExactEntry(dock.entries[index], component, {
        shrink: 1,
        minSize: dockMinimums[index],
      })
    ) {
      return undefined;
    }
  }

  return { tui: fullscreenTui, root, transcript, dock };
}

/**
 * Guarded adapter for Pi 0.84.0's canonical fullscreen tree. It changes only
 * the two root components and restores them only while it still owns both.
 */
export class Pi0840SidebarLayoutAdapter {
  private layout: Pi0840FullscreenLayout | undefined;
  private transcriptColumn: HStack | undefined;
  private dockWithoutFooter: VStack | undefined;
  private sidebarVisible = false;

  constructor(
    private readonly tui: TUI,
    private readonly sidebar: Component,
    private readonly version = VERSION,
  ) {}

  reconcile(): InstallResult {
    if (!SUPPORTED_PI_VERSIONS.has(this.version)) return "incompatible";
    if (this.tui.mode !== "fullscreen") return "waiting";

    if (this.layout && this.transcriptColumn && this.dockWithoutFooter) {
      const { root } = this.layout;
      const ownsLayout =
        root.entries[0]?.component === this.transcriptColumn &&
        root.children[0] === this.transcriptColumn &&
        root.entries[1]?.component === this.dockWithoutFooter &&
        root.children[1] === this.dockWithoutFooter;
      if (ownsLayout) return "installed";

      const isCanonicalAgain =
        root.entries[0]?.component === this.layout.transcript &&
        root.children[0] === this.layout.transcript &&
        root.entries[1]?.component === this.layout.dock &&
        root.children[1] === this.layout.dock;
      const activeRoot = (this.tui as RuntimeFullscreenTui).layoutRoot;
      if (!isCanonicalAgain || activeRoot !== root) return "incompatible";
      this.installOwnedComponents();
      return "installed";
    }

    const layout = resolvePi0840FullscreenLayout(this.tui, this.version);
    if (!layout) return "incompatible";
    this.layout = layout;
    this.transcriptColumn = new HStack([
      {
        component: layout.transcript,
        basis: 0,
        grow: 1,
        shrink: 1,
        minSize: 1,
      },
      {
        component: this.sidebar,
        basis: SIDEBAR_WIDTH,
        grow: 0,
        shrink: 0,
        minSize: SIDEBAR_WIDTH,
        maxSize: SIDEBAR_WIDTH,
        visible: (viewport) =>
          this.sidebarVisible && viewport.width >= SIDEBAR_MIN_TERMINAL_WIDTH,
      },
    ]);
    this.dockWithoutFooter = new VStack(
      layout.dock.entries.slice(0, 5).map((entry) => ({
        component: entry.component,
        ...(entry.basis === undefined ? {} : { basis: entry.basis }),
        ...(entry.grow === undefined ? {} : { grow: entry.grow }),
        ...(entry.shrink === undefined ? {} : { shrink: entry.shrink }),
        ...(entry.minSize === undefined ? {} : { minSize: entry.minSize }),
        ...(entry.maxSize === undefined ? {} : { maxSize: entry.maxSize }),
        ...(entry.visible === undefined ? {} : { visible: entry.visible }),
      })),
      { gap: layout.dock.gap, align: layout.dock.align },
    );
    this.installOwnedComponents();
    return "installed";
  }

  setSidebarVisible(visible: boolean): InstallResult {
    this.sidebarVisible = visible;
    const result = this.reconcile();
    this.tui.requestRender();
    return result;
  }

  getTranscriptHeight(): number {
    const rows = Math.max(1, this.tui.terminal.rows);
    const dock = this.dockWithoutFooter;
    if (!this.layout || !dock) return rows;

    const columns = Math.max(1, this.tui.terminal.columns);
    const dockNaturalHeight = Math.max(1, dock.render(columns).length);
    return Math.max(1, rows - dockNaturalHeight);
  }

  uninstall(): boolean {
    const layout = this.layout;
    const transcriptColumn = this.transcriptColumn;
    const dockWithoutFooter = this.dockWithoutFooter;
    if (!layout || !transcriptColumn || !dockWithoutFooter) return false;

    const ownsBoth =
      layout.root.entries[0]?.component === transcriptColumn &&
      layout.root.children[0] === transcriptColumn &&
      layout.root.entries[1]?.component === dockWithoutFooter &&
      layout.root.children[1] === dockWithoutFooter;
    if (!ownsBoth) return false;

    layout.root.entries[0]!.component = layout.transcript;
    layout.root.children[0] = layout.transcript;
    layout.root.entries[1]!.component = layout.dock;
    layout.root.children[1] = layout.dock;
    this.tui.requestRender();
    return true;
  }

  private installOwnedComponents(): void {
    const layout = this.layout!;
    layout.root.entries[0]!.component = this.transcriptColumn!;
    layout.root.children[0] = this.transcriptColumn!;
    layout.root.entries[1]!.component = this.dockWithoutFooter!;
    layout.root.children[1] = this.dockWithoutFooter!;
    this.tui.requestRender();
  }
}
