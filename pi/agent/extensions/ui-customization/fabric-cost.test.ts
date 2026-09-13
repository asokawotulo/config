import { describe, expect, test } from "bun:test";
import type { SessionEntry, Theme } from "@earendil-works/pi-coding-agent";
import { calculateSessionCosts } from "./session-cost.ts";
import { SidebarComponent, SIDEBAR_WIDTH } from "./sidebar.ts";
import type { SidebarMetadata } from "./metadata.ts";

const entry = (value: unknown) => value as SessionEntry;
const assistant = entry({
  type: "message",
  message: { role: "assistant", content: [], usage: { cost: { total: 1 } } },
});
const result = (cost: unknown) =>
  entry({
    type: "message",
    message: {
      role: "toolResult",
      toolName: "fabric_exec",
      usage: { cost },
      // Unrecognized detail shapes must not be interpreted as worker billing.
      details: {
        agents: [{ usage: { cost: 99 } }],
        trace: { usage: { cost: 99 } },
      },
    },
  });

describe("Fabric sidebar costs", () => {
  test("counts outer usage once and hides an unknown partition", () => {
    expect(calculateSessionCosts([assistant, result({ total: 2 })])).toEqual({
      total: 3,
      main: null,
      subagents: null,
    });
    expect(calculateSessionCosts([assistant, result(2)])).toEqual({
      total: 3,
      main: null,
      subagents: null,
    });
  });

  test("hides the partition from the first Fabric call, before settlement", () => {
    const pending = entry({
      type: "message",
      message: {
        role: "assistant",
        usage: { cost: 1 },
        content: [
          {
            type: "toolCall",
            id: "pending",
            name: "fabric_exec",
            arguments: {},
          },
        ],
      },
    });
    expect(calculateSessionCosts([pending])).toEqual({
      total: 1,
      main: null,
      subagents: null,
    });
  });

  test("ignores malformed usage and does not reuse stale Fabric session state", () => {
    for (const cost of [undefined, -1, NaN, Infinity, "2", { total: -1 }]) {
      expect(calculateSessionCosts([assistant, result(cost)]).total).toBe(1);
    }
    expect(calculateSessionCosts([assistant])).toEqual({
      total: 1,
      main: 1,
      subagents: 0,
    });
  });

  test("preserves legacy workflow totals in mixed sessions", () => {
    const legacy = entry({
      type: "message",
      message: {
        role: "toolResult",
        toolName: "dynamic_workflow",
        usage: { cost: 3 },
        details: { runId: "old" },
      },
    });
    expect(calculateSessionCosts([assistant, legacy, result(2)])).toEqual({
      total: 6,
      main: null,
      subagents: null,
    });
  });

  test("renders total without misleading Main/Subagents labels", () => {
    const metadata: SidebarMetadata = {
      directory: "fixture",
      branchWorktree: "main",
      sessionName: "Fabric",
      contextTokens: "1K",
      contextWindow: "100K",
      contextPercent: 1,
      latestCacheHitRate: null,
      cost: 3,
      mainCost: null,
      subagentCost: null,
      modelName: "fixture",
      thinkingLevel: "medium",
    };
    const theme = {
      bg: (_: string, text: string) => text,
      fg: (_: string, text: string) => text,
      bold: (text: string) => text,
    } as Theme;
    const text = new SidebarComponent(
      () => metadata,
      () => theme,
      () => 40,
    )
      .render(SIDEBAR_WIDTH)
      .join("\n");
    expect(text).toContain("Total $3.000");
    expect(text).not.toContain("Main $");
    expect(text).not.toContain("Subagents $");
  });
});
