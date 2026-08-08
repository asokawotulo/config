import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { authorizeCommand, explainCommand, PermissionApprovalQueue } from "./permissions.ts";
import type { PermissionDecisionRecord } from "./types.ts";

function options(
  command: string,
  ctx: ExtensionContext,
  decisions: PermissionDecisionRecord[],
) {
  return {
    command,
    cwd: process.cwd(),
    agentId: "researcher",
    ctx,
    queue: new PermissionApprovalQueue(),
    record: (decision: PermissionDecisionRecord) => decisions.push(decision),
  };
}

describe("dynamic workflow permissions", () => {
  test("uses CC Safety Net structured verdicts", async () => {
    const safe = await explainCommand("git status && rg test .", process.cwd());
    expect(safe.result).toBe("allowed");
    const blocked = await explainCommand("git reset --hard", process.cwd());
    expect(blocked.result).toBe("blocked");
    expect(blocked.reason).toContain("destroys");
  });

  test("runs allowed commands without prompting", async () => {
    const decisions: PermissionDecisionRecord[] = [];
    const ctx = {
      hasUI: true,
      ui: { select: () => { throw new Error("allowed command unexpectedly prompted"); } },
    } as unknown as ExtensionContext;

    await expect(authorizeCommand(options("git status", ctx, decisions))).resolves.toEqual({ command: "git status" });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ source: "cc-safety-net", action: "allow", command: "git status" });
  });

  test("shows the Safety Net reason and honors allow once", async () => {
    const decisions: PermissionDecisionRecord[] = [];
    let prompt = "";
    const ctx = {
      hasUI: true,
      ui: {
        select: async (message: string) => { prompt = message; return "Allow once"; },
      },
    } as unknown as ExtensionContext;

    await expect(authorizeCommand(options("git reset --hard", ctx, decisions))).resolves.toEqual({ command: "git reset --hard" });
    expect(prompt).toContain("CC Safety Net blocked this command");
    expect(prompt).toContain("Reason:");
    expect(prompt).toContain("destroys");
    expect(decisions[0]).toMatchObject({ source: "cc-safety-net", action: "allow", overridden: true });
  });

  test("honors a user denial", async () => {
    const decisions: PermissionDecisionRecord[] = [];
    const ctx = {
      hasUI: true,
      ui: { select: async () => "Deny" },
    } as unknown as ExtensionContext;

    const verdict = await authorizeCommand(options("git reset --hard", ctx, decisions));
    expect(verdict.block).toContain("BLOCKED by CC Safety Net");
    expect(decisions[0]).toMatchObject({ source: "cc-safety-net", action: "deny" });
  });

  test("re-analyzes an edited command", async () => {
    const decisions: PermissionDecisionRecord[] = [];
    const ctx = {
      hasUI: true,
      ui: {
        select: async () => "Edit command",
        editor: async () => "git status",
      },
    } as unknown as ExtensionContext;

    await expect(authorizeCommand(options("git reset --hard", ctx, decisions))).resolves.toEqual({ command: "git status" });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ action: "allow", command: "git status" });
  });

  test.each([
    [undefined, "Command edit cancelled"],
    ["   ", "Command edit was blank"],
  ] as const)("logs cancelled or blank command edits as denials", async (edited, reason) => {
    const decisions: PermissionDecisionRecord[] = [];
    const ctx = {
      hasUI: true,
      ui: {
        select: async () => "Edit command",
        editor: async () => edited,
      },
    } as unknown as ExtensionContext;

    await expect(authorizeCommand(options("git reset --hard", ctx, decisions))).resolves.toEqual({ block: reason });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ action: "deny", command: "git reset --hard", reason });
  });

  test("fails closed when Safety Net analysis fails", async () => {
    const decisions: PermissionDecisionRecord[] = [];
    const ctx = { hasUI: false } as ExtensionContext;
    const verdict = await authorizeCommand({
      ...options("git status", ctx, decisions),
      cwd: `/missing-dynamic-workflow-${Date.now()}`,
    });

    expect(verdict.block).toContain("CC Safety Net analysis failed");
    expect(decisions[0]).toMatchObject({ source: "cc-safety-net", action: "deny" });
  });

  test("fails closed when a blocked command cannot be shown in a UI", async () => {
    const decisions: PermissionDecisionRecord[] = [];
    const ctx = { hasUI: false } as ExtensionContext;
    const verdict = await authorizeCommand(options("git reset --hard", ctx, decisions));

    expect(verdict.block).toContain("BLOCKED by CC Safety Net");
    expect(decisions[0]).toMatchObject({ source: "cc-safety-net", action: "deny" });
  });
});
