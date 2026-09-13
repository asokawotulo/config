import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export interface SessionCosts {
  total: number;
  /** Null when Fabric combines worker and other tool usage. */
  main: number | null;
  subagents: number | null;
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
 * Read persisted parent/tool billing, including historical dynamic_workflow
 * results. Legacy run IDs deduplicate replayed records without depending on
 * the deleted workflow extension. Fabric workers are accounted separately.
 */
export function calculateSessionCosts(
  entries: readonly SessionEntry[],
  fabric?: { reportedCost: number },
): SessionCosts {
  let main = 0;
  let subagents = 0;
  let fabricCost = 0;
  let hasFabric = false;
  const chargedWorkflowIds = new Set<string>();

  for (const entry of entries) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      hasFabric ||=
        Array.isArray(entry.message.content) &&
        entry.message.content.some(
          (block) => block.type === "toolCall" && block.name === "fabric_exec",
        );
      main += usageCost(entry.message.usage) ?? 0;
      continue;
    }
    if (entry.type === "message" && entry.message.role === "toolResult") {
      const message = entry.message;
      if (message.toolName === "fabric_exec") {
        hasFabric = true;
        // Direct tool billing, e.g. approval classifiers. Worker cost comes
        // from the separate, deduplicated Fabric ledger.
        fabricCost += usageCost(message.usage) ?? 0;
        continue;
      }
      if (message.toolName !== "dynamic_workflow") {
        main += usageCost(message.usage) ?? 0;
        continue;
      }

      const details = workflowDetails(message.details);
      if (details.runId && chargedWorkflowIds.has(details.runId)) continue;
      if (details.runId) chargedWorkflowIds.add(details.runId);
      subagents +=
        usageCost(message.usage) ?? workflowDetailsCost(details.agents);
      continue;
    }
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      main += usageCost(entry.usage) ?? 0;
    }
  }

  return {
    total: main + subagents + fabricCost + (fabric?.reportedCost ?? 0),
    main: fabric ? main + fabricCost : hasFabric ? null : main,
    subagents: fabric
      ? subagents + fabric.reportedCost
      : hasFabric
        ? null
        : subagents,
  };
}
