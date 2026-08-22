import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { Question } from "./types.ts";

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;
export const CUSTOM_OPTION_LABEL = "Write your own answer";

const OptionSchema = Type.Object({
  label: Type.String({ description: "Short display label for this option" }),
  description: Type.Optional(
    Type.String({
      description:
        "Optional multiline Markdown explanation shown under the option. Fenced `mermaid` blocks render as terminal diagrams when valid and within the available width.",
    }),
  ),
});

const QuestionSchema = Type.Object({
  id: Type.String({ description: "Unique identifier for this question" }),
  label: Type.Optional(
    Type.String({ description: "Short label used for this question's tab" }),
  ),
  question: Type.String({ description: "Question shown to the user" }),
  type: StringEnum(["single", "multiple"] as const, {
    description: "Whether the user may select one answer or several answers",
  }),
  options: Type.Array(OptionSchema, {
    minItems: MIN_OPTIONS,
    maxItems: MAX_OPTIONS,
    description:
      "Two to five answer options. Do not include a free-form option; it is appended automatically.",
  }),
});

export const AskUserParams = Type.Object({
  questions: Type.Array(QuestionSchema, {
    minItems: 1,
    description: "One or more questions to ask in a single questionnaire",
  }),
});

export function validateQuestions(questions: Question[]) {
  const ids = new Set<string>();
  for (const question of questions) {
    if (ids.has(question.id)) {
      throw new Error(
        `ask_user requires unique question ids; duplicate id: ${question.id}`,
      );
    }
    ids.add(question.id);

    if (
      question.options.length < MIN_OPTIONS ||
      question.options.length > MAX_OPTIONS
    ) {
      throw new Error(
        `Question ${question.id} requires ${MIN_OPTIONS}-${MAX_OPTIONS} options (got ${question.options.length}).`,
      );
    }
  }
}
