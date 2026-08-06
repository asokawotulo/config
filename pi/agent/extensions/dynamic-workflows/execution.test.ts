import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import childHost from "./child-host.ts";
import {
  atomicWriteJson,
  childArtifactPaths,
  initializeChildArtifacts,
  lastAssistantSummary,
  listPermissionRequests,
  permissionResponsePath,
  readJson,
  workflowArtifactDirectory,
  writePermissionRequest,
  type PermissionResponse,
} from "./protocol.ts";
import { aggregateAgentUsage } from "./runner.ts";
import type { ResolvedAgentDefinition, RoleDefinition } from "./types.ts";
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
  permissions: { commands: { "*": "deny" } },
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

  test("keeps only the bounded last non-empty assistant summary", () => {
    const summary = lastAssistantSummary([
      { role: "assistant", content: [{ type: "text", text: "earlier conversation" }] },
      { role: "toolResult", content: [{ type: "text", text: "secret tool output" }] },
      { role: "assistant", content: [{ type: "text", text: "x".repeat(40_000) }] },
    ]);
    expect(summary).not.toContain("earlier conversation");
    expect(summary).not.toContain("secret tool output");
    expect(Buffer.byteLength(summary, "utf8")).toBeLessThanOrEqual(32 * 1024);
    expect(summary).toEndWith("[summary truncated]");
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
