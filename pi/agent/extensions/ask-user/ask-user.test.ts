import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type Editor } from "@earendil-works/pi-tui";
import { renderQuestionnaire } from "./render.ts";
import {
  answerStateToResult,
  createEmptyAnswer,
  formatResult,
} from "./results.ts";
import { validateQuestions } from "./schema.ts";
import { DialogSettler, QuestionnaireState } from "./state.ts";
import type { DialogResult, Question } from "./types.ts";

const question = (overrides: Partial<Question> = {}): Question => ({
  id: "editor",
  label: "Editor",
  question: "Which editor should be used?",
  type: "single",
  options: [{ label: "Vim" }, { label: "Emacs" }],
  ...overrides,
});

const twoQuestions = (): Question[] => [
  question(),
  question({
    id: "shell",
    label: "Shell",
    question: "Which shell should be used?",
    options: [{ label: "Zsh" }, { label: "Fish" }],
  }),
];

function moveToCustom(state: QuestionnaireState) {
  const current = state.current();
  if (!current) throw new Error("Expected an active question");
  for (let index = 0; index < current.question.options.length; index++) {
    state.handle("down");
  }
}

describe("questionnaire interactions", () => {
  test("single-choice Enter selects and advances", () => {
    const state = new QuestionnaireState(twoQuestions());

    expect(state.handle("enter")).toBe("changed");
    expect(state.answers[0]?.selected).toEqual(new Set([0]));
    expect(state.screen).toBe(1);
  });

  test("single-choice selection on the last question advances to confirmation", () => {
    const state = new QuestionnaireState([question()]);

    state.handle("enter");
    expect(state.isConfirmation).toBe(true);
    expect(state.screen).toBe(1);
  });

  test("single-choice custom submission preserves multiline text and advances", () => {
    const state = new QuestionnaireState([question()]);
    moveToCustom(state);

    expect(state.handle("enter")).toBe("open-editor");
    expect(state.submitCustomAnswer("First line\nSecond line")).toBe("changed");
    expect(state.answers[0]?.custom).toBe("First line\nSecond line");
    expect(state.isConfirmation).toBe(true);
  });

  test("multiple-choice Space selects and deselects options", () => {
    const state = new QuestionnaireState([question({ type: "multiple" })]);

    state.handle("space");
    expect(state.answers[0]?.selected).toEqual(new Set([0]));
    state.handle("space");
    expect(state.answers[0]?.selected).toEqual(new Set());
  });

  test("multiple-choice Enter opens and prefills the custom editor", () => {
    const state = new QuestionnaireState([question({ type: "multiple" })]);
    moveToCustom(state);

    expect(state.handle("enter")).toBe("open-editor");
    state.submitCustomAnswer("Existing\nanswer");
    expect(state.screen).toBe(0);

    expect(state.handle("enter")).toBe("open-editor");
    expect(state.customDraft).toBe("Existing\nanswer");
  });

  test("Space on a custom multiple-choice answer toggles it off", () => {
    const state = new QuestionnaireState([question({ type: "multiple" })]);
    moveToCustom(state);
    state.handle("enter");
    state.submitCustomAnswer("Other");

    expect(state.handle("space")).toBe("changed");
    expect(state.answers[0]?.custom).toBeUndefined();
  });

  test("Esc in the editor returns to options without declining", () => {
    const state = new QuestionnaireState([question()]);
    moveToCustom(state);
    state.handle("enter");

    expect(state.handle("escape")).toBe("changed");
    expect(state.editQuestionIndex).toBeUndefined();
    expect(state.handle("escape")).toBe("declined");
  });

  test("left and right navigation stay within question and confirmation bounds", () => {
    const state = new QuestionnaireState(twoQuestions());

    state.handle("left");
    expect(state.screen).toBe(0);
    state.handle("right");
    state.handle("right");
    state.handle("right");
    expect(state.screen).toBe(2);
    expect(state.isConfirmation).toBe(true);
  });

  test("navigating past a question leaves it unanswered", () => {
    const state = new QuestionnaireState(twoQuestions());

    state.handle("right");
    expect(state.answers[0]).toEqual(createEmptyAnswer());
    expect(state.screen).toBe(1);
  });

  test("confirmation Enter submits answered and unanswered questions", () => {
    const state = new QuestionnaireState(twoQuestions());
    state.handle("enter");
    state.handle("right");

    expect(state.isConfirmation).toBe(true);
    expect(state.handle("enter")).toBe("submitted");
    expect(state.answers[0]?.selected).toEqual(new Set([0]));
    expect(state.answers[1]).toEqual(createEmptyAnswer());
  });

  test("abort resolves as cancelled exactly once", () => {
    const controller = new AbortController();
    const results: DialogResult[] = [];
    const settler = new DialogSettler(controller.signal, (result) =>
      results.push(result),
    );

    controller.abort();
    settler.finish({ kind: "declined" });
    controller.abort();

    expect(results).toEqual([{ kind: "cancelled" }]);
  });
});

describe("ask_user results", () => {
  test("single selected option includes its one-based index", () => {
    const result = answerStateToResult(question(), {
      selected: new Set([1]),
    });

    expect(result.answers).toEqual([
      { kind: "option", label: "Emacs", optionIndex: 2 },
    ]);
  });

  test("multiple selections are returned in option order", () => {
    const result = answerStateToResult(
      question({
        type: "multiple",
        options: [{ label: "One" }, { label: "Two" }, { label: "Three" }],
      }),
      { selected: new Set([2, 0, 1]) },
    );

    expect(result.answers.map((answer) => answer.label)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
  });

  test("option and custom answers coexist", () => {
    const result = answerStateToResult(question({ type: "multiple" }), {
      selected: new Set([1]),
      custom: "First line\nSecond line",
    });

    expect(result.answers).toEqual([
      { kind: "option", label: "Emacs", optionIndex: 2 },
      { kind: "custom", label: "First line\nSecond line" },
    ]);
  });

  test("custom-only answers are marked as custom", () => {
    const result = answerStateToResult(question(), {
      selected: new Set(),
      custom: "Helix",
    });

    expect(result.answered).toBe(true);
    expect(result.answers).toEqual([{ kind: "custom", label: "Helix" }]);
  });

  test("unanswered questions use the exact not-answered text", () => {
    const result = answerStateToResult(question(), createEmptyAnswer());

    expect(result.answered).toBe(false);
    expect(formatResult("submitted", [result])).toBe(
      "editor — Which editor should be used?:\n  (not answered)",
    );
  });

  test("submitted, declined, cancelled, and no-UI messages are distinct", () => {
    const result = answerStateToResult(question(), createEmptyAnswer());
    const messages = [
      formatResult("submitted", [result]),
      formatResult("declined", [result]),
      formatResult("cancelled", [result]),
      formatResult("no_ui", [result]),
    ];

    expect(new Set(messages).size).toBe(4);
  });

  test("duplicate labels retain their original option indices", () => {
    const duplicateQuestion = question({
      options: [{ label: "Same" }, { label: "Same" }],
    });

    expect(
      answerStateToResult(duplicateQuestion, { selected: new Set([0, 1]) })
        .answers,
    ).toEqual([
      { kind: "option", label: "Same", optionIndex: 1 },
      { kind: "option", label: "Same", optionIndex: 2 },
    ]);
  });

  test("newlines survive structured and text results", () => {
    const result = answerStateToResult(question(), {
      selected: new Set(),
      custom: "First line\nSecond line",
    });

    expect(result.answers[0]?.label).toBe("First line\nSecond line");
    expect(formatResult("submitted", [result])).toContain(
      "  (written) First line\n            Second line",
    );
  });
});

describe("multiline answer rendering", () => {
  const ansi = (code: number, text: string) =>
    `\u001b[${code}m${text}\u001b[0m`;
  const theme = {
    fg: (_color: string, text: string) => ansi(32, text),
    bg: (_color: string, text: string) => ansi(42, text),
    bold: (text: string) => ansi(1, text),
  } as unknown as Theme;
  const editor = {
    render: () => [],
  } as unknown as Editor;
  const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");

  function renderedCustomAnswer(
    screen: number,
    width = 80,
    custom = "First line\nSecond line",
  ) {
    return renderQuestionnaire(
      {
        questions: [question()],
        answers: [{ selected: new Set<number>(), custom }],
        cursors: [2],
        screen,
        editor,
      },
      theme,
      width,
    );
  }

  test.each([
    ["active question", 0],
    ["confirmation", 1],
  ])("styles and aligns every line on the %s screen", (_name, screen) => {
    const lines = renderedCustomAnswer(screen);
    const first = lines.find((line) => line.includes("First line"));
    const second = lines.find((line) => line.includes("Second line"));

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).toContain("\u001b[");
    expect(stripAnsi(first ?? "").indexOf("First line")).toBe(
      stripAnsi(second ?? "").indexOf("Second line"),
    );
  });

  test.each([
    ["active question", 0],
    ["confirmation", 1],
  ])("keeps prefixed answers visible at narrow widths on the %s screen", (_name, screen) => {
    const lines = renderedCustomAnswer(screen, 8, "AB\nCD");
    const plainLines = lines.map(stripAnsi);

    expect(lines.every((line) => visibleWidth(line) <= 8)).toBe(true);
    expect(plainLines.some((line) => line.includes("AB"))).toBe(true);
    expect(plainLines.some((line) => line.includes("CD"))).toBe(true);
  });
});

describe("ask_user validation", () => {
  test("rejects duplicate question ids", () => {
    expect(() => validateQuestions([question(), question()])).toThrow(
      "duplicate id: editor",
    );
  });

  test("rejects option counts outside the runtime bounds", () => {
    expect(() =>
      validateQuestions([question({ options: [{ label: "Only" }] })]),
    ).toThrow("requires 2-5 options");
  });
});
