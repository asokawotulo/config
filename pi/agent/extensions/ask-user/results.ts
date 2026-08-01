import type {
  AnswerState,
  AskUserDetails,
  Question,
  QuestionResult,
  SubmittedAnswer,
} from "./types.ts";

export const NOT_ANSWERED_LABEL = "(not answered)";

export function createEmptyAnswer(): AnswerState {
  return { selected: new Set<number>() };
}

export function answerStateToResult(
  question: Question,
  state: AnswerState,
): QuestionResult {
  const answers: SubmittedAnswer[] = [...state.selected]
    .sort((a, b) => a - b)
    .map((index) => ({
      kind: "option",
      label: question.options[index]?.label ?? `Option ${index + 1}`,
      optionIndex: index + 1,
    }));

  if (state.custom) answers.push({ kind: "custom", label: state.custom });

  return {
    id: question.id,
    question: question.question,
    type: question.type,
    answered: answers.length > 0,
    answers,
  };
}

export function formatResult(
  status: AskUserDetails["status"],
  questions: QuestionResult[],
) {
  if (status === "declined") {
    return "User declined the questionnaire without submitting answers. Do not assume answers.";
  }
  if (status === "cancelled") {
    return "The questionnaire was cancelled before the user submitted answers.";
  }
  if (status === "no_ui") {
    return "No interactive UI is available, so the questionnaire could not be shown. Ask the user in plain text instead.";
  }

  return questions
    .map((question) => {
      const lines = [`${question.id} — ${question.question}:`];
      if (!question.answered) {
        lines.push(`  ${NOT_ANSWERED_LABEL}`);
        return lines.join("\n");
      }

      for (const answer of question.answers) {
        const marker = answer.kind === "custom" ? "(written) " : "";
        const continuation = `  ${" ".repeat(marker.length)}`;
        const answerLines = answer.label.split("\n");
        answerLines.forEach((line, index) => {
          lines.push(`${index === 0 ? `  ${marker}` : continuation}${line}`);
        });
      }
      return lines.join("\n");
    })
    .join("\n");
}
