import type { ExtensionAPI, ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import type { GuardrailAuthorizationResult } from "./types.ts";

export type GuardrailTransport = (
  command: string,
  ctx: ExtensionContext,
) => Promise<GuardrailAuthorizationResult>;

export function registerGuardrailShellHook(pi: ExtensionAPI, authorize: GuardrailTransport): void {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash" && event.toolName !== "Shell") return;
    if (!event.input || typeof event.input !== "object" || Array.isArray(event.input)) {
      return { block: true, reason: "Malformed shell command denied by Guardrails" };
    }
    const input = event.input as Record<string, unknown>;
    if (typeof input.command !== "string" || !input.command.trim()) {
      return { block: true, reason: "Malformed shell command denied by Guardrails" };
    }
    try {
      const verdict = await authorize(input.command, ctx);
      if (verdict.block) return { block: true, reason: verdict.block };
      input.command = verdict.command;
    } catch (error) {
      return {
        block: true,
        reason: `Guardrails failed closed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });
}

export function guardrailChildExtension(name: string, authorize: GuardrailTransport): InlineExtension {
  return {
    name,
    factory: (pi) => registerGuardrailShellHook(pi, authorize),
  };
}
