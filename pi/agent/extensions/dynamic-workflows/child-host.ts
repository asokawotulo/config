import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerGuardrailShellHook } from "../guardrails/child.ts";
import {
  CHILD_PROTOCOL_VERSION,
  atomicWriteJson,
  childArtifactPaths,
  delay,
  guardrailResponsePath,
  readJson,
  writeGuardrailRequest,
  type ChildConfig,
  type ChildControl,
  type ChildSettledStatus,
  type GuardrailTransportResponse,
} from "./protocol.ts";
import { classifyAssistantSettlement } from "./settlement.ts";
import type { ClassifyAssistantSettlementResult } from "./types.ts";
import { usageFromSessionEntries } from "./usage.ts";

const CONFIG_ENV = "PI_DYNAMIC_WORKFLOW_CHILD_CONFIG";

function messagesFromEntries(entries: readonly unknown[]): unknown[] {
  return entries.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const entry = raw as { type?: string; message?: unknown };
    return entry.type === "message" && entry.message ? [entry.message] : [];
  });
}

async function awaitGuardrailResponse(config: ChildConfig, command: string, signal?: AbortSignal): Promise<GuardrailTransportResponse> {
  const paths = childArtifactPaths(config.runId, config.agentId);
  const request = writeGuardrailRequest(paths, command);
  const responsePath = guardrailResponsePath(paths, request.id);
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const response = readJson<GuardrailTransportResponse>(responsePath);
    if (response) {
      if (response.version !== CHILD_PROTOCOL_VERSION || response.id !== request.id) throw new Error("Malformed parent Guardrails response");
      if (typeof response.command === "string" && !response.block) return response;
      if (typeof response.block === "string" && !response.command) return response;
      throw new Error("Parent Guardrails response did not contain exactly one verdict");
    }
    await delay(50, signal);
  }
  throw new Error("Parent Guardrails broker timed out");
}

export default function childHost(pi: ExtensionAPI) {
  const configPath = process.env[CONFIG_ENV];
  if (!configPath) return;
  const config = readJson<ChildConfig>(configPath);
  if (!config || config.version !== CHILD_PROTOCOL_VERSION || !config.runId || !config.agentId || typeof config.prompt !== "string" || typeof config.systemPrompt !== "string") {
    throw new Error("Invalid dynamic workflow child config");
  }
  const paths = childArtifactPaths(config.runId, config.agentId);
  let currentContext: ExtensionContext | undefined;
  let lastControlSequence = "";
  let lastActivity = "";
  let settled = false;
  let promptSent = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const writeRunning = (activity: string, ctx?: ExtensionContext, force = false) => {
    if (settled || !force && activity === lastActivity) return;
    lastActivity = activity;
    atomicWriteJson(paths.status, {
      version: CHILD_PROTOCOL_VERSION,
      state: activity === "Starting Pi session" ? "starting" : "running",
      at: Date.now(),
      activity,
      ...(ctx ? {
        sessionId: ctx.sessionManager.getSessionId(),
        ...(ctx.sessionManager.getSessionFile() ? { sessionFile: ctx.sessionManager.getSessionFile() } : {}),
      } : {}),
    });
  };

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${config.systemPrompt}`,
  }));

  registerGuardrailShellHook(pi, async (command, ctx) => {
    currentContext = ctx;
    writeRunning("Waiting for parent Guardrails broker", ctx);
    const response = await awaitGuardrailResponse(config, command, ctx.signal);
    if (response.block) return { block: response.block };
    writeRunning("Using shell", ctx);
    return { command: response.command! };
  });

  pi.on("tool_execution_start", (event, ctx) => {
    currentContext = ctx;
    writeRunning(`Using ${event.toolName}`, ctx);
  });
  pi.on("message_update", (event, ctx) => {
    currentContext = ctx;
    if (event.assistantMessageEvent.type === "text_delta") writeRunning("Writing response", ctx);
  });
  pi.on("agent_start", (_event, ctx) => {
    currentContext = ctx;
    writeRunning("Working", ctx);
  });
  pi.on("agent_settled", (_event, ctx) => {
    if (settled) return;
    settled = true;
    currentContext = ctx;
    const entries = ctx.sessionManager.getEntries();
    const messages = messagesFromEntries(entries);
    const settlement: ClassifyAssistantSettlementResult = classifyAssistantSettlement(messages);
    const status: ChildSettledStatus = {
      version: CHILD_PROTOCOL_VERSION,
      state: "settled",
      at: Date.now(),
      ...settlement,
      usage: usageFromSessionEntries(entries),
      sessionId: ctx.sessionManager.getSessionId(),
      ...(ctx.sessionManager.getSessionFile() ? { sessionFile: ctx.sessionManager.getSessionFile()! } : {}),
    };
    // This first settled status is the parent's completion boundary. Pi remains
    // idle and attachable in zmx until the user explicitly terminates it.
    atomicWriteJson(paths.status, status);
  });
  pi.on("session_start", (_event, ctx) => {
    currentContext = ctx;
    writeRunning("Starting Pi session", ctx);
    if (!timer) {
      let lastHeartbeatAt = Date.now();
      timer = setInterval(() => {
        try {
          const control = readJson<ChildControl>(paths.control);
          if (
            control?.version === CHILD_PROTOCOL_VERSION &&
            control.sequence !== lastControlSequence &&
            (control.action === "interrupt" || control.action === "terminate") &&
            currentContext
          ) {
            // Do not consume startup controls until a live context can honor them.
            lastControlSequence = control.sequence;
            currentContext.abort();
            if (control.action === "terminate") currentContext.shutdown();
          }
          if (!settled && currentContext && Date.now() - lastHeartbeatAt >= 1_000) {
            lastHeartbeatAt = Date.now();
            writeRunning(lastActivity || "Working", currentContext, true);
          }
        } catch {
          // Malformed control never grants capability and is ignored fail-closed.
        }
      }, 75);
      timer.unref();
    }
    if (!promptSent) {
      promptSent = true;
      setTimeout(() => pi.sendUserMessage(config.prompt), 0);
    }
  });
  pi.on("session_shutdown", () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  });
}
