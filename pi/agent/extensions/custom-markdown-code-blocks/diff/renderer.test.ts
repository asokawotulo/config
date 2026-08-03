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
        before: { marker: "-", text: "old one" },
        after: { marker: "+", text: "new one" },
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
      lines.some(
        (line) =>
          line.includes("- const mode = 'old';") && line.includes("+ const mode = 'new';"),
      ),
    ).toBe(true);
    expect(lines.some((line) => line.includes("\x1b[48;2;53;28;36m"))).toBe(true);
    expect(lines.some((line) => line.includes("\x1b[48;2;31;48;29m"))).toBe(true);
    expect(lines.every((line) => visibleWidth(line) <= 100)).toBe(true);
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
