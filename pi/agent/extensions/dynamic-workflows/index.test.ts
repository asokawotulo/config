import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import dynamicWorkflows, { validateResources } from "./index.ts";
import type { ResolvedWorkflow } from "./types.ts";

function registeredTool() {
  let tool: any;
  const pi = {
    events: { on() {}, emit() {} },
    on() {},
    registerCommand() {},
    registerTool(definition: unknown) { tool = definition; },
    getAllTools() { return []; },
  } as unknown as ExtensionAPI;
  dynamicWorkflows(pi);
  return tool;
}

function plan(tools: string[]): ResolvedWorkflow {
  return {
    source: "source",
    definition: { name: "test", agents: [] },
    waves: [["agent"]],
    agents: [{
      id: "agent", role: "reader", prompt: "inspect", dependsOn: [],
      effectiveTools: tools, effectiveSkills: [],
      resolvedRole: {
        name: "reader", description: "reader", model: "provider/model",
        tools, skills: [], prompt: "read", filePath: "/reader.md",
      },
    }],
  };
}

function validationContext(): ExtensionContext {
  return {
    modelRegistry: { find: () => ({}) },
  } as unknown as ExtensionContext;
}

describe("dynamic_workflow tool", () => {
  test("returns proposal validation failures to the model before confirmation", async () => {
    let uiOpened = false;
    const ctx = {
      mode: "tui",
      cwd: process.cwd(),
      ui: { custom() { uiOpened = true; } },
      modelRegistry: { find() { return undefined; } },
    } as unknown as ExtensionContext;

    await expect(registeredTool().execute(
      "call",
      { script: "export const workflow = nope;" },
      undefined,
      undefined,
      ctx,
    )).rejects.toThrow("Dynamic workflow validation failed");
    expect(uiOpened).toBe(false);
  });

  test("requires available Guardrails only for shell-capable agents", () => {
    const unavailable = {
      getAllTools: () => [{ name: "read" }, { name: "bash" }],
      events: { on() {}, emit() {} },
    } as unknown as ExtensionAPI;
    expect(() => validateResources(plan(["read"]), unavailable, validationContext())).not.toThrow();
    expect(() => validateResources(plan(["bash"]), unavailable, validationContext())).toThrow("requires the Guardrails extension");

    const available = {
      getAllTools: () => [{ name: "bash" }],
      events: {
        on() {},
        emit(channel: string, data: any) {
          if (channel === "guardrails:status-request") data.accept({ active: true, available: true, binary: "/cc" });
        },
      },
    } as unknown as ExtensionAPI;
    expect(() => validateResources(plan(["bash"]), available, validationContext())).not.toThrow();
  });
});
