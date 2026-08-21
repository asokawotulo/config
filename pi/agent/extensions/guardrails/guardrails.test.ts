import { describe, expect, test } from "bun:test";
import { createEventBus, type ExtensionAPI, type ExtensionContext, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { requestGuardrailsAuthorization, requestGuardrailsStatus } from "../../lib/guardrails-events.ts";
import { CliGuardrailAnalyzer, parseExplainResult, type GuardrailAnalysis, type GuardrailAnalyzer } from "./analyzer.ts";
import { parseGuardrailDecision } from "./audit.ts";
import { authorizeGuardrailCommand, GuardrailApprovalQueue } from "./authorization.ts";
import { registerGuardrailShellHook } from "./child.ts";
import { createGuardrailsExtension } from "./index.ts";
import { GuardrailDecisionViewer } from "./viewer.ts";
import type { GuardrailDecisionChain, GuardrailStatus } from "./types.ts";

class ScriptedAnalyzer implements GuardrailAnalyzer {
  constructor(private readonly results: Array<GuardrailAnalysis | Error>) {}
  async analyze(): Promise<GuardrailAnalysis> {
    const result = this.results.shift();
    if (!result) throw new Error("Missing scripted analysis");
    if (result instanceof Error) throw result;
    return result;
  }
  async status(): Promise<GuardrailStatus> {
    return { active: true, available: true, version: "test", binary: "/test/cc-safety-net" };
  }
}

function context(ui: Record<string, unknown>, hasUI = true): ExtensionContext {
  return {
    hasUI,
    cwd: process.cwd(),
    ui,
    sessionManager: { getSessionId: () => "session" },
  } as unknown as ExtensionContext;
}

function authorize(
  analyzer: GuardrailAnalyzer,
  ctx: ExtensionContext,
  records: GuardrailDecisionChain[],
  queue = new GuardrailApprovalQueue(),
) {
  return authorizeGuardrailCommand({
    analyzer,
    queue,
    command: "git reset --hard",
    cwd: process.cwd(),
    sessionId: "session",
    source: { kind: "main" },
    ctx,
    record: (record) => records.push(record),
  });
}

describe("Guardrails analyzer and authorization", () => {
  test("uses the pinned CC Safety Net 2 structured verdict", async () => {
    const analyzer = new CliGuardrailAnalyzer();
    await expect(analyzer.analyze("git status", process.cwd())).resolves.toMatchObject({ result: "allowed" });
    await expect(analyzer.analyze("git reset --hard", process.cwd())).resolves.toMatchObject({
      result: "blocked",
      ruleId: "git.reset-hard",
      segment: "git reset --hard",
    });
    await expect(analyzer.status(process.cwd())).resolves.toMatchObject({ available: true, version: "2.0.8" });
  });

  test("rejects malformed, invalid, and misconfigured analyzer output", () => {
    expect(() => parseExplainResult("not json")).toThrow("malformed JSON");
    expect(() => parseExplainResult(JSON.stringify({ result: "maybe", configValid: true }))).toThrow("invalid verdict");
    expect(() => parseExplainResult(JSON.stringify({ result: "allowed", configValid: false }))).toThrow("configuration is invalid");
    expect(() => parseExplainResult(JSON.stringify({ result: "blocked", reason: 42 }))).toThrow("invalid reason");
  });

  test("does not retain clean automatic allows", async () => {
    const records: GuardrailDecisionChain[] = [];
    const result = await authorize(
      new ScriptedAnalyzer([{ result: "allowed" }]),
      context({ select: () => { throw new Error("unexpected prompt"); } }),
      records,
    );
    expect(result).toEqual({ command: "git reset --hard" });
    expect(records).toEqual([]);
  });

  test("retains allow-once, denial, no-UI, and analysis failure outcomes", async () => {
    const allowed: GuardrailDecisionChain[] = [];
    await expect(authorize(
      new ScriptedAnalyzer([{ result: "blocked", reason: "danger", ruleId: "rule", segment: "reset" }]),
      context({ select: async () => "Allow once" }),
      allowed,
    )).resolves.toEqual({ command: "git reset --hard" });
    expect(allowed[0]).toMatchObject({ outcome: "allowed-once", reason: "danger" });

    const denied: GuardrailDecisionChain[] = [];
    await authorize(
      new ScriptedAnalyzer([{ result: "blocked", reason: "danger" }]),
      context({ select: async () => "Deny" }),
      denied,
    );
    expect(denied[0]).toMatchObject({ outcome: "denied" });

    const headless: GuardrailDecisionChain[] = [];
    const headlessResult = await authorize(
      new ScriptedAnalyzer([{ result: "blocked", reason: "danger" }]),
      context({}, false),
      headless,
    );
    expect(headlessResult.block).toContain("no approval UI");
    expect(headless[0]?.outcome).toBe("denied");

    const failed: GuardrailDecisionChain[] = [];
    const failedResult = await authorize(new ScriptedAnalyzer([new Error("broken")]), context({}), failed);
    expect(failedResult.block).toContain("analysis failed");
    expect(failed[0]?.outcome).toBe("failed");
  });

  test.each([
    [undefined, "cancel-edit", "Command edit cancelled"],
    ["   ", "blank-edit", "Command edit was blank"],
  ] as const)("fails closed when an edit is cancelled or blank", async (edited, action, reason) => {
    const records: GuardrailDecisionChain[] = [];
    const result = await authorize(
      new ScriptedAnalyzer([{ result: "blocked", reason: "danger" }]),
      context({ select: async () => "Edit command", editor: async () => edited }),
      records,
    );
    expect(result).toEqual({ block: reason });
    expect(records[0]).toMatchObject({ outcome: "denied", reason });
    expect(records[0]?.steps.at(-1)).toMatchObject({ kind: "user", action });
  });

  test("retains the full chain when an edited command becomes allowed", async () => {
    const records: GuardrailDecisionChain[] = [];
    const result = await authorize(
      new ScriptedAnalyzer([
        { result: "blocked", reason: "danger", ruleId: "git.reset-hard", segment: "git reset --hard" },
        { result: "allowed" },
      ]),
      context({ select: async () => "Edit command", editor: async () => "git status" }),
      records,
    );
    expect(result).toEqual({ command: "git status" });
    expect(records[0]).toMatchObject({ outcome: "edited-allowed", finalCommand: "git status" });
    expect(records[0]?.steps.map((step) => step.kind === "analysis" ? `${step.kind}:${step.result}` : `${step.kind}:${step.action}`)).toEqual([
      "analysis:blocked", "user:edit", "analysis:allowed",
    ]);
    expect(parseGuardrailDecision(records[0])).toEqual(records[0]);
  });

  test("serializes complete blocked interactions", async () => {
    const queue = new GuardrailApprovalQueue();
    const records: GuardrailDecisionChain[] = [];
    const resolvers: Array<(value: string) => void> = [];
    let prompts = 0;
    const ctx = context({
      select: () => {
        prompts++;
        return new Promise<string>((resolve) => resolvers.push(resolve));
      },
    });
    const first = authorize(new ScriptedAnalyzer([{ result: "blocked", reason: "one" }]), ctx, records, queue);
    const second = authorize(new ScriptedAnalyzer([{ result: "blocked", reason: "two" }]), ctx, records, queue);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(prompts).toBe(1);
    resolvers.shift()!("Deny");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(prompts).toBe(2);
    resolvers.shift()!("Deny");
    await Promise.all([first, second]);
  });
});

describe("Guardrails decision viewer", () => {
  test("renders bounded read-only content and closes without an editor", () => {
    let renders = 0;
    let closed = false;
    const tui = { terminal: { rows: 16 }, requestRender: () => { renders++; } } as unknown as TUI;
    const passthrough = (value: string) => value;
    const theme = {
      fg: (_color: string, value: string) => value,
      bg: (_color: string, value: string) => value,
      bold: passthrough,
    } as unknown as Theme;
    const viewer = new GuardrailDecisionViewer(
      tui,
      theme,
      {} as KeybindingsManager,
      Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n"),
      () => { closed = true; },
    );
    const lines = viewer.render(60);
    expect(lines.every((line) => visibleWidth(line) <= 60)).toBe(true);
    expect(lines.join("\n")).toContain("↓ more details");
    viewer.handleInput("\x1b[B");
    expect(renders).toBe(1);
    viewer.handleInput("\r");
    expect(closed).toBe(true);
  });
});

describe("Guardrails hooks and extension service", () => {
  test("guards only bash and Shell and applies edited commands", async () => {
    let handler: any;
    const pi = { on(name: string, value: unknown) { if (name === "tool_call") handler = value; } } as unknown as ExtensionAPI;
    registerGuardrailShellHook(pi, async () => ({ command: "git status" }));
    const ctx = context({});
    const bash = { toolName: "bash", input: { command: "old" } };
    await handler(bash, ctx);
    expect(bash.input.command).toBe("git status");
    const shell = { toolName: "Shell", input: { command: "old" } };
    await handler(shell, ctx);
    expect(shell.input.command).toBe("git status");
    await expect(handler({ toolName: "other", input: { command: "old" } }, ctx)).resolves.toBeUndefined();
    await expect(handler({ toolName: "bash", input: {} }, ctx)).resolves.toMatchObject({ block: true });
  });

  test("fails closed without a service responder", async () => {
    const pi = { events: createEventBus() } as unknown as ExtensionAPI;
    expect(requestGuardrailsStatus(pi)).toBeUndefined();
    await expect(requestGuardrailsAuthorization(pi, {
      command: "git status", cwd: process.cwd(), sessionId: "session", source: { kind: "main" },
    })).resolves.toEqual({ block: "Guardrails is unavailable" });
  });

  test("publishes retained decisions and exposes status", async () => {
    const events = createEventBus();
    const handlers = new Map<string, Function>();
    const commands = new Map<string, any>();
    const entries: Array<{ customType: string; data: unknown }> = [];
    const pi = {
      events,
      on(name: string, handler: Function) { handlers.set(name, handler); },
      registerCommand(name: string, command: unknown) { commands.set(name, command); },
      appendEntry(customType: string, data: unknown) { entries.push({ customType, data }); },
    } as unknown as ExtensionAPI;
    createGuardrailsExtension({
      analyzer: new ScriptedAnalyzer([{ result: "blocked", reason: "danger" }]),
    })(pi);
    const ctx = context({ select: async () => "Deny" });
    await handlers.get("session_start")!({ reason: "startup" }, ctx);
    expect(requestGuardrailsStatus(pi)).toMatchObject({ available: true, version: "test" });
    await requestGuardrailsAuthorization(pi, {
      command: "git reset --hard",
      cwd: process.cwd(),
      sessionId: "session",
      source: { kind: "dynamic-workflow", runId: "wf_test", agentId: "agent" },
    });
    expect(entries).toHaveLength(1);
    expect(parseGuardrailDecision(entries[0]?.data)).toMatchObject({ outcome: "denied" });
    const command = commands.get("guardrails");
    expect(command).toBeDefined();
    let opened = "";
    const commandCtx = {
      mode: "rpc",
      hasUI: true,
      ui: {
        select: async (_title: string, labels: string[]) => labels[0],
        notify: (content: string) => { opened = content; },
      },
      sessionManager: {
        getEntries: () => entries.map((entry, index) => ({
          type: "custom", id: String(index), parentId: null, timestamp: "", ...entry,
        })),
      },
    } as unknown as ExtensionContext;
    await command.handler("", commandCtx);
    expect(opened).toContain("Decision chain:");
    expect(opened).toContain("git reset --hard");
  });
});
