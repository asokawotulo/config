import { describe, expect, test } from "bun:test";
import {
  DYNAMIC_WORKFLOW_EVENTS,
  MAX_DYNAMIC_WORKFLOW_AGENTS,
  MAX_DYNAMIC_WORKFLOW_DETAIL_LENGTH,
  MAX_DYNAMIC_WORKFLOW_RUNS,
  dynamicWorkflowDisplayText,
} from "../../lib/dynamic-workflow-events.ts";
import { toRunSnapshot, toRunSnapshots } from "./store.ts";
import type { WorkflowRun } from "./types.ts";

function fixture(): WorkflowRun {
  return {
    runId: "wf_test",
    sessionId: "session-test",
    name: "A\nworkflow",
    description: "sidebar description",
    cwd: "/private/project",
    status: "running",
    approvedSource: "SECRET_APPROVED_SOURCE",
    waves: [["agent-0"]],
    agents: Array.from({ length: MAX_DYNAMIC_WORKFLOW_AGENTS + 2 }, (_, index) => ({
      id: `agent-${index}`,
      role: "researcher",
      prompt: `SECRET_PROMPT_${index}`,
      status: index === 0 ? "running" as const : "queued" as const,
      model: "provider/private-model",
      tools: ["bash"],
      skills: ["private-skill"],
      activity: index === 0 ? `SECRET_TOOL_ARGS_${"x".repeat(40)}` : undefined,
      sidebarActivity: index === 0 ? `\u001b[31mworking\n${"x".repeat(MAX_DYNAMIC_WORKFLOW_DETAIL_LENGTH + 20)}\u001b[0m` : undefined,
      output: `SECRET_RESULT_${index}`,
    })),
    permissionDecisions: [{
      at: 1,
      agentId: "agent-0",
      command: "SECRET_PERMISSION_COMMAND",
      source: "workflow-policy",
      action: "ask",
      reason: "SECRET_PERMISSION_REASON",
    }],
    startedAt: 1,
  };
}

describe("dynamic workflow sidebar events", () => {
  test("defines separate update and session hydration channels", () => {
    expect(DYNAMIC_WORKFLOW_EVENTS).toEqual({
      run: "dynamic-workflows:run",
      stateRequest: "dynamic-workflows:state-request",
      state: "dynamic-workflows:state",
    });
  });

  test("projects private run records to bounded display snapshots", () => {
    const snapshot = toRunSnapshot(fixture());
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.agentCount).toBe(MAX_DYNAMIC_WORKFLOW_AGENTS + 2);
    expect(snapshot.agents).toHaveLength(MAX_DYNAMIC_WORKFLOW_AGENTS);
    expect(snapshot.name).toBe("A workflow");
    expect(snapshot.agents[0]?.activity?.startsWith("working ")).toBe(true);
    expect(snapshot.agents[0]?.activity).not.toContain("\n");
    expect(snapshot.agents[0]?.activity).not.toContain("\u001b");
    expect(Array.from(snapshot.agents[0]?.activity ?? "")).toHaveLength(MAX_DYNAMIC_WORKFLOW_DETAIL_LENGTH);
    expect(serialized).not.toContain("SECRET_TOOL_ARGS");
    expect(serialized).not.toContain("SECRET_PROMPT");
    expect(serialized).not.toContain("SECRET_RESULT");
    expect(serialized).not.toContain("SECRET_PERMISSION");
    expect(serialized).not.toContain("SECRET_APPROVED_SOURCE");
    expect(serialized).not.toContain("/private/project");
  });

  test("bounds hydration batches and handles unicode without broken characters", () => {
    const run = fixture();
    const snapshots = toRunSnapshots(Array.from({ length: MAX_DYNAMIC_WORKFLOW_RUNS + 2 }, (_, index) => ({
      ...run,
      runId: `wf_${index}`,
    })));

    expect(snapshots).toHaveLength(MAX_DYNAMIC_WORKFLOW_RUNS);
    expect(dynamicWorkflowDisplayText("🙂🙂🙂", 2)).toBe("🙂…");
  });
});
