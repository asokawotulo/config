import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  SessionEntry,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  calculateSessionCost,
  formatDirectory,
  formatTokenCount,
  resolveGitMetadata,
  type SidebarMetadata,
} from "./metadata.ts";
import { SidebarComponent } from "./sidebar.ts";

function entry(value: unknown): SessionEntry {
  return value as SessionEntry;
}

function usage(cost: number) {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  };
}

describe("sidebar metadata", () => {
  test("counts assistant, tool, compaction, and branch-summary cost", () => {
    const entries = [
      entry({ type: "message", message: { role: "assistant", usage: usage(1) } }),
      entry({ type: "message", message: { role: "toolResult", usage: usage(2) } }),
      entry({ type: "compaction", usage: usage(3) }),
      entry({ type: "branch_summary", usage: usage(4) }),
    ];

    expect(calculateSessionCost(entries)).toBe(10);
  });

  test("formats context tokens and home-relative directories", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(272_000)).toBe("272K");
    expect(formatTokenCount(null)).toBe("?");
    expect(formatDirectory("/Users/test/project", "/Users/test")).toBe("~/project");
  });

  test("formats linked worktrees as branch/worktree", async () => {
    const pi = {
      exec: async () => ({
        code: 0,
        stdout:
          "/repo/worktrees/feature\n/repo/.git/worktrees/feature\n/repo/.git\nfeature/login\n",
        stderr: "",
        killed: false,
      }),
    } as unknown as ExtensionAPI;

    await expect(resolveGitMetadata(pi, "/repo/worktrees/feature")).resolves.toEqual({
      branchWorktree: "feature/login/feature",
    });
  });
});

describe("SidebarComponent", () => {
  test("renders context cost and respects width", () => {
    const metadata: SidebarMetadata = {
      directory: "~/config",
      branchWorktree: "main",
      sessionName: "UI customization",
      contextTokens: "0",
      contextWindow: "272K",
      contextPercent: "0.00%",
      cost: 1.2345,
      modelName: "gpt-5.6-sol",
      thinkingLevel: "medium",
    };
    const identity = (text: string) => text;
    const theme = {
      fg: (_color: string, text: string) => text,
      bg: (_color: string, text: string) => text,
      bold: identity,
    } as unknown as Theme;
    const sidebar = new SidebarComponent(() => metadata, () => theme);
    const lines = sidebar.render(30, 20);

    expect(lines.join("\n")).toContain("$1.234");
    expect(lines.every((line) => visibleWidth(line) <= 30)).toBe(true);
  });
});
