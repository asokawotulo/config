import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { DynamicWorkflowRunSnapshot } from "../../lib/dynamic-workflow-events.ts";

export interface SessionCosts {
  total: number;
  main: number;
  subagents: number;
}

function finiteCost(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

function usageCost(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const cost = (value as { cost?: unknown }).cost;
  return finiteCost(
    typeof cost === "number"
      ? cost
      : cost && typeof cost === "object"
        ? (cost as { total?: unknown }).total
        : undefined,
  );
}

function workflowDetails(value: unknown): {
  runId?: string;
  agents?: unknown[];
} {
  if (!value || typeof value !== "object") return {};
  const details = value as { runId?: unknown; agents?: unknown };
  return {
    ...(typeof details.runId === "string" ? { runId: details.runId } : {}),
    ...(Array.isArray(details.agents) ? { agents: details.agents } : {}),
  };
}

function workflowDetailsCost(agents: readonly unknown[] | undefined): number {
  let total = 0;
  for (const value of agents ?? []) {
    if (!value || typeof value !== "object") continue;
    const agent = value as { cost?: unknown; usage?: unknown };
    total += finiteCost(agent.cost) ?? usageCost(agent.usage) ?? 0;
  }
  return total;
}

/**
 * Partition persisted parent/tool usage from transient workflow snapshots.
 * A persisted dynamic_workflow result supersedes its event snapshot, avoiding
 * the progress-to-tool-result race from charging the same agents twice.
 */
export function calculateSessionCosts(
  entries: readonly SessionEntry[],
  workflowRuns: readonly DynamicWorkflowRunSnapshot[] = [],
): SessionCosts {
  let main = 0;
  let subagents = 0;
  const persistedWorkflowIds = new Set<string>();
  const chargedWorkflowIds = new Set<string>();

  for (const entry of entries) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      main += usageCost(entry.message.usage) ?? 0;
      continue;
    }
    if (entry.type === "message" && entry.message.role === "toolResult") {
      const message = entry.message;
      if (message.toolName !== "dynamic_workflow") {
        main += usageCost(message.usage) ?? 0;
        continue;
      }

      const details = workflowDetails(message.details);
      if (details.runId) persistedWorkflowIds.add(details.runId);
      if (details.runId && chargedWorkflowIds.has(details.runId)) continue;
      if (details.runId) chargedWorkflowIds.add(details.runId);
      subagents += usageCost(message.usage) ?? workflowDetailsCost(details.agents);
      continue;
    }
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      main += usageCost(entry.usage) ?? 0;
    }
  }

  const chargedActiveIds = new Set<string>();
  for (const run of workflowRuns) {
    if (
      persistedWorkflowIds.has(run.runId) ||
      chargedActiveIds.has(run.runId)
    ) {
      continue;
    }
    chargedActiveIds.add(run.runId);
    for (const agent of run.agents) subagents += finiteCost(agent.cost) ?? 0;
  }

  return { total: main + subagents, main, subagents };
}
