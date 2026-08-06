import type { Usage } from "@earendil-works/pi-ai";
import type { AgentRunUsage } from "./types.ts";

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isCompleteUsage(value: unknown): value is Usage {
  if (!value || typeof value !== "object") return false;
  const usage = value as Partial<Usage>;
  const cost = usage.cost as Partial<Usage["cost"]> | undefined;
  return finiteNonNegative(usage.input) && finiteNonNegative(usage.output) &&
    finiteNonNegative(usage.cacheRead) && finiteNonNegative(usage.cacheWrite) &&
    finiteNonNegative(usage.totalTokens) && !!cost &&
    finiteNonNegative(cost.input) && finiteNonNegative(cost.output) &&
    finiteNonNegative(cost.cacheRead) && finiteNonNegative(cost.cacheWrite) &&
    finiteNonNegative(cost.total);
}

export function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function addUsage(target: Usage, value: AgentRunUsage | undefined): Usage {
  if (!value) return target;
  target.input += value.input || 0;
  target.output += value.output || 0;
  if ("cacheRead" in value) {
    target.cacheRead += value.cacheRead || 0;
    target.cacheWrite += value.cacheWrite || 0;
    target.totalTokens += value.totalTokens || 0;
    target.cost.input += value.cost?.input || 0;
    target.cost.output += value.cost?.output || 0;
    target.cost.cacheRead += value.cost?.cacheRead || 0;
    target.cost.cacheWrite += value.cost?.cacheWrite || 0;
    target.cost.total += value.cost?.total || 0;
  } else {
    target.totalTokens += (value.input || 0) + (value.output || 0);
    target.cost.total += value.cost || 0;
  }
  return target;
}

export function aggregateUsage(values: Iterable<AgentRunUsage | undefined>): Usage {
  const result = emptyUsage();
  for (const value of values) addUsage(result, value);
  return result;
}

/** Include assistant calls, nested tool usage, and summaries persisted by Pi. */
export function usageFromSessionEntries(entries: readonly unknown[]): Usage {
  const result = emptyUsage();
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as { type?: string; usage?: AgentRunUsage; message?: { role?: string; usage?: AgentRunUsage } };
    if (entry.type === "message" && (entry.message?.role === "assistant" || entry.message?.role === "toolResult")) {
      addUsage(result, entry.message.usage);
    } else if (entry.type === "compaction" || entry.type === "branch_summary") {
      addUsage(result, entry.usage);
    }
  }
  return result;
}
