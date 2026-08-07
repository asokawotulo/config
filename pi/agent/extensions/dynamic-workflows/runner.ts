import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionContext,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { authorizeCommand, PermissionApprovalQueue } from "./permissions.ts";
import {
  CHILD_PROTOCOL_VERSION,
  atomicWriteJson,
  childArtifactPaths,
  delay,
  initializeChildArtifacts,
  lastAssistantSummary,
  listPermissionRequests,
  permissionResponsePath,
  readJson,
  truncateUtf8,
  writeChildConfig,
  writeChildControl,
  type ChildStatus,
  type PermissionResponse,
} from "./protocol.ts";
import type { AgentRunRecord, PermissionDecisionRecord, ResolvedAgentDefinition } from "./types.ts";
import { aggregateUsage, isCompleteUsage, usageFromSessionEntries } from "./usage.ts";
import {
  collisionSafeZmxName,
  resolveZmxExecutable,
  selectedExecutionBackend,
  startZmxChild,
} from "./zmx.ts";

const FORBIDDEN_CHILD_TOOLS = new Set(["dynamic_workflow", "ask_user"]);
const ZMX_START_TIMEOUT_MS = 30_000;
const ZMX_STALL_TIMEOUT_MS = 15_000;
const ABORT_SETTLE_TIMEOUT_MS = 5_000;
const CONTEXT_FIRST_INSTRUCTION = "Use the supplied approved context files first. Explore other worktree files only when those files are insufficient to complete the task correctly.";
const FINAL_HANDOFF_INSTRUCTION = "Finish with one concise handoff summary containing only the findings or changes, focused verification, and unresolved issues needed by the parent or dependent agents. Do not replay the conversation or tool transcript.";

export interface RunAgentResult {
  ok: boolean;
  finalSummary: string;
  /** @deprecated Compatibility alias; always identical to finalSummary. */
  output: string;
  error?: string;
  cancelled?: boolean;
}

export interface RunAgentOptions {
  runId: string;
  agent: ResolvedAgentDefinition;
  prompt: string;
  cwd: string;
  projectTrusted: boolean;
  parentContext: ExtensionContext;
  approvalQueue: PermissionApprovalQueue;
  signal?: AbortSignal;
  record: AgentRunRecord;
  onPermission: (decision: PermissionDecisionRecord) => void;
  onProgress: () => void;
  /** Deterministic backend override for focused tests. */
  zmxPath?: string | null;
}

type ControlAction = "interrupt" | "terminate";
const activeControls = new Map<string, (action: ControlAction) => void>();
const controlKey = (runId: string, agentId: string) => `${runId}\u0000${agentId}`;

export function controlRunningAgent(runId: string, agentId: string, action: ControlAction): boolean {
  const control = activeControls.get(controlKey(runId, agentId));
  if (!control) return false;
  control(action);
  return true;
}

function result(ok: boolean, finalSummary: string, error?: string, cancelled = false): RunAgentResult {
  return { ok, finalSummary, output: finalSummary, ...(error ? { error } : {}), ...(cancelled ? { cancelled: true } : {}) };
}

function childSystemPrompt(agent: ResolvedAgentDefinition): string {
  return [
    agent.resolvedRole.prompt,
    agent.contextBundle?.text ? `${CONTEXT_FIRST_INSTRUCTION}\n\n${agent.contextBundle.text}` : "",
    FINAL_HANDOFF_INSTRUCTION,
  ].filter(Boolean).join("\n\n");
}

async function shutdown(session: AgentSession) {
  try {
    const runner = session.extensionRunner;
    if (runner.hasHandlers("session_shutdown")) await runner.emit({ type: "session_shutdown", reason: "quit" });
  } catch { /* best effort */ }
  session.dispose();
}

function permissionExtension(options: RunAgentOptions): InlineExtension {
  return {
    name: `dynamic-workflow-permissions:${options.agent.id}`,
    factory: (pi) => {
      pi.on("tool_call", async (event) => {
        if (event.toolName !== "bash" && event.toolName !== "Shell") return;
        const input = event.input as Record<string, unknown>;
        if (typeof input.command !== "string") return { block: true, reason: "Malformed shell command denied" };
        const verdict = await authorizeCommand({
          command: input.command,
          cwd: options.cwd,
          agentId: options.agent.id,
          ctx: options.parentContext,
          queue: options.approvalQueue,
          signal: options.signal,
          record: options.onPermission,
        });
        if (verdict.block) return { block: true, reason: verdict.block };
        if (verdict.command) input.command = verdict.command;
      });
    },
  };
}

function validateAgent(options: RunAgentOptions): { model: NonNullable<ReturnType<ExtensionContext["modelRegistry"]["find"]>> } | { error: string } {
  const role = options.agent.resolvedRole;
  const slash = role.model.indexOf("/");
  const provider = role.model.slice(0, slash);
  const modelId = role.model.slice(slash + 1);
  const model = options.parentContext.modelRegistry.find(provider, modelId);
  if (!model) return { error: `Unknown model ${role.model}` };
  const forbidden = options.agent.effectiveTools.find((tool) => FORBIDDEN_CHILD_TOOLS.has(tool));
  if (forbidden) return { error: `Tool ${forbidden} is forbidden in workflow children` };
  return { model };
}

async function runEmbedded(options: RunAgentOptions, model: NonNullable<ReturnType<ExtensionContext["modelRegistry"]["find"]>>): Promise<RunAgentResult> {
  const role = options.agent.resolvedRole;
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(options.cwd, agentDir, { projectTrusted: options.projectTrusted });
  const allowedSkills = new Set(options.agent.effectiveSkills);
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir,
    settingsManager,
    appendSystemPrompt: [childSystemPrompt(options.agent)],
    extensionFactories: [permissionExtension(options)],
    extensionsOverride: (current) => ({ ...current, extensions: [] }),
    skillsOverride: (current) => ({
      skills: current.skills.filter((skill) => allowedSkills.has(skill.name)),
      diagnostics: current.diagnostics,
    }),
  });
  await loader.reload();
  const loadedSkills = new Set(loader.getSkills().skills.map((skill) => skill.name));
  const missingSkill = options.agent.effectiveSkills.find((skill) => !loadedSkills.has(skill));
  if (missingSkill) return result(false, "", `Unknown or unavailable skill ${missingSkill}`);

  let session: AgentSession | undefined;
  const key = controlKey(options.runId, options.agent.id);
  try {
    const sessionManager = SessionManager.create(options.cwd);
    ({ session } = await createAgentSession({
      cwd: options.cwd,
      model,
      ...(role.thinking ? { thinkingLevel: role.thinking } : {}),
      tools: options.agent.effectiveTools,
      resourceLoader: loader,
      settingsManager,
      sessionManager,
    }));
    await session.bindExtensions({ mode: "print" });
    const child = session;
    options.record.backend = { kind: "pi", provider: model.provider, model: model.id };
    options.record.session = {
      sessionId: child.sessionId,
      ...(child.sessionFile ? { sessionFile: child.sessionFile } : {}),
    };
    const unsubscribe = child.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        options.record.activity = `Using ${event.toolName}`;
        options.record.sidebarActivity = `Using ${event.toolName}`;
      } else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        options.record.activity = "Writing response";
        options.record.sidebarActivity = "Writing response";
      } else if (event.type === "message_end" && event.message.role === "assistant") {
        options.record.activity = "Response complete";
        options.record.sidebarActivity = "Response complete";
      } else return;
      options.onProgress();
    });
    const control = (_action: ControlAction) => {
      // Both targeted actions abort the active child context. The persistent
      // transcript remains inspectable after the embedded session is disposed.
      void child.abort();
    };
    activeControls.set(key, control);
    const onAbort = () => control("interrupt");
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await child.prompt(options.prompt);
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      activeControls.delete(key);
      unsubscribe();
    }
    const summary = lastAssistantSummary(child.messages);
    options.record.usage = usageFromSessionEntries(sessionManager.getEntries());
    const lastAssistant = [...child.messages].reverse().find((message) => message.role === "assistant");
    const aborted = lastAssistant?.role === "assistant" && lastAssistant.stopReason === "aborted";
    const error = lastAssistant?.role === "assistant" && (lastAssistant.stopReason === "error" || aborted)
      ? lastAssistant.errorMessage ?? (aborted ? "Agent interrupted" : "Agent failed")
      : undefined;
    return result(!error, summary, error, aborted);
  } catch (error) {
    const summary = session ? lastAssistantSummary(session.messages) : "";
    return result(false, summary, error instanceof Error ? error.message : String(error));
  } finally {
    activeControls.delete(key);
    if (session) await shutdown(session);
  }
}

async function brokerPermissionRequests(options: RunAgentOptions, processed: Set<string>): Promise<void> {
  const paths = childArtifactPaths(options.runId, options.agent.id);
  for (const request of listPermissionRequests(paths)) {
    if (processed.has(request.id)) continue;
    const responsePath = permissionResponsePath(paths, request.id);
    if (readJson<PermissionResponse>(responsePath)) { processed.add(request.id); continue; }
    let verdict: { command?: string; block?: string };
    try {
      verdict = await authorizeCommand({
        command: request.command,
        cwd: options.cwd,
        agentId: options.agent.id,
        ctx: options.parentContext,
        queue: options.approvalQueue,
        signal: options.signal,
        record: options.onPermission,
      });
    } catch (error) {
      verdict = { block: `Permission broker failed closed: ${error instanceof Error ? error.message : String(error)}` };
    }
    const response: PermissionResponse = {
      version: CHILD_PROTOCOL_VERSION,
      id: request.id,
      at: Date.now(),
      ...(verdict.command && !verdict.block ? { command: verdict.command } : { block: verdict.block ?? "Permission denied" }),
    };
    atomicWriteJson(responsePath, response);
    processed.add(request.id);
  }
}

async function runZmx(options: RunAgentOptions, zmxPath: string): Promise<RunAgentResult> {
  const paths = childArtifactPaths(options.runId, options.agent.id);
  initializeChildArtifacts(paths);
  writeChildConfig(paths, {
    version: CHILD_PROTOCOL_VERSION,
    runId: options.runId,
    agentId: options.agent.id,
    prompt: options.prompt,
    systemPrompt: childSystemPrompt(options.agent),
  });
  const sessionName = collisionSafeZmxName(options.runId, options.agent.id);
  options.record.backend = {
    kind: "zmx",
    provider: options.agent.resolvedRole.model.split("/")[0],
    model: options.agent.resolvedRole.model.split("/").slice(1).join("/"),
    zmxSessionId: sessionName,
  };
  options.record.activity = "Starting detached Pi TUI";
  options.record.sidebarActivity = "Starting detached Pi TUI";
  options.onProgress();

  const key = controlKey(options.runId, options.agent.id);
  let abortWrittenAt: number | undefined;
  const control = (action: ControlAction) => {
    if (abortWrittenAt === undefined) abortWrittenAt = Date.now();
    writeChildControl(paths, action);
  };
  activeControls.set(key, control);
  const onAbort = () => control("interrupt");
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    await startZmxChild({
      zmxPath,
      sessionName,
      configPath: paths.config,
      agent: options.agent,
      cwd: options.cwd,
      projectTrusted: options.projectTrusted,
    });
    const startedAt = Date.now();
    const processed = new Set<string>();
    let observedStatus = false;
    let lastStatusAt = -1;
    let lastFreshStatusAt = startedAt;
    while (true) {
      await brokerPermissionRequests(options, processed);
      const status = readJson<ChildStatus>(paths.status);
      if (
        status?.version === CHILD_PROTOCOL_VERSION &&
        typeof status.at === "number" && Number.isFinite(status.at) &&
        (status.state === "starting" || status.state === "running" || status.state === "settled")
      ) {
        observedStatus = true;
        if (status.at !== lastStatusAt) lastFreshStatusAt = Date.now();
        if (typeof status.sessionId === "string") {
          options.record.session = {
            sessionId: status.sessionId,
            ...(status.sessionFile ? { sessionFile: status.sessionFile } : {}),
          };
        }
        if (status.state === "settled") {
          if (typeof status.ok !== "boolean" || typeof status.finalSummary !== "string" || !isCompleteUsage(status.usage)) {
            return result(false, "", "Detached Pi child published malformed settled status");
          }
          options.record.usage = status.usage;
          options.record.activity = "Response complete";
          options.record.sidebarActivity = "Response complete";
          return result(
            status.ok,
            truncateUtf8(status.finalSummary),
            typeof status.error === "string" ? status.error : undefined,
            status.cancelled === true,
          );
        }
        if (status.at !== lastStatusAt) {
          lastStatusAt = status.at;
          const activity = typeof status.activity === "string" ? truncateUtf8(status.activity, 240) : "Working";
          options.record.activity = activity;
          options.record.sidebarActivity = activity;
          options.onProgress();
        }
      }
      if (!observedStatus && Date.now() - startedAt > ZMX_START_TIMEOUT_MS) {
        return result(false, "", "Detached Pi child did not publish startup status");
      }
      if (observedStatus && Date.now() - lastFreshStatusAt > ZMX_STALL_TIMEOUT_MS) {
        return result(false, "", "Detached Pi child stopped publishing heartbeat status");
      }
      if (abortWrittenAt !== undefined && Date.now() - abortWrittenAt > ABORT_SETTLE_TIMEOUT_MS) {
        return result(false, "", "Agent interrupted before publishing settled status", true);
      }
      await delay(75);
    }
  } catch (error) {
    return result(false, "", error instanceof Error ? error.message : String(error));
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    activeControls.delete(key);
  }
}

export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const validated = validateAgent(options);
  if ("error" in validated) return result(false, "", validated.error);
  const zmxPath = options.zmxPath === null ? undefined : options.zmxPath ?? resolveZmxExecutable();
  options.record.backend = { kind: selectedExecutionBackend(zmxPath) };
  return zmxPath ? runZmx(options, zmxPath) : runEmbedded(options, validated.model);
}

export function aggregateAgentUsage(records: readonly AgentRunRecord[]) {
  return aggregateUsage(records.map((record) => record.usage));
}
