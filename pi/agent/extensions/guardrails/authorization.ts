import { randomBytes } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GuardrailAnalyzer } from "./analyzer.ts";
import type {
  GuardrailAnalysisStep,
  GuardrailAuthorizationResult,
  GuardrailDecisionChain,
  GuardrailDecisionOutcome,
  GuardrailDecisionStep,
  GuardrailSource,
} from "./types.ts";

export class GuardrailApprovalQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export interface AuthorizeGuardrailCommandOptions {
  analyzer: GuardrailAnalyzer;
  queue: GuardrailApprovalQueue;
  command: string;
  cwd: string;
  sessionId: string;
  source: GuardrailSource;
  ctx: ExtensionContext;
  signal?: AbortSignal;
  record: (decision: GuardrailDecisionChain) => void;
}

function analysisError(command: string, error: unknown): GuardrailAnalysisStep {
  return {
    kind: "analysis",
    at: Date.now(),
    command,
    result: "error",
    reason: error instanceof Error ? error.message : String(error),
  };
}

function finish(
  options: AuthorizeGuardrailCommandOptions,
  startedAt: number,
  steps: GuardrailDecisionStep[],
  outcome: GuardrailDecisionOutcome,
  reason: string,
  finalCommand?: string,
): GuardrailDecisionChain {
  const decision: GuardrailDecisionChain = {
    version: 1,
    id: `gr_${randomBytes(8).toString("hex")}`,
    sessionId: options.sessionId,
    source: options.source,
    startedAt,
    finishedAt: Date.now(),
    steps,
    outcome,
    ...(finalCommand ? { finalCommand } : {}),
    reason,
  };
  options.record(decision);
  return decision;
}

function message(command: string, step: GuardrailAnalysisStep): string {
  return [
    command,
    step.reason ? `Reason: ${step.reason}` : "Reason: Blocked by CC Safety Net",
    step.ruleId ? `Rule: ${step.ruleId}` : "",
    step.segment ? `Segment: ${step.segment}` : "",
  ].filter(Boolean).join("\n\n");
}

async function analyze(
  options: AuthorizeGuardrailCommandOptions,
  command: string,
): Promise<GuardrailAnalysisStep> {
  try {
    const verdict = await options.analyzer.analyze(command, options.cwd, options.signal);
    return {
      kind: "analysis",
      at: Date.now(),
      command,
      result: verdict.result,
      ...(verdict.reason ? { reason: verdict.reason } : {}),
      ...(verdict.segment ? { segment: verdict.segment } : {}),
      ...(verdict.ruleId ? { ruleId: verdict.ruleId } : {}),
    };
  } catch (error) {
    return analysisError(command, error);
  }
}

export async function authorizeGuardrailCommand(
  options: AuthorizeGuardrailCommandOptions,
): Promise<GuardrailAuthorizationResult> {
  const startedAt = Date.now();
  const first = await analyze(options, options.command);
  if (first.result === "allowed") return { command: options.command };
  const steps: GuardrailDecisionStep[] = [first];

  if (first.result === "error") {
    const reason = `Command denied because CC Safety Net analysis failed: ${first.reason ?? "unknown error"}`;
    finish(options, startedAt, steps, "failed", reason);
    return { block: reason };
  }

  return options.queue.run(async () => {
    let command = options.command;
    let blocked = first;
    try {
      while (true) {
        if (options.signal?.aborted) throw options.signal.reason ?? new Error("Guardrail authorization aborted");
        if (!options.ctx.hasUI) {
          const reason = "Blocked command denied because no approval UI is available";
          finish(options, startedAt, steps, "denied", reason);
          return { block: reason };
        }
        const choice = await options.ctx.ui.select(
          `CC Safety Net blocked this command\n\n${message(command, blocked)}`,
          ["Allow once", "Edit command", "Deny"],
        );
        if (choice === "Allow once") {
          steps.push({ kind: "user", at: Date.now(), action: "allow-once" });
          const reason = blocked.reason ?? "Blocked by CC Safety Net";
          finish(options, startedAt, steps, "allowed-once", reason, command);
          return { command };
        }
        if (choice !== "Edit command") {
          steps.push({ kind: "user", at: Date.now(), action: "deny" });
          const reason = blocked.reason ?? "Blocked by CC Safety Net";
          finish(options, startedAt, steps, "denied", reason);
          return { block: `BLOCKED by CC Safety Net: ${reason}` };
        }

        const edited = await options.ctx.ui.editor("Edit command (it will be re-analyzed)", command);
        if (edited === undefined) {
          steps.push({ kind: "user", at: Date.now(), action: "cancel-edit" });
          const reason = "Command edit cancelled";
          finish(options, startedAt, steps, "denied", reason);
          return { block: reason };
        }
        if (!edited.trim()) {
          steps.push({ kind: "user", at: Date.now(), action: "blank-edit" });
          const reason = "Command edit was blank";
          finish(options, startedAt, steps, "denied", reason);
          return { block: reason };
        }
        command = edited.trim();
        steps.push({ kind: "user", at: Date.now(), action: "edit", command });
        const next = await analyze(options, command);
        steps.push(next);
        if (next.result === "allowed") {
          finish(options, startedAt, steps, "edited-allowed", "Edited command allowed by CC Safety Net", command);
          return { command };
        }
        if (next.result === "error") {
          const reason = `Command denied because CC Safety Net analysis failed: ${next.reason ?? "unknown error"}`;
          finish(options, startedAt, steps, "failed", reason);
          return { block: reason };
        }
        blocked = next;
      }
    } catch (error) {
      const reason = `Guardrail authorization failed closed: ${error instanceof Error ? error.message : String(error)}`;
      finish(options, startedAt, steps, "failed", reason);
      return { block: reason };
    }
  });
}
