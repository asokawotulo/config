import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { ICONS } from "./icons.ts";
import { answerStateToResult, NOT_ANSWERED_LABEL } from "./results.ts";
import { CUSTOM_OPTION_LABEL } from "./schema.ts";
import type { QuestionTab, RenderState } from "./types.ts";

function appendPrefixed(
  lines: string[],
  width: number,
  prefix: string,
  text: string,
) {
  const prefixWidth = visibleWidth(prefix);
  if (prefixWidth >= width) {
    lines.push(...wrapTextWithAnsi(prefix + text, width));
    return;
  }

  const continuation = " ".repeat(prefixWidth);
  const paragraphs = text.split("\n");
  let firstLine = true;
  for (const paragraph of paragraphs) {
    const wrapped = wrapTextWithAnsi(
      paragraph || " ",
      Math.max(1, width - prefixWidth),
    );
    for (const line of wrapped) {
      lines.push(`${firstLine ? prefix : continuation}${line}`);
      firstLine = false;
    }
  }
}

function appendStyledPrefixed(
  lines: string[],
  width: number,
  prefix: string,
  text: string,
  style: (line: string) => string,
) {
  const prefixWidth = visibleWidth(prefix);
  const continuation = " ".repeat(prefixWidth);
  const paragraphs = text.split("\n");
  let firstLine = true;

  for (const paragraph of paragraphs) {
    const styled = style(paragraph || " ");
    const wrapped = wrapTextWithAnsi(styled, Math.max(1, width - prefixWidth));
    for (const line of wrapped) {
      lines.push(`${firstLine ? prefix : continuation}${line}`);
      firstLine = false;
    }
  }
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

export function renderQuestionnaire(
  state: RenderState,
  theme: Theme,
  width: number,
) {
  const renderWidth = Math.max(1, width);
  const lines: string[] = [theme.fg("accent", "─".repeat(renderWidth))];
  lines.push(renderTabs(state, theme, renderWidth));
  lines.push("");

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
        appendStyledPrefixed(
          lines,
          renderWidth,
          `    ${icon} `,
          submitted.label,
          (line) => theme.fg("success", line),
        );
      }
    });

    lines.push("");
    appendPrefixed(
      lines,
      renderWidth,
      " ",
      theme.fg(
        "dim",
        `${ICONS.left} return to questions ${ICONS.separator} Enter submit ${ICONS.separator} Esc decline`,
      ),
    );
    lines.push(theme.fg("accent", "─".repeat(renderWidth)));
    return lines;
  }

  const question = state.questions[state.screen];
  const answer = state.answers[state.screen];
  if (!question || !answer) return lines;

  appendPrefixed(
    lines,
    renderWidth,
    " ",
    theme.fg("text", theme.bold(question.question)),
  );
  lines.push("");

  const options = [
    ...question.options,
    { label: CUSTOM_OPTION_LABEL, isCustom: true },
  ];
  const cursor = state.cursors[state.screen] ?? 0;
  options.forEach((option, index) => {
    const isCursor = cursor === index;
    const isCustom = "isCustom" in option && option.isCustom === true;
    const isSelected = isCustom
      ? Boolean(answer.custom)
      : answer.selected.has(index);
    const marker =
      question.type === "single"
        ? isSelected
          ? ICONS.singleSelected
          : ICONS.singleUnselected
        : isSelected
          ? ICONS.multipleSelected
          : ICONS.multipleUnselected;
    const prefix = isCursor ? theme.fg("accent", ` ${ICONS.cursor} `) : "   ";
    const color = isCursor
      ? "accent"
      : isSelected
        ? "success"
        : isCustom
          ? "muted"
          : "text";
    appendPrefixed(
      lines,
      renderWidth,
      prefix,
      theme.fg(color, `${marker} ${option.label}`),
    );

    if (isCustom && answer.custom) {
      appendStyledPrefixed(
        lines,
        renderWidth,
        "      ",
        answer.custom,
        (line) => theme.fg("muted", line),
      );
    } else if ("description" in option && option.description) {
      appendPrefixed(
        lines,
        renderWidth,
        "      ",
        theme.fg("muted", option.description),
      );
    }
  });

  if (state.editQuestionIndex !== undefined) {
    lines.push("");
    appendPrefixed(lines, renderWidth, " ", theme.fg("muted", "Your answer:"));
    for (const line of state.editor.render(Math.max(1, renderWidth - 2)))
      lines.push(` ${line}`);
    lines.push("");
    appendPrefixed(
      lines,
      renderWidth,
      " ",
      theme.fg(
        "dim",
        `Enter confirm ${ICONS.separator} Shift+Enter newline ${ICONS.separator} Esc return to options`,
      ),
    );
  } else {
    lines.push("");
    const selectionHelp =
      question.type === "single"
        ? "Enter select and continue"
        : `Space toggle ${ICONS.separator} Enter edit custom answer`;
    appendPrefixed(
      lines,
      renderWidth,
      " ",
      theme.fg(
        "dim",
        `↑↓ navigate ${ICONS.separator} ${selectionHelp} ${ICONS.separator} ${ICONS.horizontal} tabs ${ICONS.separator} Esc decline`,
      ),
    );
  }

  lines.push(theme.fg("accent", "─".repeat(renderWidth)));
  return lines;
}
