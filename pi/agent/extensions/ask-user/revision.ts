import type {
  ContextEvent,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { formatResult } from "./results.ts";
import { validateQuestions } from "./schema.ts";
import type {
  AnswerState,
  AskUserDetails,
  Question,
  QuestionResult,
  SubmittedAnswer,
} from "./types.ts";

type AgentMessage = ContextEvent["messages"][number];
type ReadonlySessionManager = ExtensionContext["sessionManager"];

export const ASK_USER_REVISION_TYPE = "ask-user-revision";

export interface AskUserRevisionDetails {
  version: 1;
  toolCallId: string;
  result: AskUserDetails;
}

export interface AskUserRevision {
  targetId: string;
  toolCallId: string;
  questions: Question[];
  initialAnswers: AnswerState[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isQuestion(value: unknown): value is Question {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    typeof value.question !== "string" ||
    (value.type !== "single" && value.type !== "multiple") ||
    !Array.isArray(value.options)
  ) {
    return false;
  }
  if (value.label !== undefined && typeof value.label !== "string") return false;
  return value.options.every((option) => {
    if (!isRecord(option) || typeof option.label !== "string") return false;
    return (
      option.description === undefined || typeof option.description === "string"
    );
  });
}

function storedQuestionResults(details: unknown): QuestionResult[] {
  if (!isRecord(details) || !Array.isArray(details.questions)) return [];

  const results: QuestionResult[] = [];
  for (const value of details.questions) {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      !Array.isArray(value.answers)
    ) {
      continue;
    }

    const answers = value.answers.flatMap<SubmittedAnswer>((answer) => {
      if (
        !isRecord(answer) ||
        (answer.kind !== "option" && answer.kind !== "custom") ||
        typeof answer.label !== "string" ||
        (answer.optionIndex !== undefined &&
          typeof answer.optionIndex !== "number")
      ) {
        return [];
      }
      return [{
        kind: answer.kind,
        label: answer.label,
        optionIndex: answer.optionIndex,
      }];
    });
    results.push({
      id: value.id,
      question: typeof value.question === "string" ? value.question : "",
      type: value.type === "multiple" ? "multiple" : "single",
      answered: answers.length > 0,
      answers,
    });
  }
  return results;
}

export function parseRevisionDetails(
  value: unknown,
): AskUserRevisionDetails | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.toolCallId !== "string" ||
    !isRecord(value.result) ||
    value.result.status !== "submitted" ||
    !Array.isArray(value.result.questions)
  ) {
    return undefined;
  }

  const questions = storedQuestionResults(value.result);
  if (questions.length !== value.result.questions.length) return undefined;
  return {
    version: 1,
    toolCallId: value.toolCallId,
    result: { status: "submitted", questions },
  };
}

export function collectAskUserRevisionResults(
  sessionManager: ReadonlySessionManager,
): Map<string, AskUserDetails> {
  const revisions = new Map<string, AskUserDetails>();
  for (const entry of sessionManager.getBranch()) {
    if (
      entry.type !== "custom_message" ||
      entry.customType !== ASK_USER_REVISION_TYPE
    ) {
      continue;
    }
    const revision = parseRevisionDetails(entry.details);
    if (revision) revisions.set(revision.toolCallId, revision.result);
  }
  return revisions;
}

export function formatRevisionMessage(questions: QuestionResult[]): string {
  return `Revised answers to the earlier questionnaire:\n${formatResult("submitted", questions)}`;
}

export function applyAskUserRevisions(messages: AgentMessage[]): AgentMessage[] {
  const askUserResultIds = new Set(
    messages.flatMap((message) =>
      message.role === "toolResult" && message.toolName === "ask_user"
        ? [message.toolCallId]
        : [],
    ),
  );
  const revisions = new Map<string, AskUserRevisionDetails>();
  for (const message of messages) {
    if (message.role !== "custom" || message.customType !== ASK_USER_REVISION_TYPE) {
      continue;
    }
    const revision = parseRevisionDetails(message.details);
    if (revision && askUserResultIds.has(revision.toolCallId)) {
      revisions.set(revision.toolCallId, revision);
    }
  }

  return messages.flatMap((message) => {
    if (message.role === "custom" && message.customType === ASK_USER_REVISION_TYPE) {
      const revision = parseRevisionDetails(message.details);
      if (revision && askUserResultIds.has(revision.toolCallId)) return [];
      return [message];
    }
    if (message.role !== "toolResult" || message.toolName !== "ask_user") {
      return [message];
    }

    const revision = revisions.get(message.toolCallId);
    if (!revision) return [message];
    return [{
      ...message,
      content: [{
        type: "text" as const,
        text: formatResult("submitted", revision.result.questions),
      }],
      details: revision.result,
      isError: false,
    }];
  });
}

export function questionResultsToAnswerStates(
  questions: Question[],
  results: QuestionResult[],
): AnswerState[] {
  const byId = new Map(results.map((result) => [result.id, result]));
  return questions.map((question) => {
    const state: AnswerState = { selected: new Set<number>() };
    const result = byId.get(question.id);
    if (!result) return state;

    for (const answer of result.answers) {
      if (answer.kind === "custom") {
        if (typeof answer.label === "string" && answer.label.length > 0) {
          state.custom = answer.label;
        }
        continue;
      }

      const optionIndex = answer.optionIndex;
      if (
        Number.isInteger(optionIndex) &&
        optionIndex !== undefined &&
        optionIndex >= 1 &&
        optionIndex <= question.options.length
      ) {
        state.selected.add(optionIndex - 1);
      }
    }
    return state;
  });
}

export function findAskUserRevision(
  sessionManager: ReadonlySessionManager,
  targetId: string,
): AskUserRevision | undefined {
  const target = sessionManager.getEntry(targetId);
  if (
    target?.type !== "message" ||
    target.message.role !== "toolResult" ||
    target.message.toolName !== "ask_user"
  ) {
    return undefined;
  }

  const branch = sessionManager.getBranch(targetId);
  let questions: Question[] | undefined;
  for (let index = branch.length - 1; index >= 0 && !questions; index--) {
    const entry = branch[index];
    if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
    if (!Array.isArray(entry.message.content)) continue;

    for (const block of entry.message.content) {
      if (
        block.type !== "toolCall" ||
        block.id !== target.message.toolCallId ||
        block.name !== "ask_user" ||
        !isRecord(block.arguments) ||
        !Array.isArray(block.arguments.questions) ||
        !block.arguments.questions.every(isQuestion)
      ) {
        continue;
      }
      questions = block.arguments.questions;
      break;
    }
  }
  if (!questions) return undefined;

  try {
    validateQuestions(questions);
  } catch {
    return undefined;
  }

  return {
    targetId,
    toolCallId: target.message.toolCallId,
    questions,
    initialAnswers: questionResultsToAnswerStates(
      questions,
      storedQuestionResults(target.message.details),
    ),
  };
}
