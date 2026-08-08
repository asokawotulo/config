import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  MAX_DYNAMIC_WORKFLOW_AGENTS,
  MAX_DYNAMIC_WORKFLOW_RUNS,
  type DynamicWorkflowAgentSnapshot,
  type DynamicWorkflowRunSnapshot,
  type DynamicWorkflowStatus,
} from "../../lib/dynamic-workflow-events.ts";
import { resolveGitMetadata } from "./git-metadata.ts";
import {
  buildSidebarMetadata,
  formatDirectory,
  formatTokenCount,
  type SidebarMetadata,
} from "./metadata.ts";
import { calculateSessionCosts } from "./session-cost.ts";
import { DynamicWorkflowSidebarState } from "./workflow-state.ts";
import {
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

function workflowRun(
  runId: string,
  status: DynamicWorkflowStatus,
  startedAt: number,
  options: {
    sessionId?: string;
    finishedAt?: number;
    agents?: DynamicWorkflowAgentSnapshot[];
    name?: string;
  } = {},
): DynamicWorkflowRunSnapshot {
  const agents = options.agents ?? [];
  return {
    runId,
    sessionId: options.sessionId ?? "session-a",
    name: options.name ?? runId,
    status,
    startedAt,
    ...(options.finishedAt === undefined
      ? {}
      : { finishedAt: options.finishedAt }),
    agentCount: agents.length,
    agents,
  };
}

function widgetMetadata(
  workflowRuns: readonly DynamicWorkflowRunSnapshot[] = [],
): SidebarMetadata {
  return {
    directory: "~/config",
    branchWorktree: "main",
    sessionName: "UI customization",
    workflowRuns,
    contextTokens: "0",
    contextWindow: "272K",
    contextPercent: 0,
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

  test("partitions workflow cost without double-counting persisted usage", () => {
    const settled = entry({
      type: "message",
      message: {
        role: "toolResult",
        toolName: "dynamic_workflow",
        usage: usage(5),
        details: { runId: "settled", agents: [{ usage: usage(5) }] },
      },
    });
    const runs = [
      workflowRun("settled", "completed", 1, {
        agents: [{ id: "done", role: "worker", status: "completed", cost: 5 }],
      }),
      workflowRun("active", "running", 2, {
        agents: [{ id: "live", role: "worker", status: "running", cost: 2 }],
      }),
    ];
    const assistant = entry({
      type: "message",
      message: { role: "assistant", usage: usage(1) },
    });

    expect(calculateSessionCosts([assistant, settled, settled], runs)).toEqual({
      total: 8,
      main: 1,
      subagents: 7,
    });
  });

  test("replaces active snapshot cost when its result persists", () => {
    const run = workflowRun("transition", "running", 1, {
      agents: [{ id: "agent", role: "worker", status: "running", cost: 3 }],
    });
    expect(calculateSessionCosts([], [run]).subagents).toBe(3);

    const result = entry({
      type: "message",
      message: {
        role: "toolResult",
        toolName: "dynamic_workflow",
        usage: usage(3),
        details: { runId: "transition", agents: [{ cost: 3 }] },
      },
    });
    expect(calculateSessionCosts([result], [run]).subagents).toBe(3);
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
      sessionManager: { getEntries: () => [] },
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

describe("dynamic workflow widget state", () => {
  test("filters by session and returns every run newest-first", () => {
    const state = new DynamicWorkflowSidebarState();
    state.beginSession("session-a");

    expect(
      state.applyRun({
        sessionId: "session-b",
        phase: "started",
        run: workflowRun("foreign", "running", 9, { sessionId: "session-b" }),
      }),
    ).toBe(false);

    for (const run of [
      workflowRun("active-old", "running", 2),
      workflowRun("settled", "completed", 8, { finishedAt: 9 }),
      workflowRun("active-new", "running", 4),
    ]) {
      expect(
        state.applyRun({ sessionId: "session-a", phase: "progress", run }),
      ).toBe(true);
    }
    expect(state.getVisibleRuns().map((run) => run.runId)).toEqual([
      "settled",
      "active-new",
      "active-old",
    ]);

    expect(
      state.applyState({
        sessionId: "session-a",
        runs: [
          workflowRun("older", "failed", 10, { finishedAt: 20 }),
          workflowRun("newest", "completed", 15, { finishedAt: 25 }),
          workflowRun("running", "running", 12),
        ],
      }),
    ).toBe(true);
    expect(state.getVisibleRuns().map((run) => run.runId)).toEqual([
      "newest",
      "running",
      "older",
    ]);
  });

  test("rejects malformed shared events without replacing valid state", () => {
    const state = new DynamicWorkflowSidebarState();
    state.beginSession("session-a");
    const valid = workflowRun("valid", "running", 1);
    expect(
      state.applyRun({ sessionId: "session-a", phase: "started", run: valid }),
    ).toBe(true);

    expect(
      state.applyRun({
        sessionId: "session-a",
        phase: "progress",
        run: { ...workflowRun("unknown-field", "running", 2), extra: true },
      }),
    ).toBe(false);
    expect(
      state.applyState({
        sessionId: "session-a",
        runs: [
          workflowRun("foreign", "completed", 3, {
            sessionId: "session-b",
          }),
        ],
      }),
    ).toBe(false);
    expect(
      state.applyState({
        sessionId: "session-a",
        runs: [{ ...workflowRun("invalid-number", "failed", 4), startedAt: NaN }],
      }),
    ).toBe(false);
    expect(state.getVisibleRuns()).toEqual([valid]);
  });
});

describe("SidebarComponent", () => {
  test("renders a 50-column panel with sections in the required order", () => {
    const sidebar = new SidebarComponent(
      widgetMetadata,
      identityTheme,
      () => 34,
    );
    const lines = sidebar.render(SIDEBAR_WIDTH);
    const text = lines.join("\n");

    const sectionRow = (heading: string) =>
      lines.findIndex(
        (line) => line.replace(/^│\s*/, "").trim() === heading,
      );
    expect(sectionRow("Directory")).toBeLessThan(sectionRow("Session"));
    expect(sectionRow("Session")).toBeLessThan(sectionRow("Context"));
    expect(sectionRow("Context")).toBeLessThan(sectionRow("Model"));
    expect(sectionRow("Model")).toBeLessThan(sectionRow("Workflow"));
    expect(text).toContain("~/config");
    expect(text).toContain("0 / 272K  0.00%");
    expect(text).toContain("Total $1.234");
    expect(text).not.toContain("Ctrl+B hide");
    expect(text).not.toContain("/workflows inspect");
    expect(text).not.toContain("─");
    expect(lines.every((line) => line.startsWith("│"))).toBe(true);
    expect(lines.every((line) => visibleWidth(line) === SIDEBAR_WIDTH)).toBe(
      true,
    );
  });

  test("shows workflow agents when height permits and compacts on short terminals", () => {
    const run = workflowRun("live", "running", 1, {
      name: "Parallel review",
      agents: [
        {
          id: "research",
          role: "researcher",
          status: "running",
          activity: "Reading files",
          cost: 0.25,
        },
        { id: "verify", role: "reviewer", status: "completed" },
      ],
    });
    const settled = workflowRun("settled", "completed", 2, {
      name: "Earlier implementation",
    });
    const tall = new SidebarComponent(
      () => widgetMetadata([settled, run]),
      identityTheme,
      () => 44,
    )
      .render(SIDEBAR_WIDTH)
      .join("\n");
    expect(tall).toContain("Parallel review");
    expect(tall).toContain("Earlier implementation");
    expect(tall).toContain("running research");
    expect(tall).toContain("completed verify");

    const compact = new SidebarComponent(
      () => widgetMetadata([run]),
      identityTheme,
      () => 11,
    ).render(SIDEBAR_WIDTH);
    const compactText = compact.join("\n");
    for (const heading of [
      "Directory",
      "Session",
      "Context",
      "Model",
      "Workflow",
    ]) {
      expect(compactText).toContain(heading);
    }
    expect(compact).toHaveLength(11);

    const manyRuns = Array.from({ length: 8 }, (_, index) =>
      workflowRun(`run-${index}`, "completed", 8 - index),
    );
    const constrained = new SidebarComponent(
      () => widgetMetadata(manyRuns),
      identityTheme,
      () => 11,
    )
      .render(SIDEBAR_WIDTH)
      .join("\n");
    expect(constrained).toContain("run-0");
    expect(constrained).toContain("more workflows");
  });

  test("fits and renders the maximum workflow event contract linearly", () => {
    const agents: DynamicWorkflowAgentSnapshot[] = Array.from(
      { length: MAX_DYNAMIC_WORKFLOW_AGENTS },
      (_, index) => ({
        id: `agent-${index}`,
        role: "worker",
        status: "running",
        activity: `activity-${index}`,
        cost: index / 100,
      }),
    );
    const runs = Array.from({ length: MAX_DYNAMIC_WORKFLOW_RUNS }, (_, index) =>
      workflowRun(`run-${index}`, "running", index, { agents }),
    );
    const height = 80;
    const lines = new SidebarComponent(
      () => widgetMetadata(runs),
      identityTheme,
      () => height,
    ).render(SIDEBAR_WIDTH);
    const text = lines.join("\n");

    expect(lines).toHaveLength(height);
    expect(lines.every((line) => visibleWidth(line) === SIDEBAR_WIDTH)).toBe(
      true,
    );
    expect(text).toContain("run-0");
    expect(text).toContain(`run-${MAX_DYNAMIC_WORKFLOW_RUNS - 1}`);
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
});
