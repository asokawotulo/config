import { describe, expect, test } from "bun:test";
import {
  FabricCostLedger,
  type FabricCostObservation,
} from "./fabric-cost-ledger.ts";

const run = (
  overrides: Partial<FabricCostObservation> = {},
): FabricCostObservation => ({
  rootId: "main",
  runner: "pi",
  runId: "worker",
  updatedAt: 10,
  cost: 1,
  basis: "own",
  ...overrides,
});
const replay = (observations: FabricCostObservation[], root = "main") => {
  const ledger = new FabricCostLedger(root);
  for (const value of observations) ledger.observe(value);
  return ledger;
};

describe("Fabric recursive and multi-runner attribution", () => {
  test("deduplicates a run seen by run, wait, status, list and nested results", () => {
    const child = run({ runId: "child", cost: 2 });
    const grandchild = run({ runId: "grandchild", cost: 3 });
    // These are cumulative observations from different transports, not deltas.
    const observations = [
      run(),
      child,
      grandchild,
      child,
      run(),
      grandchild,
      child,
    ];
    for (const ordered of [observations, [...observations].reverse()]) {
      const total = replay(ordered).summary(true);
      expect(total.reportedCost).toBe(6);
      expect(total.complete).toBe(true);
    }
  });

  test("latest cumulative revision replaces older reports rather than adding", () => {
    const observations = [
      run(),
      run({ cost: 4, updatedAt: 30 }),
      run({ cost: 2, updatedAt: 20 }),
    ];
    for (const ordered of [
      observations,
      [...observations].reverse(),
      [observations[1]!, observations[0]!, observations[2]!],
    ]) {
      expect(replay(ordered).summary(true).reportedCost).toBe(4);
    }
  });

  test("a newer corrected cost can decrease; max-cost deduplication would be wrong", () => {
    expect(
      replay([run({ cost: 4 }), run({ cost: 3, updatedAt: 20 })]).summary(true)
        .reportedCost,
    ).toBe(3);
  });

  test("identical short IDs from different runners remain separate", () => {
    const ledger = replay([
      run({ runner: "pi", cost: 1 }),
      run({ runner: "claude", cost: 2 }),
      run({ runner: "veda", cost: 3 }),
      run({ runner: "claude", cost: 2 }),
    ]);
    expect(ledger.summary(true)).toMatchObject({
      reportedCost: 6,
      complete: true,
    });
  });

  test("foreign root sessions never contaminate the current session", () => {
    const observations = [run(), run({ rootId: "peer", cost: 100 })];
    expect(replay(observations).summary(true).reportedCost).toBe(1);
    expect(replay(observations, "peer").summary(true).reportedCost).toBe(100);
  });

  test("inclusive or unverified costs are not added to descendant costs", () => {
    for (const basis of ["subtree", "unknown"] as const) {
      const total = replay([
        run({ cost: 10, basis }),
        run({ runId: "child", cost: 3 }),
      ]).summary(true);
      expect(total).toMatchObject({ reportedCost: 3, complete: false });
      expect(total.issues).toContain("unsupported_cost_basis");
    }
  });

  test("rejects coercible runner/basis values and marks aggregate overflow", () => {
    for (const value of [
      { ...run(), runner: ["pi"] },
      { ...run(), basis: ["own"] },
    ]) {
      expect(new FabricCostLedger("main").observe(value)).toBe(false);
    }
    const total = replay([
      run({ cost: Number.MAX_VALUE }),
      run({ runId: "other", cost: Number.MAX_VALUE }),
    ]).summary(true);
    expect(Number.isFinite(total.reportedCost)).toBe(true);
    expect(total.complete).toBe(false);
    expect(total.issues).toContain("cost_overflow");
  });

  test("failed and stopped runs retain incurred costs", () => {
    const ledger = new FabricCostLedger("main");
    ledger.observe({ ...run({ runId: "failed", cost: 2 }), status: "failed" });
    ledger.observe({
      ...run({ runId: "stopped", cost: 3 }),
      status: "stopped",
    });
    expect(ledger.summary(true)).toMatchObject({
      reportedCost: 5,
      complete: true,
    });
  });

  test("conflicting equal revisions stay visibly incomplete", () => {
    const ledger = replay([run(), run({ cost: 2 })]);
    expect(ledger.summary(true).issues).toContain("conflicting_revision");
    expect(ledger.summary(true).complete).toBe(false);
  });

  test("rejects invalid amounts and IDs rather than creating free workers", () => {
    for (const value of [NaN, Infinity, -1, "2", undefined]) {
      const ledger = new FabricCostLedger("main");
      expect(ledger.observe({ ...run(), cost: value })).toBe(false);
      expect(ledger.summary(true).complete).toBe(false);
    }
    for (const value of [
      { ...run(), runId: "" },
      { ...run(), runner: "unknown" },
      { ...run(), updatedAt: NaN },
    ]) {
      expect(new FabricCostLedger("main").observe(value)).toBe(false);
    }
    expect(replay([run({ cost: 0 })]).summary(true).complete).toBe(true);
  });
});

describe("Fabric actor activation attribution", () => {
  test("separate activations of one actor accumulate by run ID, not actor ID", () => {
    const ledger = replay([
      run({ actorId: "reviewer", runId: "activation-1", cost: 2 }),
      run({ actorId: "reviewer", runId: "activation-2", cost: 3 }),
    ]);
    expect(ledger.summary(true)).toMatchObject({
      reportedCost: 5,
    });
  });

  test("worker and repeated mailbox delivery for the same activation charge once", () => {
    const worker = run({ actorId: "reviewer", runId: "activation-1", cost: 2 });
    // An actor message's runId identifies its worker. Its message id is NOT a billing identity.
    const messages = ["delivery-1", "delivery-2"].map((id) => ({
      id,
      actorId: "reviewer",
      runId: "activation-1",
      usage: { cost: 2 },
      createdAt: 20,
    }));
    const ledger = replay([worker]);
    for (const message of messages)
      ledger.observe(
        run({
          runId: message.runId,
          actorId: message.actorId,
          cost: message.usage.cost,
          updatedAt: message.createdAt,
        }),
      );
    expect(ledger.summary(true)).toMatchObject({
      reportedCost: 2,
    });
  });

  test("actor restarts/new activation IDs and runner changes preserve all costs", () => {
    const ledger = replay([
      run({ actorId: "reviewer", runId: "old", cost: 2 }),
      run({ actorId: "reviewer", runId: "new", cost: 3 }),
      run({ actorId: "reviewer", runId: "new", runner: "claude", cost: 4 }),
      run({ runId: "non-actor", cost: 1 }),
    ]);
    expect(ledger.summary(true)).toMatchObject({
      reportedCost: 10,
    });
  });

  test("one worker cannot be reassigned to another actor by later observations", () => {
    const ledger = replay([
      run({ actorId: "first" }),
      run({ actorId: "second", updatedAt: 20 }),
    ]);
    expect(ledger.summary(true).reportedCost).toBe(1);
    expect(ledger.summary(true).issues).toContain("conflicting_actor_identity");
  });
});
