import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, visibleWidth } from "@earendil-works/pi-tui";
import { installCustomMarkdownCodeBlocks } from "../markdown-renderer.ts";
import { diffCodeBlockRenderer } from "./index.ts";
import { alignUnifiedDiff } from "./renderer.ts";
import {
  applyDiffBackground,
  foregroundAnsiToBackground,
  getDiffBackgroundAnsi,
} from "./theme.ts";

const identity = (text: string) => text;
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
const markdownTheme = {
  heading: identity,
  link: identity,
  linkUrl: identity,
  code: identity,
  codeBlock: identity,
  codeBlockBorder: identity,
  quote: identity,
  quoteBorder: identity,
  hr: identity,
  listBullet: identity,
  bold: identity,
  italic: identity,
  strikethrough: identity,
  underline: identity,
  highlightCode: (code: string, language?: string) =>
    code.split("\n").map((line) => `\x1b[35m${language ?? "plain"}:${line}\x1b[39m`),
};

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: identity,
  italic: identity,
  strikethrough: identity,
  underline: identity,
  getFgAnsi: (color: string) =>
    color === "toolDiffAddedBg" ? "\x1b[38;2;31;48;29m" : "\x1b[38;2;53;28;36m",
  getBgAnsi: (color: string) =>
    color === "toolSuccessBg" ? "\x1b[48;5;22m" : "\x1b[48;5;52m",
} as unknown as Theme;

function installDiffRenderer(): void {
  installCustomMarkdownCodeBlocks([diffCodeBlockRenderer])(theme);
}

describe("side-by-side diff code block", () => {
  test("aligns replacement runs and preserves context", () => {
    expect(alignUnifiedDiff(" same\n-old one\n-old two\n+new one\n tail")).toEqual([
      {
        type: "pair",
        before: { marker: " ", text: "same" },
        after: { marker: " ", text: "same" },
      },
      {
        type: "pair",
        before: { marker: "-", text: "old one", changedBytes: [{ start: 0, end: 3 }] },
        after: { marker: "+", text: "new one", changedBytes: [{ start: 0, end: 3 }] },
      },
      {
        type: "pair",
        before: { marker: "-", text: "old two" },
        after: { marker: " ", text: "" },
      },
      {
        type: "pair",
        before: { marker: " ", text: "tail" },
        after: { marker: " ", text: "tail" },
      },
    ]);
  });

  test("aligns expanded statements and inserted blocks by line similarity", () => {
    const rows = alignUnifiedDiff(
      " export async function request(input: RequestInfo) {\n" +
        "-  const response = await fetch(input);\n" +
        "-  return response.json();\n" +
        "+  const response = await fetch(input, {\n" +
        "+    signal: AbortSignal.timeout(5_000),\n" +
        "+  });\n" +
        "+\n" +
        "+  if (!response.ok) {\n" +
        "+    throw new HttpError(response.status);\n" +
        "+  }\n" +
        "+\n" +
        "+  return response.json() as Promise<ApiResponse>;\n" +
        " }",
    );

    expect(rows[1]).toEqual({
      type: "pair",
      before: {
        marker: "-",
        text: "  const response = await fetch(input);",
        changedBytes: [{ start: 36, end: 38 }],
      },
      after: {
        marker: "+",
        text: "  const response = await fetch(input, {",
        changedBytes: [{ start: 36, end: 39 }],
      },
    });
    expect(rows.slice(2, 9).every((row) => row.type === "pair" && row.before.text === "")).toBe(
      true,
    );
    expect(rows[9]).toEqual({
      type: "pair",
      before: {
        marker: "-",
        text: "  return response.json();",
        changedBytes: [],
      },
      after: {
        marker: "+",
        text: "  return response.json() as Promise<ApiResponse>;",
        changedBytes: [{ start: 24, end: 48 }],
      },
    });
  });

  test("keeps byte ranges on UTF-8 character boundaries", () => {
    expect(alignUnifiedDiff("-café\n+cafè")).toEqual([
      {
        type: "pair",
        before: { marker: "-", text: "café", changedBytes: [{ start: 3, end: 5 }] },
        after: { marker: "+", text: "cafè", changedBytes: [{ start: 3, end: 5 }] },
      },
    ]);
  });

  test("keeps unrelated one-to-one replacements paired", () => {
    expect(alignUnifiedDiff("-alpha\n+XYZ")).toEqual([
      {
        type: "pair",
        before: {
          marker: "-",
          text: "alpha",
          changedBytes: [{ start: 0, end: 5 }],
        },
        after: {
          marker: "+",
          text: "XYZ",
          changedBytes: [{ start: 0, end: 3 }],
        },
      },
    ]);
  });

  test("falls back to whole-line ranges when an intra-line diff exceeds its bound", () => {
    const before = "a".repeat(600);
    const after = "b".repeat(600);
    expect(alignUnifiedDiff(`-${before}\n+${after}`)).toEqual([
      {
        type: "pair",
        before: { marker: "-", text: before, changedBytes: [{ start: 0, end: 600 }] },
        after: { marker: "+", text: after, changedBytes: [{ start: 0, end: 600 }] },
      },
    ]);
  });

  test("converts custom foreground tokens into truecolor and 256-color backgrounds", () => {
    expect(foregroundAnsiToBackground("\x1b[38;2;31;48;29m")).toBe("\x1b[48;2;31;48;29m");
    expect(foregroundAnsiToBackground("\x1b[38;5;22m")).toBe("\x1b[48;5;22m");
    expect(foregroundAnsiToBackground("\x1b[39m")).toBeUndefined();
  });

  test("falls back to native backgrounds when custom tokens are unavailable", () => {
    const fallbackTheme = {
      getFgAnsi: () => {
        throw new Error("Unknown color");
      },
      getBgAnsi: (color: string) =>
        color === "toolSuccessBg" ? "\x1b[48;5;22m" : "\x1b[48;5;52m",
    } as unknown as Theme;

    expect(getDiffBackgroundAnsi(fallbackTheme, "toolDiffAddedBg")).toBe("\x1b[48;5;22m");
    expect(getDiffBackgroundAnsi(fallbackTheme, "toolDiffRemovedBg")).toBe("\x1b[48;5;52m");
  });

  test("reapplies custom backgrounds after full syntax resets", () => {
    expect(applyDiffBackground(theme, "toolDiffAddedBg", "a\x1b[0mb")).toBe(
      "\x1b[48;2;31;48;29ma\x1b[0m\x1b[48;2;31;48;29mb\x1b[49m",
    );
  });

  test("renders wide diff fences side-by-side without exceeding width", () => {
    installDiffRenderer();
    const component = new Markdown(
      "Plan intro\n\n```diff\n-const mode = 'old';\n+const mode = 'new';\n```\n\nPlan outro",
      1,
      0,
      markdownTheme,
    );
    const lines = component.render(100);

    expect(lines.some((line) => line.includes("Before") && line.includes("After"))).toBe(true);
    expect(
      lines.some((line) => {
        const visibleLine = stripAnsi(line);
        return (
          visibleLine.includes("- const mode = 'old';") &&
          visibleLine.includes("+ const mode = 'new';")
        );
      }),
    ).toBe(true);
    expect(lines.some((line) => line.includes("\x1b[48;2;53;28;36m"))).toBe(true);
    expect(lines.some((line) => line.includes("\x1b[48;2;31;48;29m"))).toBe(true);
    expect(lines.every((line) => visibleWidth(line) <= 100)).toBe(true);
  });

  test("wraps long replacement lines without truncating their suffixes", () => {
    installDiffRenderer();
    const before =
      "const beforeValue = buildConfiguration(alpha, beta, gamma, delta, epsilon); // BEFORE_TAIL";
    const after =
      "const afterValue = buildConfiguration(alpha, beta, gamma, delta, epsilon, zeta); // AFTER_TAIL";
    const lines = new Markdown(`\`\`\`diff\n-${before}\n+${after}\n\`\`\``, 1, 0, markdownTheme).render(
      100,
    );
    const visibleLines = lines.map(stripAnsi);

    expect(visibleLines.some((line) => line.includes("BEFORE_TAIL"))).toBe(true);
    expect(visibleLines.some((line) => line.includes("AFTER_TAIL"))).toBe(true);
    expect(visibleLines.filter((line) => line.includes("- const beforeValue"))).toHaveLength(1);
    expect(visibleLines.filter((line) => line.includes("+ const afterValue"))).toHaveLength(1);
    expect(lines.every((line) => visibleWidth(line) <= 100)).toBe(true);
  });

  test("preserves syntax and changed-byte backgrounds across wrapped lines", () => {
    installDiffRenderer();
    const exactHighlightTheme = {
      ...markdownTheme,
      highlightCode: (code: string) =>
        code.split("\n").map((line) => `\x1b[35m${line}\x1b[0m`),
    };
    const before = `const value = "${"a".repeat(70)}old";`;
    const after = `const value = "${"a".repeat(70)}new";`;
    const lines = new Markdown(
      `\`\`\`diff:typescript\n-${before}\n+${after}\n\`\`\``,
      1,
      0,
      exactHighlightTheme,
    ).render(100);
    const beforeContinuation = lines.find((line) => stripAnsi(line).includes('old";'));
    const afterContinuation = lines.find((line) => stripAnsi(line).includes('new";'));

    expect(beforeContinuation).toBeDefined();
    expect(afterContinuation).toBeDefined();
    expect(beforeContinuation).toContain("\x1b[35m");
    expect(afterContinuation).toContain("\x1b[35m");
    expect(beforeContinuation).toContain("\x1b[48;2;53;28;36m");
    expect(afterContinuation).toContain("\x1b[48;2;31;48;29m");
    for (const background of ["\x1b[48;2;53;28;36m", "\x1b[48;2;31;48;29m"]) {
      const backgroundLines = lines.filter((line) => line.includes(background));
      expect(backgroundLines.length).toBeGreaterThan(0);
      expect(
        backgroundLines.every(
          (line) => line.lastIndexOf(background) < line.lastIndexOf("\x1b[49m"),
        ),
      ).toBe(true);
    }
    expect(lines.every((line) => visibleWidth(line) <= 100)).toBe(true);
  });

  test("wraps long metadata lines without truncating them", () => {
    installDiffRenderer();
    const path = `${"nested/".repeat(16)}example.ts`;
    const lines = new Markdown(
      `\`\`\`diff\ndiff --git a/${path} b/${path}\n-old\n+new\n\`\`\``,
      1,
      0,
      markdownTheme,
    ).render(100);
    const visibleLines = lines.map(stripAnsi);

    expect(visibleLines.filter((line) => line.includes("example.ts")).length).toBeGreaterThan(1);
    expect(lines.every((line) => visibleWidth(line) <= 100)).toBe(true);
  });

  test("restores full-pane backgrounds for unpaired changes", () => {
    installDiffRenderer();
    const lines = new Markdown(
      "```diff\n-removed\n unchanged\n+inserted\n+\n```",
      1,
      0,
      markdownTheme,
    ).render(100);
    const removedBackground = "\x1b[48;2;53;28;36m";
    const addedBackground = "\x1b[48;2;31;48;29m";

    const removedLine = lines.find((line) => stripAnsi(line).includes("- removed"));
    const insertedLine = lines.find((line) => stripAnsi(line).includes("+ inserted"));
    expect(removedLine).toBeDefined();
    expect(insertedLine).toBeDefined();

    const removedCell = removedLine!.slice(
      removedLine!.indexOf(removedBackground) + removedBackground.length,
      removedLine!.indexOf("\x1b[49m", removedLine!.indexOf(removedBackground)),
    );
    const addedCell = insertedLine!.slice(
      insertedLine!.indexOf(addedBackground) + addedBackground.length,
      insertedLine!.indexOf("\x1b[49m", insertedLine!.indexOf(addedBackground)),
    );
    expect(stripAnsi(removedCell)).toStartWith("- removed");
    expect(stripAnsi(addedCell)).toStartWith("+ inserted");
    expect(visibleWidth(removedCell)).toBe(45);
    expect(visibleWidth(addedCell)).toBe(46);

    const addedCells = lines.filter((line) => line.includes(addedBackground));
    expect(addedCells).toHaveLength(2);
  });

  test("keeps full-pane backgrounds on wrapped unpaired changes", () => {
    installDiffRenderer();
    const addedBackground = "\x1b[48;2;31;48;29m";
    const added =
      "insert a deliberately long standalone line that wraps across several visual rows and keeps its full background through ADDED_TAIL";
    const lines = new Markdown(`\`\`\`diff\n+${added}\n\`\`\``, 1, 0, markdownTheme).render(100);
    const addedLines = lines.filter((line) => line.includes(addedBackground));

    expect(addedLines.length).toBeGreaterThan(1);
    expect(addedLines.some((line) => stripAnsi(line).includes("ADDED_TAIL"))).toBe(true);
    for (const line of addedLines) {
      const start = line.indexOf(addedBackground) + addedBackground.length;
      const cell = line.slice(start, line.indexOf("\x1b[49m", start));
      expect(visibleWidth(cell)).toBe(46);
    }
  });

  test("backgrounds only changed bytes on aligned lines", () => {
    installDiffRenderer();
    const lines = new Markdown(
      "```diff\n-  const response = await fetch(input);\n+  const response = await fetch(input, {\n```",
      1,
      0,
      markdownTheme,
    ).render(100);

    const changedLine = lines.find((line) => stripAnsi(line).includes("fetch(input);"));
    expect(changedLine).toBeDefined();
    expect(changedLine!.indexOf("fetch(input")).toBeLessThan(
      changedLine!.indexOf("\x1b[48;2;53;28;36m"),
    );
    expect(changedLine!.indexOf("fetch(input", changedLine!.indexOf(" │ "))).toBeLessThan(
      changedLine!.indexOf("\x1b[48;2;31;48;29m"),
    );
  });

  test("preserves syntax ANSI while applying partial byte backgrounds", () => {
    installDiffRenderer();
    const exactHighlightTheme = {
      ...markdownTheme,
      highlightCode: (code: string) =>
        code.split("\n").map((line) => `\x1b[35m${line}\x1b[0m`),
    };
    const lines = new Markdown(
      "```diff:typescript\n-const mode = 'old';\n+const mode = 'new';\n```",
      1,
      0,
      exactHighlightTheme,
    ).render(100);

    const changedLine = lines.find((line) => stripAnsi(line).includes("const mode = 'old';"));
    expect(changedLine).toBeDefined();
    expect(changedLine).toContain("\x1b[35mconst mode = '");
    expect(changedLine!.indexOf("const mode = '")).toBeLessThan(
      changedLine!.indexOf("\x1b[48;2;53;28;36m"),
    );
    expect(changedLine).toContain("\x1b[0m");
  });

  test("inherits syntax highlighting without coloring context backgrounds", () => {
    installDiffRenderer();
    const lines = new Markdown(
      "```diff:typescript\n const shared = true;\n-const mode = 'old';\n+const mode = 'new';\n```",
      1,
      0,
      markdownTheme,
    ).render(100);

    const contextLine = lines.find((line) => line.includes("typescript:const shared = true;"));
    expect(contextLine).toBeDefined();
    expect(contextLine).not.toContain("\x1b[48;2;");
    expect(lines.some((line) => line.includes("typescript:const mode = 'old';"))).toBe(true);
    expect(lines.some((line) => line.includes("typescript:const mode = 'new';"))).toBe(true);
    expect(lines.some((line) => line.includes("\x1b[48;2;53;28;36m"))).toBe(true);
    expect(lines.some((line) => line.includes("\x1b[48;2;31;48;29m"))).toBe(true);
  });

  test("falls back to unified rendering in narrow terminals", () => {
    installDiffRenderer();
    const lines = new Markdown("```diff:typescript\n-old\n+new\n```", 1, 0, markdownTheme).render(60);

    expect(lines.some((line) => line.includes("```diff"))).toBe(true);
    expect(lines.some((line) => line.includes("```diff:typescript"))).toBe(false);
    expect(lines.some((line) => line.includes("Before"))).toBe(false);
  });

  test("does not claim the former diff-side-by-side language", () => {
    installDiffRenderer();
    const lines = new Markdown(
      "```diff-side-by-side\n-old\n+new\n```",
      1,
      0,
      markdownTheme,
    ).render(100);

    expect(lines.some((line) => line.includes("```diff-side-by-side"))).toBe(true);
    expect(lines.some((line) => line.includes("Before"))).toBe(false);
  });
});
