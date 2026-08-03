import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, visibleWidth } from "@earendil-works/pi-tui";
import { installCustomMarkdownCodeBlocks } from "../markdown-renderer.ts";
import { diffCodeBlockRenderer } from "./index.ts";
import { alignUnifiedDiff } from "./renderer.ts";

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
};

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: identity,
  italic: identity,
  strikethrough: identity,
  underline: identity,
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
    expect(lines.every((line) => visibleWidth(line) <= 100)).toBe(true);
  });

  test("falls back to unified rendering in narrow terminals", () => {
    installDiffRenderer();
    const lines = new Markdown("```diff\n-old\n+new\n```", 1, 0, markdownTheme).render(60);

    expect(lines.some((line) => line.includes("```diff"))).toBe(true);
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
