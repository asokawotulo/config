import { describe, expect, test } from "bun:test";
import { parseWorkflow } from "../workflow.ts";
import { serializeWorkflow } from "./serialize.ts";

const source = `export const workflow = {
  name: "round trip",
  description: "test",
  agents: [
    { id: "first", role: "reader", prompt: "inspect", dependsOn: [], contextFiles: ["src/a.ts", "docs/a.md"] },
    { id: "second", role: "reader", prompt: "{{agents.first.output}}", dependsOn: ["first"], tools: [], skills: ["diff"] }
  ]
};`;

describe("workflow serializer", () => {
  test("round-trips parsed workflow semantics", () => {
    const definition = parseWorkflow(source);
    const serialized = serializeWorkflow(definition);
    expect(parseWorkflow(serialized)).toEqual(definition);
    expect(serialized.startsWith("export const workflow = {")).toBe(true);
    expect(serialized).toContain('"contextFiles"');
  });

  test("is deterministic and detached from the source definition", () => {
    const definition = parseWorkflow(source);
    const first = serializeWorkflow(definition);
    definition.agents[0]!.dependsOn.push("second");
    expect(first).not.toBe(serializeWorkflow(definition));
    expect(serializeWorkflow(parseWorkflow(first))).toBe(first);
  });
});
