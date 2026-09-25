import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  TuiAltScreen,
  visibleWidth,
  type Component,
  type Terminal,
} from "@earendil-works/pi-tui";
import {
  MAX_FABRIC_WORKERS,
  type FabricSidebarSnapshot,
  type FabricWorkerRow,
} from "./fabric-state.ts";
import { resolveGitMetadata } from "./git-metadata.ts";
import {
  buildSidebarMetadata,
  calculateLatestCacheHitRate,
  formatDirectory,
  formatTokenCount,
  type SidebarMetadata,
} from "./metadata.ts";
import { calculateSessionCosts } from "./session-cost.ts";
import {
  activityAppearance,
  orderedFabricWorkers,
  contextUsageColor,
  SIDEBAR_WIDTH,
  SidebarComponent,
} from "./sidebar.ts";

function entry(value: unknown): SessionEntry {
  return value as SessionEntry;
}

function usage(cost: number) {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  };
}

function worker(id: string, status = "running"): FabricWorkerRow {
  return {
    id,
    name: id,
    runner: "pi",
    status,
    updatedAt: 1,
    currentTool: "grep",
    turns: 2,
    toolCalls: 4,
    usage: {
      input: 12345,
      output: 678,
      cacheRead: 9000,
      cacheWrite: 10,
      cost: 0.25,
    },
  };
}

function widgetMetadata(workers: FabricWorkerRow[] = []): SidebarMetadata {
  const fabric: FabricSidebarSnapshot = {
    workers,
    executions: [],
    connection: "live",
    complete: true,
    issues: [],
    reportedCost: 0.2345,
  };
  return {
    directory: "~/config",
    branchWorktree: "main",
    sessionName: "UI customization",
    fabric,
    contextTokens: "0",
    contextWindow: "272K",
    contextPercent: 0,
    latestCacheHitRate: 75,
    cost: 1.2345,
    mainCost: 1,
    subagentCost: 0.2345,
    modelName: "gpt-5.6-sol",
    thinkingLevel: "medium",
  };
}

function identityTheme(): Theme {
  const identity = (text: string) => text;
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: identity,
  } as unknown as Theme;
}

class SelectionTerminal implements Terminal {
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

describe("status widget metadata", () => {
  test("counts assistant, tool, compaction, and branch-summary cost", () => {
    const entries = [
      entry({
        type: "message",
        message: { role: "assistant", usage: usage(1) },
      }),
      entry({
        type: "message",
        message: { role: "toolResult", usage: usage(2) },
      }),
      entry({ type: "compaction", usage: usage(3) }),
      entry({ type: "branch_summary", usage: usage(4) }),
    ];

    expect(calculateSessionCosts(entries)).toEqual({
      total: 10,
      main: 10,
      subagents: 0,
    });
  });

  test("preserves historical workflow costs and deduplicates replay by run ID", () => {
    const settled = entry({
      type: "message",
      message: {
        role: "toolResult",
        toolName: "dynamic_workflow",
        usage: usage(5),
        details: { runId: "settled", agents: [{ usage: usage(99) }] },
      },
    });
    const assistant = entry({
      type: "message",
      message: { role: "assistant", usage: usage(1) },
    });
    expect(calculateSessionCosts([assistant, settled, settled])).toEqual({
      total: 6,
      main: 1,
      subagents: 5,
    });
    expect(
      calculateSessionCosts([assistant, settled, settled], { reportedCost: 2 }),
    ).toEqual({ total: 8, main: 1, subagents: 7 });
  });

  test("supports legacy agent-detail fallback and invalid amounts without the deleted runtime", () => {
    const legacy = (details: unknown) =>
      entry({
        type: "message",
        message: { role: "toolResult", toolName: "dynamic_workflow", details },
      });
    const one = legacy({
      runId: "one",
      agents: [
        { cost: 2 },
        { usage: usage(3) },
        { cost: -1 },
        null,
        { usage: { cost: { total: NaN } } },
      ],
    });
    expect(calculateSessionCosts([one, one]).subagents).toBe(5);
    expect(
      calculateSessionCosts([legacy(null), legacy({ agents: "invalid" })])
        .total,
    ).toBe(0);
    // Unidentified historical results remain independent; do not collapse them by tool name.
    expect(
      calculateSessionCosts([
        legacy({ agents: [{ cost: 2 }] }),
        legacy({ agents: [{ cost: 3 }] }),
      ]).subagents,
    ).toBe(5);
  });

  test("formats context tokens, percentages, and home-relative directories", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(272_000)).toBe("272K");
    expect(formatTokenCount(null)).toBe("?");
    expect(formatDirectory("/Users/test/project", "/Users/test")).toBe(
      "~/project",
    );
    expect(contextUsageColor(50)).toBe("muted");
    expect(contextUsageColor(50.01)).toBe("accent");
    expect(contextUsageColor(80)).toBe("accent");
    expect(contextUsageColor(80.01)).toBe("error");
  });

  test("uses the latest assistant prompt cache hit rate", () => {
    const entries = [
      entry({
        type: "message",
        message: {
          role: "assistant",
          usage: { ...usage(0), input: 20, cacheRead: 80 },
        },
      }),
      entry({
        type: "message",
        message: {
          role: "assistant",
          usage: { ...usage(0), input: 25, cacheRead: 75 },
        },
      }),
    ];

    expect(calculateLatestCacheHitRate(entries)).toBe(75);
    expect(
      calculateLatestCacheHitRate([
        ...entries,
        entry({
          type: "message",
          message: { role: "assistant", usage: { ...usage(0), input: 100 } },
        }),
      ]),
    ).toBe(0);
    expect(
      calculateLatestCacheHitRate([
        entry({
          type: "message",
          message: { role: "assistant", usage: { ...usage(0), input: 100 } },
        }),
      ]),
    ).toBeNull();
  });

  test("carries the raw context percentage", () => {
    const pi = {
      getSessionName: () => "test session",
      getThinkingLevel: () => "off",
    } as unknown as ExtensionAPI;
    const ctx = {
      cwd: "/repo",
      getContextUsage: () => ({
        tokens: 10_000,
        contextWindow: 100_000,
        percent: 63.125,
      }),
      sessionManager: { getEntries: () => [], getBranch: () => [] },
    } as unknown as ExtensionContext;

    expect(
      buildSidebarMetadata(pi, ctx, { branchWorktree: "main" }).contextPercent,
    ).toBe(63.125);
  });

  test("formats linked worktrees as branch/worktree", async () => {
    const pi = {
      exec: async () => ({
        code: 0,
        stdout:
          "/repo/worktrees/feature\n/repo/.git/worktrees/feature\n/repo/.git\nfeature/login\n",
        stderr: "",
        killed: false,
      }),
    } as unknown as ExtensionAPI;

    await expect(
      resolveGitMetadata(pi, "/repo/worktrees/feature"),
    ).resolves.toEqual({
      branchWorktree: "feature/login/feature",
    });
  });
});

describe("SidebarComponent", () => {
  test("deactivated children never consult stale session callbacks", () => {
    let stale = false;
    const live = <T>(value: T): T => {
      if (stale) throw new Error("stale session callback");
      return value;
    };
    const sidebar = new SidebarComponent(
      () => live(widgetMetadata()),
      () => live(identityTheme()),
      () => live(34),
    );
    expect(sidebar.render(SIDEBAR_WIDTH).join("\n")).toContain("~/config");
    const [separator, viewport] = (sidebar as unknown as {
      children: Component[];
    }).children;
    const content = (viewport as unknown as { children: Component[] })
      .children[0]!;

    stale = true;
    sidebar.deactivate();
    sidebar.deactivate();
    expect(separator!.render(1)).toEqual([" "]);
    expect(content.render(SIDEBAR_WIDTH - 1)).toEqual([
      " ".repeat(SIDEBAR_WIDTH - 1),
    ]);
    expect(sidebar.render(SIDEBAR_WIDTH)).toEqual([
      " ".repeat(SIDEBAR_WIDTH),
    ]);
    sidebar.invalidate();
    expect(sidebar.render(SIDEBAR_WIDTH).join("")).not.toContain("config");
  });

  test("renders a 50-column panel with sections in the required order", () => {
    const sidebar = new SidebarComponent(
      widgetMetadata,
      identityTheme,
      () => 34,
    );
    const lines = sidebar.render(SIDEBAR_WIDTH);
    const text = lines.join("\n");

    const sectionRow = (heading: string) =>
      lines.findIndex((line) => line.replace(/^│\s*/, "").trim() === heading);
    expect(sectionRow("Directory")).toBeLessThan(sectionRow("Session"));
    expect(sectionRow("Session")).toBeLessThan(sectionRow("Context"));
    expect(sectionRow("Context")).toBeLessThan(sectionRow("Model"));
    expect(sectionRow("Model")).toBeLessThan(sectionRow("Fabric"));
    expect(text).toContain("~/config");
    expect(text).toContain("0 / 272K  0.00%");
    expect(text).toContain("Cache hit 75.0%");
    expect(text).toContain("Total $1.234");
    expect(text.indexOf("0 / 272K")).toBeLessThan(
      text.indexOf("Cache hit 75.0%"),
    );
    expect(text.indexOf("Cache hit 75.0%")).toBeLessThan(
      text.indexOf("Total $1.234"),
    );
    expect(text).not.toContain("Ctrl+B hide");
    expect(text).not.toContain("/workflows inspect");
    expect(text).not.toContain("─");
    expect(lines.every((line) => line.startsWith("│"))).toBe(true);
    expect(lines.every((line) => visibleWidth(line) === SIDEBAR_WIDTH)).toBe(
      true,
    );

    const withoutCacheRate = new SidebarComponent(
      () => ({ ...widgetMetadata(), latestCacheHitRate: null }),
      identityTheme,
      () => 34,
    )
      .render(SIDEBAR_WIDTH)
      .join("\n");
    expect(withoutCacheRate).not.toContain("Cache hit");
  });

  test("worker metrics are hidden while main context/cache and worker costs remain", () => {
    const text = new SidebarComponent(
      () => widgetMetadata([worker("research")]),
      identityTheme,
      () => 45,
    )
      .render(SIDEBAR_WIDTH)
      .join("\n");
    for (const expected of [
      "Fabric",
      "research",
      "Cost $0.250",
      "4 calls",
      "2 turns",
      "grep",
      "0 / 272K",
      "Cache hit 75.0%",
    ])
      expect(text).toContain(expected);
    for (const removed of ["↑12345", "↓678", "cache 9000/10", "Workflow"])
      expect(text).not.toContain(removed);
  });

  test("long worker names cannot truncate their separate cost row", () => {
    const long = { ...worker("long"), name: "long-worker-name-".repeat(8) };
    for (const height of [11, 45]) {
      const lines = new SidebarComponent(
        () => widgetMetadata([long]),
        identityTheme,
        () => height,
      ).render(SIDEBAR_WIDTH);
      const nameIndex = lines.findIndex((line) =>
        line.includes("long-worker-name"),
      );
      expect(nameIndex).toBeGreaterThanOrEqual(0);
      expect(lines[nameIndex]).not.toContain("$0.250");
      expect(lines[nameIndex + 1]).toContain("Cost $0.250");
      expect(lines.every((line) => visibleWidth(line) <= SIDEBAR_WIDTH)).toBe(
        true,
      );
    }
  });

  test("compact truncation never leaves a worker name without its cost", () => {
    const workers = Array.from({ length: 8 }, (_, i) => worker(`paired-${i}`));
    for (const height of [8, 9, 10, 11, 12, 13, 14]) {
      const lines = new SidebarComponent(
        () => widgetMetadata(workers),
        identityTheme,
        () => height,
      ).render(SIDEBAR_WIDTH);
      expect(lines).toHaveLength(height);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes("paired-"))
          expect(lines[i + 1]).toContain("Cost $0.250");
      }
      expect(lines.join("\n")).toContain("more in /fabric");
    }
  });

  test("missing worker usage keeps its unknown cost below the name", () => {
    const unknown = { ...worker("unknown-cost"), usage: undefined };
    const lines = new SidebarComponent(
      () => widgetMetadata([unknown]),
      identityTheme,
      () => 45,
    ).render(SIDEBAR_WIDTH);
    const index = lines.findIndex((line) => line.includes("unknown-cost"));
    expect(index).toBeGreaterThanOrEqual(0);
    expect(lines[index + 1]).toContain("Cost $?");
  });

  test("shared appearance handles all known states and neutral unknowns", () => {
    for (const [status, symbol, color] of [
      ["running", "●", "warning"],
      ["completed", "✓", "success"],
      ["queued", "○", "dim"],
      ["failed", "✗", "error"],
      ["timed_out", "✗", "error"],
      ["stopped", "×", "muted"],
      ["cancelled", "×", "muted"],
      ["stale", "!", "warning"],
      ["unexpected", "?", "dim"],
    ] as const)
      expect(activityAppearance(status)).toEqual({ symbol, color });
  });

  test("shared ordering handles parents, cycles, duplicate IDs across runners and depth limits", () => {
    const parent = worker("parent");
    const child = { ...worker("child"), parentId: "parent" };
    expect(
      orderedFabricWorkers([child, parent]).map((row) => [
        row.worker.id,
        row.depth,
      ]),
    ).toEqual([
      ["parent", 0],
      ["child", 1],
    ]);
    const cycle = [
      { ...worker("a"), parentId: "b" },
      { ...worker("b"), parentId: "a" },
    ];
    expect(orderedFabricWorkers(cycle)).toHaveLength(2);
    expect(
      orderedFabricWorkers([parent, { ...parent, runner: "claude" }]),
    ).toHaveLength(2);
    const deep = Array.from({ length: 12 }, (_, i) => ({
      ...worker(String(i)),
      ...(i ? { parentId: String(i - 1) } : {}),
    }));
    expect(orderedFabricWorkers(deep).every((row) => row.depth <= 4)).toBe(
      true,
    );
  });

  test("renders bounded Fabric rows and overflow at short and tall heights", () => {
    const workers = Array.from({ length: MAX_FABRIC_WORKERS }, (_, i) =>
      worker(`worker-${i}`),
    );
    for (const height of [11, 80]) {
      const lines = new SidebarComponent(
        () => widgetMetadata(workers),
        identityTheme,
        () => height,
      ).render(SIDEBAR_WIDTH);
      expect(lines).toHaveLength(height);
      expect(lines.every((line) => visibleWidth(line) === SIDEBAR_WIDTH)).toBe(
        true,
      );
      expect(lines.join("\n")).toContain("Fabric");
      expect(lines.join("\n")).toContain("worker-0");
      expect(lines.join("\n")).toContain("more");
      expect(lines.join("\n")).not.toContain("worker-8 ");
    }
  });

  test("caches by width and transcript height until invalidated", () => {
    const metadata = widgetMetadata();
    let metadataCalls = 0;
    let height = 34;
    const sidebar = new SidebarComponent(
      () => {
        metadataCalls += 1;
        return metadata;
      },
      identityTheme,
      () => height,
    );

    const first = sidebar.render(SIDEBAR_WIDTH);
    expect(sidebar.render(SIDEBAR_WIDTH)).toBe(first);
    expect(metadataCalls).toBe(1);

    height = 35;
    expect(sidebar.render(SIDEBAR_WIDTH)).toHaveLength(35);
    expect(metadataCalls).toBe(1);

    metadata.sessionName = "Updated session";
    sidebar.invalidate();
    expect(sidebar.render(SIDEBAR_WIDTH).join("\n")).toContain(
      "Updated session",
    );
    expect(metadataCalls).toBe(2);
  });

  test("copies multiline content without the separator", () => {
    const height = 12;
    const sidebar = new SidebarComponent(
      widgetMetadata,
      identityTheme,
      () => height,
    );
    const terminal = new SelectionTerminal(SIDEBAR_WIDTH, height);
    const tui = new TuiAltScreen(terminal);
    tui.setLayoutRoot(sidebar);
    tui.start();
    tui.renderNow(true);

    const select = tui as unknown as {
      handleSelectionMouseEvent(event: {
        button: number;
        x: number;
        y: number;
        release: boolean;
      }): void;
    };
    select.handleSelectionMouseEvent({
      button: 0,
      x: 2,
      y: 2,
      release: false,
    });
    select.handleSelectionMouseEvent({
      button: 32,
      x: 12,
      y: 4,
      release: false,
    });
    select.handleSelectionMouseEvent({
      button: 0,
      x: 12,
      y: 4,
      release: true,
    });

    const clipboardWrite = terminal.writes.findLast((write) =>
      write.startsWith("\u001b]52;c;"),
    );
    expect(clipboardWrite).toBeDefined();
    const encoded = clipboardWrite!.slice("\u001b]52;c;".length, -1);
    const copied = Buffer.from(encoded, "base64").toString("utf8");
    expect(copied).toContain("Directory");
    expect(copied).toContain("~/config");
    expect(copied).not.toContain("│");

    tui.stop();
  });
});
