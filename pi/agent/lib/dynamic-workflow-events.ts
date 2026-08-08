import { sanitizeTerminalText } from "./text.ts";

export const DYNAMIC_WORKFLOW_EVENTS = {
  run: "dynamic-workflows:run",
  stateRequest: "dynamic-workflows:state-request",
  state: "dynamic-workflows:state",
  openAgent: "dynamic-workflows:open-agent",
  targetedControl: "dynamic-workflows:targeted-control",
} as const;

export const DYNAMIC_WORKFLOW_RUN_EVENT = DYNAMIC_WORKFLOW_EVENTS.run;
export const DYNAMIC_WORKFLOW_STATE_REQUEST_EVENT = DYNAMIC_WORKFLOW_EVENTS.stateRequest;
export const DYNAMIC_WORKFLOW_STATE_EVENT = DYNAMIC_WORKFLOW_EVENTS.state;
export const DYNAMIC_WORKFLOW_OPEN_AGENT_EVENT = DYNAMIC_WORKFLOW_EVENTS.openAgent;
export const DYNAMIC_WORKFLOW_TARGETED_CONTROL_EVENT = DYNAMIC_WORKFLOW_EVENTS.targetedControl;

export const MAX_DYNAMIC_WORKFLOW_RUNS = 25;
export const MAX_DYNAMIC_WORKFLOW_AGENTS = 32;
export const MAX_DYNAMIC_WORKFLOW_LABEL_LENGTH = 120;
export const MAX_DYNAMIC_WORKFLOW_DETAIL_LENGTH = 240;
export const MAX_DYNAMIC_WORKFLOW_COST = 1_000_000;

export type DynamicWorkflowAgentStatus = "queued" | "running" | "completed" | "failed" | "skipped" | "cancelled";
export type DynamicWorkflowStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";
export type DynamicWorkflowRunPhase = "started" | "progress" | "settled";

export interface DynamicWorkflowAgentSnapshot {
  id: string;
  role: string;
  status: DynamicWorkflowAgentStatus;
  startedAt?: number;
  finishedAt?: number;
  /** Coarse operational label only; never tool arguments or model text. */
  activity?: string;
  /** Sanitized, finite USD total only; no token/request details. */
  cost?: number;
  /** Bounded opaque identity used only to open/control a zmx-backed session. */
  zmxSessionId?: string;
}

/** A deliberately small, display-only projection of a workflow run. */
export interface DynamicWorkflowRunSnapshot {
  runId: string;
  sessionId: string;
  name: string;
  status: DynamicWorkflowStatus;
  startedAt: number;
  finishedAt?: number;
  agentCount: number;
  agents: DynamicWorkflowAgentSnapshot[];
}

export interface DynamicWorkflowRunEvent {
  sessionId: string;
  phase: DynamicWorkflowRunPhase;
  run: DynamicWorkflowRunSnapshot;
}

export interface DynamicWorkflowStateRequestEvent {
  sessionId: string;
}

export interface DynamicWorkflowStateEvent {
  sessionId: string;
  runs: DynamicWorkflowRunSnapshot[];
}

export interface DynamicWorkflowAgentTarget {
  /** Parent Pi session owning the workflow. */
  sessionId: string;
  runId: string;
  agentId: string;
}

/** Sidebar/UI request to open the persistent agent identified by the target snapshot. */
export interface DynamicWorkflowOpenAgentEvent extends DynamicWorkflowAgentTarget {}

export type DynamicWorkflowTargetedControlAction = "interrupt" | "terminate";

/** Payload-free targeted control: prompts, tool arguments, and commands never cross this channel. */
export interface DynamicWorkflowTargetedControlEvent extends DynamicWorkflowAgentTarget {
  action: DynamicWorkflowTargetedControlAction;
}

/** Remove terminal control sequences and keep event strings single-line and bounded. */
export function dynamicWorkflowDisplayText(value: unknown, maxLength = MAX_DYNAMIC_WORKFLOW_DETAIL_LENGTH): string {
  if (typeof value !== "string" || maxLength <= 0) return "";
  const safe = sanitizeTerminalText(value);
  const characters = Array.from(safe);
  if (characters.length <= maxLength) return safe;
  if (maxLength === 1) return "…";
  return `${characters.slice(0, maxLength - 1).join("")}…`;
}

const AGENT_STATUSES = new Set<DynamicWorkflowAgentStatus>([
  "queued", "running", "completed", "failed", "skipped", "cancelled",
]);
const WORKFLOW_STATUSES = new Set<DynamicWorkflowStatus>([
  "running", "completed", "failed", "cancelled", "interrupted",
]);
const RUN_PHASES = new Set<DynamicWorkflowRunPhase>(["started", "progress", "settled"]);

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function strictRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;

  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string" || !allowed.has(key))
    || required.some((key) => !keys.includes(key))
  ) return undefined;
  return value as Record<string, unknown>;
}

function isDisplayString(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && dynamicWorkflowDisplayText(value, maxLength) === value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseAgentSnapshotValue(value: unknown): DynamicWorkflowAgentSnapshot | undefined {
  const raw = strictRecord(
    value,
    ["id", "role", "status"],
    ["startedAt", "finishedAt", "activity", "cost", "zmxSessionId"],
  );
  if (
    !raw
    || !isDisplayString(raw.id, MAX_DYNAMIC_WORKFLOW_LABEL_LENGTH)
    || !isDisplayString(raw.role, MAX_DYNAMIC_WORKFLOW_LABEL_LENGTH)
    || !AGENT_STATUSES.has(raw.status as DynamicWorkflowAgentStatus)
    || (hasOwn(raw, "startedAt") && !isFiniteNumber(raw.startedAt))
    || (hasOwn(raw, "finishedAt") && !isFiniteNumber(raw.finishedAt))
    || (hasOwn(raw, "activity") && !isDisplayString(raw.activity, MAX_DYNAMIC_WORKFLOW_DETAIL_LENGTH))
    || (hasOwn(raw, "cost") && (
      !isFiniteNumber(raw.cost) || raw.cost < 0 || raw.cost > MAX_DYNAMIC_WORKFLOW_COST
    ))
    || (hasOwn(raw, "zmxSessionId") && !isDisplayString(raw.zmxSessionId, MAX_DYNAMIC_WORKFLOW_LABEL_LENGTH))
  ) return undefined;

  return {
    id: raw.id,
    role: raw.role,
    status: raw.status as DynamicWorkflowAgentStatus,
    ...(hasOwn(raw, "startedAt") ? { startedAt: raw.startedAt as number } : {}),
    ...(hasOwn(raw, "finishedAt") ? { finishedAt: raw.finishedAt as number } : {}),
    ...(hasOwn(raw, "activity") ? { activity: raw.activity as string } : {}),
    ...(hasOwn(raw, "cost") ? { cost: raw.cost as number } : {}),
    ...(hasOwn(raw, "zmxSessionId") ? { zmxSessionId: raw.zmxSessionId as string } : {}),
  };
}

function parseRunSnapshotValue(value: unknown): DynamicWorkflowRunSnapshot | undefined {
  const raw = strictRecord(
    value,
    ["runId", "sessionId", "name", "status", "startedAt", "agentCount", "agents"],
    ["finishedAt"],
  );
  if (
    !raw
    || !isDisplayString(raw.runId, MAX_DYNAMIC_WORKFLOW_LABEL_LENGTH)
    || !isDisplayString(raw.sessionId, MAX_DYNAMIC_WORKFLOW_LABEL_LENGTH)
    || !isDisplayString(raw.name, MAX_DYNAMIC_WORKFLOW_LABEL_LENGTH)
    || !WORKFLOW_STATUSES.has(raw.status as DynamicWorkflowStatus)
    || !isFiniteNumber(raw.startedAt)
    || (hasOwn(raw, "finishedAt") && !isFiniteNumber(raw.finishedAt))
    || typeof raw.agentCount !== "number"
    || !Number.isSafeInteger(raw.agentCount)
    || raw.agentCount < 0
    || !Array.isArray(raw.agents)
    || raw.agents.length > MAX_DYNAMIC_WORKFLOW_AGENTS
  ) return undefined;

  const agents: DynamicWorkflowAgentSnapshot[] = [];
  for (const value of raw.agents) {
    const agent = parseAgentSnapshotValue(value);
    if (!agent) return undefined;
    agents.push(agent);
  }
  const countMatchesProjection = raw.agentCount === agents.length
    || (raw.agentCount > MAX_DYNAMIC_WORKFLOW_AGENTS && agents.length === MAX_DYNAMIC_WORKFLOW_AGENTS);
  if (!countMatchesProjection) return undefined;

  return {
    runId: raw.runId,
    sessionId: raw.sessionId,
    name: raw.name,
    status: raw.status as DynamicWorkflowStatus,
    startedAt: raw.startedAt,
    ...(hasOwn(raw, "finishedAt") ? { finishedAt: raw.finishedAt as number } : {}),
    agentCount: raw.agentCount,
    agents,
  };
}

/** Parse a strict, bounded agent snapshot, returning undefined for invalid input. */
export function parseDynamicWorkflowAgentSnapshot(value: unknown): DynamicWorkflowAgentSnapshot | undefined {
  try { return parseAgentSnapshotValue(value); }
  catch { return undefined; }
}

/** Parse a strict, bounded run snapshot, returning undefined for invalid input. */
export function parseDynamicWorkflowRunSnapshot(value: unknown): DynamicWorkflowRunSnapshot | undefined {
  try { return parseRunSnapshotValue(value); }
  catch { return undefined; }
}

/** Parse a run update event and require its session identity to match its snapshot. */
export function parseDynamicWorkflowRunEvent(value: unknown): DynamicWorkflowRunEvent | undefined {
  try {
    const raw = strictRecord(value, ["sessionId", "phase", "run"]);
    if (
      !raw
      || !isDisplayString(raw.sessionId, MAX_DYNAMIC_WORKFLOW_LABEL_LENGTH)
      || !RUN_PHASES.has(raw.phase as DynamicWorkflowRunPhase)
    ) return undefined;
    const run = parseRunSnapshotValue(raw.run);
    if (!run || run.sessionId !== raw.sessionId) return undefined;
    return { sessionId: raw.sessionId, phase: raw.phase as DynamicWorkflowRunPhase, run };
  } catch {
    return undefined;
  }
}

/** Parse a bounded state event and require every run to belong to its session. */
export function parseDynamicWorkflowStateEvent(value: unknown): DynamicWorkflowStateEvent | undefined {
  try {
    const raw = strictRecord(value, ["sessionId", "runs"]);
    if (
      !raw
      || !isDisplayString(raw.sessionId, MAX_DYNAMIC_WORKFLOW_LABEL_LENGTH)
      || !Array.isArray(raw.runs)
      || raw.runs.length > MAX_DYNAMIC_WORKFLOW_RUNS
    ) return undefined;

    const runs: DynamicWorkflowRunSnapshot[] = [];
    for (const value of raw.runs) {
      const run = parseRunSnapshotValue(value);
      if (!run || run.sessionId !== raw.sessionId) return undefined;
      runs.push(run);
    }
    return { sessionId: raw.sessionId, runs };
  } catch {
    return undefined;
  }
}
