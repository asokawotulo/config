import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  GUARDRAILS_AUTHORIZE_EVENT,
  GUARDRAILS_DECISION_EVENT,
  GUARDRAILS_STATUS_REQUEST_EVENT,
  type GuardrailsAuthorizationRequest,
  type GuardrailsDecisionEvent,
  type GuardrailsStatusRequest,
} from "../../lib/guardrails-events.ts";
import { CliGuardrailAnalyzer, type GuardrailAnalyzer } from "./analyzer.ts";
import { guardrailDecisionLabel, parseGuardrailDecision } from "./audit.ts";
import { authorizeGuardrailCommand, GuardrailApprovalQueue } from "./authorization.ts";
import { registerGuardrailShellHook } from "./child.ts";
import { showGuardrailDecision } from "./viewer.ts";
import {
  GUARDRAIL_DECISION_ENTRY,
  type GuardrailDecisionChain,
  type GuardrailSource,
  type GuardrailStatus,
} from "./types.ts";

function authorizationRequest(value: unknown): GuardrailsAuthorizationRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const raw = value as Partial<GuardrailsAuthorizationRequest>;
  if (
    typeof raw.command !== "string"
    || typeof raw.cwd !== "string"
    || typeof raw.sessionId !== "string"
    || typeof raw.accept !== "function"
    || !raw.source
    || (raw.source.kind !== "main" && raw.source.kind !== "dynamic-workflow")
    || (raw.source.kind === "dynamic-workflow" && (
      typeof raw.source.runId !== "string" || typeof raw.source.agentId !== "string"
    ))
  ) return;
  return raw as GuardrailsAuthorizationRequest;
}

export interface GuardrailsExtensionOptions {
  analyzer?: GuardrailAnalyzer;
}

export function createGuardrailsExtension(options: GuardrailsExtensionOptions = {}) {
  return function guardrails(pi: ExtensionAPI): void {
    const analyzer = options.analyzer ?? new CliGuardrailAnalyzer();
    let queue = new GuardrailApprovalQueue();
    let currentContext: ExtensionContext | undefined;
    let currentSessionId: string | undefined;
    let status: GuardrailStatus = { active: true, available: false, binary: "unknown", error: "Guardrails has not started" };

    const record = (decision: GuardrailDecisionChain) => {
      pi.appendEntry(GUARDRAIL_DECISION_ENTRY, decision);
      const event: GuardrailsDecisionEvent = { sessionId: decision.sessionId, decision };
      pi.events.emit(GUARDRAILS_DECISION_EVENT, event);
    };

    const authorize = (
      command: string,
      cwd: string,
      sessionId: string,
      source: GuardrailSource,
      ctx: ExtensionContext,
      signal?: AbortSignal,
    ) => authorizeGuardrailCommand({ analyzer, queue, command, cwd, sessionId, source, ctx, signal, record });

    registerGuardrailShellHook(pi, (command, ctx) => authorize(
      command,
      ctx.cwd,
      ctx.sessionManager.getSessionId(),
      { kind: "main" },
      ctx,
      ctx.signal,
    ));

    const unsubscribeStatus = pi.events.on(GUARDRAILS_STATUS_REQUEST_EVENT, (value) => {
      const request = value as Partial<GuardrailsStatusRequest> | undefined;
      if (typeof request?.accept === "function") request.accept(status);
    });
    const unsubscribeAuthorize = pi.events.on(GUARDRAILS_AUTHORIZE_EVENT, (value) => {
      const request = authorizationRequest(value);
      if (!request) return;
      if (!currentContext || request.sessionId !== currentSessionId) {
        request.accept(Promise.resolve({ block: "Guardrails rejected a stale or unavailable host session" }));
        return;
      }
      request.accept(authorize(
        request.command,
        request.cwd,
        request.sessionId,
        request.source,
        currentContext,
        request.signal,
      ));
    });

    pi.on("session_start", async (_event, ctx) => {
      queue = new GuardrailApprovalQueue();
      currentContext = ctx;
      currentSessionId = ctx.sessionManager.getSessionId();
      status = await analyzer.status(ctx.cwd, ctx.signal);
    });
    pi.on("session_shutdown", () => {
      currentContext = undefined;
      currentSessionId = undefined;
      unsubscribeStatus();
      unsubscribeAuthorize();
    });

    pi.registerCommand("guardrails", {
      description: "Show Guardrails status and inspect retained command decisions",
      handler: async (_args, ctx) => {
        const statusText = status.available
          ? `Guardrails active\nCC Safety Net: ${status.version ?? "unknown"}\nBinary: ${status.binary}`
          : `Guardrails active but unavailable\nBinary: ${status.binary}\nError: ${status.error ?? "unknown error"}`;
        const decisions = ctx.sessionManager.getEntries().flatMap((entry) => {
          if (entry.type !== "custom" || entry.customType !== GUARDRAIL_DECISION_ENTRY) return [];
          const decision = parseGuardrailDecision(entry.data);
          return decision ? [decision] : [];
        }).sort((left, right) => right.finishedAt - left.finishedAt);
        if (!decisions.length) {
          ctx.ui.notify(`${statusText}\n\nNo retained Guardrails decisions in this session.`, status.available ? "info" : "warning");
          return;
        }
        if (!ctx.hasUI) return;
        const labels = decisions.map(guardrailDecisionLabel);
        const choice = await ctx.ui.select(`${statusText}\n\nGuardrails audit`, labels);
        if (!choice) return;
        const decision = decisions[labels.indexOf(choice)];
        if (!decision) return;
        await showGuardrailDecision(pi, ctx, decision);
      },
    });
  };
}

export default createGuardrailsExtension();
