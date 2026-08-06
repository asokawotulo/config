import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  SessionEntry,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type {
  DynamicWorkflowAgentSnapshot,
  DynamicWorkflowRunSnapshot,
  DynamicWorkflowStatus,
} from "../../lib/dynamic-workflow-events.ts";
import {
  calculateSessionCost,
  DynamicWorkflowSidebarState,
  formatDirectory,
  formatTokenCount,
  resolveGitMetadata,
  type SidebarMetadata,
} from "./metadata.ts";
import { SidebarComponent } from "./sidebar.ts";

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
    ...(options.finishedAt === undefined ? {} : { finishedAt: options.finishedAt }),
    agentCount: agents.length,
    agents,
  };
}

function sidebarMetadata(
  workflowRuns: readonly DynamicWorkflowRunSnapshot[] = [],
): SidebarMetadata {
  return {
    directory: "~/config",
    branchWorktree: "main",
    sessionName: "UI customization",
    workflowRuns,
    contextTokens: "0",
    contextWindow: "272K",
    contextPercent: "0.00%",
    cost: 1.2345,
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

describe("sidebar metadata", () => {
  test("counts assistant, tool, compaction, and branch-summary cost", () => {
    const entries = [
      entry({ type: "message", message: { role: "assistant", usage: usage(1) } }),
      entry({ type: "message", message: { role: "toolResult", usage: usage(2) } }),
      entry({ type: "compaction", usage: usage(3) }),
      entry({ type: "branch_summary", usage: usage(4) }),
    ];

    expect(calculateSessionCost(entries)).toBe(10);
  });

  test("formats context tokens and home-relative directories", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(272_000)).toBe("272K");
    expect(formatTokenCount(null)).toBe("?");
    expect(formatDirectory("/Users/test/project", "/Users/test")).toBe("~/project");
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

    await expect(resolveGitMetadata(pi, "/repo/worktrees/feature")).resolves.toEqual({
      branchWorktree: "feature/login/feature",
    });
  });
});

describe("dynamic workflow sidebar state", () => {
  test("filters by session, shows all active runs, and hydrates the newest settled run", () => {
    const state = new DynamicWorkflowSidebarState();
    state.beginSession("session-a");

    expect(state.applyRun({
      sessionId: "session-b",
      phase: "started",
      run: workflowRun("foreign", "running", 9, { sessionId: "session-b" }),
    })).toBe(false);

    for (const run of [
      workflowRun("active-old", "running", 2),
      workflowRun("settled", "completed", 8, { finishedAt: 9 }),
      workflowRun("active-new", "running", 4),
    ]) {
      expect(state.applyRun({ sessionId: "session-a", phase: "progress", run })).toBe(true);
    }
    expect(state.getVisibleRuns().map((run) => run.runId)).toEqual([
      "active-new",
      "active-old",
    ]);

    expect(state.applyState({
      sessionId: "session-a",
      runs: [
        workflowRun("older", "failed", 10, { finishedAt: 20 }),
        workflowRun("foreign", "completed", 30, {
          sessionId: "session-b",
          finishedAt: 40,
        }),
        workflowRun("newest", "completed", 15, { finishedAt: 25 }),
      ],
    })).toBe(true);
    expect(state.getVisibleRuns().map((run) => run.runId)).toEqual(["newest"]);

    state.beginSession("session-b");
    expect(state.getVisibleRuns()).toEqual([]);
  });
});

describe("SidebarComponent", () => {
  test("renders context cost and respects width", () => {
    const sidebar = new SidebarComponent(
      () => sidebarMetadata(),
      identityTheme,
    );
    const lines = sidebar.render(30, 20);

    expect(lines.join("\n")).toContain("$1.234");
    expect(lines.every((line) => visibleWidth(line) <= 30)).toBe(true);
  });

  test("renders workflow statuses and one bounded activity row before context and model", () => {
    const run = workflowRun("active", "running", 1, {
      name: "Parallel review",
      agents: [
        {
          id: "research",
          role: "researcher",
          status: "running",
          activity: `Indexing ${"a".repeat(100)}`,
        },
        { id: "verify", role: "reviewer", status: "completed" },
      ],
    });
    const sidebar = new SidebarComponent(
      () => sidebarMetadata([run]),
      identityTheme,
    );
    const lines = sidebar.render(30, 30);
    const text = lines.join("\n");

    expect(text.indexOf("Workflow")).toBeLessThan(text.indexOf("Context"));
    expect(text.indexOf("Context")).toBeLessThan(text.indexOf("Model"));
    expect(text).toContain("running research");
    expect(text).toContain("completed verify");
    expect(lines.filter((line) => line.includes("Indexing"))).toHaveLength(1);
    expect(text).not.toContain("a".repeat(100));
    expect(lines.every((line) => visibleWidth(line) <= 30)).toBe(true);
  });

  test("reserves Context and Model rows before optional activity", () => {
    const sidebar = new SidebarComponent(
      () => sidebarMetadata([
        workflowRun("boundary", "running", 1, {
          agents: [{ id: "worker", role: "worker", status: "running", activity: "optional detail" }],
        }),
      ]),
      identityTheme,
    );
    const text = sidebar.render(30, 20).join("\n");

    expect(text).toContain("Context");
    expect(text).toContain("Model");
    expect(text).not.toContain("optional detail");
  });

  test("uses scarce rows for every agent status before running activity", () => {
    const agents: DynamicWorkflowAgentSnapshot[] = Array.from(
      { length: 5 },
      (_, index) => ({
        id: `a${index}`,
        role: "worker",
        status: "running",
        activity: `activity-${index}`,
      }),
    );
    const sidebar = new SidebarComponent(
      () => sidebarMetadata([
        workflowRun("budget", "running", 1, { name: "Budget", agents }),
      ]),
      identityTheme,
    );
    const lines = sidebar.render(30, 15);
    const text = lines.join("\n");

    for (const agent of agents) expect(text).toContain(`running ${agent.id}`);
    expect(text).not.toContain("activity-");
    expect(lines).toHaveLength(15);
    expect(lines.every((line) => visibleWidth(line) <= 30)).toBe(true);
  });
});
