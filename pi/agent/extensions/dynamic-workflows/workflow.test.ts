import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RoleDefinition } from "./types.ts";
import {
  CONTEXT_BUNDLE_SOFT_SCOPE,
  MAX_CONTEXT_BYTES_PER_AGENT,
  MAX_CONTEXT_FILE_BYTES,
  MAX_EXPANDED_PROMPT_BYTES,
  expandAgentOutputs,
  parseWorkflow,
  prepareAgentContextBundle,
  resolveWorkflow,
  workflowWaves,
} from "./workflow.ts";

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
    expect(parseWorkflow(source.replace('dependsOn: []', 'dependsOn: [], contextFiles: ["src/a.ts"]')).agents[0]?.contextFiles).toEqual(["src/a.ts"]);
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

  test("resolves bounded worktree context into a reusable soft-scope bundle", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dynamic-workflow-"));
    try {
      mkdirSync(join(cwd, "src"));
      writeFileSync(join(cwd, "src", "a.ts"), "export const a = 1;\n");
      const withContext = source.replace('dependsOn: []', 'dependsOn: [], contextFiles: ["src/a.ts"]');
      const resolved = resolveWorkflow(withContext, new Map([["reader", role]]), cwd);
      const bundle = resolved.agents[0]?.contextBundle;
      expect(bundle?.files.map((file) => ({ path: file.path, bytes: file.bytes }))).toEqual([{ path: "src/a.ts", bytes: 20 }]);
      expect(bundle?.text).toContain(CONTEXT_BUNDLE_SOFT_SCOPE);
      expect(bundle?.text).toContain("## Context file: src/a.ts");
      expect(bundle?.text).toContain("export const a = 1;");
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  test("rejects duplicate, outside, missing, non-regular, and oversized context", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dynamic-workflow-"));
    const outside = mkdtempSync(join(tmpdir(), "dynamic-workflow-outside-"));
    try {
      writeFileSync(join(cwd, "a.txt"), "a");
      mkdirSync(join(cwd, "directory"));
      writeFileSync(join(outside, "secret.txt"), "secret");
      symlinkSync(join(outside, "secret.txt"), join(cwd, "outside.txt"));
      expect(() => prepareAgentContextBundle(cwd, ["a.txt", "./a.txt"])).toThrow("Duplicate");
      expect(() => prepareAgentContextBundle(cwd, ["../secret.txt"])).toThrow("worktree");
      expect(() => prepareAgentContextBundle(cwd, ["outside.txt"])).toThrow("outside");
      expect(() => prepareAgentContextBundle(cwd, ["missing.txt"])).toThrow("missing");
      expect(() => prepareAgentContextBundle(cwd, ["directory"])).toThrow("regular");
      writeFileSync(join(cwd, "binary.txt"), Buffer.from([0xff, 0xfe]));
      expect(() => prepareAgentContextBundle(cwd, ["binary.txt"])).toThrow("UTF-8");
      writeFileSync(join(cwd, "nul.txt"), "a\u0000b");
      expect(() => prepareAgentContextBundle(cwd, ["nul.txt"])).toThrow("NUL");
      writeFileSync(join(cwd, "large.txt"), Buffer.alloc(MAX_CONTEXT_FILE_BYTES + 1));
      expect(() => prepareAgentContextBundle(cwd, ["large.txt"])).toThrow("exceeds");
      writeFileSync(join(cwd, "one.txt"), "x".repeat(90_000));
      writeFileSync(join(cwd, "two.txt"), "x".repeat(90_000));
      writeFileSync(join(cwd, "three.txt"), "x".repeat(90_000));
      expect(() => prepareAgentContextBundle(cwd, ["one.txt", "two.txt", "three.txt"])).toThrow("aggregate");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("rejects duplicate context paths during parsing", () => {
    const duplicate = source.replace('dependsOn: []', 'dependsOn: [], contextFiles: ["a.ts", "a.ts"]');
    expect(() => parseWorkflow(duplicate)).toThrow("duplicate path");
  });

  test("bounds expanded dependency summaries", () => {
    const summaries = new Map([["a", "x".repeat(MAX_EXPANDED_PROMPT_BYTES)]]);
    expect(() => expandAgentOutputs("{{agents.a.output}}{{agents.a.output}}", summaries)).toThrow("Expanded agent prompt");
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
