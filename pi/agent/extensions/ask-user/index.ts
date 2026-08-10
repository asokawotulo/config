import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
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
import {
  applyAskUserRevisions,
  ASK_USER_REVISION_TYPE,
  collectAskUserRevisionResults,
  findAskUserRevision,
  formatRevisionMessage,
  type AskUserRevision,
  type AskUserRevisionDetails,
} from "./revision.ts";
import { AskUserParams, validateQuestions } from "./schema.ts";
import type { AskUserDetails } from "./types.ts";

export type { AskUserInput } from "./types.ts";

export default function askUser(pi: ExtensionAPI) {
  pi.on("context", (event) => ({
    messages: applyAskUserRevisions(event.messages),
  }));

  let pendingTreeTargetId: string | undefined;
  let revisionTimer: ReturnType<typeof setTimeout> | undefined;
  let revisionController: AbortController | undefined;
  let projectedRevisionResults = new Map<string, AskUserDetails>();
  const revisionResultInvalidators = new Map<string, () => void>();

  function restoreVisualRevisions(ctx: ExtensionContext) {
    projectedRevisionResults = collectAskUserRevisionResults(
      ctx.sessionManager,
    );
  }

  async function reopenRevision(
    ctx: ExtensionContext,
    revision: AskUserRevision,
  ) {
    if (revisionController) return;
    const controller = new AbortController();
    revisionController = controller;

    try {
      const result = await showQuestionnaire(
        pi,
        ctx,
        revision.questions,
        controller.signal,
        revision.initialAnswers,
      );
      if (result.kind !== "submitted") return;

      const questions = revision.questions.map((question, index) =>
        answerStateToResult(
          question,
          result.answers[index] ?? createEmptyAnswer(),
        ),
      );
      const details: AskUserRevisionDetails = {
        version: 1,
        toolCallId: revision.toolCallId,
        result: { status: "submitted", questions },
      };
      projectedRevisionResults.set(revision.toolCallId, details.result);
      revisionResultInvalidators.get(revision.toolCallId)?.();
      pi.sendMessage(
        {
          customType: ASK_USER_REVISION_TYPE,
          content: formatRevisionMessage(questions),
          display: false,
          details,
        },
        { triggerTurn: true },
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        ctx.ui.notify(
          `Unable to revise questionnaire: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
    } finally {
      if (revisionController === controller) revisionController = undefined;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    revisionResultInvalidators.clear();
    restoreVisualRevisions(ctx);
  });

  pi.on("session_before_tree", (event) => {
    pendingTreeTargetId = event.preparation.targetId;
  });

  pi.on("session_tree", (_event, ctx) => {
    revisionResultInvalidators.clear();
    restoreVisualRevisions(ctx);
    const targetId = pendingTreeTargetId;
    pendingTreeTargetId = undefined;
    if (!targetId || ctx.mode !== "tui") return;

    const revision = findAskUserRevision(ctx.sessionManager, targetId);
    if (!revision) return;

    if (revisionTimer) clearTimeout(revisionTimer);
    revisionTimer = setTimeout(() => {
      revisionTimer = undefined;
      const targetIsActive = ctx.sessionManager
        .getBranch()
        .some((entry) => entry.id === revision.targetId);
      if (targetIsActive) void reopenRevision(ctx, revision);
    }, 0);
  });

  pi.on("session_shutdown", () => {
    pendingTreeTargetId = undefined;
    if (revisionTimer) clearTimeout(revisionTimer);
    revisionTimer = undefined;
    revisionController?.abort();
    revisionController = undefined;
    projectedRevisionResults.clear();
    revisionResultInvalidators.clear();
  });

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

      const result = await showQuestionnaire(pi, ctx, params.questions, signal);
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

    renderResult(result, _options, theme, context) {
      revisionResultInvalidators.set(context.toolCallId, context.invalidate);
      const details =
        projectedRevisionResults.get(context.toolCallId) ??
        (result.details as AskUserDetails | undefined);
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
