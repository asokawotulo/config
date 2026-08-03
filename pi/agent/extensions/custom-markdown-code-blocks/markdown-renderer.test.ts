import { describe, expect, test } from "bun:test";
import { Markdown } from "@earendil-works/pi-tui";
import { installCustomMarkdownCodeBlocks, splitMarkdownCodeBlockSections } from "./markdown-renderer.ts";
import type { CustomCodeBlockRenderer } from "./types.ts";

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

const noticeRenderer: CustomCodeBlockRenderer = {
  language: "notice",
  render: ({ code }) => [`custom: ${code}`],
};

describe("custom Markdown code block framework", () => {
  test("splits registered closed and streaming fences from surrounding Markdown", () => {
    const languages = new Set(["notice"]);
    expect(splitMarkdownCodeBlockSections("Before\n\n```notice\nhello\n```\n\nAfter", languages)).toEqual([
      { type: "markdown", text: "Before\n" },
      { type: "codeBlock", code: "hello", language: "notice", closed: true },
      { type: "markdown", text: "\nAfter" },
    ]);
    expect(splitMarkdownCodeBlockSections("```notice\npartial", languages)).toEqual([
      { type: "codeBlock", code: "partial", language: "notice", closed: false },
    ]);
  });

  test("dispatches registered blocks and preserves surrounding Markdown", () => {
    installCustomMarkdownCodeBlocks([noticeRenderer]);
    const lines = new Markdown(
      "Before\n\n```notice\nhello\n```\n\nAfter",
      0,
      0,
      markdownTheme,
    ).render(80);

    expect(lines.some((line) => line.includes("Before"))).toBe(true);
    expect(lines).toContain("custom: hello");
    expect(lines.some((line) => line.includes("After"))).toBe(true);
  });

  test("leaves unregistered languages to Pi's original renderer", () => {
    installCustomMarkdownCodeBlocks([noticeRenderer]);
    const lines = new Markdown("```typescript\nconst value = 1;\n```", 0, 0, markdownTheme).render(80);

    expect(lines.some((line) => line.includes("```typescript"))).toBe(true);
    expect(lines.some((line) => line.includes("custom:"))).toBe(false);
  });

  test("delegates to the original renderer when a custom renderer declines", () => {
    installCustomMarkdownCodeBlocks([{ language: "notice", render: () => undefined }]);
    const lines = new Markdown("```notice\nhello\n```", 0, 0, markdownTheme).render(80);

    expect(lines.some((line) => line.includes("```notice"))).toBe(true);
    expect(lines.some((line) => line.includes("hello"))).toBe(true);
  });

  test("reuses one prototype patch while refreshing the renderer registry", () => {
    installCustomMarkdownCodeBlocks([noticeRenderer]);
    const patchedRender = Markdown.prototype.render;
    installCustomMarkdownCodeBlocks([{ language: "other", render: ({ code }) => [`other: ${code}`] }]);

    expect(Markdown.prototype.render).toBe(patchedRender);
    const lines = new Markdown("```other\nvalue\n```", 0, 0, markdownTheme).render(80);
    expect(lines).toContain("other: value");
  });
});
