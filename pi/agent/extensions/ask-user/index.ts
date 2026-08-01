import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import {
  SUPACODE_NOTIFICATION_EVENT,
  type SupacodeNotification,
} from "../../lib/supacode-events.ts";
import { showQuestionnaire } from "./dialog.ts";
import { ICONS } from "./icons.ts";
import {
  ASK_USER_PROMPT_GUIDELINES,
  ASK_USER_PROMPT_SNIPPET,
  ASK_USER_TOOL_DESCRIPTION,
} from "./prompt.ts";
import {
  answerStateToResult,
  createEmptyAnswer,
  formatResult,
  NOT_ANSWERED_LABEL,
} from "./results.ts";
import { AskUserParams, validateQuestions } from "./schema.ts";
import type { AskUserDetails } from "./types.ts";

export type { AskUserInput } from "./types.ts";

export default function askUser(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description: ASK_USER_TOOL_DESCRIPTION,
    promptSnippet: ASK_USER_PROMPT_SNIPPET,
    promptGuidelines: ASK_USER_PROMPT_GUIDELINES,
    parameters: AskUserParams,
    executionMode: "sequential",

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      validateQuestions(params.questions);

      const emptyResults = params.questions.map((question) =>
        answerStateToResult(question, createEmptyAnswer()),
      );
      const reply = (
        status: AskUserDetails["status"],
        questions = emptyResults,
      ) => ({
        content: [
          { type: "text" as const, text: formatResult(status, questions) },
        ],
        details: { status, questions } satisfies AskUserDetails,
      });

      if (ctx.mode !== "tui") return reply("no_ui");
      if (signal?.aborted) return reply("cancelled");

      const notification = {
        title: "Pi needs your input",
        body:
          params.questions.length === 1
            ? params.questions[0]?.question
            : `${params.questions.length} questions require your input`,
      } satisfies SupacodeNotification;
      pi.events.emit(SUPACODE_NOTIFICATION_EVENT, notification);

      const result = await showQuestionnaire(ctx, params.questions, signal);
      if (result.kind !== "submitted") return reply(result.kind);

      const questions = params.questions.map((question, index) =>
        answerStateToResult(
          question,
          result.answers[index] ?? createEmptyAnswer(),
        ),
      );
      return reply("submitted", questions);
    },

    renderCall(args, theme) {
      const questions = Array.isArray(args.questions) ? args.questions : [];
      const count = questions.length;
      const labels = questions
        .map((question) => {
          if (!question || typeof question !== "object") return undefined;
          if ("label" in question && typeof question.label === "string") {
            return question.label;
          }
          if ("id" in question && typeof question.id === "string") {
            return question.id;
          }
          return undefined;
        })
        .filter((label): label is string => Boolean(label));

      let text =
        theme.fg("toolTitle", theme.bold("ask_user ")) +
        theme.fg("muted", `${count} question${count === 1 ? "" : "s"}`);
      if (labels.length > 0) text += theme.fg("dim", ` (${labels.join(", ")})`);
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as AskUserDetails | undefined;
      if (!details) {
        const first = result.content[0];
        return new Text(first?.type === "text" ? first.text : "", 0, 0);
      }
      if (details.status === "declined") {
        return new Text(
          theme.fg("warning", `${ICONS.dismissed} user declined`),
          0,
          0,
        );
      }
      if (details.status === "cancelled") {
        return new Text(
          theme.fg("warning", `${ICONS.dismissed} cancelled`),
          0,
          0,
        );
      }
      if (details.status === "no_ui") {
        return new Text(
          theme.fg("warning", "Interactive UI unavailable"),
          0,
          0,
        );
      }

      const lines: string[] = [];
      for (const question of details.questions) {
        if (!question.answered) {
          lines.push(
            theme.fg(
              "warning",
              `${ICONS.warning} ${question.id}: ${NOT_ANSWERED_LABEL}`,
            ),
          );
          continue;
        }

        lines.push(
          theme.fg("success", `${ICONS.success} `) +
            theme.fg("accent", `${question.id}:`),
        );
        for (const answer of question.answers) {
          const icon =
            answer.kind === "custom" ? ICONS.customAnswer : ICONS.optionAnswer;
          const prefix = `  ${icon} `;
          const continuation = " ".repeat(visibleWidth(prefix));
          answer.label.split("\n").forEach((line, index) => {
            lines.push(
              `${index === 0 ? prefix : continuation}${theme.fg("text", line)}`,
            );
          });
        }
      }
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
