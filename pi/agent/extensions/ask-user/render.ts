import type {
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Markdown,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type MarkdownTheme,
} from "@earendil-works/pi-tui";
import {
  dialogContentWidth,
  formatDialogHints,
  keybindingHint,
  renderDialogFrame,
} from "../../shared/ui/index.ts";
import { ICONS } from "./icons.ts";
import { answerStateToResult, NOT_ANSWERED_LABEL } from "./results.ts";
import { CUSTOM_OPTION_LABEL } from "./schema.ts";
import type {
  DetailViewport,
  Question,
  QuestionnaireRenderView,
  QuestionTab,
  RenderState,
} from "./types.ts";

export const MASTER_DETAIL_MIN_WIDTH = 72;
const MASTER_DETAIL_LEFT_MIN = 28;
const MASTER_DETAIL_LEFT_MAX = 36;
const MASTER_DETAIL_GAP = 3;

function appendPrefixed(
  lines: string[],
  width: number,
  prefix: string,
  text: string,
  style: (line: string) => string = (line) => line,
) {
  const prefixWidth = visibleWidth(prefix);
  if (prefixWidth >= width) {
    lines.push(...wrapTextWithAnsi(`${prefix}${style(text)}`, width));
    return;
  }

  const continuation = " ".repeat(prefixWidth);
  const paragraphs = text.split("\n");
  let firstLine = true;
  for (const paragraph of paragraphs) {
    const wrapped = wrapTextWithAnsi(
      style(paragraph || " "),
      Math.max(1, width - prefixWidth),
    );
    for (const line of wrapped) {
      lines.push(`${firstLine ? prefix : continuation}${line}`);
      firstLine = false;
    }
  }
}

function appendMarkdownPrefixed(
  lines: string[],
  width: number,
  prefix: string,
  markdown: string,
  markdownTheme: MarkdownTheme,
) {
  const prefixWidth = visibleWidth(prefix);
  const canIndent = prefixWidth < width;
  const contentWidth = canIndent ? width - prefixWidth : width;
  const rendered = new Markdown(
    markdown,
    0,
    0,
    markdownTheme,
  ).render(Math.max(1, contentWidth));

  for (const line of rendered) {
    lines.push(canIndent ? `${prefix}${line}` : line);
  }
}

function fitColumn(line: string, width: number) {
  const clipped = truncateToWidth(line, Math.max(1, width), "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function masterDetailWidths(width: number) {
  const left = Math.max(
    MASTER_DETAIL_LEFT_MIN,
    Math.min(MASTER_DETAIL_LEFT_MAX, Math.floor(width * 0.3)),
  );
  return { left, right: Math.max(1, width - left - MASTER_DETAIL_GAP) };
}

function tabWidth(tabs: QuestionTab[], start: number, end: number) {
  return tabs.slice(start, end + 1).reduce((total, tab, index) => {
    return total + visibleWidth(tab.plain) + (index === 0 ? 0 : 1);
  }, 0);
}

function renderTabs(state: RenderState, theme: Theme, width: number) {
  const tabs: QuestionTab[] = state.questions.map((question, index) => {
    const answer = state.answers[index];
    const answered = answer
      ? answer.selected.size > 0 || Boolean(answer.custom)
      : false;
    const label = truncateToWidth(
      question.label ?? question.id ?? `Q${index + 1}`,
      16,
    );
    return {
      plain: ` ${answered ? ICONS.answered : ICONS.unanswered} ${label} `,
      active: state.screen === index,
      answered,
      confirmation: false,
    };
  });
  tabs.push({
    plain: ` ${ICONS.confirm} Confirm `,
    active: state.screen === state.questions.length,
    answered: false,
    confirmation: true,
  });

  const active = Math.max(0, Math.min(tabs.length - 1, state.screen));
  const available = Math.max(1, width - 2);
  let start = active;
  let end = active;

  while (true) {
    let changed = false;
    if (end < tabs.length - 1) {
      const nextWidth =
        tabWidth(tabs, start, end + 1) +
        (start > 0 ? 2 : 0) +
        (end + 1 < tabs.length - 1 ? 2 : 0);
      if (nextWidth <= available) {
        end++;
        changed = true;
      }
    }
    if (start > 0) {
      const nextWidth =
        tabWidth(tabs, start - 1, end) +
        (start - 1 > 0 ? 2 : 0) +
        (end < tabs.length - 1 ? 2 : 0);
      if (nextWidth <= available) {
        start--;
        changed = true;
      }
    }
    if (!changed) break;
  }

  const rendered: string[] = [];
  if (start > 0) rendered.push(theme.fg("dim", `${ICONS.previousTabs} `));
  for (let index = start; index <= end; index++) {
    const tab = tabs[index];
    if (!tab) continue;
    if (rendered.length > 0 && !(index === start && start > 0))
      rendered.push(" ");

    const color = tab.confirmation
      ? "accent"
      : tab.answered
        ? "success"
        : "muted";
    rendered.push(
      tab.active
        ? theme.bg("selectedBg", theme.fg("text", theme.bold(tab.plain)))
        : theme.fg(color, tab.plain),
    );
  }
  if (end < tabs.length - 1)
    rendered.push(theme.fg("dim", ` ${ICONS.nextTabs}`));
  return truncateToWidth(` ${rendered.join("")}`, width, "");
}

type DisplayOption =
  | (Question["options"][number] & { isCustom?: false })
  | { label: string; isCustom: true };

function displayOptions(question: Question): DisplayOption[] {
  return [
    ...question.options,
    { label: CUSTOM_OPTION_LABEL, isCustom: true },
  ];
}

function optionAppearance(
  state: RenderState,
  question: Question,
  option: DisplayOption,
  index: number,
) {
  const answer = state.answers[state.screen];
  const cursor = state.cursors[state.screen] ?? 0;
  const isCursor = cursor === index;
  const isCustom = option.isCustom === true;
  const isSelected = isCustom
    ? Boolean(answer?.custom)
    : Boolean(answer?.selected.has(index));
  const marker =
    question.type === "single"
      ? isSelected
        ? ICONS.singleSelected
        : ICONS.singleUnselected
      : isSelected
        ? ICONS.multipleSelected
        : ICONS.multipleUnselected;
  const color = isCursor
    ? "accent"
    : isSelected
      ? "success"
      : isCustom
        ? "muted"
        : "text";
  return { isCursor, isCustom, marker, color } as const;
}

function questionHints(
  state: RenderState,
  question: Question,
  keybindings: KeybindingsManager | undefined,
  masterDetail: boolean,
) {
  if (state.editQuestionIndex !== undefined) {
    return [
      keybindingHint(keybindings, "tui.input.submit", "confirm", "enter"),
      keybindingHint(
        keybindings,
        "tui.input.newLine",
        "newline",
        "shift+enter",
      ),
      keybindingHint(
        keybindings,
        "tui.select.cancel",
        "return to options",
        "esc",
      ),
    ];
  }

  return [
    keybindingHint(keybindings, "tui.select.up", "previous", "↑"),
    keybindingHint(keybindings, "tui.select.down", "next", "↓"),
    ...(question.type === "single"
      ? [
          keybindingHint(
            keybindings,
            "tui.select.confirm",
            "select and continue",
            "enter",
          ),
        ]
      : [
          "space toggle",
          keybindingHint(
            keybindings,
            "tui.select.confirm",
            "edit custom answer",
            "enter",
          ),
        ]),
    ...(masterDetail ? ["PgUp/PgDn details"] : []),
    `${ICONS.horizontal} tabs`,
    keybindingHint(keybindings, "tui.select.cancel", "decline", "esc"),
  ];
}

function renderStackedOptions(
  state: RenderState,
  question: Question,
  theme: Theme,
  width: number,
) {
  const lines: string[] = [];
  const answer = state.answers[state.screen];
  if (!answer) return lines;
  const options = displayOptions(question);

  options.forEach((option, index) => {
    const appearance = optionAppearance(state, question, option, index);
    const prefix = appearance.isCursor
      ? theme.fg("accent", ` ${ICONS.cursor} `)
      : "   ";
    appendPrefixed(
      lines,
      width,
      prefix,
      theme.fg(appearance.color, `${appearance.marker} ${option.label}`),
    );

    if (appearance.isCustom && answer.custom) {
      appendPrefixed(
        lines,
        width,
        "      ",
        answer.custom,
        (line) => theme.fg("muted", line),
      );
    } else if ("description" in option && option.description) {
      appendMarkdownPrefixed(
        lines,
        width,
        "      ",
        option.description,
        state.markdownTheme,
      );
    }

    if (index < options.length - 1) lines.push("");
  });

  if (state.editQuestionIndex !== undefined) {
    lines.push("");
    appendPrefixed(lines, width, " ", theme.fg("muted", "Your answer:"));
    for (const line of state.editor.render(Math.max(1, width - 2)))
      lines.push(` ${line}`);
  }
  return lines;
}

function renderOptionRail(
  state: RenderState,
  question: Question,
  theme: Theme,
  width: number,
  capacity: number,
) {
  const lines: string[] = [];
  let cursorRow = 0;
  const options = displayOptions(question);
  options.forEach((option, index) => {
    if ((state.cursors[state.screen] ?? 0) === index) cursorRow = lines.length;
    const appearance = optionAppearance(state, question, option, index);
    const prefix = appearance.isCursor
      ? theme.fg("accent", ` ${ICONS.cursor} `)
      : "   ";
    const labelLines: string[] = [];
    appendPrefixed(
      labelLines,
      width,
      prefix,
      theme.fg(appearance.color, `${appearance.marker} ${option.label}`),
    );
    lines.push(...labelLines);
    if (index < options.length - 1) lines.push("");
  });

  if (lines.length <= capacity) return lines;
  const maxTop = Math.max(0, lines.length - capacity);
  const top = Math.max(0, Math.min(maxTop, cursorRow - Math.floor(capacity / 2)));
  const visible = lines.slice(top, top + capacity);
  if (top > 0 && visible.length > 0) {
    visible[0] = theme.fg("dim", "↑ more options");
  }
  if (top + capacity < lines.length && visible.length > 0) {
    visible[visible.length - 1] = theme.fg("dim", "↓ more options");
  }
  return visible;
}

function renderFocusedDetail(
  state: RenderState,
  question: Question,
  theme: Theme,
  width: number,
) {
  const lines: string[] = [];
  const options = displayOptions(question);
  const cursor = state.cursors[state.screen] ?? 0;
  const option = options[cursor];
  const answer = state.answers[state.screen];
  if (!option || !answer) return lines;

  lines.push(theme.fg("accent", theme.bold(option.label)), "");
  if (option.isCustom === true) {
    if (state.editQuestionIndex !== undefined) {
      lines.push(theme.fg("muted", "Your answer:"));
      lines.push(...state.editor.render(Math.max(1, width)));
    } else if (answer.custom) {
      appendPrefixed(
        lines,
        width,
        "",
        answer.custom,
        (line) => theme.fg("text", line),
      );
      lines.push("", theme.fg("muted", "Press Enter to edit this answer."));
    } else {
      lines.push(theme.fg("muted", "Press Enter to write a custom answer."));
    }
  } else if (option.description) {
    lines.push(...new Markdown(
      option.description,
      0,
      0,
      state.markdownTheme,
    ).render(Math.max(1, width)));
  } else {
    lines.push(theme.fg("muted", "No additional details."));
  }
  return lines;
}

function viewportDetails(
  lines: string[],
  capacity: number,
  requestedTop: number,
  theme: Theme,
): { lines: string[]; viewport: DetailViewport } {
  const safeCapacity = Math.max(1, capacity);
  const maxTop = Math.max(0, lines.length - safeCapacity);
  const top = Math.max(0, Math.min(maxTop, requestedTop));
  const visible = lines.slice(top, top + safeCapacity);
  if (top > 0 && visible.length > 0) {
    visible[0] = theme.fg("dim", "↑ more details");
  }
  if (top + safeCapacity < lines.length && visible.length > 0) {
    visible[visible.length - 1] = theme.fg("dim", "↓ more details");
  }
  return {
    lines: visible,
    viewport: {
      top,
      maxTop,
      pageSize: Math.max(1, safeCapacity - 2),
      overflow: maxTop > 0,
    },
  };
}

function renderMasterDetail(
  state: RenderState,
  question: Question,
  theme: Theme,
  width: number,
  capacity: number,
) {
  const columns = masterDetailWidths(width);
  const rail = renderOptionRail(state, question, theme, columns.left, capacity);
  const detail = renderFocusedDetail(state, question, theme, columns.right);
  const viewport = viewportDetails(
    detail,
    capacity,
    state.detailScroll ?? 0,
    theme,
  );
  const height = Math.max(rail.length, viewport.lines.length);
  const divider = theme.fg("borderMuted", " │ ");
  const lines = Array.from({ length: height }, (_, index) =>
    `${fitColumn(rail[index] ?? "", columns.left)}${divider}${fitColumn(
      viewport.lines[index] ?? "",
      columns.right,
    )}`
  );
  return { lines, detailViewport: viewport.viewport };
}

export function renderQuestionnaireView(
  state: RenderState,
  theme: Theme,
  width: number,
  keybindings?: KeybindingsManager,
): QuestionnaireRenderView {
  const frameWidth = Math.max(1, width);
  const renderWidth = dialogContentWidth(frameWidth);
  const lines: string[] = [];

  if (state.screen === state.questions.length) {
    appendPrefixed(
      lines,
      renderWidth,
      " ",
      theme.fg("text", theme.bold("Confirm your answers")),
    );
    lines.push("");

    state.questions.forEach((question, index) => {
      const answer = state.answers[index];
      if (!answer) return;
      const result = answerStateToResult(question, answer);
      if (!result.answered) {
        const warning = theme.bg(
          "selectedBg",
          theme.fg(
            "warning",
            theme.bold(`${question.question}: ${NOT_ANSWERED_LABEL}`),
          ),
        );
        appendPrefixed(lines, renderWidth, ` ${ICONS.warning} `, warning);
        return;
      }

      appendPrefixed(
        lines,
        renderWidth,
        ` ${index + 1}. `,
        theme.fg("text", theme.bold(question.question)),
      );
      for (const submitted of result.answers) {
        const icon =
          submitted.kind === "custom" ? ICONS.customAnswer : ICONS.optionAnswer;
        appendPrefixed(
          lines,
          renderWidth,
          `    ${icon} `,
          submitted.label,
          (line) => theme.fg("success", line),
        );
      }
    });

    return {
      lines: renderDialogFrame(theme, frameWidth, {
        header: [renderTabs(state, theme, renderWidth)],
        body: lines,
        hints: [
          `${ICONS.left} return to questions`,
          keybindingHint(
            keybindings,
            "tui.select.confirm",
            "submit",
            "enter",
          ),
          keybindingHint(
            keybindings,
            "tui.select.cancel",
            "decline",
            "esc",
          ),
        ],
      }),
      masterDetail: false,
    };
  }

  const question = state.questions[state.screen];
  const answer = state.answers[state.screen];
  if (!question || !answer) {
    return {
      lines: renderDialogFrame(theme, frameWidth, {
        header: [renderTabs(state, theme, renderWidth)],
        body: lines,
        hints: [],
      }),
      masterDetail: false,
    };
  }

  const promptLines: string[] = [];
  appendPrefixed(
    promptLines,
    renderWidth,
    " ",
    theme.fg("text", theme.bold(question.question)),
  );

  const masterDetail = renderWidth >= MASTER_DETAIL_MIN_WIDTH;
  const hints = questionHints(state, question, keybindings, masterDetail);
  let detailViewport: DetailViewport | undefined;
  let contentLines: string[];

  if (masterDetail) {
    const hintRows = wrapTextWithAnsi(
      theme.fg("dim", formatDialogHints(hints)),
      renderWidth,
    ).length;
    const frameRowsWithoutPanel = 8 + promptLines.length + hintRows;
    const capacity = state.maxFrameRows === undefined
      ? Number.MAX_SAFE_INTEGER
      : Math.max(1, state.maxFrameRows - frameRowsWithoutPanel);
    const rendered = renderMasterDetail(
      state,
      question,
      theme,
      renderWidth,
      capacity,
    );
    contentLines = rendered.lines;
    detailViewport = rendered.detailViewport;
  } else {
    contentLines = renderStackedOptions(state, question, theme, renderWidth);
  }

  return {
    lines: renderDialogFrame(theme, frameWidth, {
      header: [renderTabs(state, theme, renderWidth)],
      body: [...promptLines, "", ...contentLines],
      hints,
    }),
    masterDetail,
    detailViewport,
  };
}

export function renderQuestionnaire(
  state: RenderState,
  theme: Theme,
  width: number,
  keybindings?: KeybindingsManager,
) {
  return renderQuestionnaireView(state, theme, width, keybindings).lines;
}
