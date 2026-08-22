import { describe, expect, test } from "bun:test";
import type {
  ContextEvent,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  visibleWidth,
  type Editor,
  type MarkdownTheme,
} from "@earendil-works/pi-tui";
import { renderOptionDescription } from "./description.ts";
import {
  MASTER_DETAIL_MIN_WIDTH,
  renderQuestionnaire,
  renderQuestionnaireView,
} from "./render.ts";
import {
  answerStateToResult,
  createEmptyAnswer,
  formatResult,
} from "./results.ts";
import {
  applyAskUserRevisions,
  ASK_USER_REVISION_TYPE,
  collectAskUserRevisionResults,
  findAskUserRevision,
  questionResultsToAnswerStates,
} from "./revision.ts";
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
  test("prefills cloned answers for revision", () => {
    const initial = [{ selected: new Set([1]), custom: "Existing" }];
    const state = new QuestionnaireState([question({ type: "multiple" })], initial);

    initial[0]?.selected.clear();
    if (initial[0]) initial[0].custom = "Changed";

    expect(state.answers[0]?.selected).toEqual(new Set([1]));
    expect(state.answers[0]?.custom).toBe("Existing");
  });

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

describe("ask_user tree revision", () => {
  test("hydrates stored answers by question id and ignores invalid indices", () => {
    const questions = twoQuestions();
    const states = questionResultsToAnswerStates(questions, [
      {
        id: "shell",
        question: "Which shell should be used?",
        type: "single",
        answered: true,
        answers: [
          { kind: "option", label: "Fish", optionIndex: 2 },
          { kind: "option", label: "Invalid", optionIndex: 99 },
          { kind: "custom", label: "Nushell" },
        ],
      },
    ]);

    expect(states[0]).toEqual(createEmptyAnswer());
    expect(states[1]?.selected).toEqual(new Set([1]));
    expect(states[1]?.custom).toBe("Nushell");
  });

  test("recovers questions from the matching ancestor tool call", () => {
    const questions = twoQuestions();
    const toolCallId = "ask-call";
    const assistant = {
      type: "message",
      id: "assistant",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: toolCallId,
            name: "ask_user",
            arguments: { questions },
          },
        ],
      },
    };
    const intervening = {
      type: "message",
      id: "other-result",
      parentId: "assistant",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { role: "toolResult", toolName: "read", toolCallId: "read-call" },
    };
    const target = {
      type: "message",
      id: "ask-result",
      parentId: "other-result",
      timestamp: "2026-01-01T00:00:02.000Z",
      message: {
        role: "toolResult",
        toolName: "ask_user",
        toolCallId,
        details: {
          status: "submitted",
          questions: [
            {
              id: "editor",
              question: "Which editor should be used?",
              type: "single",
              answered: true,
              answers: [{ kind: "option", label: "Emacs", optionIndex: 2 }],
            },
          ],
        },
      },
    };
    const entries = [assistant, intervening, target];
    const sessionManager = {
      getEntry: (id: string) => entries.find((entry) => entry.id === id),
      getBranch: () => entries,
    } as unknown as ExtensionContext["sessionManager"];

    const revision = findAskUserRevision(sessionManager, target.id);

    expect(revision?.questions).toEqual(questions);
    expect(revision?.initialAnswers[0]?.selected).toEqual(new Set([1]));
    expect(revision?.initialAnswers[1]).toEqual(createEmptyAnswer());
  });

  test("replaces the original answer and removes the applied revision marker", () => {
    const revisedQuestion = {
      id: "tree_revision_test",
      question: "Which option?",
      type: "single" as const,
      answered: true,
      answers: [{ kind: "option" as const, label: "Option B", optionIndex: 2 }],
    };
    const messages = [
      {
        role: "assistant",
        content: [{
          type: "toolCall",
          id: "ask-call",
          name: "ask_user",
          arguments: { questions: [] },
        }],
      },
      {
        role: "toolResult",
        toolCallId: "ask-call",
        toolName: "ask_user",
        content: [{ type: "text", text: "Option A" }],
        details: {
          status: "submitted",
          questions: [{ ...revisedQuestion, answers: [
            { kind: "option", label: "Option A", optionIndex: 1 },
          ] }],
        },
        isError: false,
      },
      {
        role: "custom",
        customType: ASK_USER_REVISION_TYPE,
        content: "Revised to Option B",
        display: true,
        details: {
          version: 1,
          toolCallId: "ask-call",
          result: { status: "submitted", questions: [revisedQuestion] },
        },
      },
    ] as unknown as ContextEvent["messages"];

    const transformed = applyAskUserRevisions(messages);
    const serialized = JSON.stringify(transformed);

    expect(transformed).toHaveLength(2);
    expect(serialized).not.toContain("Option A");
    expect(serialized).not.toContain(ASK_USER_REVISION_TYPE);
    expect(serialized).toContain("Option B");
    expect(transformed[1]).toMatchObject({
      role: "toolResult",
      toolCallId: "ask-call",
      toolName: "ask_user",
      isError: false,
    });
  });

  test("uses the latest matched revision and preserves unmatched markers", () => {
    const result = {
      role: "toolResult",
      toolCallId: "ask-call",
      toolName: "ask_user",
      content: [{ type: "text", text: "Original" }],
      isError: false,
    };
    const marker = (toolCallId: string, label: string) => ({
      role: "custom",
      customType: ASK_USER_REVISION_TYPE,
      content: `Revised to ${label}`,
      display: true,
      details: {
        version: 1,
        toolCallId,
        result: {
          status: "submitted",
          questions: [{
            id: "choice",
            question: "Choose",
            type: "single",
            answered: true,
            answers: [{ kind: "option", label, optionIndex: 1 }],
          }],
        },
      },
    });
    const messages = [
      result,
      marker("ask-call", "First revision"),
      marker("ask-call", "Latest revision"),
      marker("missing-call", "Unmatched revision"),
    ] as unknown as ContextEvent["messages"];

    const transformed = applyAskUserRevisions(messages);
    const serialized = JSON.stringify(transformed);

    expect(serialized).not.toContain("First revision");
    expect(serialized).toContain("Latest revision");
    expect(serialized).toContain("Unmatched revision");
    expect(transformed).toHaveLength(2);
  });

  test("hydrates the latest visual projection from the active branch", () => {
    const revisionEntry = (id: string, label: string) => ({
      type: "custom_message",
      id,
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      customType: ASK_USER_REVISION_TYPE,
      content: `Revised to ${label}`,
      display: false,
      details: {
        version: 1,
        toolCallId: "ask-call",
        result: {
          status: "submitted",
          questions: [{
            id: "choice",
            question: "Choose",
            type: "single",
            answered: true,
            answers: [{ kind: "option", label, optionIndex: 1 }],
          }],
        },
      },
    });
    const sessionManager = {
      getBranch: () => [
        revisionEntry("first", "First revision"),
        revisionEntry("latest", "Latest revision"),
      ],
    } as unknown as ExtensionContext["sessionManager"];

    const projections = collectAskUserRevisionResults(sessionManager);

    expect(projections.get("ask-call")?.questions[0]?.answers[0]?.label).toBe(
      "Latest revision",
    );
  });

  test("ignores unrelated and malformed stored tool events", () => {
    const entries = [
      {
        type: "message",
        id: "result",
        message: {
          role: "toolResult",
          toolName: "read",
          toolCallId: "call",
        },
      },
    ];
    const sessionManager = {
      getEntry: (id: string) => entries.find((entry) => entry.id === id),
      getBranch: () => entries,
    } as unknown as ExtensionContext["sessionManager"];

    expect(findAskUserRevision(sessionManager, "result")).toBeUndefined();
    expect(findAskUserRevision(sessionManager, "missing")).toBeUndefined();
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
  const markdownTheme: MarkdownTheme = {
    heading: (text) => ansi(33, text),
    link: (text) => ansi(34, text),
    linkUrl: (text) => ansi(36, text),
    code: (text) => ansi(35, text),
    codeBlock: (text) => ansi(35, text),
    codeBlockBorder: (text) => ansi(90, text),
    quote: (text) => ansi(37, text),
    quoteBorder: (text) => ansi(90, text),
    hr: (text) => ansi(90, text),
    listBullet: (text) => ansi(33, text),
    bold: (text) => ansi(1, text),
    italic: (text) => ansi(3, text),
    strikethrough: (text) => ansi(9, text),
    underline: (text) => ansi(4, text),
    highlightCode: (code) => code.split("\n").map((line) => ansi(35, line)),
  };
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
        markdownTheme,
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

  function descriptionView(
    description: string,
    width = 80,
    screen = 0,
    overrides: Partial<Parameters<typeof renderQuestionnaireView>[0]> = {},
  ) {
    return renderQuestionnaireView(
      {
        questions: [question({
          options: [{ label: "Vim", description }, { label: "Emacs" }],
        })],
        answers: [{ selected: new Set([0]) }],
        cursors: [0],
        screen,
        editor,
        markdownTheme,
        ...overrides,
      },
      theme,
      width,
    );
  }

  function renderedDescription(
    description: string,
    width = 80,
    screen = 0,
  ) {
    return descriptionView(description, width, screen).lines;
  }

  test("uses master-detail at wide widths and stacked rendering below the breakpoint", () => {
    const wide = descriptionView(
      "FIRST_DETAIL",
      MASTER_DETAIL_MIN_WIDTH + 4,
      0,
      {
        questions: [question({
          options: [
            { label: "Vim", description: "FIRST_DETAIL" },
            { label: "Emacs", description: "SECOND_DETAIL" },
          ],
        })],
      },
    );
    const narrow = descriptionView(
      "FIRST_DETAIL",
      MASTER_DETAIL_MIN_WIDTH + 3,
      0,
      {
        questions: [question({
          options: [
            { label: "Vim", description: "FIRST_DETAIL" },
            { label: "Emacs", description: "SECOND_DETAIL" },
          ],
        })],
      },
    );

    expect(wide.masterDetail).toBe(true);
    expect(wide.lines.map(stripAnsi).join("\n")).not.toContain("SECOND_DETAIL");
    expect(narrow.masterDetail).toBe(false);
    expect(narrow.lines.map(stripAnsi).join("\n")).toContain("SECOND_DETAIL");
  });

  test("shows details for the cursor-focused option", () => {
    const view = descriptionView("unused", 100, 0, {
      questions: [question({
        options: [
          { label: "Vim", description: "FIRST_DETAIL" },
          { label: "Emacs", description: "SECOND_DETAIL" },
        ],
      })],
      cursors: [1],
    });
    const output = view.lines.map(stripAnsi).join("\n");

    expect(output).toContain("SECOND_DETAIL");
    expect(output).not.toContain("FIRST_DETAIL");
  });

  test("shows an intentional empty-detail message", () => {
    const output = descriptionView("", 100).lines.map(stripAnsi).join("\n");

    expect(output).toContain("No additional details.");
  });

  test("limits long details to the frame budget and reports scroll metrics", () => {
    const description = Array.from(
      { length: 20 },
      (_, index) => `Detail line ${index + 1}`,
    ).join("\n");
    const first = descriptionView(description, 100, 0, { maxFrameRows: 18 });
    const viewport = first.detailViewport;
    if (!viewport) throw new Error("Expected a detail viewport");
    const next = descriptionView(description, 100, 0, {
      maxFrameRows: 18,
      detailScroll: viewport.pageSize,
    });
    const last = descriptionView(description, 100, 0, {
      maxFrameRows: 18,
      detailScroll: viewport.maxTop,
    });

    expect(first.lines.length).toBeLessThanOrEqual(18);
    expect(viewport.overflow).toBe(true);
    expect(first.lines.map(stripAnsi).join("\n")).toContain("↓ more details");
    expect(next.lines.map(stripAnsi).join("\n")).toContain("↑ more details");
    expect(last.lines.map(stripAnsi).join("\n")).toContain("Detail line 20");
  });

  test("renders the custom editor inside the detail pane", () => {
    const editing = {
      render: () => ["editor content"],
    } as unknown as Editor;
    const view = descriptionView("unused", 100, 0, {
      cursors: [2],
      editQuestionIndex: 0,
      editor: editing,
    });
    const output = view.lines.map(stripAnsi).join("\n");

    expect(view.masterDetail).toBe(true);
    expect(output).toContain("Write your own answer");
    expect(output).toContain("Your answer:");
    expect(output).toContain("editor content");
  });

  test("renders multiline Markdown descriptions with block spacing", () => {
    const lines = renderedDescription(
      "First line\nSecond **bold** line\n\n- Item with `code`\n\n[Docs](https://example.com)",
    );
    const plainLines = lines.map(stripAnsi);
    const firstIndex = plainLines.findIndex((line) =>
      line.includes("First line")
    );
    const secondIndex = plainLines.findIndex((line) =>
      line.includes("Second bold line")
    );
    const itemIndex = plainLines.findIndex((line) =>
      line.includes("Item with code")
    );
    const output = plainLines.join("\n");

    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(firstIndex);
    expect(itemIndex).toBeGreaterThan(secondIndex + 1);
    expect(output).toContain("Docs");
    expect(output).toContain("https://example.com");
    expect(output).not.toContain("**bold**");
    expect(output).not.toContain("`code`");
    expect(lines[secondIndex]).toContain("\u001b[");
    expect(plainLines[firstIndex]?.indexOf("First line")).toBe(
      plainLines[secondIndex]?.indexOf("Second bold line"),
    );
  });

  test("renders heading, quote, and fenced-code description blocks", () => {
    const lines = renderedDescription(
      "## Details\n\n> Quoted text\n\n```ts\nconst value = 1;\n```",
    );
    const output = lines.map(stripAnsi).join("\n");

    expect(output).toContain("Details");
    expect(output).toContain("Quoted text");
    expect(output).toContain("const value = 1;");
    expect(output).not.toContain("## Details");
    expect(output).not.toContain("> Quoted text");
    expect(lines.find((line) => line.includes("const value = 1;")))
      .toContain("\u001b[");
  });

  test.each([
    ["flowchart", "flowchart LR\nA[Start] --> B[Done]", ["Start", "Done"]],
    ["state", "stateDiagram-v2\n[*] --> Idle\nIdle --> [*]", ["Idle"]],
    ["class", "classDiagram\nclass Animal", ["Animal"]],
    [
      "entity relationship",
      "erDiagram\nCUSTOMER ||--o{ ORDER : places",
      ["CUSTOMER", "ORDER"],
    ],
    [
      "sequence",
      "sequenceDiagram\nAlice->>Bob: Hi",
      ["Alice", "Bob", "Hi"],
    ],
  ])("renders a clean %s Mermaid diagram", (_kind, source, labels) => {
    const output = renderedDescription(
      `\`\`\`mermaid\n${source}\n\`\`\``,
      120,
    ).map(stripAnsi).join("\n");

    for (const label of labels) expect(output).toContain(label);
    expect(output).not.toContain("```mermaid");
  });

  test.each([
    ["master-detail", 100, true],
    ["stacked", 60, false],
  ])("renders Mermaid inside the %s questionnaire layout", (_name, width, masterDetail) => {
    const view = descriptionView(
      "```mermaid\nflowchart LR\nA[Start] --> B[Done]\n```",
      width,
    );
    const output = view.lines.map(stripAnsi).join("\n");

    expect(view.masterDetail).toBe(masterDetail);
    expect(output).toContain("Start");
    expect(output).toContain("Done");
    expect(output).toContain("▶");
    expect(output).not.toContain("```mermaid");
    expect(view.lines.every((line) => visibleWidth(line) <= width)).toBe(true);
  });

  test("renders Mermaid blocks with surrounding Markdown in source order", () => {
    const output = renderedDescription([
      "Before **bold** text",
      "",
      "```mermaid",
      "flowchart LR",
      "A[First] --> B[Second]",
      "```",
      "",
      "Between",
      "",
      "~~~MERMAID",
      "sequenceDiagram",
      "Alice->>Bob: Hello",
      "~~~",
      "",
      "After `code` text",
    ].join("\n"), 120).map(stripAnsi).join("\n");

    const before = output.indexOf("Before bold text");
    const first = output.indexOf("First");
    const between = output.indexOf("Between");
    const alice = output.indexOf("Alice");
    const after = output.indexOf("After code text");
    expect(before).toBeGreaterThan(-1);
    expect(first).toBeGreaterThan(before);
    expect(between).toBeGreaterThan(first);
    expect(alice).toBeGreaterThan(between);
    expect(after).toBeGreaterThan(alice);
    expect(output).not.toContain("```mermaid");
    expect(output).not.toContain("~~~MERMAID");
  });

  test.each([
    ["invalid", "not valid"],
    ["unsupported", "mindmap\n  root((A))"],
    ["warning-producing", "flowchart TD\nA[Start --> B"],
  ])("falls back to fenced source for %s Mermaid", (_kind, source) => {
    const output = renderedDescription(
      `\`\`\`mermaid\n${source}\n\`\`\``,
      120,
    ).map(stripAnsi).join("\n");

    expect(output).toContain("```mermaid");
    expect(output).toContain(source.split("\n")[0] ?? source);
  });

  test("falls back to source when Mermaid art exceeds the description width", () => {
    const output = renderedDescription([
      "```mermaid",
      "flowchart LR",
      "A[This is a very long label that cannot fit] --> B[Another long label]",
      "```",
    ].join("\n"), 32);
    const plain = output.map(stripAnsi).join("\n");

    expect(plain).toContain("```mermaid");
    expect(plain).toContain("flowchart");
    expect(output.every((line) => visibleWidth(line) <= 32)).toBe(true);
  });

  test("leaves unclosed and nested Mermaid-looking fences as source", () => {
    const unclosed = renderedDescription(
      "```mermaid\nflowchart LR\nA --> B",
      120,
    ).map(stripAnsi).join("\n");
    const nested = renderedDescription([
      "````text",
      "```mermaid",
      "flowchart LR",
      "A --> B",
      "```",
      "````",
    ].join("\n"), 120).map(stripAnsi).join("\n");

    expect(unclosed).toContain("```mermaid");
    expect(unclosed).toContain("flowchart LR");
    expect(nested).toContain("```mermaid");
    expect(nested).toContain("flowchart LR");
  });

  test("uses Pi theme roles for Mermaid spans", () => {
    const colors: string[] = [];
    const semanticTheme = {
      fg: (color: string, text: string) => {
        colors.push(color);
        return text;
      },
      bold: (text: string) => text,
    } as unknown as Theme;
    const lines = renderOptionDescription(
      "```mermaid\nflowchart LR\nA[Start] -->|next| B[Done]\n```",
      80,
      markdownTheme,
      semanticTheme,
    );

    expect(colors).toContain("borderMuted");
    expect(colors).toContain("text");
    expect(colors).toContain("accent");
    expect(colors).toContain("muted");
    expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
  });

  test("wraps Markdown descriptions within the dialog width", () => {
    const lines = renderedDescription(
      "A long description that must wrap without crossing the dialog border.",
      32,
    );

    expect(lines.every((line) => visibleWidth(line) <= 32)).toBe(true);
    expect(
      lines.filter((line) =>
        line.includes("description") || line.includes("dialog")
      ),
    ).not.toHaveLength(0);
  });

  test("keeps Markdown descriptions visible when indentation cannot fit", () => {
    const lines = renderedDescription("AB\n**CD**", 8);
    const plainLines = lines.map(stripAnsi);

    expect(lines.every((line) => visibleWidth(line) <= 8)).toBe(true);
    expect(plainLines.some((line) => line.includes("AB"))).toBe(true);
    expect(plainLines.some((line) => line.includes("CD"))).toBe(true);
  });

  test("separates every answer option with a blank line", () => {
    const plainLines = renderedDescription("").map(stripAnsi);
    const vimIndex = plainLines.findIndex((line) => line.includes("● Vim"));
    const emacsIndex = plainLines.findIndex((line) => line.includes("○ Emacs"));
    const customIndex = plainLines.findIndex((line) =>
      line.includes("○ Write your own answer")
    );

    expect(emacsIndex).toBeGreaterThan(vimIndex + 1);
    expect(customIndex).toBeGreaterThan(emacsIndex + 1);
  });

  test("keeps descriptions off the confirmation screen", () => {
    const lines = renderedDescription("SECRET description", 80, 1);

    expect(lines.map(stripAnsi).join("\n")).not.toContain("SECRET description");
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
