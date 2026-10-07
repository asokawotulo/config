/** Pure accounting used by the Fabric sidebar adapter. No hooks or IO. */
export type FabricRunner = "pi" | "claude" | "veda";
export interface FabricCostObservation {
  rootId: string;
  runner: FabricRunner;
  runId: string;
  actorId?: string;
  updatedAt: number;
  /** Cumulative cost for this run, not a delta or actor lifetime total. */
  cost: number;
  /** Adapters must establish attribution; never guess from the runner name. */
  basis: "own" | "subtree" | "unknown";
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const nonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const key = (value: FabricCostObservation) =>
  JSON.stringify([value.rootId, value.runner, value.runId]);

function observation(value: unknown): FabricCostObservation | undefined {
  if (
    !record(value) ||
    !identifier(value.rootId) ||
    !identifier(value.runId) ||
    typeof value.runner !== "string" ||
    !["pi", "claude", "veda"].includes(value.runner) ||
    !nonNegative(value.cost) ||
    !nonNegative(value.updatedAt) ||
    typeof value.basis !== "string" ||
    !["own", "subtree", "unknown"].includes(value.basis) ||
    (value.actorId !== undefined && !identifier(value.actorId))
  )
    return;
  // Retain accounting fields only, not prompts, results or logs.
  return {
    rootId: value.rootId,
    runner: value.runner as FabricRunner,
    runId: value.runId,
    updatedAt: value.updatedAt,
    cost: value.cost,
    basis: value.basis as FabricCostObservation["basis"],
    ...(value.actorId !== undefined
      ? { actorId: value.actorId as string }
      : {}),
  };
}

export class FabricCostLedger {
  private readonly runs = new Map<string, FabricCostObservation>();
  private readonly rejected = new Set<string>();

  constructor(readonly rootId: string) {
    if (!identifier(rootId))
      throw new Error("A root session identity is required");
  }

  observe(value: unknown): boolean {
    const next = observation(value);
    if (!next) {
      this.rejected.add("invalid_observation");
      return false;
    }
    if (next.rootId !== this.rootId) return false;
    const id = key(next);
    const previous = this.runs.get(id);
    if (previous) {
      if (previous.actorId !== next.actorId) {
        this.rejected.add("conflicting_actor_identity");
        return false;
      }
      if (next.updatedAt < previous.updatedAt) return false;
      if (next.updatedAt === previous.updatedAt) {
        if (next.cost !== previous.cost || next.basis !== previous.basis) {
          this.rejected.add("conflicting_revision");
        }
        return false;
      }
    }
    this.runs.set(id, next);
    return true;
  }

  /** Caller must establish complete history independently of available usage. */
  summary(historyComplete: boolean) {
    const issues = new Set(this.rejected);
    if (!historyComplete) issues.add("incomplete_history");
    let reportedCost = 0;
    for (const run of this.runs.values()) {
      if (run.basis !== "own") {
        issues.add("unsupported_cost_basis");
        continue;
      }
      if (!Number.isFinite(reportedCost + run.cost)) {
        issues.add("cost_overflow");
        continue;
      }
      reportedCost += run.cost;
    }
    return {
      reportedCost,
      complete: issues.size === 0,
      issues: [...issues].sort(),
    };
  }
}
