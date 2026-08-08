import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { WorkflowDefinition } from "../types.ts";
import { renderWorkflowGraph, workflowMermaid } from "./graph.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const definition: WorkflowDefinition = {
  name: "fan-in",
  agents: [
    { id: "api-scout", role: "reader", prompt: "API", dependsOn: [] },
    { id: "test-scout", role: "reader", prompt: "Tests", dependsOn: [] },
    { id: "worker", role: "reader", prompt: "Work", dependsOn: ["api-scout", "test-scout"] },
    { id: "review", role: "reader", prompt: "Review", dependsOn: ["worker"] },
  ],
};

describe("workflow graph", () => {
  test("generates deterministic Mermaid nodes and every dependency edge", () => {
    expect(workflowMermaid(definition)).toBe([
      "flowchart TD",
      '  n0["api-scout"]',
      '  n1["test-scout"]',
      '  n2["worker"]',
      '  n3["review"]',
      "  n0 --> n2",
      "  n1 --> n2",
      "  n2 --> n3",
    ].join("\n"));
  });

  test("renders full or numbered top-down Mermaid before the complete text fallback", () => {
    const wide = renderWorkflowGraph(definition, 120, theme);
    expect(wide.join("\n")).toContain("api-scout");
    expect(wide.join("\n")).toContain("review");
    expect(wide.every((line) => visibleWidth(line) <= 120)).toBe(true);

    const narrow = renderWorkflowGraph(definition, 20, theme);
    const text = narrow.join("\n");
    expect(text).toContain("│ 1 │");
    expect(text).toContain("1: api-scout");
    expect(text).toContain("2: test-scout");
    expect(text).toContain("3: worker");
    expect(text).toContain("4: review");
    expect(narrow.every((line) => visibleWidth(line) <= 20)).toBe(true);

    const fallback = renderWorkflowGraph(definition, 6, theme);
    const unwrapped = fallback.join("");
    for (const id of ["api-scout", "test-scout", "worker", "review"]) expect(unwrapped).toContain(id);
    expect(fallback.every((line) => visibleWidth(line) <= 6)).toBe(true);
  });
});
