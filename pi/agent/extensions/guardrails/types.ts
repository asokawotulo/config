export const GUARDRAIL_DECISION_ENTRY = "guardrails:decision";
export const MAX_GUARDRAIL_COMMAND_BYTES = 128 * 1024;

export type GuardrailSource =
  | { kind: "main" }
  | { kind: "dynamic-workflow"; runId: string; agentId: string };

export interface GuardrailAnalysisStep {
  kind: "analysis";
  at: number;
  command: string;
  result: "allowed" | "blocked" | "error";
  reason?: string;
  segment?: string;
  ruleId?: string;
}

export interface GuardrailUserStep {
  kind: "user";
  at: number;
  action: "allow-once" | "edit" | "deny" | "cancel-edit" | "blank-edit";
  command?: string;
}

export type GuardrailDecisionStep = GuardrailAnalysisStep | GuardrailUserStep;
export type GuardrailDecisionOutcome = "allowed-once" | "edited-allowed" | "denied" | "failed";

export interface GuardrailDecisionChain {
  version: 1;
  id: string;
  sessionId: string;
  source: GuardrailSource;
  startedAt: number;
  finishedAt: number;
  steps: GuardrailDecisionStep[];
  outcome: GuardrailDecisionOutcome;
  finalCommand?: string;
  reason: string;
}

export type GuardrailAuthorizationResult =
  | { command: string; block?: never }
  | { block: string; command?: never };

export interface GuardrailStatus {
  active: boolean;
  available: boolean;
  version?: string;
  binary: string;
  error?: string;
}
