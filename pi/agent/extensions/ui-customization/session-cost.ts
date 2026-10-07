import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export interface SessionCosts {
  total: number;
  /** Null until Fabric's worker ledger is available. */
  main: number | null;
  subagents: number | null;
}

function usageCost(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const cost = (value as { cost?: unknown }).cost;
  const total = typeof cost === "number"
    ? cost
    : cost && typeof cost === "object"
      ? (cost as { total?: unknown }).total
      : undefined;
  return typeof total === "number" && Number.isFinite(total) && total >= 0
    ? total
    : 0;
}

/** Read parent/tool billing; Fabric's deduplicated ledger owns worker costs. */
export function calculateSessionCosts(
  entries: readonly SessionEntry[],
  fabric?: { reportedCost: number },
): SessionCosts {
  let main = 0;
  let hasFabric = false;

  for (const entry of entries) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      hasFabric ||=
        Array.isArray(entry.message.content) &&
        entry.message.content.some(
          (block) => block.type === "toolCall" && block.name === "fabric_exec",
        );
      main += usageCost(entry.message.usage);
    } else if (entry.type === "message" && entry.message.role === "toolResult") {
      hasFabric ||= entry.message.toolName === "fabric_exec";
      // Direct tool billing, e.g. approval classifiers. Never infer worker
      // costs from tool details or assume outer billing includes worker usage.
      main += usageCost(entry.message.usage);
    } else if (
      entry.type === "compaction" || entry.type === "branch_summary" ||
      entry.type === "usage"
    ) {
      main += usageCost(entry.usage);
    }
  }

  return {
    total: main + (fabric?.reportedCost ?? 0),
    main: fabric || !hasFabric ? main : null,
    subagents: fabric ? fabric.reportedCost : hasFabric ? null : 0,
  };
}
