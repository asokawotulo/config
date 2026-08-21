import type { GuardrailDecisionChain, GuardrailDecisionStep, GuardrailSource } from "./types.ts";

function source(value: unknown): GuardrailSource | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const raw = value as Record<string, unknown>;
  if (raw.kind === "main") return { kind: "main" };
  if (raw.kind === "dynamic-workflow" && typeof raw.runId === "string" && typeof raw.agentId === "string") {
    return { kind: "dynamic-workflow", runId: raw.runId, agentId: raw.agentId };
  }
}

function step(value: unknown): GuardrailDecisionStep | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const raw = value as Record<string, unknown>;
  if (raw.kind === "analysis") {
    if (
      typeof raw.at !== "number" || !Number.isFinite(raw.at)
      || typeof raw.command !== "string"
      || (raw.result !== "allowed" && raw.result !== "blocked" && raw.result !== "error")
    ) return;
    if ([raw.reason, raw.segment, raw.ruleId].some((item) => item !== undefined && typeof item !== "string")) return;
    return {
      kind: "analysis", at: raw.at, command: raw.command, result: raw.result,
      ...(typeof raw.reason === "string" ? { reason: raw.reason } : {}),
      ...(typeof raw.segment === "string" ? { segment: raw.segment } : {}),
      ...(typeof raw.ruleId === "string" ? { ruleId: raw.ruleId } : {}),
    };
  }
  if (raw.kind === "user") {
    if (
      typeof raw.at !== "number" || !Number.isFinite(raw.at)
      || !["allow-once", "edit", "deny", "cancel-edit", "blank-edit"].includes(String(raw.action))
      || (raw.command !== undefined && typeof raw.command !== "string")
    ) return;
    return {
      kind: "user",
      at: raw.at,
      action: raw.action as "allow-once" | "edit" | "deny" | "cancel-edit" | "blank-edit",
      ...(typeof raw.command === "string" ? { command: raw.command } : {}),
    };
  }
}

export function parseGuardrailDecision(value: unknown): GuardrailDecisionChain | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const raw = value as Record<string, unknown>;
    const parsedSource = source(raw.source);
    if (
      raw.version !== 1
      || typeof raw.id !== "string"
      || typeof raw.sessionId !== "string"
      || !parsedSource
      || typeof raw.startedAt !== "number" || !Number.isFinite(raw.startedAt)
      || typeof raw.finishedAt !== "number" || !Number.isFinite(raw.finishedAt)
      || !Array.isArray(raw.steps) || raw.steps.length === 0
      || !["allowed-once", "edited-allowed", "denied", "failed"].includes(String(raw.outcome))
      || (raw.finalCommand !== undefined && typeof raw.finalCommand !== "string")
      || typeof raw.reason !== "string"
    ) return;
    const steps: GuardrailDecisionStep[] = [];
    for (const value of raw.steps) {
      const parsed = step(value);
      if (!parsed) return;
      steps.push(parsed);
    }
    return {
      version: 1,
      id: raw.id,
      sessionId: raw.sessionId,
      source: parsedSource,
      startedAt: raw.startedAt,
      finishedAt: raw.finishedAt,
      steps,
      outcome: raw.outcome as GuardrailDecisionChain["outcome"],
      ...(typeof raw.finalCommand === "string" ? { finalCommand: raw.finalCommand } : {}),
      reason: raw.reason,
    };
  } catch { return; }
}

export function guardrailDecisionLabel(decision: GuardrailDecisionChain): string {
  const origin = decision.source.kind === "main"
    ? "main"
    : `${decision.source.runId}/${decision.source.agentId}`;
  return `${new Date(decision.finishedAt).toLocaleTimeString()}  ${decision.outcome}  ${origin}`;
}

export function formatGuardrailDecision(decision: GuardrailDecisionChain): string {
  const origin = decision.source.kind === "main"
    ? "Main host"
    : `Workflow ${decision.source.runId}, agent ${decision.source.agentId}`;
  const lines = [
    `Guardrail decision ${decision.id}`,
    `Source: ${origin}`,
    `Outcome: ${decision.outcome}`,
    `Started: ${new Date(decision.startedAt).toLocaleString()}`,
    `Finished: ${new Date(decision.finishedAt).toLocaleString()}`,
    `Reason: ${decision.reason}`,
    "",
    "Decision chain:",
  ];
  for (const item of decision.steps) {
    if (item.kind === "analysis") {
      lines.push(`- analyze ${JSON.stringify(item.command)}: ${item.result}`);
      if (item.reason) lines.push(`  Reason: ${item.reason}`);
      if (item.ruleId) lines.push(`  Rule: ${item.ruleId}`);
      if (item.segment) lines.push(`  Segment: ${item.segment}`);
    } else {
      lines.push(`- user: ${item.action}${item.command ? ` ${JSON.stringify(item.command)}` : ""}`);
    }
  }
  if (decision.finalCommand) lines.push("", `Final command: ${decision.finalCommand}`);
  return lines.join("\n");
}
