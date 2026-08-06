import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { centeredDialogOverlay } from "../../shared/ui/index.ts";
import {
  DYNAMIC_WORKFLOW_RUN_EVENT,
  DYNAMIC_WORKFLOW_STATE_EVENT,
  DYNAMIC_WORKFLOW_STATE_REQUEST_EVENT,
  type DynamicWorkflowRunEvent,
  type DynamicWorkflowRunPhase,
  type DynamicWorkflowStateEvent,
  type DynamicWorkflowStateRequestEvent,
} from "../../lib/dynamic-workflow-events.ts";
import { WorkflowDialogComponent } from "./form/dialog.ts";
import { PermissionApprovalQueue } from "./permissions.ts";
import { loadRoles } from "./roles.ts";
import { runAgent } from "./runner.ts";
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

async function review(source: string, pi: ExtensionAPI, ctx: ExtensionContext): Promise<ResolvedWorkflow | undefined> {
  if (ctx.mode !== "tui") throw new Error("Dynamic workflows require interactive TUI mode for editable approval");
  const roles = loadRoles();
  return ctx.ui.custom<ResolvedWorkflow | undefined>((tui, theme, _keybindings, done) =>
    new WorkflowDialogComponent({
      tui,
      theme,
      source,
      roles,
      resolveSource: (canonicalSource) => {
        const plan = resolveWorkflow(canonicalSource, roles);
        validateResources(plan, pi, ctx);
        return plan;
      },
      onDone: done,
    }),
    {
      overlay: true,
      overlayOptions: centeredDialogOverlay({
        width: "90%",
        minWidth: 50,
        maxHeight: "90%",
      }),
    },
  );
}

async function mapLimit<T>(items: T[], limit: number, operation: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      if (item !== undefined) await operation(item);
    }
  });
  await Promise.all(workers);
}

export default function dynamicWorkflows(pi: ExtensionAPI) {
  const active = new Map<string, { run: WorkflowRun; abort: AbortController }>();
  let currentSessionId: string | undefined;
  let lastUi: ExtensionContext["ui"] | undefined;

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

  pi.on("session_start", (_event, ctx) => {
    currentSessionId = ctx.sessionManager.getSessionId();
    if (ctx.hasUI) lastUi = ctx.ui;
    updateStatus();
    publishState(currentSessionId);
  });
  pi.on("session_shutdown", async () => {
    for (const { run, abort } of active.values()) {
      abort.abort(new Error("Session is shutting down"));
      run.status = "cancelled";
      run.finishedAt = Date.now();
      saveRun(run);
      publishRun(run, "settled");
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
      if (ctx.mode === "tui") await ctx.ui.editor("Workflow details (read-only; edits are ignored)", formatRun(selected));
      else ctx.ui.notify(formatRun(selected), "info");
    },
  });

  pi.registerTool({
    name: "dynamic_workflow",
    label: "Dynamic Workflow",
    description: [
      "Propose a complete static subagent DAG and run it only after editable user approval.",
      "The script must be exactly `export const workflow = { name, description?, agents }` using static literals.",
      "Each agent requires id, role, prompt, and dependsOn. Optional tools, skills, and permissions.commands may only narrow its role.",
      "Declare every agent up front. Agents in the same dependency wave run in parallel. Use {{agents.ID.output}} in dependent prompts.",
    ].join(" "),
    promptSnippet: "Propose an editable, statically declared DAG of isolated Pi subagents",
    promptGuidelines: ["Use dynamic_workflow only when the user requests a multi-agent workflow or a task clearly benefits from parallel specialized agents."],
    parameters: Type.Object({ script: Type.String({ description: "Static JavaScript workflow definition" }) }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const plan = await review(params.script, pi, ctx);
      if (!plan) return { content: [{ type: "text", text: "Dynamic workflow cancelled before execution." }], details: { cancelled: true } };

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
      active.set(runId, { run, abort });
      if (ctx.hasUI) lastUi = ctx.ui;
      updateStatus();
      saveRun(run);
      publishRun(run, "started");
      const approvalQueue = new PermissionApprovalQueue();
      const outputs = new Map<string, string>();
      const emit = () => {
        saveRun(run);
        publishRun(run, "progress");
        onUpdate?.({
          content: [{ type: "text", text: `${run.name}: ${run.agents.filter((agent) => agent.status === "completed").length}/${run.agents.length} agents completed` }],
          details: { runId, status: run.status, agents: run.agents.map(({ id, role, status, activity, error }) => ({ id, role, status, activity, error })) },
        });
      };

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
              emit();
              return;
            }
            record.status = "running";
            record.startedAt = Date.now();
            record.activity = "Starting Pi session";
            record.sidebarActivity = "Starting Pi session";
            emit();
            const result = await runAgent({
              agent,
              prompt: expandAgentOutputs(agent.prompt, outputs),
              cwd: ctx.cwd,
              projectTrusted: ctx.isProjectTrusted(),
              parentContext: ctx,
              approvalQueue,
              signal: abort.signal,
              record,
              onPermission: (decision) => { run.permissionDecisions.push(decision); emit(); },
              onProgress: emit,
            });
            record.finishedAt = Date.now();
            record.output = result.output;
            if (result.ok) {
              record.status = "completed";
              outputs.set(agent.id, result.output);
            } else {
              record.status = abort.signal.aborted ? "cancelled" : "failed";
              record.error = result.error ?? "Agent failed";
            }
            emit();
          });
        }
        run.status = abort.signal.aborted ? "cancelled" : run.agents.some((agent) => agent.status === "failed" || agent.status === "skipped") ? "failed" : "completed";
      } catch (error) {
        run.status = abort.signal.aborted ? "cancelled" : "failed";
        run.error = error instanceof Error ? error.message : String(error);
      } finally {
        signal?.removeEventListener("abort", onAbort);
        run.finishedAt = Date.now();
        saveRun(run);
        publishRun(run, "settled");
        active.delete(runId);
        updateStatus();
      }
      return { content: [{ type: "text", text: formatRun(run) }], details: { runId, status: run.status, agents: run.agents } };
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
