import { describe, expect, test } from "bun:test";
import type { RoleDefinition, WorkflowDefinition } from "../types.ts";
import {
  addAgent,
  createWorkflowDraft,
  deleteAgent,
  renameAgent,
  reorderAgent,
  updateWorkflowMetadata,
  validateWorkflowDraft,
} from "./state.ts";

const role: RoleDefinition = {
  name: "reader", description: "Reads", model: "test/model", tools: ["read"], skills: ["diff"],
  prompt: "Read", filePath: "/reader.md",
};

const definition: WorkflowDefinition = {
  name: "draft",
  agents: [
    { id: "source", role: "reader", prompt: "Inspect", dependsOn: [], contextFiles: ["src/source.ts"] },
    { id: "consumer", role: "reader", prompt: "Use {{agents.source.output}} twice: {{agents.source.output}}", dependsOn: ["source"] },
  ],
};

describe("workflow form draft state", () => {
  test("copies definitions and mutates metadata and agent order", () => {
    const draft = createWorkflowDraft(definition);
    updateWorkflowMetadata(draft, { name: "edited", description: "Description" });
    addAgent(draft, { id: "last", role: "reader", prompt: "Finish", dependsOn: ["consumer"] });
    expect(reorderAgent(draft, "last", 0)).toBe(true);
    expect(draft.agents.map((agent) => agent.id)).toEqual(["last", "source", "consumer"]);
    expect(deleteAgent(draft, "consumer")?.id).toBe("consumer");
    expect(draft.agents[0]?.dependsOn).toEqual([]);
    expect(definition.name).toBe("draft");
    expect(definition.agents).toHaveLength(2);
    expect(definition.agents[0]?.contextFiles).toEqual(["src/source.ts"]);
    draft.agents[1]!.contextFiles = ["new.ts"];
    expect(definition.agents[1]?.contextFiles).toBeUndefined();
  });

  test("renames ids, dependencies, and every output placeholder atomically", () => {
    const draft = createWorkflowDraft(definition);
    renameAgent(draft, "source", "research");
    expect(draft.agents[0]?.id).toBe("research");
    expect(draft.agents[1]?.dependsOn).toEqual(["research"]);
    expect(draft.agents[1]?.prompt).toBe("Use {{agents.research.output}} twice: {{agents.research.output}}");

    const snapshot = JSON.stringify(draft);
    expect(() => renameAgent(draft, "research", "consumer")).toThrow("Duplicate");
    expect(JSON.stringify(draft)).toBe(snapshot);
  });

  test("validates roles, narrowing, cycles, and output references", () => {
    const roles = new Map([[role.name, role]]);
    const valid = createWorkflowDraft(definition);
    valid.agents[1]!.tools = ["read"];
    valid.agents[1]!.skills = [];
    expect(validateWorkflowDraft(valid, roles)).toEqual({ valid: true, issues: [] });

    const invalid = createWorkflowDraft(definition);
    invalid.agents[0]!.role = "missing";
    invalid.agents[0]!.dependsOn = ["consumer"];
    invalid.agents[1]!.tools = ["write"];
    invalid.agents[1]!.prompt = "Use {{agents.missing.output}}";
    invalid.agents[1]!.contextFiles = ["../outside.ts", "same.ts", "same.ts"];
    const result = validateWorkflowDraft(invalid, roles);
    expect(result.valid).toBe(false);
    expect(result.issues.map((item) => item.message).join("\n")).toContain("Unknown role");
    expect(result.issues.map((item) => item.message).join("\n")).toContain("cycle");
    expect(result.issues.map((item) => item.message).join("\n")).toContain("not allowed by the role");
    expect(result.issues.map((item) => item.message).join("\n")).toContain("unknown agent missing");
    expect(result.issues.map((item) => item.message).join("\n")).toContain("workflow worktree");
    expect(result.issues.map((item) => item.message).join("\n")).toContain("duplicate value same.ts");
  });
});
