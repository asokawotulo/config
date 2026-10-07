import {
  HStack,
  isViewportTUI,
  ScrollView,
  VStack,
  type Component,
  type StackEntry,
  type TUI,
  type ViewportTUI,
} from "@earendil-works/pi-tui";
import { SIDEBAR_WIDTH } from "./sidebar.ts";

export const SIDEBAR_MIN_TERMINAL_WIDTH = 100;

interface RuntimeStack {
  children: Component[];
  entries: StackEntry[];
  gap: number;
  align: string;
}

interface RuntimeFullscreenTui extends ViewportTUI {
  layoutRoot?: Component;
}

export interface FullscreenLayoutSnapshot {
  root: VStack;
  transcript: ScrollView;
  dock: VStack;
  rootEntries: StackEntry[];
  dockEntries: StackEntry[];
}

export type LayoutMismatch =
  | "missing-viewport-capability"
  | "unexpected-root"
  | "dock-contract-mismatch"
  | "unsynchronized-entries"
  | "ownership-lost";

export type InstallResult =
  | { status: "installed" }
  | { status: "waiting" }
  | { status: "incompatible"; reason: LayoutMismatch };

type LayoutProbe =
  | { status: "ready"; snapshot: FullscreenLayoutSnapshot }
  | Exclude<InstallResult, { status: "installed" }>;

const incompatible = (reason: LayoutMismatch): InstallResult & { status: "incompatible" } =>
  ({ status: "incompatible", reason });

function isComponent(value: unknown): value is Component {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Component).render === "function" &&
    typeof (value as Component).invalidate === "function"
  );
}

/** Keep all reads of protected stack fields behind runtime validation. */
function inspectStack(component: VStack): RuntimeStack | undefined {
  const stack = component as unknown as Partial<RuntimeStack>;
  if (
    !Array.isArray(stack.children) ||
    !Array.isArray(stack.entries) ||
    stack.children.length !== stack.entries.length
  ) return undefined;
  // Indexed checks also reject sparse arrays.
  for (let index = 0; index < stack.entries.length; index += 1) {
    const entry = stack.entries[index];
    if (
      !isComponent(stack.children[index]) ||
      !entry || typeof entry !== "object" || Array.isArray(entry) ||
      entry.component !== stack.children[index]
    ) return undefined;
  }
  if (typeof stack.gap !== "number" || typeof stack.align !== "string") return undefined;
  return stack as RuntimeStack;
}

function sameEntry(actual: StackEntry | undefined, expected: StackEntry): boolean {
  if (!actual) return false;
  const keys = Object.keys(actual);
  return keys.length === Object.keys(expected).length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(expected, key) &&
    actual[key as keyof StackEntry] === expected[key as keyof StackEntry],
  );
}

function matchesEntries(component: VStack, expected: readonly StackEntry[]): boolean {
  const stack = inspectStack(component);
  return !!stack && stack.gap === 0 && stack.align === "stretch" &&
    stack.entries.length === expected.length &&
    expected.every((entry, index) => sameEntry(stack.entries[index], entry));
}

/** Read-only probe of the canonical transcript/dock contract, not a version list. */
export function probeFullscreenLayout(tui: TUI): LayoutProbe {
  if (tui.mode !== "fullscreen") return { status: "waiting" };
  if (!isViewportTUI(tui)) return incompatible("missing-viewport-capability");
  const root = (tui as RuntimeFullscreenTui).layoutRoot;
  if (root === undefined) return { status: "waiting" };
  if (!(root instanceof VStack)) return incompatible("unexpected-root");
  const rootStack = inspectStack(root);
  if (!rootStack) return incompatible("unsynchronized-entries");
  if (rootStack.gap !== 0 || rootStack.align !== "stretch" || rootStack.entries.length !== 2) {
    return incompatible("unexpected-root");
  }

  const transcript = rootStack.children[0];
  const dock = rootStack.children[1];
  if (!(transcript instanceof ScrollView) || !(dock instanceof VStack)) {
    return incompatible("unexpected-root");
  }
  if (
    transcript.primary !== true || transcript.overscroll !== "chain" ||
    !sameEntry(rootStack.entries[0], {
      component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1,
    }) ||
    !sameEntry(rootStack.entries[1], {
      component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1,
    })
  ) return incompatible("unexpected-root");

  const dockStack = inspectStack(dock);
  if (!dockStack) return incompatible("unsynchronized-entries");
  if (
    dockStack.gap !== 0 || dockStack.align !== "stretch" || dockStack.entries.length !== 6 ||
    !Array.isArray(tui.children) || tui.children.length !== 7 ||
    !Array.isArray(transcript.children) || transcript.children.length !== 1 ||
    !isComponent(tui.children[0]) || transcript.children[0] !== tui.children[0]
  ) return incompatible("dock-contract-mismatch");

  const dockMinimums = [0, 0, 0, 3, 0, 0] as const;
  for (let index = 0; index < dockMinimums.length; index += 1) {
    const component = tui.children[index + 1];
    if (!isComponent(component) || !sameEntry(dockStack.entries[index], {
      component, shrink: 1, minSize: dockMinimums[index],
    })) return incompatible("dock-contract-mismatch");
  }

  return {
    status: "ready",
    snapshot: {
      root, transcript, dock,
      rootEntries: rootStack.entries.map((entry) => ({ ...entry })),
      dockEntries: dockStack.entries.map((entry) => ({ ...entry })),
    },
  };
}

/** Mutate only through Stack's public methods, which synchronize its arrays. */
function replaceEntries(root: VStack, entries: readonly StackEntry[]): void {
  root.clear();
  for (const { component, ...options } of entries) root.addChild(component, options);
}

export class SidebarLayoutAdapter {
  private layout: FullscreenLayoutSnapshot | undefined;
  private installedEntries: StackEntry[] | undefined;
  private dockWithoutFooter: VStack | undefined;
  private sidebarVisible = false;

  constructor(
    private readonly tui: TUI,
    private readonly sidebar: Component,
  ) {}

  reconcile(): InstallResult {
    if (this.tui.mode !== "fullscreen") return { status: "waiting" };
    if (!isViewportTUI(this.tui)) return incompatible("missing-viewport-capability");

    if (this.layout && this.installedEntries) {
      const { root } = this.layout;
      if ((this.tui as RuntimeFullscreenTui).layoutRoot !== root) {
        return incompatible("ownership-lost");
      }
      if (matchesEntries(root, this.installedEntries)) return { status: "installed" };
      if (!matchesEntries(root, this.layout.rootEntries)) return incompatible("ownership-lost");
      const probe = probeFullscreenLayout(this.tui);
      if (probe.status !== "ready") return probe;
      if (
        probe.snapshot.transcript !== this.layout.transcript ||
        probe.snapshot.dock !== this.layout.dock ||
        !matchesEntries(this.layout.dock, this.layout.dockEntries)
      ) return incompatible("ownership-lost");
      this.installOwnedComponents();
      return { status: "installed" };
    }

    const probe = probeFullscreenLayout(this.tui);
    if (probe.status !== "ready") return probe;
    const layout = probe.snapshot;
    const transcriptColumn = new HStack([
      { component: layout.transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
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
    const dockWithoutFooter = new VStack(layout.dockEntries.slice(0, -1));
    this.layout = layout;
    this.dockWithoutFooter = dockWithoutFooter;
    this.installedEntries = layout.rootEntries.map((entry, index) => ({
      ...entry,
      component: index === 0 ? transcriptColumn : dockWithoutFooter,
    }));
    this.installOwnedComponents();
    return { status: "installed" };
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
    if (!this.layout || !this.installedEntries) return false;
    if (
      this.tui.mode === "fullscreen" &&
      (this.tui as RuntimeFullscreenTui).layoutRoot !== this.layout.root
    ) return false;
    if (!matchesEntries(this.layout.root, this.installedEntries)) return false;
    replaceEntries(this.layout.root, this.layout.rootEntries);
    this.tui.requestRender();
    return true;
  }

  private installOwnedComponents(): void {
    replaceEntries(this.layout!.root, this.installedEntries!);
    this.tui.requestRender();
  }
}
