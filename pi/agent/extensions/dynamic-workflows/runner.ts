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
import type { AgentRunRecord, PermissionDecisionRecord, ResolvedAgentDefinition } from "./types.ts";

const FORBIDDEN_CHILD_TOOLS = new Set(["dynamic_workflow", "ask_user"]);
const OUTPUT_LIMIT = 64 * 1024;

function truncate(value: string, max = OUTPUT_LIMIT): string {
  if (Buffer.byteLength(value, "utf8") <= max) return value;
  return `${Buffer.from(value, "utf8").subarray(0, max).toString("utf8")}\n[output truncated]`;
}

function finalOutput(session: AgentSession): string {
  for (let index = session.messages.length - 1; index >= 0; index--) {
    const message = session.messages[index];
    if (!message || message.role !== "assistant") continue;
    const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
    if (text) return truncate(text);
  }
  return "";
}

function usage(session: AgentSession) {
  const total = { input: 0, output: 0, cost: 0 };
  for (const message of session.messages) {
    if (message.role !== "assistant" || !message.usage) continue;
    total.input += message.usage.input || 0;
    total.output += message.usage.output || 0;
    total.cost += message.usage.cost?.total || 0;
  }
  return total;
}

async function shutdown(session: AgentSession) {
  try {
    const runner = session.extensionRunner;
    if (runner.hasHandlers("session_shutdown")) await runner.emit({ type: "session_shutdown", reason: "quit" });
  } catch { /* best effort */ }
  session.dispose();
}

export interface RunAgentOptions {
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
}

function permissionExtension(options: RunAgentOptions): InlineExtension {
  return {
    name: `dynamic-workflow-permissions:${options.agent.id}`,
    factory: (pi) => {
      pi.on("tool_call", async (event) => {
        if (event.toolName !== "bash" && event.toolName !== "Shell") return;
        const input = event.input as Record<string, unknown>;
        if (typeof input.command !== "string") return { block: true, reason: "Malformed shell command denied" };
        const result = await authorizeCommand({
          command: input.command,
          cwd: options.cwd,
          agent: options.agent,
          ctx: options.parentContext,
          queue: options.approvalQueue,
          signal: options.signal,
          record: options.onPermission,
        });
        if (result.block) return { block: true, reason: result.block };
        if (result.command) input.command = result.command;
      });
    },
  };
}

export async function runAgent(options: RunAgentOptions): Promise<{ ok: boolean; output: string; error?: string }> {
  const role = options.agent.resolvedRole;
  const slash = role.model.indexOf("/");
  const provider = role.model.slice(0, slash);
  const modelId = role.model.slice(slash + 1);
  const model = options.parentContext.modelRegistry.find(provider, modelId);
  if (!model) return { ok: false, output: "", error: `Unknown model ${role.model}` };
  const forbidden = options.agent.effectiveTools.find((tool) => FORBIDDEN_CHILD_TOOLS.has(tool));
  if (forbidden) return { ok: false, output: "", error: `Tool ${forbidden} is forbidden in workflow children` };

  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(options.cwd, agentDir, { projectTrusted: options.projectTrusted });
  const allowedSkills = new Set(options.agent.effectiveSkills);
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir,
    settingsManager,
    appendSystemPrompt: [role.prompt],
    extensionFactories: [permissionExtension(options)],
    // A separately installed stock CC Safety Net Pi extension would issue its own
    // irreversible block after our approved override. Children use its CLI only.
    extensionsOverride: (current) => ({
      ...current,
      extensions: current.extensions.filter((extension) =>
        !/[\\/]cc-safety-net[\\/].*[\\/]pi[\\/]index\.[cm]?js$/.test(extension.resolvedPath),
      ),
    }),
    skillsOverride: (current) => ({
      skills: current.skills.filter((skill) => allowedSkills.has(skill.name)),
      diagnostics: current.diagnostics,
    }),
  });
  await loader.reload();
  const loadedSkills = new Set(loader.getSkills().skills.map((skill) => skill.name));
  const missingSkill = options.agent.effectiveSkills.find((skill) => !loadedSkills.has(skill));
  if (missingSkill) return { ok: false, output: "", error: `Unknown or unavailable skill ${missingSkill}` };

  let session: AgentSession | undefined;
  try {
    ({ session } = await createAgentSession({
      cwd: options.cwd,
      model,
      ...(role.thinking ? { thinkingLevel: role.thinking } : {}),
      tools: options.agent.effectiveTools,
      resourceLoader: loader,
      settingsManager,
      sessionManager: SessionManager.inMemory(options.cwd),
    }));
    await session.bindExtensions({ mode: "print" });
    const child = session;
    const unsubscribe = child.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        options.record.activity = `${event.toolName} ${JSON.stringify(event.args).slice(0, 300)}`;
        options.record.sidebarActivity = `Using ${event.toolName}`;
      } else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        options.record.activity = truncate((options.record.activity ?? "") + event.assistantMessageEvent.delta, 500);
        options.record.sidebarActivity = "Writing response";
      } else if (event.type === "message_end" && event.message.role === "assistant") {
        options.record.activity = finalOutput(child).slice(0, 500);
        options.record.sidebarActivity = "Response complete";
      } else return;
      options.onProgress();
    });
    const abort = () => { void child.abort(); };
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    try {
      await child.prompt(options.prompt);
    } finally {
      options.signal?.removeEventListener("abort", abort);
      unsubscribe();
    }
    const output = finalOutput(child);
    options.record.usage = usage(child);
    const lastAssistant = [...child.messages].reverse().find((message) => message.role === "assistant");
    const error = lastAssistant?.role === "assistant" ? lastAssistant.errorMessage : undefined;
    if (error || lastAssistant?.role === "assistant" && lastAssistant.stopReason === "error") {
      return { ok: false, output, error: error ?? "Agent failed" };
    }
    return { ok: true, output };
  } catch (error) {
    return { ok: false, output: session ? finalOutput(session) : "", error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (session) await shutdown(session);
  }
}
