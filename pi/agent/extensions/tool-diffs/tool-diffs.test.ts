import { afterEach, describe, expect, test } from "bun:test";
import {
  createEditToolDefinition,
  createWriteToolDefinition,
  initTheme,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ToolExecutionComponent } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import toolDiffsExtension from "./index.ts";
import { ToolDiffComponent, type WriteDiffDetails } from "./render.ts";

const temporaryDirectories: string[] = [];
const identity = (text: string) => text;
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: identity,
  italic: identity,
  strikethrough: identity,
  underline: identity,
  getFgAnsi: (color: string) =>
    color === "toolDiffAddedBg" ? "\x1b[38;2;31;48;29m" : "\x1b[38;2;53;28;36m",
  getBgAnsi: (color: string) =>
    color === "toolSuccessBg" ? "\x1b[48;5;22m" : "\x1b[48;5;52m",
} as unknown as Theme;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function loadTools(_cwd: string): Promise<Map<string, any>> {
  const tools = new Map<string, any>();
  toolDiffsExtension({
    on() {},
    registerTool(tool: { name: string }) {
      tools.set(tool.name, tool);
    },
  } as never);
  return tools;
}

async function makeTemporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "pi-tool-diffs-"));
  temporaryDirectories.push(path);
  return path;
}

const replacedToolSlots = new Set(["execute", "renderCall", "renderResult"]);

function expectBuiltInOverrideContract(override: any, builtIn: any): void {
  expect(Object.keys(override).sort()).toEqual(Object.keys(builtIn).sort());
  expect(override.parameters).toBe(builtIn.parameters);
  expect(override.prepareArguments).toBe(builtIn.prepareArguments);
  expect(override.promptSnippet).toBe(builtIn.promptSnippet);
  expect(override.promptGuidelines).toEqual(builtIn.promptGuidelines);
  expect(override.renderShell).toBe(builtIn.renderShell);

  for (const key of Object.keys(builtIn)) {
    if (!replacedToolSlots.has(key)) expect(override[key]).toEqual(builtIn[key]);
  }
  for (const slot of replacedToolSlots) {
    expect(typeof override[slot]).toBe("function");
    expect(override[slot].toString()).not.toBe(builtIn[slot].toString());
  }
}

function renderAtBoundedWidths(component: ToolExecutionComponent): Map<number, string[]> {
  const rendered = new Map<number, string[]>();
  for (const width of [100, 220]) {
    const lines = component.render(width);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    rendered.set(width, lines.map(stripAnsi));
  }
  return rendered;
}

describe("tool diff rendering", () => {
  test("keeps the two most recently used widths and clears them on invalidation", () => {
    let foregroundCalls = 0;
    const countingTheme = {
      ...theme,
      fg: (_color: string, text: string) => {
        foregroundCalls++;
        return text;
      },
    } as Theme;
    const component = new ToolDiffComponent(
      "--- example.ts\n+++ example.ts\n@@ -1,1 +1,1 @@\n-const value = 'old';\n+const value = 'new';\n",
      "example.ts",
      countingTheme,
    );

    const wide = component.render(100);
    const callsAfterWideRender = foregroundCalls;
    expect(wide.some((line) => line.includes("Before") && line.includes("After"))).toBe(true);

    const narrow = component.render(60);
    const callsAfterNarrowRender = foregroundCalls;
    expect(callsAfterNarrowRender).toBeGreaterThan(callsAfterWideRender);
    expect(narrow.some((line) => line.includes("Before"))).toBe(false);
    expect(narrow.some((line) => line.includes("const value"))).toBe(true);

    expect(component.render(100)).toBe(wide);
    expect(component.render(60)).toBe(narrow);
    expect(component.render(100)).toBe(wide);
    expect(foregroundCalls).toBe(callsAfterNarrowRender);

    const thirdWidth = component.render(80);
    const callsAfterThirdWidth = foregroundCalls;
    expect(callsAfterThirdWidth).toBeGreaterThan(callsAfterNarrowRender);
    expect(thirdWidth).not.toBe(wide);
    expect(thirdWidth).not.toBe(narrow);

    expect(component.render(100)).toBe(wide);
    expect(foregroundCalls).toBe(callsAfterThirdWidth);

    const evictedNarrow = component.render(60);
    const callsAfterEvictedNarrow = foregroundCalls;
    expect(callsAfterEvictedNarrow).toBeGreaterThan(callsAfterThirdWidth);
    expect(evictedNarrow).not.toBe(narrow);
    expect(evictedNarrow).toEqual(narrow);

    component.invalidate();
    const invalidatedWide = component.render(100);
    const callsAfterInvalidatedWide = foregroundCalls;
    expect(callsAfterInvalidatedWide).toBeGreaterThan(callsAfterEvictedNarrow);
    expect(invalidatedWide).not.toBe(wide);
    expect(invalidatedWide).toEqual(wide);

    const invalidatedNarrow = component.render(60);
    const callsAfterInvalidatedNarrow = foregroundCalls;
    expect(callsAfterInvalidatedNarrow).toBeGreaterThan(callsAfterInvalidatedWide);
    expect(invalidatedNarrow).not.toBe(evictedNarrow);
    expect(invalidatedNarrow).toEqual(narrow);
    expect(component.render(100)).toBe(invalidatedWide);
    expect(component.render(60)).toBe(invalidatedNarrow);
    expect(foregroundCalls).toBe(callsAfterInvalidatedNarrow);
  });
});

describe("tool diff overrides", () => {
  test("registers during extension loading so reload replay can resolve the renderers", () => {
    const tools: Array<{ name: string }> = [];
    toolDiffsExtension({
      on() {},
      registerTool(tool: { name: string }) {
        tools.push(tool);
      },
    } as never);

    expect(tools.map((tool) => tool.name)).toEqual(["edit", "write"]);
  });

  test("retains the Pi 0.84.2 built-in contracts outside execution and rendering", async () => {
    const cwd = await makeTemporaryDirectory();
    const tools = await loadTools(cwd);

    expectBuiltInOverrideContract(tools.get("edit"), createEditToolDefinition(process.cwd()));
    expectBuiltInOverrideContract(tools.get("write"), createWriteToolDefinition(process.cwd()));
  });

  test("delegates edit execution and renders its persisted patch side by side", async () => {
    const cwd = await makeTemporaryDirectory();
    const path = join(cwd, "example");
    await writeFile(path, "const value = 'old';\n", "utf8");
    const edit = (await loadTools(cwd)).get("edit");

    const result = await edit.execute(
      "edit-1",
      { path: "example", edits: [{ oldText: "'old'", newText: "'new'" }] },
      undefined,
      undefined,
      { cwd },
    );
    expect(await readFile(path, "utf8")).toBe("const value = 'new';\n");
    expect(result.details.patch).toContain("-const value = 'old';");

    const component = edit.renderResult(
      result,
      { expanded: false, isPartial: false },
      theme,
      { args: { path: "example" }, isError: false },
    );
    expect(component.render(100).some((line: string) => line.includes("Before") && line.includes("After"))).toBe(true);
    const narrowLines = component.render(60);
    expect(narrowLines.some((line: string) => line.includes("Before"))).toBe(false);
    expect(narrowLines.some((line: string) => line.includes("const value"))).toBe(true);
  });

  test("Pi's historical replay component uses the edit override", async () => {
    initTheme("dark", false);
    const cwd = await makeTemporaryDirectory();
    const edit = (await loadTools(cwd)).get("edit");
    const args = {
      path: "past.ts",
      edits: [{ oldText: "const value = 'old';", newText: "const value = 'new';" }],
    };
    const component = new ToolExecutionComponent(
      "edit",
      "past-edit",
      args,
      {},
      edit,
      { requestRender() {} } as never,
      cwd,
    );
    component.setArgsComplete();
    component.updateResult({
      content: [{ type: "text", text: "Successfully replaced 1 block(s) in past.ts." }],
      details: {
        patch:
          "--- past.ts\n+++ past.ts\n@@ -1,1 +1,1 @@\n-const value = 'old';\n+const value = 'new';\n",
      },
      isError: false,
    });

    const lines = renderAtBoundedWidths(component).get(100)!;
    expect(lines.some((line) => line.includes("Before") && line.includes("After"))).toBe(true);
    expect(lines.some((line) => line.includes("1 - │ const value = 'old';"))).toBe(true);
    expect(lines.some((line) => line.includes("1 + │ const value = 'new';"))).toBe(true);
  });

  test("Pi's historical replay component uses persisted write diff details", async () => {
    initTheme("dark", false);
    const cwd = await makeTemporaryDirectory();
    const write = (await loadTools(cwd)).get("write");
    const args = { path: "past.ts", content: "const value = 'new';\n" };
    const component = new ToolExecutionComponent(
      "write",
      "past-write",
      args,
      {},
      write,
      { requestRender() {} } as never,
      cwd,
    );
    component.setArgsComplete();
    component.updateResult({
      content: [{ type: "text", text: "Successfully wrote 21 bytes to past.ts" }],
      details: {
        kind: "diff",
        path: "past.ts",
        patch:
          "--- past.ts\n+++ past.ts\n@@ -1,1 +1,1 @@\n-const value = 'old';\n+const value = 'new';\n",
        created: false,
      } satisfies WriteDiffDetails,
      isError: false,
    });

    const lines = renderAtBoundedWidths(component).get(100)!;
    expect(lines.some((line) => line.includes("Before") && line.includes("After"))).toBe(true);
    expect(lines.some((line) => line.includes("1 - │ const value = 'old';"))).toBe(true);
    expect(lines.some((line) => line.includes("1 + │ const value = 'new';"))).toBe(true);
  });

  test("captures overwrite content inside delegated write execution", async () => {
    const cwd = await makeTemporaryDirectory();
    const path = join(cwd, "example");
    await writeFile(path, "before\n", "utf8");
    const write = (await loadTools(cwd)).get("write");

    const result = await write.execute(
      "write-1",
      { path: "example", content: "after\n" },
      undefined,
      undefined,
      { cwd },
    );
    const details = result.details as WriteDiffDetails;
    expect(await readFile(path, "utf8")).toBe("after\n");
    expect(details.kind).toBe("diff");
    if (details.kind === "diff") {
      expect(details.created).toBe(false);
      expect(details.patch).toContain("-before");
      expect(details.patch).toContain("+after");
    }
  });

  test("serializes snapshots with parallel writes to the same file", async () => {
    const cwd = await makeTemporaryDirectory();
    await writeFile(join(cwd, "shared"), "zero\n", "utf8");
    const write = (await loadTools(cwd)).get("write");

    const results = await Promise.all([
      write.execute("write-a", { path: "shared", content: "one\n" }, undefined, undefined, { cwd }),
      write.execute("write-b", { path: "shared", content: "two\n" }, undefined, undefined, { cwd }),
    ]);
    const patches = results.map((result) => (result.details as WriteDiffDetails & { patch: string }).patch);

    expect(patches.filter((patch) => patch.includes("-zero")).length).toBe(1);
    expect(patches.some((patch) => patch.includes("-one") || patch.includes("-two"))).toBe(true);
  });

  test("distinguishes new, empty, and unchanged writes", async () => {
    const cwd = await makeTemporaryDirectory();
    const write = (await loadTools(cwd)).get("write");

    const created = await write.execute(
      "write-new",
      { path: "new-file", content: "created\n" },
      undefined,
      undefined,
      { cwd },
    );
    expect(created.details).toMatchObject({ kind: "diff", created: true });

    const empty = await write.execute(
      "write-empty",
      { path: "empty-file", content: "" },
      undefined,
      undefined,
      { cwd },
    );
    expect(empty.details).toEqual({ kind: "no-change", path: "empty-file", created: true });

    const unchanged = await write.execute(
      "write-same",
      { path: "new-file", content: "created\n" },
      undefined,
      undefined,
      { cwd },
    );
    expect(unchanged.details).toEqual({ kind: "no-change", path: "new-file", created: false });
  });
});
