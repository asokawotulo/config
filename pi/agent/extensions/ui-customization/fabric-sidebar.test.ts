import { describe, expect, test } from "bun:test";
import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionEntry,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type FabricComponentDefinition,
  type FabricComponentContext,
} from "../../npm/node_modules/pi-fabric/dist/protocol.js";
import {
  FabricSidebarState,
  FABRIC_SIDEBAR_ENTRY,
  MAX_FABRIC_WORKERS,
} from "./fabric-state.ts";
import { registerFabricSidebar } from "./fabric-bridge.ts";
import { calculateSessionCosts } from "./session-cost.ts";
import { SidebarComponent, SIDEBAR_WIDTH } from "./sidebar.ts";
import type { SidebarMetadata } from "./metadata.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

const worker = (extra: Record<string, unknown> = {}) => ({
  id: "worker",
  name: "Research",
  runner: "pi",
  status: "running",
  startedAt: Date.now(),
  updatedAt: Date.now(),
  currentTool: "grep",
  model: "model",
  thinking: "high",
  cwd: "/repo",
  turns: 2,
  toolCalls: 5,
  usage: { cost: 2, input: 100, output: 20, cacheRead: 40, cacheWrite: 0 },
  ...extra,
});
const entry = (value: unknown) => value as SessionEntry;
const base = entry({
  id: "base",
  parentId: null,
  type: "message",
  message: { role: "user", content: [] },
});

function harness() {
  const handlers = new Map<
    string,
    Array<(e: any, ctx: ExtensionContext) => unknown>
  >();
  let component: FabricComponentDefinition | undefined;
  const sm = SessionManager.inMemory("/repo");
  sm.appendMessage({
    role: "user",
    content: [{ type: "text", text: "fixture" }],
    timestamp: Date.now(),
  });
  let changes = 0;
  const pi = {
    on(name: string, handler: (e: any, ctx: ExtensionContext) => unknown) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    appendEntry(type: string, data: unknown) {
      sm.appendCustomEntry(type, data);
    },
    events: {
      emit(_name: string, data: any) {
        if (data.component) component = data.component;
      },
      on() {},
    },
  } as unknown as ExtensionAPI;
  const bridge = registerFabricSidebar(pi, () => changes++);
  const ctx = {
    mode: "tui",
    sessionManager: sm,
  } as unknown as ExtensionContext;
  const emit = async (name: string, event: any = {}) => {
    for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
  };
  return {
    bridge,
    component: () => component!,
    ctx,
    emit,
    sm,
    changes: () => changes,
  };
}

describe("Fabric sidebar state", () => {
  test("normalizes metadata, deduplicates nested workers, and adds independent costs", () => {
    const state = new FabricSidebarState("session");
    state.connected("root");
    const child = worker({
      id: "child",
      actorId: "reviewer",
      actorName: "Reviewer",
    });
    state.observe(worker({ nestedAgents: [child] }));
    state.observe(child);
    const view = state.snapshot();
    expect(view.reportedCost).toBe(4);
    expect(view.workers).toHaveLength(2);
    expect(view.workers.find((w) => w.id === "child")?.parentId).toBe("worker");
    const costs = calculateSessionCosts(
      [
        entry({
          type: "message",
          message: { role: "assistant", content: [], usage: { cost: 1 } },
        }),
        entry({
          type: "message",
          message: {
            role: "toolResult",
            toolName: "fabric_exec",
            usage: { cost: 0.5 },
          },
        }),
      ],
      view,
    );
    expect(costs).toEqual({ total: 5.5, main: 1.5, subagents: 4 });
  });
  test("rejects foreign roots, handles partial metadata and sanitizes retained fields", () => {
    const state = new FabricSidebarState("session");
    state.connected("root");
    state.observe(worker({ rootId: "peer" }));
    expect(state.snapshot().workers).toHaveLength(0);
    state.observe(
      worker({
        name: "x\x1b[31m\nInjected",
        task: "PRIVATE",
        text: "PRIVATE",
        args: { secret: "PRIVATE" },
        error: "PRIVATE",
      }),
    );
    expect(JSON.stringify(state.checkpoint("base"))).not.toContain("PRIVATE");
    expect(state.snapshot().workers[0]?.name).toBe("x Injected");
    state.observe(
      worker({
        usage: undefined,
        currentTool: "read",
        updatedAt: Date.now() + 1,
      }),
    );
    expect(state.snapshot().reportedCost).toBe(2);
  });
  test("unknown runner billing and missing usage are explicit", () => {
    const state = new FabricSidebarState("session");
    state.connected("root");
    state.observe(worker({ runner: "claude" }));
    state.observe(worker({ id: "queued", usage: undefined }));
    expect(state.snapshot().complete).toBe(false);
    expect(state.snapshot().reportedCost).toBe(0);
    expect(state.snapshot().issues).toContain("unsupported_cost_basis");
    expect(state.snapshot().issues).toContain("missing_worker_usage");
  });
  test("checkpoints recover trimmed history and reject a wrong boundary atomically", () => {
    const state = new FabricSidebarState("session");
    state.connected("root");
    state.observe(worker());
    const d = state.checkpoint("base");
    const restored = new FabricSidebarState("session");
    restored.hydrate([
      base,
      entry({
        id: "saved",
        parentId: "base",
        type: "custom",
        customType: FABRIC_SIDEBAR_ENTRY,
        data: d,
      }),
    ]);
    expect(restored.snapshot().reportedCost).toBe(2);
    expect(restored.snapshot().workers[0]?.stale).toBe(true);
    restored.hydrate([
      base,
      entry({
        id: "saved",
        parentId: "wrong",
        type: "custom",
        customType: FABRIC_SIDEBAR_ENTRY,
        data: d,
      }),
    ]);
    expect(restored.snapshot().reportedCost).toBe(0);
    const corrupt = {
      ...(d as object),
      workers: [worker(), { invalid: true }],
    };
    restored.hydrate([
      base,
      entry({
        id: "saved",
        parentId: "base",
        type: "custom",
        customType: FABRIC_SIDEBAR_ENTRY,
        data: corrupt,
      }),
    ]);
    expect(restored.snapshot().workers).toHaveLength(0);
  });
  test("old off-branch live records cannot return after tree navigation", () => {
    const state = new FabricSidebarState("session");
    state.connected("root");
    state.hydrate([base]);
    state.observeLive([worker({ startedAt: 1, updatedAt: 2 })]);
    expect(state.snapshot().workers).toHaveLength(0);
    state.observeLive([worker({ startedAt: Date.now() + 1 })]);
    expect(state.snapshot().workers).toHaveLength(1);
  });
  test("bounded history flags incomplete coverage and never loops on cycles", () => {
    const state = new FabricSidebarState("session");
    state.connected("root");
    state.observe(
      Array.from({ length: MAX_FABRIC_WORKERS + 1 }, (_, i) =>
        worker({ id: String(i) }),
      ),
    );
    expect(state.snapshot().workers).toHaveLength(MAX_FABRIC_WORKERS);
    expect(state.snapshot().issues).toContain("worker_limit");
    state.ingestDetails(
      {
        trace: {
          operations: [{ ref: "agents.run", outcome: "succeeded" }],
          counts: { droppedOperations: 0 },
        },
        audits: [],
      },
      true,
    );
    expect(state.snapshot().issues).toContain("trimmed_worker_history");
  });
});

describe("Fabric observation bridge", () => {
  test("public component polls local and lineage records and disposes without late writes", async () => {
    const h = harness();
    await h.emit("session_start");
    const record = worker({ startedAt: Date.now() + 1 });
    const calls: string[] = [];
    const control = new AbortController();
    const context = {
      signal: control.signal,
      call: async (ref: string) => {
        calls.push(ref);
        return ref === "agents.self"
          ? { kind: "root", rootId: "root" }
          : [record];
      },
    } as unknown as FabricComponentContext;
    const dispose = (await h
      .component()
      .activate(context, undefined)) as () => void;
    try {
      await new Promise((r) => setTimeout(r, 25));
      expect(calls.filter((c) => c === "agents.list")).toHaveLength(2);
      expect(h.bridge.snapshot()?.reportedCost).toBe(2);
      expect(h.bridge.snapshot()?.connection).toBe("live");
    } finally {
      dispose();
      await h.emit("session_shutdown");
    }
    expect(
      h.sm
        .getBranch()
        .some(
          (e) => e.type === "custom" && e.customType === FABRIC_SIDEBAR_ENTRY,
        ),
    ).toBe(true);
    expect(h.bridge.snapshot()).toBeUndefined();
  });
  test("late poll from a previous branch is discarded", async () => {
    const h = harness();
    await h.emit("session_start");
    let resolve!: (v: unknown) => void;
    const pending = new Promise((r) => (resolve = r));
    let waiting = false;
    const context = {
      signal: new AbortController().signal,
      call: async (ref: string) => {
        if (ref === "agents.self") return { kind: "root", rootId: "root" };
        waiting = true;
        return pending;
      },
    } as unknown as FabricComponentContext;
    const dispose = (await h
      .component()
      .activate(context, undefined)) as () => void;
    try {
      await new Promise((r) => setTimeout(r, 10));
      expect(waiting).toBe(true);
      await h.emit("session_tree");
      resolve([worker()]);
      await new Promise((r) => setTimeout(r, 10));
      expect(h.bridge.snapshot()?.workers).toHaveLength(0);
    } finally {
      dispose();
      await h.emit("session_shutdown");
    }
  });
  test("captures exact provider result, persists once, and restores after restart", async () => {
    const h = harness();
    await h.emit("session_start");
    const event = {
      toolName: "agents.run",
      toolCallId: "fabric_fixture",
      details: {
        kind: "pi-fabric.tool-result-proxy.v1",
        ref: "agents.run",
        result: worker({ status: "completed" }),
      },
    };
    await h.emit("tool_result", event);
    await h.emit("tool_result", event);
    const checkpoints = h.sm.getBranch().filter((e) => e.type === "custom");
    expect(checkpoints).toHaveLength(1);
    await h.emit("session_start");
    expect(h.bridge.snapshot()?.reportedCost).toBe(2);
    await h.emit("session_shutdown");
  });
});

test("Fabric replaces workflow rows, with responsive costs and worker details", () => {
  const state = new FabricSidebarState("session");
  state.connected("root");
  state.observe(worker({ parentId: "worker" }));
  state.execution(
    "call",
    { display: { name: "Verify migration" } },
    { phases: ["Review"] },
  );
  const metadata: SidebarMetadata = {
    directory: "/repo",
    branchWorktree: "main",
    sessionName: "Fixture",
    contextTokens: "1K",
    contextWindow: "100K",
    contextPercent: 1,
    latestCacheHitRate: null,
    cost: 3,
    mainCost: 1,
    subagentCost: 2,
    costComplete: true,
    modelName: "model",
    thinkingLevel: "high",
    fabric: state.snapshot(),
  };
  const theme = {
    fg: (_: string, s: string) => s,
    bg: (_: string, s: string) => s,
    bold: (s: string) => s,
  } as Theme;
  const render = (height: number, width = SIDEBAR_WIDTH) =>
    new SidebarComponent(
      () => metadata,
      () => theme,
      () => height,
    ).render(width);
  const text = render(45).join("\n");
  for (const expected of [
    "Fabric",
    "Research",
    "Cost $2.000",
    "Main $1.000",
    "Subagents $2.000",
    "Review",
    "grep",
    "5 calls",
  ])
    expect(text).toContain(expected);
  expect(text).not.toContain("Workflow");
  expect(text).not.toContain("↑100");
  expect(text).not.toContain("↓20");
  expect(text).not.toContain("cache 40/0");
  for (const height of [5, 10, 20, 45])
    for (const width of [20, 40]) {
      const rows = render(height, width);
      expect(rows).toHaveLength(height);
      expect(rows.every((r) => visibleWidth(r) <= width)).toBe(true);
    }
});
