import { describe, expect, test } from "bun:test";
import { parseWorkflow } from "../workflow.ts";
import { createWorkflowDraft } from "./state.ts";
import { serializeWorkflowDraft } from "./serialize.ts";

const source = `export const workflow = {
  name: "round trip",
  description: "static",
  agents: [
    { id: "first", role: "reader", prompt: "inspect", dependsOn: [], permissions: { commands: { "z *": "deny", "*": "ask" } } },
    { id: "second", role: "reader", prompt: "{{agents.first.output}}", dependsOn: ["first"], tools: [], skills: ["diff"] }
  ]
};`;

describe("workflow draft serializer", () => {
  test("round-trips parsed workflow semantics", () => {
    const parsed = parseWorkflow(source);
    const serialized = serializeWorkflowDraft(createWorkflowDraft(parsed));
    expect(parseWorkflow(serialized)).toEqual(parsed);
    expect(serialized.startsWith("export const workflow = {")).toBe(true);
    expect(serialized.endsWith(";\n")).toBe(true);
  });

  test("is deterministic and preserves semantic command order without mutating", () => {
    const draft = createWorkflowDraft(parseWorkflow(source));
    const before = JSON.stringify(draft);
    const first = serializeWorkflowDraft(draft);
    const second = serializeWorkflowDraft(draft);
    expect(first).toBe(second);
    expect(first.indexOf('"z *": "deny"')).toBeLessThan(first.indexOf('"*": "ask"'));
    expect(JSON.stringify(draft)).toBe(before);
  });
});
