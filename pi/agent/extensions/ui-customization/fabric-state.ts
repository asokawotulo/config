import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalText } from "../../lib/text.ts";
import { FabricCostLedger, type FabricRunner } from "./fabric-cost-ledger.ts";

export const FABRIC_SIDEBAR_ENTRY = "asoka.fabric-sidebar.v1";
export const MAX_FABRIC_WORKERS = 128;
const MAX_EXECUTIONS = 12;
const MAX_CHECKPOINT_BYTES = 256 * 1024;
const statuses = new Set([
  "queued",
  "running",
  "completed",
  "failed",
  "stopped",
  "timed_out",
]);
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
const text = (v: unknown, max = 120): string | undefined =>
  typeof v === "string"
    ? sanitizeTerminalText(v.slice(0, 4096)).slice(0, max) || undefined
    : undefined;
const id = (v: unknown): string | undefined =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 200 &&
  sanitizeTerminalText(v) === v
    ? v
    : undefined;

export interface FabricWorkerRow {
  id: string;
  name: string;
  runner: FabricRunner;
  status: string;
  parentId?: string;
  actorId?: string;
  actorName?: string;
  model?: string;
  thinking?: string;
  currentTool?: string;
  cwd?: string;
  worktree?: string;
  startedAt?: number;
  updatedAt: number;
  finishedAt?: number;
  turns?: number;
  toolCalls?: number;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
  };
  stale?: boolean;
}
export interface FabricExecutionRow {
  id: string;
  name: string;
  status: string;
  phase?: string;
  /** Recorded wrapper execution time, not worker elapsed time or nested-call totals. */
  durationMs?: number;
}
export interface FabricSidebarSnapshot {
  workers: FabricWorkerRow[];
  executions: FabricExecutionRow[];
  reportedCost: number;
  complete: boolean;
  issues: string[];
  connection: "connecting" | "live" | "unavailable";
}

export class FabricSidebarState {
  private workers = new Map<string, FabricWorkerRow>();
  private executions = new Map<string, FabricExecutionRow>();
  private ledger: FabricCostLedger;
  private problems = new Set<string>();
  private connection: FabricSidebarSnapshot["connection"] = "connecting";
  private fabricRoot?: string;
  private hydratedAt = Date.now();
  constructor(readonly sessionId: string) {
    this.ledger = new FabricCostLedger(sessionId);
  }

  connected(rootId: string) {
    this.fabricRoot = rootId;
    this.connection = "live";
  }
  unavailable() {
    this.connection = "unavailable";
    for (const row of this.workers.values())
      if (["running", "queued"].includes(row.status)) row.stale = true;
  }
  observeLive(value: unknown) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values.slice(0, MAX_FABRIC_WORKERS)) {
      if (!isRecord(item)) continue;
      const known = this.workers.has(JSON.stringify([item.runner, item.id]));
      // A live registry is not branch history. Do not import old off-branch runs.
      if (!known && (number(item.startedAt) ?? 0) < this.hydratedAt) continue;
      this.observe(item);
    }
    if (values.length > MAX_FABRIC_WORKERS) this.problems.add("worker_limit");
    // A successful poll is an authoritative live set, including nested runs.
    // Do not infer completion when a run disappears: cleanup can race our poll.
    const live = new Set<string>();
    let complete = true;
    const remember = (item: unknown, depth = 0): void => {
      if (depth > 8) {
        complete = false;
        return;
      }
      if (Array.isArray(item)) {
        if (item.length > MAX_FABRIC_WORKERS) complete = false;
        for (const child of item.slice(0, MAX_FABRIC_WORKERS))
          remember(child, depth + 1);
        return;
      }
      if (!isRecord(item)) return;
      if (item.rootId !== undefined && item.rootId !== this.fabricRoot) return;
      if (id(item.id) && typeof item.runner === "string")
        live.add(JSON.stringify([item.runner, item.id]));
      if (Array.isArray(item.nestedAgents))
        remember(item.nestedAgents, depth + 1);
    };
    remember(values);
    if (complete)
      for (const [key, row] of this.workers)
        if (!live.has(key)) row.stale = true;
  }
  observe(value: unknown, parentId?: string, depth = 0): void {
    if (depth > 8) {
      this.problems.add("worker_depth_limit");
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_FABRIC_WORKERS) this.problems.add("worker_limit");
      for (const item of value.slice(0, MAX_FABRIC_WORKERS))
        this.observe(item, parentId, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    if (value.rootId !== undefined && value.rootId !== this.fabricRoot) return;
    const runId = id(value.id);
    if (
      !runId ||
      typeof value.runner !== "string" ||
      !["pi", "claude", "veda"].includes(value.runner) ||
      typeof value.status !== "string" ||
      !statuses.has(value.status)
    )
      return;
    const runner = value.runner as FabricRunner;
    const key = JSON.stringify([runner, runId]);
    if (!this.workers.has(key) && this.workers.size >= MAX_FABRIC_WORKERS) {
      this.problems.add("worker_limit");
      return;
    }
    const previous = this.workers.get(key);
    const updatedAt =
      number(value.updatedAt) ??
      number(value.finishedAt) ??
      number(value.startedAt) ??
      0;
    if (previous && updatedAt < previous.updatedAt) return;
    if (
      previous &&
      updatedAt === previous.updatedAt &&
      !["running", "queued"].includes(previous.status) &&
      ["running", "queued"].includes(String(value.status))
    )
      return;
    const rawUsage = isRecord(value.usage) ? value.usage : undefined;
    const cost = number(rawUsage?.cost);
    const usage =
      cost === undefined
        ? previous?.usage
        : {
            cost,
            input: number(rawUsage?.input) ?? 0,
            output: number(rawUsage?.output) ?? 0,
            cacheRead: number(rawUsage?.cacheRead) ?? 0,
            cacheWrite: number(rawUsage?.cacheWrite) ?? 0,
          };
    const row: FabricWorkerRow = {
      id: runId,
      runner,
      name: text(value.name, 80) ?? previous?.name ?? runId,
      status: String(value.status),
      updatedAt,
      ...(usage ? { usage } : {}),
    };
    for (const field of [
      "model",
      "thinking",
      "currentTool",
      "cwd",
      "worktree",
      "actorName",
    ] as const) {
      const v = text(value[field]) ?? previous?.[field];
      if (v) row[field] = v;
    }
    for (const field of ["parentId", "actorId"] as const) {
      const v =
        id(value[field]) ??
        previous?.[field] ??
        (field === "parentId" ? parentId : undefined);
      if (v) row[field] = v;
    }
    for (const field of [
      "startedAt",
      "finishedAt",
      "turns",
      "toolCalls",
    ] as const) {
      const v = number(value[field]) ?? previous?.[field];
      if (v !== undefined) row[field] = v;
    }
    row.stale = value.stale === true;
    this.workers.set(key, row);
    if (usage)
      this.ledger.observe({
        rootId: this.sessionId,
        runner,
        runId,
        updatedAt,
        cost: usage.cost,
        ...(row.actorId ? { actorId: row.actorId } : {}),
        basis: runner === "pi" ? "own" : "unknown",
      });
    if (Array.isArray(value.nestedAgents))
      this.observe(value.nestedAgents, runId, depth + 1);
  }

  execution(
    callId: string,
    args: unknown,
    details?: unknown,
    status = "running",
    durationMs?: number,
  ) {
    if (!id(callId)) return;
    const previous = this.executions.get(callId);
    const display =
      isRecord(args) && isRecord(args.display) ? args.display : undefined;
    const phases =
      isRecord(details) && Array.isArray(details.phases) ? details.phases : [];
    const duration = number(durationMs) ?? previous?.durationMs;
    this.executions.set(callId, {
      id: callId,
      name: text(display?.name) ?? previous?.name ?? "Fabric execution",
      status,
      ...(duration === undefined ? {} : { durationMs: duration }),
      ...((text(phases.at(-1)) ?? previous?.phase)
        ? { phase: text(phases.at(-1)) ?? previous?.phase }
        : {}),
    });
    while (this.executions.size > MAX_EXECUTIONS)
      this.executions.delete(this.executions.keys().next().value!);
  }

  ingestDetails(details: unknown, historical = false) {
    if (!isRecord(details)) {
      if (historical) this.problems.add("missing_execution_history");
      return;
    }
    if (historical && !isRecord(details.trace))
      this.problems.add("missing_execution_trace");
    const rawAudits = Array.isArray(details.audits) ? details.audits : [];
    if (rawAudits.length > 512) this.problems.add("audit_limit");
    const audits = rawAudits.slice(0, 512);
    for (const audit of audits) {
      if (
        !isRecord(audit) ||
        typeof audit.ref !== "string" ||
        !audit.ref.startsWith("agents.")
      )
        continue;
      if (audit.resultTruncated === true) {
        this.problems.add("trimmed_worker_history");
        continue;
      }
      if (["agents.run", "agents.wait", "agents.spawn"].includes(audit.ref))
        this.observe(audit.result);
      if (["agents.ask", "agents.handoff"].includes(audit.ref))
        this.problems.add("activation_history_requires_worker_record");
    }
    if (historical && isRecord(details.trace)) {
      const operations = Array.isArray(details.trace.operations)
        ? details.trace.operations
        : [];
      const workerRefs = [
        "agents.run",
        "agents.wait",
        "agents.spawn",
        "agents.ask",
        "agents.handoff",
      ];
      for (const ref of workerRefs) {
        const expected = operations.filter(
          (op) => isRecord(op) && op.ref === ref && op.outcome === "succeeded",
        ).length;
        const retained = audits.filter(
          (a) =>
            isRecord(a) &&
            a.ref === ref &&
            a.resultTruncated !== true &&
            isRecord(a.result) &&
            isRecord(a.result.usage),
        ).length;
        if (expected > retained) this.problems.add("trimmed_worker_history");
      }
      if (
        isRecord(details.trace.counts) &&
        Number(details.trace.counts.droppedOperations) > 0
      )
        this.problems.add("trimmed_worker_history");
    }
  }

  snapshot(): FabricSidebarSnapshot {
    const summary = this.ledger.summary(this.problems.size === 0);
    const issues = new Set([...summary.issues, ...this.problems]);
    if ([...this.workers.values()].some((w) => !w.usage))
      issues.add("missing_worker_usage");
    if (this.connection !== "live") issues.add("live_data_unavailable");
    return {
      // Actor runs are cleaned up between messages. Keep their cost history,
      // but do not display retained runs as if the actor were still working.
      workers: [...this.workers.values()]
        .filter((w) => !(w.actorId && w.stale))
        .sort(
          (a, b) =>
            Number(!b.stale && ["running", "queued"].includes(b.status)) -
              Number(!a.stale && ["running", "queued"].includes(a.status)) ||
            b.updatedAt - a.updatedAt,
        ),
      executions: [...this.executions.values()].reverse(),
      reportedCost: summary.reportedCost,
      complete: issues.size === 0,
      issues: [...issues].sort(),
      connection: this.connection,
    };
  }

  checkpoint(throughEntryId: string): unknown {
    const result = {
      version: 1,
      sessionId: this.sessionId,
      throughEntryId,
      workers: [...this.workers.values()],
      executions: [...this.executions.values()],
      problems: [
        ...new Set([...this.problems, ...this.ledger.summary(true).issues]),
      ],
    };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_CHECKPOINT_BYTES) {
      this.problems.add("checkpoint_limit");
      return undefined;
    }
    return structuredClone(result);
  }

  hydrate(entries: readonly SessionEntry[]) {
    this.hydratedAt = Date.now();
    this.workers.clear();
    this.executions.clear();
    this.problems.clear();
    this.ledger = new FabricCostLedger(this.sessionId);
    const seen = new Set<string>();
    for (const entry of entries) {
      if (
        entry.type === "custom" &&
        entry.customType === FABRIC_SIDEBAR_ENTRY
      ) {
        const d = entry.data;
        if (
          isRecord(d) &&
          d.version === 1 &&
          d.sessionId === this.sessionId &&
          id(d.throughEntryId) &&
          seen.has(String(d.throughEntryId)) &&
          entry.parentId === d.throughEntryId &&
          Array.isArray(d.workers) &&
          d.workers.length <= MAX_FABRIC_WORKERS &&
          d.workers.every(
            (w) =>
              isRecord(w) &&
              id(w.id) &&
              typeof w.runner === "string" &&
              ["pi", "claude", "veda"].includes(w.runner) &&
              typeof w.status === "string" &&
              statuses.has(w.status) &&
              number(w.updatedAt) !== undefined &&
              w.rootId === undefined &&
              (w.usage === undefined ||
                (isRecord(w.usage) && number(w.usage.cost) !== undefined)),
          ) &&
          Array.isArray(d.executions) &&
          d.executions.length <= MAX_EXECUTIONS &&
          Array.isArray(d.problems) &&
          d.problems.every((p) => typeof p === "string" && p.length <= 80) &&
          Buffer.byteLength(JSON.stringify(d)) <= MAX_CHECKPOINT_BYTES
        ) {
          // A checkpoint follows and covers its exact active-branch boundary.
          this.workers.clear();
          this.executions.clear();
          this.ledger = new FabricCostLedger(this.sessionId);
          this.problems = new Set(d.problems as string[]);
          this.observe(d.workers);
          for (const raw of d.executions)
            if (isRecord(raw) && id(raw.id)) {
              this.execution(
                String(raw.id),
                { display: { name: raw.name } },
                { phases: [raw.phase] },
                text(raw.status) ?? "completed",
                number(raw.durationMs),
              );
            }
        }
      } else if (
        entry.type === "message" &&
        entry.message.role === "toolResult" &&
        entry.message.toolName === "fabric_exec"
      ) {
        this.execution(
          entry.message.toolCallId,
          undefined,
          entry.message.details,
          entry.message.isError ? "failed" : "completed",
          entry.message.durationMs,
        );
        this.ingestDetails(entry.message.details, true);
      } else if (
        entry.type === "message" &&
        entry.message.role === "assistant" &&
        Array.isArray(entry.message.content)
      ) {
        for (const block of entry.message.content)
          if (block.type === "toolCall" && block.name === "fabric_exec")
            this.execution(block.id, block.arguments);
      }
      seen.add(entry.id);
    }
    for (const row of this.workers.values())
      if (["running", "queued"].includes(row.status)) row.stale = true;
  }
}
