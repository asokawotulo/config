import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  MAX_DYNAMIC_WORKFLOW_AGENTS,
  MAX_DYNAMIC_WORKFLOW_COST,
  MAX_DYNAMIC_WORKFLOW_LABEL_LENGTH,
  MAX_DYNAMIC_WORKFLOW_RUNS,
  dynamicWorkflowDisplayText,
  type DynamicWorkflowAgentSnapshot,
  type DynamicWorkflowAgentStatus,
  type DynamicWorkflowRunSnapshot,
  type DynamicWorkflowStatus,
} from "../../lib/dynamic-workflow-events.ts";
import type { WorkflowRun } from "./types.ts";

const AGENT_STATUSES = new Set<DynamicWorkflowAgentStatus>(["queued", "running", "completed", "failed", "skipped", "cancelled"]);
const WORKFLOW_STATUSES = new Set<DynamicWorkflowStatus>(["running", "completed", "failed", "cancelled", "interrupted"]);

function root() { return join(getAgentDir(), "dynamic-workflows"); }
function runDir(runId: string) { return join(root(), runId); }
function timestamp(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function agentStatus(value: unknown): DynamicWorkflowAgentStatus { return AGENT_STATUSES.has(value as DynamicWorkflowAgentStatus) ? value as DynamicWorkflowAgentStatus : "failed"; }
function workflowStatus(value: unknown): DynamicWorkflowStatus { return WORKFLOW_STATUSES.has(value as DynamicWorkflowStatus) ? value as DynamicWorkflowStatus : "failed"; }
function agentCost(value: WorkflowRun["agents"][number]["usage"]): number | undefined {
  const cost = value?.cost;
  const raw = typeof cost === "number" ? cost : cost?.total;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  return Math.min(raw, MAX_DYNAMIC_WORKFLOW_COST);
}

function restoreLegacyAgentFields(run: WorkflowRun): WorkflowRun {
  if (!Array.isArray(run.agents)) run.agents = [];
  for (const agent of run.agents) {
    if (typeof agent.finalSummary !== "string" && typeof agent.output === "string") agent.finalSummary = agent.output;
  }
  return run;
}

/** Project private run artifacts onto the bounded shape safe for shared UI events. */
export function toRunSnapshot(run: WorkflowRun): DynamicWorkflowRunSnapshot {
  const records = Array.isArray(run.agents) ? run.agents : [];
  const agents = records.slice(0, MAX_DYNAMIC_WORKFLOW_AGENTS).map((agent): DynamicWorkflowAgentSnapshot => {
    const startedAt = timestamp(agent.startedAt);
    const finishedAt = timestamp(agent.finishedAt);
    const activity = dynamicWorkflowDisplayText(agent.sidebarActivity);
    const cost = agentCost(agent.usage);
    const zmxSessionId = agent.backend?.kind === "zmx"
      ? dynamicWorkflowDisplayText(agent.backend.zmxSessionId, MAX_DYNAMIC_WORKFLOW_LABEL_LENGTH)
      : "";
    return {
      id: dynamicWorkflowDisplayText(agent.id, MAX_DYNAMIC_WORKFLOW_LABEL_LENGTH),
      role: dynamicWorkflowDisplayText(agent.role, MAX_DYNAMIC_WORKFLOW_LABEL_LENGTH),
      status: agentStatus(agent.status),
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(finishedAt === undefined ? {} : { finishedAt }),
      ...(activity ? { activity } : {}),
      ...(cost === undefined ? {} : { cost }),
      ...(zmxSessionId ? { zmxSessionId } : {}),
    };
  });
  const finishedAt = timestamp(run.finishedAt);
  return {
    runId: dynamicWorkflowDisplayText(run.runId, MAX_DYNAMIC_WORKFLOW_LABEL_LENGTH),
    sessionId: dynamicWorkflowDisplayText(run.sessionId, MAX_DYNAMIC_WORKFLOW_LABEL_LENGTH),
    name: dynamicWorkflowDisplayText(run.name, MAX_DYNAMIC_WORKFLOW_LABEL_LENGTH),
    status: workflowStatus(run.status),
    startedAt: timestamp(run.startedAt) ?? 0,
    ...(finishedAt === undefined ? {} : { finishedAt }),
    agentCount: records.length,
    agents,
  };
}

/** Preserve caller ordering while enforcing the state-event run bound. */
export function toRunSnapshots(runs: Iterable<WorkflowRun>): DynamicWorkflowRunSnapshot[] {
  return Array.from(runs).slice(0, MAX_DYNAMIC_WORKFLOW_RUNS).map(toRunSnapshot);
}

export function saveRun(run: WorkflowRun): void {
  const directory = runDir(run.runId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, "run.json");
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(run, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, target);
  const sourcePath = join(directory, "workflow.js");
  if (!existsSync(sourcePath)) writeFileSync(sourcePath, run.approvedSource, { encoding: "utf8", mode: 0o600 });
}

export function loadRuns(sessionId?: string): WorkflowRun[] {
  if (!existsSync(root())) return [];
  const runs: WorkflowRun[] = [];
  for (const entry of readdirSync(root(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("wf_")) continue;
    try {
      const run = restoreLegacyAgentFields(
        JSON.parse(readFileSync(join(root(), entry.name, "run.json"), "utf8")) as WorkflowRun,
      );
      if (sessionId && run.sessionId !== sessionId) continue;
      if (run.status === "running") run.status = "interrupted";
      runs.push(run);
    } catch { /* ignore corrupt artifacts */ }
  }
  return runs.sort((left, right) => right.startedAt - left.startedAt);
}

export function formatRun(run: WorkflowRun): string {
  const lines = [
    `${run.name} (${run.runId}) — ${run.status}`,
    run.description ?? "",
    `Started: ${new Date(run.startedAt).toLocaleString()}`,
    "",
    "Agents:",
  ].filter(Boolean);
  for (const agent of run.agents) {
    lines.push(`- ${agent.id} [${agent.role}] ${agent.status}${agent.activity ? ` — ${agent.activity}` : ""}`);
    const summary = agent.finalSummary ?? agent.output;
    if (summary) lines.push(`  Result: ${summary}`);
    if (agent.error) lines.push(`  Error: ${agent.error}`);
  }
  if (run.permissionDecisions.length) {
    lines.push("", "Permission decisions:");
    for (const decision of run.permissionDecisions) {
      lines.push(`- ${decision.agentId}: ${decision.action} ${decision.command} (${decision.source}: ${decision.reason})`);
    }
  }
  return lines.join("\n");
}
