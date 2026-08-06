export const DYNAMIC_WORKFLOW_EVENTS = {
  run: "dynamic-workflows:run",
  stateRequest: "dynamic-workflows:state-request",
  state: "dynamic-workflows:state",
} as const;

export const DYNAMIC_WORKFLOW_RUN_EVENT = DYNAMIC_WORKFLOW_EVENTS.run;
export const DYNAMIC_WORKFLOW_STATE_REQUEST_EVENT = DYNAMIC_WORKFLOW_EVENTS.stateRequest;
export const DYNAMIC_WORKFLOW_STATE_EVENT = DYNAMIC_WORKFLOW_EVENTS.state;

export const MAX_DYNAMIC_WORKFLOW_RUNS = 25;
export const MAX_DYNAMIC_WORKFLOW_AGENTS = 32;
export const MAX_DYNAMIC_WORKFLOW_LABEL_LENGTH = 120;
export const MAX_DYNAMIC_WORKFLOW_DETAIL_LENGTH = 240;

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

/** Remove terminal control sequences and keep event strings single-line and bounded. */
export function dynamicWorkflowDisplayText(value: unknown, maxLength = MAX_DYNAMIC_WORKFLOW_DETAIL_LENGTH): string {
  if (typeof value !== "string" || maxLength <= 0) return "";
  const safe = value
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, "")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(safe);
  if (characters.length <= maxLength) return safe;
  if (maxLength === 1) return "…";
  return `${characters.slice(0, maxLength - 1).join("")}…`;
}
