import { truncateUtf8 } from "./protocol.ts";
import type { ClassifyAssistantSettlementResult } from "./types.ts";

interface AssistantLike {
  role?: unknown;
  content?: unknown;
  stopReason?: unknown;
  errorMessage?: unknown;
}

function assistantText(message: AssistantLike): string {
  if (!Array.isArray(message.content)) return "";
  return message.content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const value = part as { type?: unknown; text?: unknown };
      return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
    })
    .join("\n")
    .trim();
}

/** Classify the final assistant message identically for embedded and detached children. */
export function classifyAssistantSettlement(messages: readonly unknown[]): ClassifyAssistantSettlementResult {
  let assistant: AssistantLike | undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    const value = messages[index];
    if (!value || typeof value !== "object") continue;
    const candidate = value as AssistantLike;
    if (candidate.role === "assistant") {
      assistant = candidate;
      break;
    }
  }
  if (!assistant) {
    return { ok: false, finalSummary: "", error: "Agent produced no assistant response" };
  }

  const finalSummary = truncateUtf8(assistantText(assistant));
  const cancelled = assistant.stopReason === "aborted";
  if (cancelled || assistant.stopReason === "error") {
    const fallback = cancelled ? "Agent interrupted" : "Agent failed";
    return {
      ok: false,
      finalSummary,
      error: typeof assistant.errorMessage === "string" && assistant.errorMessage.trim()
        ? assistant.errorMessage
        : fallback,
      ...(cancelled ? { cancelled: true } : {}),
    };
  }
  if (!finalSummary) {
    return { ok: false, finalSummary: "", error: "Agent produced no assistant summary" };
  }
  return { ok: true, finalSummary };
}
