import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import type { RoleDefinition } from "../types.ts";
import { resolveWorkflow } from "../workflow.ts";
import { WorkflowDialogComponent } from "./dialog.ts";
import { layoutDialogColumns, WIDE_DIALOG_WIDTH } from "./render.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const tui = {
  requestRender() {},
  terminal: { rows: 30 },
} as unknown as TUI;

const role: RoleDefinition = {
  name: "reader",
  description: "Reads safely",
  model: "test/model",
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
    { id: "first", role: "reader", prompt: "Inspect", dependsOn: [], contextFiles: ["src/first.ts"] },
    { id: "second", role: "reader", prompt: "Use {{agents.first.output}}", dependsOn: ["first"], tools: ["read"], skills: [] }
  ]
};`;

function dialog(
  input = source,
  resolveSource: (value: string) => ReturnType<typeof resolveWorkflow> = (value) => resolveWorkflow(value, roles),
) {
  let result: ReturnType<typeof resolveWorkflow> | undefined;
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

describe("workflow approval dialog", () => {
  test("uses wide columns and a narrow stacked layout within the viewport", () => {
    const left = ["LEFT", "agent"];
    const right = ["RIGHT", "field"];
    expect(layoutDialogColumns(left, right, WIDE_DIALOG_WIDTH).some((line) => line.includes("LEFT") && line.includes("RIGHT"))).toBe(true);
    const narrow = layoutDialogColumns(left, right, 40);
    expect(narrow.findIndex((line) => line.includes("RIGHT"))).toBeGreaterThan(narrow.findIndex((line) => line.includes("agent")));

    for (const width of [42, 120]) {
      const lines = dialog().component.render(width);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(lines.join("\n")).toContain("review me");
      expect(lines.join("\n")).toContain("first · reader");
    }
  });

  test("offers multiline approval editing for per-agent context paths", () => {
    const state = dialog();
    state.component.handleInput("\t");
    for (let index = 0; index < 3; index++) state.component.handleInput("\u001b[B");
    expect(state.component.render(120).join("\n")).toContain("Context files: src/first.ts");
    state.component.handleInput("\r");
    expect(state.component.render(120).join("\n")).toContain("one worktree-relative path per line");
  });

  test("keeps large forms within the terminal viewport", () => {
    const manyAgents = `export const workflow = { name: "large", agents: [${Array.from(
      { length: 12 },
      (_, index) => `{ id: "a${index}", role: "reader", prompt: "Inspect ${index}", dependsOn: [] }`,
    ).join(",")}] };`;
    const state = dialog(manyAgents);
    state.component.handleInput("\t");
    for (let index = 0; index < 20; index++) state.component.handleInput("\u001b[B");
    const lines = state.component.render(120);

    expect(lines.length).toBeLessThanOrEqual(30);
    expect(lines.join("\n")).toContain("more fields");
    expect(lines.every((line) => visibleWidth(line) <= 120)).toBe(true);
  });

  test("valid source opens in the form and final review approves canonical re-resolution", () => {
    let resolves = 0;
    const state = dialog(source, (value) => { resolves++; return resolveWorkflow(value, roles); });
    expect(state.component.render(120).join("\n")).toContain("Workflow metadata");
    state.component.handleInput("\t");
    expect(state.component.render(120).join("\n")).toContain("Agent definition");
    state.component.handleInput("\t");
    const review = state.component.render(120).join("\n");
    expect(review).toContain("Waves: 1[first] → 2[second]");
    expect(review).toContain("approved context: src/first.ts");
    expect(review).toContain("16 files / 262144 aggregate bytes");
    expect(review).toContain("command safety: Bash/Shell commands are inspected by CC Safety Net");
    expect(review).toContain("blocked commands require an explicit parent-user decision");
    expect(review).not.toContain("Command overrides");
    state.component.handleInput("\r");
    expect(state.completed()).toBe(true);
    expect(state.result()?.source.startsWith("export const workflow = {")).toBe(true);
    expect(resolves).toBeGreaterThanOrEqual(2);
  });

  test("resource errors disable approval", () => {
    const state = dialog(source, () => { throw new Error("unavailable model test/model"); });
    state.component.handleInput("\t");
    state.component.handleInput("\t");
    expect(state.component.render(100).join("\n")).toContain("Approval disabled");
    expect(state.component.render(100).join("\n")).toContain("unavailable model");
    state.component.handleInput("\r");
    expect(state.completed()).toBe(false);
  });

  test("raw source is an explicit escape hatch and invalid-source recovery keeps Editor IME focus", () => {
    const valid = dialog();
    valid.component.handleInput("r");
    expect(valid.component.render(80).join("\n")).toContain("Raw source escape hatch");

    const invalid = dialog("export const workflow = nope;");
    invalid.component.focused = true;
    const rendered = invalid.component.render(80).join("\n");
    expect(rendered).toContain("Raw source recovery");
    expect(rendered).toContain("static");
    expect(rendered).toContain(CURSOR_MARKER);
    invalid.component.focused = false;
    expect(invalid.component.render(80).join("\n")).not.toContain(CURSOR_MARKER);
    invalid.component.focused = true;
    expect(invalid.component.render(80).join("\n")).toContain(CURSOR_MARKER);
    invalid.component.handleInput("\u001b");
    expect(invalid.completed()).toBe(true);
  });
});
