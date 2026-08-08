import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  ScrollView,
  VStack,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  DYNAMIC_WORKFLOW_RUN_EVENT,
  DYNAMIC_WORKFLOW_STATE_REQUEST_EVENT,
} from "../../lib/dynamic-workflow-events.ts";
import uiCustomization from "./index.ts";

const VIEWPORT_TUI = Symbol.for("@earendil-works/pi-tui/viewport");

class Lines implements Component {
  constructor(private readonly lines: string[]) {}
  render(): string[] {
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

function makeFullscreenTui() {
  const components: Component[] = [
    new Lines(["transcript"]),
    new Lines([]),
    new Lines([]),
    new Lines([]),
    new Lines(["editor", "editor", "editor"]),
    new Lines([]),
    new Lines(["footer"]),
  ];
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
  let renderRequests = 0;
  const tui = {
    mode: "fullscreen",
    [VIEWPORT_TUI]: true,
    children: components,
    terminal: { columns: 120, rows: 30 },
    layoutRoot: root,
    requestRender() {
      renderRequests += 1;
    },
  } as unknown as TUI;
  return { dock, root, transcript, tui, renders: () => renderRequests };
}

interface RuntimeStack {
  children: Component[];
  entries: Array<{
    component: Component;
    visible?: (viewport: { width: number; height: number }) => boolean;
  }>;
}

function stack(component: Component): RuntimeStack {
  return component as unknown as RuntimeStack;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !condition(); attempt += 1) {
    await Promise.resolve();
  }
  expect(condition()).toBe(true);
}

function gitResult(cwd: string, branch: string) {
  return {
    code: 0,
    stdout: `${cwd}\n${cwd}/.git\n${cwd}/.git\n${branch}\n`,
    stderr: "",
    killed: false,
  };
}

function makeGitRefreshHarness() {
  type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
  const handlers = new Map<string, Handler[]>();
  const requests: Array<{
    cwd: string;
    result: Deferred<ReturnType<typeof gitResult>>;
  }> = [];
  const fixture = makeFullscreenTui();
  const theme = identityTheme();
  let footer: Component | undefined;
  const pi = {
    on(event: string, handler: Handler) {
      const registered = handlers.get(event) ?? [];
      registered.push(handler);
      handlers.set(event, registered);
    },
    registerShortcut() {},
    registerCommand() {},
    events: { on() {}, emit() {} },
    exec(_command: string, args: string[]) {
      const result = deferred<ReturnType<typeof gitResult>>();
      requests.push({ cwd: args[1]!, result });
      return result.promise;
    },
    getSessionName: () => "git refresh test",
    getThinkingLevel: () => "off",
  } as unknown as ExtensionAPI;
  uiCustomization(pi);

  const makeContext = (sessionId: string, cwd: string) =>
    ({
      mode: "tui",
      cwd,
      ui: {
        theme,
        setFooter(
          factory:
            | ((tui: TUI, theme: Theme, data: unknown) => Component)
            | undefined,
        ) {
          footer = factory?.(fixture.tui, theme, {});
        },
        notify() {},
      },
      model: {
        id: "model",
        name: "Model",
        contextWindow: 100_000,
        reasoning: false,
      },
      thinkingLevel: "off",
      sessionManager: {
        getSessionId: () => sessionId,
        getEntries: () => [],
      },
      getContextUsage: () => ({
        tokens: 0,
        contextWindow: 100_000,
        percent: 0,
      }),
    }) as unknown as ExtensionContext;

  const sidebarText = () => {
    footer?.render(120);
    const transcriptColumns = stack(stack(fixture.root).children[0]!);
    return transcriptColumns.entries[1]!.component.render(50).join("\n");
  };

  return { fixture, handlers, makeContext, requests, sidebarText };
}

describe("ui customization docked lifecycle", () => {
  test("installs an empty footer and toggles a hydrated 50-column transcript sibling", async () => {
    type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
    type ShortcutHandler = (ctx: ExtensionContext) => unknown;
    type CommandHandler = (args: string, ctx: ExtensionContext) => unknown;
    const handlers = new Map<string, Handler[]>();
    const busHandlers = new Map<string, Array<(data: unknown) => void>>();
    const emitted: Array<{ event: string; data: unknown }> = [];
    let shortcutHandler: ShortcutHandler | undefined;
    let commandHandler: CommandHandler | undefined;

    const pi = {
      on(event: string, handler: Handler) {
        const registered = handlers.get(event) ?? [];
        registered.push(handler);
        handlers.set(event, registered);
      },
      registerShortcut(
        shortcut: string,
        options: { handler: ShortcutHandler },
      ) {
        expect(shortcut).toBe("ctrl+b");
        shortcutHandler = options.handler;
      },
      registerCommand(name: string, options: { handler: CommandHandler }) {
        expect(name).toBe("sidebar");
        commandHandler = options.handler;
      },
      events: {
        on(event: string, handler: (data: unknown) => void) {
          const registered = busHandlers.get(event) ?? [];
          registered.push(handler);
          busHandlers.set(event, registered);
        },
        emit(event: string, data: unknown) {
          emitted.push({ event, data });
          for (const handler of busHandlers.get(event) ?? []) handler(data);
        },
      },
      exec: async () => ({ code: 1, stdout: "", stderr: "", killed: false }),
      getSessionName: () => "docked test",
      getThinkingLevel: () => "off",
    } as unknown as ExtensionAPI;
    uiCustomization(pi);

    const fixture = makeFullscreenTui();
    const theme = identityTheme();
    let footer: Component | undefined;
    const notices: Array<[string, string]> = [];
    const context = {
      mode: "tui",
      cwd: "/repo",
      ui: {
        theme,
        setFooter(
          factory:
            | ((tui: TUI, theme: Theme, data: unknown) => Component)
            | undefined,
        ) {
          footer = factory?.(fixture.tui, theme, {});
        },
        custom() {
          throw new Error("the docked sidebar must not create an overlay");
        },
        notify(message: string, level: string) {
          notices.push([message, level]);
        },
      },
      model: {
        id: "model",
        name: "Model",
        contextWindow: 100_000,
        reasoning: false,
      },
      thinkingLevel: "off",
      sessionManager: {
        getSessionId: () => "session",
        getEntries: () => [],
      },
      getContextUsage: () => ({
        tokens: 10_000,
        contextWindow: 100_000,
        percent: 10,
      }),
    } as unknown as ExtensionContext;

    handlers.get("session_start")![0]!({ type: "session_start" }, context);
    await Promise.resolve();
    expect(emitted).toContainEqual({
      event: DYNAMIC_WORKFLOW_STATE_REQUEST_EVENT,
      data: { sessionId: "session" },
    });
    expect(footer?.render(120)).toEqual([]);
    expect(notices).toEqual([]);

    const patchedRoot = stack(fixture.root);
    const transcriptColumns = stack(patchedRoot.children[0]!);
    const sidebarEntry = transcriptColumns.entries[1]!;
    expect(sidebarEntry.visible?.({ width: 120, height: 30 })).toBe(true);
    expect(stack(patchedRoot.children[1]!).children).toHaveLength(5);

    shortcutHandler!(context);
    expect(sidebarEntry.visible?.({ width: 120, height: 30 })).toBe(false);
    expect(sidebarEntry.visible?.({ width: 99, height: 30 })).toBe(false);

    const rendersBeforeWorkflow = fixture.renders();
    for (const handler of busHandlers.get(DYNAMIC_WORKFLOW_RUN_EVENT) ?? []) {
      handler({
        sessionId: "session",
        phase: "progress",
        run: {
          runId: "run",
          sessionId: "session",
          name: "Live review",
          status: "running",
          startedAt: 1,
          agentCount: 1,
          agents: [{ id: "reviewer", role: "reviewer", status: "running" }],
        },
      });
    }
    expect(fixture.renders()).toBeGreaterThan(rendersBeforeWorkflow);
    expect(sidebarEntry.component.render(50).join("\n")).toContain(
      "Live review",
    );

    commandHandler!("", context);
    expect(sidebarEntry.visible?.({ width: 120, height: 30 })).toBe(true);

    handlers.get("session_shutdown")![0]!(
      { type: "session_shutdown" },
      context,
    );
    expect(stack(fixture.root).children).toEqual([
      fixture.transcript,
      fixture.dock,
    ]);
  });

  test("warns instead of opening outside TUI mode", () => {
    type ShortcutHandler = (ctx: ExtensionContext) => unknown;
    let shortcutHandler: ShortcutHandler | undefined;
    const pi = {
      on() {},
      registerShortcut(
        _shortcut: string,
        options: { handler: ShortcutHandler },
      ) {
        shortcutHandler = options.handler;
      },
      registerCommand() {},
      events: { on() {}, emit() {} },
    } as unknown as ExtensionAPI;
    uiCustomization(pi);

    const notices: Array<[string, string]> = [];
    const context = {
      mode: "print",
      ui: {
        notify: (message: string, level: string) =>
          notices.push([message, level]),
      },
    } as unknown as ExtensionContext;

    shortcutHandler!(context);
    expect(notices).toEqual([
      ["The session sidebar requires interactive TUI mode", "warning"],
    ]);
  });

  test("warns once and restores the default footer for an incompatible fullscreen tree", async () => {
    type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
    const handlers = new Map<string, Handler[]>();
    const pi = {
      on(event: string, handler: Handler) {
        handlers.set(event, [handler]);
      },
      registerShortcut() {},
      registerCommand() {},
      events: { on() {}, emit() {} },
      exec: async () => ({ code: 1, stdout: "", stderr: "", killed: false }),
    } as unknown as ExtensionAPI;
    uiCustomization(pi);

    const notices: string[] = [];
    const incompatibleRoot = new Lines(["owned elsewhere"]);
    const tui = {
      mode: "fullscreen",
      [VIEWPORT_TUI]: true,
      children: [],
      terminal: { columns: 120, rows: 30 },
      layoutRoot: incompatibleRoot,
      requestRender() {},
    } as unknown as TUI;
    let footer: Component | undefined;
    const context = {
      mode: "tui",
      cwd: "/repo",
      ui: {
        theme: identityTheme(),
        notify: (message: string) => notices.push(message),
        setFooter(
          factory:
            | ((tui: TUI, theme: Theme, data: unknown) => Component)
            | undefined,
        ) {
          footer = factory?.(tui, identityTheme(), {});
        },
      },
      sessionManager: { getSessionId: () => "session", getEntries: () => [] },
    } as unknown as ExtensionContext;

    handlers.get("session_start")![0]!({}, context);
    footer?.render(120);
    footer?.invalidate();
    await Promise.resolve();
    expect(notices).toHaveLength(1);
    expect(footer).toBeUndefined();
    expect((tui as unknown as { layoutRoot: Component }).layoutRoot).toBe(
      incompatibleRoot,
    );
  });

  test("drains only the latest cwd requested during a deferred Git refresh", async () => {
    const harness = makeGitRefreshHarness();
    const first = harness.makeContext("session", "/repo/first");
    const middle = harness.makeContext("session", "/repo/middle");
    const latest = harness.makeContext("session", "/repo/latest");

    harness.handlers.get("session_start")![0]!({}, first);
    harness.handlers.get("input")![0]!({}, middle);
    harness.handlers.get("tool_execution_end")![0]!({}, latest);
    expect(harness.requests.map((request) => request.cwd)).toEqual([
      "/repo/first",
    ]);

    harness.requests[0]!.result.resolve(gitResult("/repo/first", "stale"));
    await waitFor(() => harness.requests.length === 2);
    expect(harness.requests.map((request) => request.cwd)).toEqual([
      "/repo/first",
      "/repo/latest",
    ]);
    expect(harness.sidebarText()).not.toContain("stale");

    harness.requests[1]!.result.resolve(gitResult("/repo/latest", "latest"));
    await waitFor(() => harness.sidebarText().includes("latest"));
    expect(harness.sidebarText()).toContain("latest");
  });

  test("does not drop a replacement-session refresh behind deferred exec", async () => {
    const harness = makeGitRefreshHarness();
    const replaced = harness.makeContext("replaced", "/repo/replaced");
    const replacement = harness.makeContext("replacement", "/repo/replacement");

    harness.handlers.get("session_start")![0]!({}, replaced);
    harness.handlers.get("session_shutdown")![0]!({}, replaced);
    harness.handlers.get("session_start")![0]!({}, replacement);
    expect(harness.requests.map((request) => request.cwd)).toEqual([
      "/repo/replaced",
    ]);

    harness.requests[0]!.result.resolve(
      gitResult("/repo/replaced", "stale-session"),
    );
    await waitFor(() => harness.requests.length === 2);
    expect(harness.requests[1]!.cwd).toBe("/repo/replacement");
    expect(harness.sidebarText()).not.toContain("stale-session");

    harness.requests[1]!.result.resolve(
      gitResult("/repo/replacement", "replacement-branch"),
    );
    await waitFor(() => harness.sidebarText().includes("replacement-branch"));
    expect(harness.sidebarText()).toContain("replacement-branch");
  });
});
