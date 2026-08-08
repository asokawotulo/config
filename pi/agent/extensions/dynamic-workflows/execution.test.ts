import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import childHost from "./child-host.ts";
import { finalizeRunForShutdown, mapLimit } from "./index.ts";
import { MAX_PARENT_RESULT_BYTES, parentResultText } from "./output.ts";
import { CoalescedProgress, type ProgressTimers } from "./progress.ts";
import {
  atomicWriteJson,
  childArtifactPaths,
  initializeChildArtifacts,
  listPermissionRequests,
  permissionResponsePath,
  readJson,
  workflowArtifactDirectory,
  writePermissionRequest,
  type PermissionResponse,
} from "./protocol.ts";
import { aggregateAgentUsage, updateAgentActivity } from "./runner.ts";
import { classifyAssistantSettlement } from "./settlement.ts";
import type { AgentRunRecord, ResolvedAgentDefinition, RoleDefinition, WorkflowRun } from "./types.ts";
import { usageFromSessionEntries } from "./usage.ts";
import {
  attachZmxSession,
  childPiArguments,
  collisionSafeZmxName,
  MAX_ZMX_SESSION_NAME_BYTES,
  resolveZmxExecutable,
  selectedExecutionBackend,
  startZmxChild,
} from "./zmx.ts";

const cleanup: string[] = [];
afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

const role: RoleDefinition = {
  name: "reader",
  description: "reader",
  model: "openai-codex/gpt-5.6-sol",
  thinking: "high",
  tools: ["read", "bash"],
  skills: [],
  prompt: "Read carefully",
  filePath: "/reader.md",
};
const agent: ResolvedAgentDefinition = {
  id: "reader",
  role: "reader",
  prompt: "inspect",
  dependsOn: [],
  resolvedRole: role,
  effectiveTools: ["read", "bash"],
  effectiveSkills: [],
};

describe("dynamic workflow execution protocol", () => {
  test("loads the isolated child-host extension without starting a child", () => {
    expect(typeof childHost).toBe("function");
  });

  test("atomically exchanges restrictive permission artifacts", () => {
    const runId = `wf_test_${Date.now()}`;
    const paths = childArtifactPaths(runId, "reader");
    cleanup.push(workflowArtifactDirectory(runId));
    initializeChildArtifacts(paths);
    const request = writePermissionRequest(paths, "git status");
    expect(listPermissionRequests(paths)).toEqual([request]);
    expect(statSync(paths.directory).mode & 0o777).toBe(0o700);
    expect(statSync(join(paths.requests, `${request.id}.json`)).mode & 0o777).toBe(0o600);

    const response: PermissionResponse = { version: 1, id: request.id, at: 2, command: "git status" };
    atomicWriteJson(permissionResponsePath(paths, request.id), response);
    expect(readJson<PermissionResponse>(permissionResponsePath(paths, request.id))).toEqual(response);
  });

  test("classifies successful, blank, missing, errored, and cancelled assistant settlement uniformly", () => {
    expect(classifyAssistantSettlement([
      { role: "assistant", content: [{ type: "text", text: "done" }] },
      { role: "toolResult", content: [{ type: "text", text: "ignored" }] },
    ])).toEqual({ ok: true, finalSummary: "done" });
    expect(classifyAssistantSettlement([
      { role: "assistant", content: [{ type: "text", text: "earlier" }] },
      { role: "assistant", content: [{ type: "text", text: "  " }] },
    ])).toMatchObject({ ok: false, finalSummary: "", error: "Agent produced no assistant summary" });
    expect(classifyAssistantSettlement([])).toMatchObject({ ok: false, error: "Agent produced no assistant response" });
    expect(classifyAssistantSettlement([
      { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "bad" },
    ])).toEqual({ ok: false, finalSummary: "partial", error: "bad" });
    expect(classifyAssistantSettlement([
      { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "aborted" },
    ])).toEqual({ ok: false, finalSummary: "partial", error: "Agent interrupted", cancelled: true });
    const bounded = classifyAssistantSettlement([
      { role: "assistant", content: [{ type: "text", text: "x".repeat(40_000) }] },
    ]);
    expect(Buffer.byteLength(bounded.finalSummary, "utf8")).toBeLessThanOrEqual(32 * 1024);
    expect(bounded.finalSummary).toEndWith("[summary truncated]");
  });

  test("deduplicates activity and coalesces transient progress around immediate transitions", () => {
    const record: AgentRunRecord = {
      id: "reader", role: "reader", prompt: "inspect", status: "running",
      model: "provider/model", tools: [], skills: [],
    };
    expect(updateAgentActivity(record, "Writing response")).toBe(true);
    expect(updateAgentActivity(record, "Writing response")).toBe(false);

    let commits = 0;
    let nextHandle = 0;
    const scheduled = new Map<number, () => void>();
    const timers: ProgressTimers = {
      set(callback) { const handle = ++nextHandle; scheduled.set(handle, callback); return handle; },
      clear(handle) { scheduled.delete(handle as number); },
    };
    const progress = new CoalescedProgress(() => commits++, 100, timers);
    progress.transient();
    progress.transient();
    progress.transient();
    expect(scheduled.size).toBe(1);
    const [handle, callback] = scheduled.entries().next().value!;
    scheduled.delete(handle);
    callback();
    expect(commits).toBe(1);
    progress.transient();
    progress.immediate();
    expect(commits).toBe(2);
    expect(scheduled.size).toBe(0);
    progress.transient();
    progress.cancel();
    expect(scheduled.size).toBe(0);
    expect(commits).toBe(2);
  });

  test("closes progress permanently and persists immediately cancelled terminal state on shutdown", () => {
    const callbacks: Array<() => void> = [];
    const timers: ProgressTimers = {
      set(callback) { callbacks.push(callback); return callbacks.length; },
      clear() {},
    };
    let progressCommits = 0;
    const progress = new CoalescedProgress(() => progressCommits++, 100, timers);
    const run: WorkflowRun = {
      runId: "wf_shutdown", sessionId: "session", name: "shutdown", cwd: "/project", status: "running",
      approvedSource: "source", waves: [], permissionDecisions: [], startedAt: 1,
      agents: [
        { id: "queued", role: "reader", prompt: "inspect", status: "queued", model: "p/m", tools: [], skills: [] },
        { id: "running", role: "reader", prompt: "inspect", status: "running", model: "p/m", tools: [], skills: [], startedAt: 2 },
      ],
    };

    const abort = new AbortController();
    abort.signal.addEventListener("abort", () => {
      progress.immediate();
      progress.transient();
    });
    const persisted: WorkflowRun[] = [];
    const published: WorkflowRun[] = [];

    progress.transient();
    finalizeRunForShutdown(
      { run, abort, closeProgress: () => progress.dispose() },
      (value) => persisted.push(structuredClone(value)),
      (value) => published.push(structuredClone(value)),
      3,
    );
    progress.immediate();
    progress.transient();
    callbacks[0]!();

    expect(progressCommits).toBe(0);
    expect(persisted).toHaveLength(1);
    expect(published).toEqual(persisted);
    expect(persisted[0]?.status).toBe("cancelled");
    expect(persisted[0]?.finishedAt).toBe(3);
    expect(persisted[0]?.agents.map((record) => record.status)).toEqual(["cancelled", "cancelled"]);
    expect(persisted[0]?.agents.map((record) => record.finishedAt)).toEqual([3, 3]);
  });

  test("formats multi-byte summaries fairly at the exact parent byte limit", () => {
    const run: WorkflowRun = {
      runId: "wf_output", sessionId: "session", name: "output", cwd: "/project", status: "completed",
      approvedSource: "source", waves: [], permissionDecisions: [], startedAt: 1,
      agents: Array.from({ length: 32 }, (_, index) => ({
        id: `agent-${index}`, role: "reader", prompt: "inspect", status: "completed" as const,
        model: "provider/model", tools: [], skills: [], finalSummary: `body-${index}:🙂漢字\n` + "x".repeat(20_000),
      })),
    };
    const output = parentResultText(run);
    expect(Buffer.byteLength(output, "utf8")).toBe(MAX_PARENT_RESULT_BYTES);
    expect(Buffer.from(output, "utf8").toString("utf8")).toBe(output);
    expect(output).not.toContain("\uFFFD");

    const sections = output.split(/\n\n(?=## agent-\d+ \[completed\]\n\n)/);
    const bodySizes = sections.map((section) => Buffer.byteLength(section.replace(/^## agent-\d+ \[completed\]\n\n/, ""), "utf8"));
    expect(Math.max(...bodySizes) - Math.min(...bodySizes)).toBeLessThanOrEqual(1);
    for (let index = 0; index < run.agents.length; index++) {
      expect(output).toContain(`## agent-${index} [completed]`);
      expect(output).toContain(`body-${index}:🙂漢字`);
    }
  });

  test("runs bounded orchestration without a model or zmx process", async () => {
    let active = 0;
    let maximum = 0;
    const visited: number[] = [];
    await mapLimit([0, 1, 2, 3, 4], 2, async (value) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, value % 2));
      visited.push(value);
      active--;
    });
    expect(maximum).toBe(2);
    expect(visited.sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 4]);
  });

  test("aggregates complete assistant and nested tool usage", () => {
    const first = {
      input: 10, output: 5, cacheRead: 3, cacheWrite: 2, totalTokens: 20,
      cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
    };
    const second = {
      input: 7, output: 6, cacheRead: 5, cacheWrite: 4, totalTokens: 22,
      cost: { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, total: 14 },
    };
    const usage = usageFromSessionEntries([
      { type: "message", message: { role: "assistant", usage: first } },
      { type: "message", message: { role: "toolResult", usage: second } },
    ]);
    expect(usage.totalTokens).toBe(42);
    expect(usage.cacheRead).toBe(8);
    expect(usage.cost.total).toBe(24);
    expect(aggregateAgentUsage([{ id: "a", role: "r", prompt: "p", status: "completed", model: "p/m", tools: [], skills: [], usage }])).toEqual(usage);
  });
});

describe("detached zmx backend", () => {
  test("resolves PATH before fallback and deterministically selects fallback", () => {
    const directory = mkdtempSync(join(tmpdir(), "fake-zmx-"));
    cleanup.push(directory);
    const fake = join(directory, "zmx");
    writeFileSync(fake, "#!/bin/sh\nexit 0\n");
    chmodSync(fake, 0o700);
    expect(resolveZmxExecutable({ PATH: [directory, "/missing"].join(delimiter) })).toBe(fake);
    expect(selectedExecutionBackend(fake)).toBe("zmx");
    expect(selectedExecutionBackend(undefined)).toBe("pi");
  });

  test("stops and restores Pi's TUI around attach, including failure", async () => {
    const lifecycle: string[] = [];
    const tui = {
      stop: () => lifecycle.push("stop"),
      start: () => lifecycle.push("start"),
      requestRender: (force?: boolean) => lifecycle.push(`render:${String(force)}`),
    } as any;
    const fakeSpawn = ((command: string, args: string[]) => {
      expect(command).toBe("/fake/zmx");
      expect(args).toEqual(["attach", "pi-test-agent"]);
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", 7));
      return child;
    }) as any;

    await expect(attachZmxSession(tui, "/fake/zmx", "pi-test-agent", fakeSpawn, () => {})).rejects.toThrow("status 7");
    expect(lifecycle).toEqual(["stop", "start", "render:true"]);
  });

  test("keeps randomized zmx session names within zmx's byte limit", () => {
    const name = collisionSafeZmxName(`wf_${"a".repeat(100)}`, `agent-${"b".repeat(100)}`);
    expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(MAX_ZMX_SESSION_NAME_BYTES);
    expect(name).toMatch(/^pi-[A-Za-z0-9_-]+-[a-f0-9]{12}$/);
  });

  test("starts a collision-safe detached interactive Pi command through fake zmx", async () => {
    const calls: Array<{ command: string; args: string[]; options: unknown }> = [];
    const name = collisionSafeZmxName("wf_test", "reader");
    await startZmxChild({
      zmxPath: "/fake/zmx",
      sessionName: name,
      configPath: "/private/config.json",
      agent,
      cwd: "/project",
      projectTrusted: true,
      invocation: { command: "/fake/pi", args: [] },
      execute: (async (command: string, args: readonly string[], options: unknown) => {
        calls.push({ command, args: [...args], options });
        return { stdout: "", stderr: "" };
      }) as any,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("/fake/zmx");
    expect(calls[0]?.args.slice(0, 3)).toEqual(["run", name, "-d"]);
    expect(calls[0]?.args).toContain("PI_DYNAMIC_WORKFLOW_CHILD_CONFIG=/private/config.json");
    expect(calls[0]?.args).toContain("/fake/pi");
    expect(calls[0]?.args).not.toContain("supacode");
    expect(childPiArguments(agent, true)).toContain("--extension");
    expect(childPiArguments(agent, true)).not.toContain("--print");
  });
});
