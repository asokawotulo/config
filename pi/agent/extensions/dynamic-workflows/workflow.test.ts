import { describe, expect, test } from "bun:test";
import type { RoleDefinition } from "./types.ts";
import { parseWorkflow, resolveWorkflow, workflowWaves } from "./workflow.ts";

const role: RoleDefinition = {
  name: "reader", description: "reads", model: "openai-codex/gpt-5.6-sol",
  tools: ["read", "bash"], skills: ["diff"], prompt: "Read only", filePath: "/reader.md",
  permissions: { commands: { "*": "deny", "rg *": "allow" } },
};

const source = `export const workflow = {
  name: "test",
  agents: [
    { id: "a", role: "reader", prompt: "inspect", dependsOn: [] },
    { id: "b", role: "reader", prompt: "use {{agents.a.output}}", dependsOn: ["a"], tools: ["read"], skills: [] }
  ]
}`;

describe("dynamic workflow parser", () => {
  test("parses and resolves static DAGs", () => {
    const parsed = parseWorkflow(source);
    expect(workflowWaves(parsed.agents)).toEqual([["a"], ["b"]]);
    const resolved = resolveWorkflow(source, new Map([["reader", role]]));
    expect(resolved.agents[1]?.effectiveTools).toEqual(["read"]);
    expect(resolved.agents[1]?.effectiveSkills).toEqual([]);
  });

  test("rejects executable expressions", () => {
    expect(() => parseWorkflow(`export const workflow = makeWorkflow()`)).toThrow("static");
  });

  test("rejects cycles and permission elevation", () => {
    const cyclic = source.replace('dependsOn: []', 'dependsOn: ["b"]');
    expect(() => resolveWorkflow(cyclic, new Map([["reader", role]]))).toThrow("cycle");
    const elevated = source.replace('tools: ["read"]', 'tools: ["write"]');
    expect(() => resolveWorkflow(elevated, new Map([["reader", role]]))).toThrow("cannot add write");
  });

  test("rejects unknown, malformed, and unavailable output references", () => {
    const unknown = source.replace("{{agents.a.output}}", "{{agents.missing.output}}");
    expect(() => resolveWorkflow(unknown, new Map([["reader", role]]))).toThrow("unknown agent missing");
    const unavailable = source.replace("{{agents.a.output}}", "{{agents.b.output}}");
    expect(() => resolveWorkflow(unavailable, new Map([["reader", role]]))).toThrow("without depending");
    const malformed = source.replace("{{agents.a.output}}", "{{agents.a.result}}");
    expect(() => resolveWorkflow(malformed, new Map([["reader", role]]))).toThrow("invalid agent output placeholder");
    const extraDelimiter = source.replace("{{agents.a.output}}", "{{agents.a.output}}}");
    expect(() => resolveWorkflow(extraDelimiter, new Map([["reader", role]]))).toThrow("invalid agent output placeholder");
  });
});
