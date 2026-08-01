export const ASK_USER_TOOL_DESCRIPTION =
  "Ask the user a set of single-choice and/or multiple-choice questions. Each question requires 2-5 options; a free-form answer is added automatically. Questions may be left unanswered, and the user confirms all answers before submission.";

export const ASK_USER_PROMPT_SNIPPET =
  "Ask the user a set of single-choice or multiple-choice questions";

export const ASK_USER_PROMPT_GUIDELINES = [
  "Use ask_user when answers can be usefully presented as 2-5 choices.",
  "Do not add a free-form option to ask_user questions; the tool always adds Write your own answer.",
  "Treat unanswered ask_user questions as intentionally unanswered and do not infer an answer.",
];
