import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import dynamicWorkflows from "./index.ts";

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
});
