import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  GuardrailAuthorizationResult,
  GuardrailDecisionChain,
  GuardrailSource,
  GuardrailStatus,
} from "../extensions/guardrails/types.ts";

export const GUARDRAILS_STATUS_REQUEST_EVENT = "guardrails:status-request";
export const GUARDRAILS_AUTHORIZE_EVENT = "guardrails:authorize";
export const GUARDRAILS_DECISION_EVENT = "guardrails:decision";

export interface GuardrailsStatusRequest {
  accept(status: GuardrailStatus): void;
}

export interface GuardrailsAuthorizationRequest {
  command: string;
  cwd: string;
  sessionId: string;
  source: GuardrailSource;
  signal?: AbortSignal;
  accept(result: Promise<GuardrailAuthorizationResult>): void;
}

export interface GuardrailsDecisionEvent {
  sessionId: string;
  decision: GuardrailDecisionChain;
}

type EventHost = Pick<ExtensionAPI, "events">;

export function requestGuardrailsStatus(pi: EventHost): GuardrailStatus | undefined {
  let accepted: GuardrailStatus | undefined;
  const request: GuardrailsStatusRequest = {
    accept(status) { if (!accepted) accepted = status; },
  };
  pi.events.emit(GUARDRAILS_STATUS_REQUEST_EVENT, request);
  return accepted;
}

export function requestGuardrailsAuthorization(
  pi: EventHost,
  request: Omit<GuardrailsAuthorizationRequest, "accept">,
): Promise<GuardrailAuthorizationResult> {
  let accepted: Promise<GuardrailAuthorizationResult> | undefined;
  pi.events.emit(GUARDRAILS_AUTHORIZE_EVENT, {
    ...request,
    accept(result: Promise<GuardrailAuthorizationResult>) {
      if (!accepted) accepted = result;
    },
  } satisfies GuardrailsAuthorizationRequest);
  return accepted ?? Promise.resolve({ block: "Guardrails is unavailable" });
}
