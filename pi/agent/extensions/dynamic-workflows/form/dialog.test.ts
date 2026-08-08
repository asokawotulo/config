import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import type { RoleDefinition } from "../types.ts";
import { resolveWorkflow } from "../workflow.ts";
import {
  WORKFLOW_DIALOG_MAX_HEIGHT,
  WorkflowDialogComponent,
  type WorkflowReviewResult,
} from "./dialog.ts";
import { dialogColumnWidths, layoutDialogColumns, WIDE_DIALOG_WIDTH } from "./render.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const tui = {
  requestRender() {},
  terminal: { rows: 60 },
} as unknown as TUI;

const role: RoleDefinition = {
  name: "reader",
  description: "Reads safely",
  model: "test/model",
  thinking: "high",
  tools: ["read", "grep"],
  skills: ["diff"],
  prompt: "Read",
  filePath: "/reader.md",
};
const roles = new Map([[role.name, role]]);
const source = `export const workflow = {
  name: "review me",
  description: "A safe workflow",
  agents: [
    { id: "first", role: "reader", prompt: "Inspect the implementation in full", dependsOn: [], contextFiles: ["src/first.ts"] },
    { id: "second", role: "reader", prompt: "Use {{agents.first.output}}", dependsOn: ["first"], tools: ["read"], skills: [] }
  ]
};`;

function dialog(
  input = source,
  resolveSource: (value: string) => ReturnType<typeof resolveWorkflow> = (value) => resolveWorkflow(value, roles),
) {
  let result: WorkflowReviewResult | undefined;
  let completed = false;
  const component = new WorkflowDialogComponent({
    tui,
    theme,
    source: input,
    roles,
    resolveSource,
    onDone: (value) => { result = value; completed = true; },
  });
  return { component, result: () => result, completed: () => completed };
}

describe("workflow confirmation dialog", () => {
  test("uses wide columns and a narrow stacked layout within the viewport", () => {
    const left = ["LEFT", "agent"];
    const right = ["RIGHT", "field"];
    expect(layoutDialogColumns(left, right, WIDE_DIALOG_WIDTH).some((line) => line.includes("LEFT") && line.includes("RIGHT"))).toBe(true);
    expect(dialogColumnWidths(120)).toEqual({ left: 87, right: 30 });
    const narrow = layoutDialogColumns(left, right, 40);
    expect(narrow.findIndex((line) => line.includes("RIGHT"))).toBeGreaterThan(narrow.findIndex((line) => line.includes("agent")));

    for (const width of [42, 120]) {
      const lines = dialog().component.render(width);
      expect(WORKFLOW_DIALOG_MAX_HEIGHT).toBe("75%");
      expect(lines.length).toBeLessThanOrEqual(45);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(lines[0]).toMatch(/^┌─+┐$/);
      expect(lines.at(-1)).toMatch(/^└─+┘$/);
      expect(lines.slice(1, -1).every((line) => line.startsWith("│") && line.endsWith("│"))).toBe(true);
      expect(lines.join("\n")).toContain("Confirm dynamic workflow");
      expect(lines.join("\n")).toContain("review me");
    }
  });

  test("shows the graph and complete subagent capability details", () => {
    const rendered = dialog().component.render(120).join("\n");
    expect(rendered).toContain("Workflow graph");
    expect(rendered).toContain("Subagent capabilities");
    const headings = rendered.split("\n").find((line) => line.includes("Workflow graph") && line.includes("Subagent capabilities"));
    expect(headings).toBeDefined();
    expect(headings!.indexOf("Subagent capabilities")).toBeLessThan(headings!.indexOf("Workflow graph"));
    expect(rendered).toContain("first");
    expect(rendered).toContain("second");
    expect(rendered).toMatch(/│ Role\s+│ reader — Reads safely/);
    expect(rendered).toMatch(/│ Model\s+│ test\/model • thinking: high/);
    expect(rendered).toMatch(/│ Dependencies\s+│ first/);
    expect(rendered).toMatch(/│ Tools\s+│ read/);
    expect(rendered).toMatch(/│ Context files\s+│ src\/first\.ts/);
    expect(rendered).toMatch(/┌─+┬─+┐/);
    expect(rendered).not.toContain("role:");
    expect(rendered).toContain("Inspect the implementation in full");
    expect(rendered).toContain("Enter — Run");
    expect(rendered).toContain("Space — Suggest");
    expect(rendered).toContain("Esc — Cancel");
  });

  test("Enter runs only after canonical re-resolution", () => {
    let resolves = 0;
    const state = dialog(source, (value) => { resolves++; return resolveWorkflow(value, roles); });
    state.component.handleInput("\r");
    expect(state.completed()).toBe(true);
    const result = state.result();
    expect(result?.action).toBe("run");
    if (result?.action === "run") {
      expect(result.plan.source.startsWith("export const workflow = {")).toBe(true);
    }
    expect(resolves).toBeGreaterThanOrEqual(2);
  });

  test("Space collects a free-text suggestion without running", () => {
    const state = dialog();
    state.component.focused = true;
    state.component.handleInput(" ");
    expect(state.component.render(100).join("\n")).toContain("Suggest a workflow revision");
    expect(state.component.render(100).join("\n")).toContain(CURSOR_MARKER);
    for (const character of "Add a parallel test researcher") state.component.handleInput(character);
    state.component.handleInput("\r");
    expect(state.result()).toEqual({ action: "suggest", suggestion: "Add a parallel test researcher" });
  });

  test("Escape returns from suggestions, then cancels confirmation", () => {
    const state = dialog();
    state.component.handleInput(" ");
    state.component.handleInput("\u001b");
    expect(state.completed()).toBe(false);
    expect(state.component.render(100).join("\n")).toContain("Confirm dynamic workflow");
    state.component.handleInput("\u001b");
    expect(state.result()).toEqual({ action: "cancel" });
  });

  test("resource errors disable Run while Suggest remains available", () => {
    const state = dialog(source, () => { throw new Error("unavailable model test/model"); });
    const rendered = state.component.render(100).join("\n");
    expect(rendered).toContain("Run is disabled");
    expect(rendered).toContain("unavailable model");
    state.component.handleInput("\r");
    expect(state.completed()).toBe(false);
    state.component.handleInput(" ");
    expect(state.component.render(100).join("\n")).toContain("Suggest a workflow revision");
  });

  test("invalid-source recovery keeps Editor IME focus and parses into confirmation", () => {
    const state = dialog("export const workflow = nope;");
    state.component.focused = true;
    const rendered = state.component.render(80).join("\n");
    expect(rendered).toContain("Raw source recovery");
    expect(rendered).toContain("static");
    expect(rendered).toContain(CURSOR_MARKER);
    state.component.focused = false;
    expect(state.component.render(80).join("\n")).not.toContain(CURSOR_MARKER);
  });
});
