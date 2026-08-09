import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { centeredDialogOverlay, showDialog } from "../../shared/ui/index.ts";
import {
  DYNAMIC_WORKFLOW_OPEN_AGENT_EVENT,
  DYNAMIC_WORKFLOW_RUN_EVENT,
  DYNAMIC_WORKFLOW_STATE_EVENT,
  DYNAMIC_WORKFLOW_STATE_REQUEST_EVENT,
  DYNAMIC_WORKFLOW_TARGETED_CONTROL_EVENT,
  type DynamicWorkflowOpenAgentEvent,
  type DynamicWorkflowRunEvent,
  type DynamicWorkflowRunPhase,
  type DynamicWorkflowStateEvent,
  type DynamicWorkflowStateRequestEvent,
  type DynamicWorkflowTargetedControlEvent,
} from "../../lib/dynamic-workflow-events.ts";
import {
  WORKFLOW_DIALOG_MAX_HEIGHT,
  WorkflowDialogComponent,
  type WorkflowReviewResult,
} from "./form/dialog.ts";
import { parentResultText } from "./output.ts";
import { PermissionApprovalQueue } from "./permissions.ts";
import { CoalescedProgress } from "./progress.ts";
import { loadRoles } from "./roles.ts";
import { aggregateAgentUsage, controlRunningAgent, runAgent } from "./runner.ts";
import { childArtifactPaths, workflowArtifactDirectory, writeChildControl } from "./protocol.ts";
import { attachZmxSession, killZmxSession, resolveZmxExecutable } from "./zmx.ts";
import { formatRun, loadRuns, saveRun, toRunSnapshot, toRunSnapshots } from "./store.ts";
import type { AgentRunRecord, ResolvedWorkflow, WorkflowRun } from "./types.ts";
import { expandAgentOutputs, resolveWorkflow } from "./workflow.ts";

const CONCURRENCY = 4;

function validateResources(plan: ResolvedWorkflow, pi: ExtensionAPI, ctx: ExtensionContext) {
  const tools = new Set(pi.getAllTools().map((tool) => tool.name));
  for (const agent of plan.agents) {
    const slash = agent.resolvedRole.model.indexOf("/");
    const provider = agent.resolvedRole.model.slice(0, slash);
    const model = agent.resolvedRole.model.slice(slash + 1);
    if (!ctx.modelRegistry.find(provider, model)) throw new Error(`Role ${agent.role} uses unavailable model ${agent.resolvedRole.model}`);
    const unknownTool = agent.effectiveTools.find((tool) => !tools.has(tool));
    if (unknownTool) throw new Error(`Agent ${agent.id} uses unknown tool ${unknownTool}`);
    const unknownSkill = agent.effectiveSkills.find((skill) => !existsSync(join(getAgentDir(), "skills", skill, "SKILL.md")));
    if (unknownSkill) throw new Error(`Agent ${agent.id} uses unknown global skill ${unknownSkill}`);
  }
}

async function review(source: string, pi: ExtensionAPI, ctx: ExtensionContext): Promise<WorkflowReviewResult> {
  if (ctx.mode !== "tui") throw new Error("Dynamic workflows require interactive TUI mode for confirmation");
  const loadedRoles = loadRoles();
  const resolveSource = (candidate: string) => {
    const plan = resolveWorkflow(candidate, loadedRoles.roles, ctx.cwd, loadedRoles.diagnostics);
    validateResources(plan, pi, ctx);
    return plan;
  };
  let plan: ResolvedWorkflow;
  try {
    plan = resolveSource(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Dynamic workflow validation failed: ${message}`, { cause: error });
  }
  const result = await showDialog<WorkflowReviewResult | undefined>(pi, ctx, (tui, theme, _keybindings, done) =>
    new WorkflowDialogComponent({
      tui,
      theme,
      plan,
      roles: loadedRoles.roles,
      resolveSource,
      onDone: done,
    }),
    {
      notification: {
        title: "Pi needs your input",
        body: "Review dynamic workflow",
      },
      overlayOptions: centeredDialogOverlay({
        width: "90%",
        minWidth: 50,
        maxHeight: WORKFLOW_DIALOG_MAX_HEIGHT,
      }),
    },
  );
  return result ?? { action: "cancel" };
}

export async function mapLimit<T>(
  items: T[],
  limit: number,
  operation: (item: T) => Promise<void>,
  signal?: AbortSignal,
) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!signal?.aborted && index < items.length) {
      const item = items[index++];
      if (signal?.aborted) return;
      if (item !== undefined) await operation(item);
    }
  });
  await Promise.all(workers);
}

function parentResultDetails(run: WorkflowRun) {
  return {
    runId: run.runId,
    status: run.status,
    artifact: join(workflowArtifactDirectory(run.runId), "run.json"),
    agents: run.agents.map((agent) => ({
      id: agent.id,
      status: agent.status,
      ...(agent.session?.sessionFile ? { artifact: agent.session.sessionFile }
        : agent.backend?.kind === "zmx" ? { artifact: childArtifactPaths(run.runId, agent.id).directory } : {}),
    })),
  };
}

export function cancelUnfinishedAgents(run: WorkflowRun, finishedAt = Date.now()): void {
  for (const agent of run.agents) {
    if (agent.status !== "queued" && agent.status !== "running") continue;
    agent.status = "cancelled";
    agent.error = agent.startedAt
      ? "Workflow cancelled while agent was running"
      : "Workflow cancelled before agent launch";
    agent.finishedAt = finishedAt;
  }
}

type ActiveRun = { run: WorkflowRun; abort: AbortController; closeProgress?: () => void };

export function finalizeRunForShutdown(
  activeRun: ActiveRun,
  persist: (run: WorkflowRun) => void,
  publish: (run: WorkflowRun) => void,
  finishedAt = Date.now(),
): void {
  activeRun.closeProgress?.();
  activeRun.abort.abort(new Error("Session is shutting down"));
  activeRun.run.status = "cancelled";
  cancelUnfinishedAgents(activeRun.run, finishedAt);
  activeRun.run.finishedAt = finishedAt;
  persist(activeRun.run);
  publish(activeRun.run);
}

export default function dynamicWorkflows(pi: ExtensionAPI) {
  const active = new Map<string, ActiveRun>();
  let currentSessionId: string | undefined;
  let lastUi: ExtensionContext["ui"] | undefined;
  let attachingAgent = false;

  const updateStatus = () => {
    if (!lastUi) return;
    lastUi.setStatus("dynamic-workflows", active.size ? lastUi.theme.fg("warning", `■ workflows ${active.size}`) : undefined);
  };

  const publishRun = (run: WorkflowRun, phase: DynamicWorkflowRunPhase) => {
    if (run.sessionId !== currentSessionId) return;
    const event: DynamicWorkflowRunEvent = { sessionId: run.sessionId, phase, run: toRunSnapshot(run) };
    pi.events.emit(DYNAMIC_WORKFLOW_RUN_EVENT, event);
  };

  const publishState = (sessionId: string) => {
    if (sessionId !== currentSessionId) return;
    const activeRuns = [...active.values()]
      .map(({ run }) => run)
      .filter((run) => run.sessionId === sessionId)
      .sort((left, right) => right.startedAt - left.startedAt);
    const activeIds = new Set(activeRuns.map((run) => run.runId));
    const persistedRuns = loadRuns(sessionId).filter((run) => !activeIds.has(run.runId));
    const event: DynamicWorkflowStateEvent = { sessionId, runs: toRunSnapshots([...activeRuns, ...persistedRuns]) };
    pi.events.emit(DYNAMIC_WORKFLOW_STATE_EVENT, event);
  };

  pi.events.on(DYNAMIC_WORKFLOW_STATE_REQUEST_EVENT, (data) => {
    const request = data as Partial<DynamicWorkflowStateRequestEvent> | undefined;
    if (typeof request?.sessionId === "string") publishState(request.sessionId);
  });
  pi.events.on(DYNAMIC_WORKFLOW_OPEN_AGENT_EVENT, (data) => {
    const request = data as Partial<DynamicWorkflowOpenAgentEvent> | undefined;
    if (
      typeof request?.sessionId !== "string" || request.sessionId !== currentSessionId ||
      typeof request.runId !== "string" || typeof request.agentId !== "string"
    ) return;
    const run = active.get(request.runId)?.run
      ?? loadRuns(request.sessionId).find((candidate) => candidate.runId === request.runId);
    const agent = run?.agents.find((record) => record.id === request.agentId);
    const sessionName = agent?.backend?.kind === "zmx" ? agent.backend.zmxSessionId : undefined;
    const zmxPath = resolveZmxExecutable();
    const ui = lastUi;
    if (!sessionName || !zmxPath || !ui) {
      ui?.notify("This workflow agent has no attachable zmx session", "warning");
      return;
    }
    if (attachingAgent) {
      ui.notify("Another workflow agent is already open", "warning");
      return;
    }
    attachingAgent = true;
    void ui.custom<void>((tui, _theme, _keybindings, done) => {
      void attachZmxSession(tui, zmxPath, sessionName)
        .catch((error) => ui.notify(`Unable to attach workflow agent: ${error instanceof Error ? error.message : String(error)}`, "error"))
        .finally(() => {
          attachingAgent = false;
          done(undefined);
        });
      return { render: () => [], invalidate: () => {} };
    });
  });
  pi.events.on(DYNAMIC_WORKFLOW_TARGETED_CONTROL_EVENT, (data) => {
    const request = data as Partial<DynamicWorkflowTargetedControlEvent> | undefined;
    if (
      typeof request?.sessionId !== "string" || request.sessionId !== currentSessionId ||
      typeof request.runId !== "string" || typeof request.agentId !== "string" ||
      (request.action !== "interrupt" && request.action !== "terminate")
    ) return;
    const run = active.get(request.runId)?.run
      ?? loadRuns(request.sessionId).find((candidate) => candidate.runId === request.runId);
    if (!run || run.sessionId !== request.sessionId) return;
    const agent = run.agents.find((record) => record.id === request.agentId);
    if (!agent) return;
    const controlled = agent.status === "running" && controlRunningAgent(request.runId, request.agentId, request.action);
    if (controlled && request.action === "interrupt") return;
    if (agent.backend?.kind !== "zmx") return;
    if (request.action === "interrupt") {
      writeChildControl(childArtifactPaths(request.runId, request.agentId), "interrupt");
      return;
    }
    const zmxPath = resolveZmxExecutable();
    const zmxSessionId = agent.backend.zmxSessionId;
    if (!zmxPath || !zmxSessionId) return;
    void killZmxSession(zmxPath, zmxSessionId).catch((error) => {
      lastUi?.notify(`Unable to terminate workflow agent: ${error instanceof Error ? error.message : String(error)}`, "error");
    });
  });

  pi.on("session_start", (_event, ctx) => {
    currentSessionId = ctx.sessionManager.getSessionId();
    if (ctx.hasUI) lastUi = ctx.ui;
    updateStatus();
    publishState(currentSessionId);
  });
  pi.on("session_shutdown", async () => {
    for (const activeRun of active.values()) {
      finalizeRunForShutdown(activeRun, saveRun, (run) => publishRun(run, "settled"));
    }
    active.clear();
    updateStatus();
    if (currentSessionId) publishState(currentSessionId);
    currentSessionId = undefined;
  });

  pi.registerCommand("workflows", {
    description: "List and inspect dynamic workflow runs",
    handler: async (_args, ctx) => {
      const persisted = loadRuns(ctx.sessionManager.getSessionId());
      const byId = new Map(persisted.map((run) => [run.runId, run]));
      for (const [id, value] of active) byId.set(id, value.run);
      const runs = [...byId.values()].sort((left, right) => right.startedAt - left.startedAt);
      if (!runs.length) { ctx.ui.notify("No dynamic workflow runs in this session", "info"); return; }
      const labels = runs.map((run) => `${run.status === "running" ? "*" : " "} ${run.runId}  ${run.status}  ${run.name}`);
      const choice = await ctx.ui.select("Dynamic workflows", labels);
      if (!choice) return;
      const selected = runs[labels.indexOf(choice)];
      if (!selected) return;
      const agentLabels = selected.agents.map((agent) => `${agent.status}  ${agent.id}  [${agent.role}]`);
      const agentChoice = await ctx.ui.select("Workflow agents", [...agentLabels, "View workflow details"]);
      if (!agentChoice) return;
      if (agentChoice === "View workflow details") {
        if (ctx.mode === "tui") await ctx.ui.editor("Workflow details (read-only; edits are ignored)", formatRun(selected));
        else ctx.ui.notify(formatRun(selected), "info");
        return;
      }
      const agent = selected.agents[agentLabels.indexOf(agentChoice)];
      if (!agent) return;
      const actions = [
        ...(agent.backend?.kind === "zmx" ? ["Open agent"] : []),
        ...(agent.status === "running" ? ["Interrupt agent"] : []),
        ...(agent.backend?.kind === "zmx" ? ["Terminate session"] : []),
        "View workflow details",
      ];
      const action = await ctx.ui.select(`Agent ${agent.id}`, actions);
      const target = { sessionId: selected.sessionId, runId: selected.runId, agentId: agent.id };
      if (action === "Open agent") pi.events.emit(DYNAMIC_WORKFLOW_OPEN_AGENT_EVENT, target);
      else if (action === "Interrupt agent") pi.events.emit(DYNAMIC_WORKFLOW_TARGETED_CONTROL_EVENT, { ...target, action: "interrupt" });
      else if (action === "Terminate session") pi.events.emit(DYNAMIC_WORKFLOW_TARGETED_CONTROL_EVENT, { ...target, action: "terminate" });
      else if (action === "View workflow details") {
        if (ctx.mode === "tui") await ctx.ui.editor("Workflow details (read-only; edits are ignored)", formatRun(selected));
        else ctx.ui.notify(formatRun(selected), "info");
      }
    },
  });

  pi.registerTool({
    name: "dynamic_workflow",
    label: "Dynamic Workflow",
    description: [
      "Propose a complete static subagent DAG and run it only after user confirmation.",
      "The script must be exactly `export const workflow = { name, description?, agents }` using static literals.",
      "Each agent requires id, role, prompt, and dependsOn. Optional contextFiles preload approved worktree files; tools and skills may only narrow its role.",
      "Declare every agent up front. Agents in the same dependency wave run in parallel. Use {{agents.ID.output}} in dependent prompts.",
      "Validation failures are returned as tool errors; correct the complete workflow and call dynamic_workflow again.",
    ].join(" "),
    promptSnippet: "Propose an editable, statically declared DAG of isolated Pi subagents",
    promptGuidelines: [
      "Use dynamic_workflow only when the user requests a multi-agent workflow or a task clearly benefits from parallel specialized agents.",
      "When dynamic_workflow returns a validation error, correct the complete workflow and call dynamic_workflow again.",
    ],
    parameters: Type.Object({ script: Type.String({ description: "Static JavaScript workflow definition" }) }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const reviewResult = await review(params.script, pi, ctx);
      if (reviewResult.action === "cancel") {
        return { content: [{ type: "text", text: "Dynamic workflow cancelled before execution." }], details: { cancelled: true } };
      }
      if (reviewResult.action === "suggest") {
        return {
          content: [{
            type: "text",
            text: `The user requested a workflow revision. Apply the suggestion below and call dynamic_workflow again with a complete revised static workflow. Do not run the rejected workflow.\n\nSuggestion:\n${reviewResult.suggestion}`,
          }],
          details: { suggested: true, suggestion: reviewResult.suggestion },
        };
      }
      if (reviewResult.action === "invalid") {
        throw new Error(`Dynamic workflow validation failed: ${reviewResult.error}`);
      }
      const plan = reviewResult.plan;

      const runId = `wf_${randomBytes(6).toString("hex")}`;
      const run: WorkflowRun = {
        runId,
        sessionId: ctx.sessionManager.getSessionId(),
        name: plan.definition.name,
        ...(plan.definition.description ? { description: plan.definition.description } : {}),
        cwd: ctx.cwd,
        status: "running",
        approvedSource: plan.source,
        waves: plan.waves,
        agents: plan.agents.map((agent): AgentRunRecord => ({
          id: agent.id, role: agent.role, prompt: agent.prompt, status: "queued",
          model: agent.resolvedRole.model, tools: agent.effectiveTools, skills: agent.effectiveSkills,
        })),
        permissionDecisions: [],
        startedAt: Date.now(),
      };
      const abort = new AbortController();
      const onAbort = () => abort.abort(signal?.reason);
      if (signal?.aborted) onAbort(); else signal?.addEventListener("abort", onAbort, { once: true });
      const approvalQueue = new PermissionApprovalQueue();
      const outputs = new Map<string, string>();
      const commitProgress = () => {
        saveRun(run);
        publishRun(run, "progress");
        onUpdate?.({
          content: [{ type: "text", text: `${run.name}: ${run.agents.filter((agent) => agent.status === "completed").length}/${run.agents.length} agents completed` }],
          details: parentResultDetails(run),
        });
      };
      const progress = new CoalescedProgress(commitProgress);
      active.set(runId, { run, abort, closeProgress: () => progress.dispose() });
      if (ctx.hasUI) lastUi = ctx.ui;
      updateStatus();
      saveRun(run);
      publishRun(run, "started");

      try {
        for (const wave of plan.waves) {
          if (abort.signal.aborted) break;
          const definitions = wave.map((id) => plan.agents.find((agent) => agent.id === id)!);
          await mapLimit(definitions, CONCURRENCY, async (agent) => {
            const record = run.agents.find((item) => item.id === agent.id)!;
            const failedDependency = agent.dependsOn.find((id) => run.agents.find((item) => item.id === id)?.status !== "completed");
            if (failedDependency) {
              record.status = "skipped";
              record.error = `Dependency ${failedDependency} did not complete`;
              record.finishedAt = Date.now();
              progress.immediate();
              return;
            }
            let expandedPrompt: string;
            try {
              expandedPrompt = expandAgentOutputs(agent.prompt, outputs);
            } catch (error) {
              record.status = "failed";
              record.error = error instanceof Error ? error.message : String(error);
              record.finishedAt = Date.now();
              progress.immediate();
              return;
            }
            record.status = "running";
            record.startedAt = Date.now();
            record.activity = "Starting Pi session";
            record.sidebarActivity = "Starting Pi session";
            progress.immediate();
            const result = await runAgent({
              runId,
              agent,
              prompt: expandedPrompt,
              cwd: ctx.cwd,
              projectTrusted: ctx.isProjectTrusted(),
              parentContext: ctx,
              approvalQueue,
              signal: abort.signal,
              record,
              onPermission: (decision) => { run.permissionDecisions.push(decision); progress.immediate(); },
              onProgress: () => progress.transient(),
            });
            if (active.get(runId)?.run !== run) return;
            record.finishedAt = Date.now();
            record.finalSummary = result.finalSummary;
            if (result.ok) {
              record.status = "completed";
              outputs.set(agent.id, result.finalSummary);
            } else {
              record.status = abort.signal.aborted || result.cancelled ? "cancelled" : "failed";
              record.error = result.error ?? "Agent failed";
            }
            progress.immediate();
          }, abort.signal);
        }
        run.status = abort.signal.aborted ? "cancelled" : run.agents.some((agent) => agent.status === "failed" || agent.status === "skipped") ? "failed" : "completed";
      } catch (error) {
        run.status = abort.signal.aborted ? "cancelled" : "failed";
        run.error = error instanceof Error ? error.message : String(error);
      } finally {
        signal?.removeEventListener("abort", onAbort);
        progress.dispose();
        if (active.get(runId)?.run === run) {
          if (abort.signal.aborted) {
            cancelUnfinishedAgents(run);
          } else {
            for (const agent of run.agents) {
              if (agent.status !== "queued" && agent.status !== "running") continue;
              agent.status = agent.status === "queued" ? "skipped" : "failed";
              agent.error = run.error ?? "Workflow stopped before the agent settled";
              agent.finishedAt = Date.now();
            }
          }
          run.finishedAt = Date.now();
          saveRun(run);
          publishRun(run, "settled");
          active.delete(runId);
          updateStatus();
        }
      }
      return {
        content: [{ type: "text", text: parentResultText(run) }],
        details: parentResultDetails(run),
        usage: aggregateAgentUsage(run.agents),
      };
    },

    renderCall(args, theme) {
      return new Text(`${theme.fg("toolTitle", theme.bold("dynamic workflow"))}\n${theme.fg("dim", args.script?.slice(0, 500) ?? "")}`, 0, 0);
    },
    renderResult(result, _options, theme) {
      const first = result.content[0];
      return new Text(first?.type === "text" ? first.text : theme.fg("muted", "No workflow output"), 0, 0);
    },
  });
}
