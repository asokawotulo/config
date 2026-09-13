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

export interface FabricCostCheckpoint {
  kind: "fabric-cost-checkpoint";
  version: 1;
  rootId: string;
  /** Exact history boundary covered, not merely the latest checkpoint found. */
  throughEntryId: string;
  observations: FabricCostObservation[];
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
  // Whitelist persisted fields. Never retain prompts, tokens, results or logs.
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
    const actors: Record<string, number> = Object.create(null);
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
      if (run.actorId)
        actors[run.actorId] = (actors[run.actorId] ?? 0) + run.cost;
    }
    return {
      reportedCost,
      actors,
      runCount: this.runs.size,
      complete: issues.size === 0,
      issues: [...issues].sort(),
    };
  }

  checkpoint(throughEntryId: string): FabricCostCheckpoint {
    if (!identifier(throughEntryId))
      throw new Error("A history boundary is required");
    // A checkpoint must not silently discard uncertainty while being saved.
    if (!this.summary(true).complete)
      throw new Error("Cannot checkpoint ambiguous cost evidence");
    return {
      kind: "fabric-cost-checkpoint",
      version: 1,
      rootId: this.rootId,
      throughEntryId,
      observations: [...this.runs.values()]
        .sort((a, b) => key(a).localeCompare(key(b)))
        .map((value) => ({ ...value })),
    };
  }

  restore(value: unknown, expectedThroughEntryId: string): boolean {
    if (
      !record(value) ||
      value.kind !== "fabric-cost-checkpoint" ||
      value.version !== 1 ||
      value.rootId !== this.rootId ||
      !identifier(expectedThroughEntryId) ||
      value.throughEntryId !== expectedThroughEntryId ||
      !Array.isArray(value.observations)
    )
      return false;
    // Validate the entire checkpoint before changing any existing state.
    const restored = new FabricCostLedger(this.rootId);
    for (const item of value.observations) {
      const normalized = observation(item);
      if (
        !normalized ||
        normalized.rootId !== this.rootId ||
        normalized.basis !== "own"
      )
        return false;
      restored.observe(normalized);
    }
    if (!restored.summary(true).complete) return false;
    // Reject a conflicting merge atomically, too.
    const merged = new FabricCostLedger(this.rootId);
    for (const item of this.runs.values()) merged.observe(item);
    for (const item of restored.runs.values()) merged.observe(item);
    if (!merged.summary(true).complete) return false;
    for (const [id, item] of merged.runs) this.runs.set(id, item);
    return true;
  }
}
