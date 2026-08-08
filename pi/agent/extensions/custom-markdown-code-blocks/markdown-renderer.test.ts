import { describe, expect, test } from "bun:test";
import { Markdown } from "@earendil-works/pi-tui";
import {
  installCustomMarkdownCodeBlocks,
  resolveCodeBlockLanguage,
  splitMarkdownCodeBlockSections,
} from "./markdown-renderer.ts";
import type {
  CustomCodeBlockRenderer,
  TransitionalMarkdownOptions,
} from "./types.ts";

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

const diffRenderer: CustomCodeBlockRenderer = {
  language: "diff",
  render: ({ code }) => [`diff custom: ${code}`],
};

describe("custom Markdown code block framework", () => {
  test("resolves exact and inherited languages without claiming malformed variants", () => {
    const languages = new Set(["diff"]);
    expect(resolveCodeBlockLanguage("diff", languages)).toEqual({ language: "diff" });
    expect(resolveCodeBlockLanguage("DIFF:TypeScript", languages)).toEqual({
      language: "diff",
      inheritedLanguage: "typescript",
    });
    expect(resolveCodeBlockLanguage("diff:", languages)).toBeUndefined();
    expect(resolveCodeBlockLanguage("diff:typescript:extra", languages)).toBeUndefined();
    expect(resolveCodeBlockLanguage("unknown:typescript", languages)).toBeUndefined();
  });

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
    expect(splitMarkdownCodeBlockSections("```notice:typescript\npartial", languages)).toEqual([
      {
        type: "codeBlock",
        code: "partial",
        language: "notice",
        inheritedLanguage: "typescript",
        closed: false,
      },
    ]);
  });

  test("skips custom-looking fences inside ordinary backtick and tilde fences", () => {
    const sources = [
      "````text\n```notice\nliteral backtick content\n```\n````",
      "~~~~text\n~~~notice\nliteral tilde content\n~~~\n~~~~",
    ];

    for (const source of sources) {
      expect(splitMarkdownCodeBlockSections(source, new Set(["notice"]))).toEqual([
        { type: "markdown", text: source },
      ]);
    }
  });

  test("does not render custom-looking fences inside ordinary backtick and tilde fences", () => {
    const renderedCodes: string[] = [];
    installCustomMarkdownCodeBlocks([
      {
        language: "notice",
        render: ({ code }) => {
          renderedCodes.push(code);
          return [`unexpected custom: ${code}`];
        },
      },
    ]);
    const cases = [
      {
        source: "````text\n```notice\nliteral backtick content\n```\n````",
        literal: "literal backtick content",
      },
      {
        source: "~~~~text\n~~~notice\nliteral tilde content\n~~~\n~~~~",
        literal: "literal tilde content",
      },
    ];

    for (const { source, literal } of cases) {
      const lines = new Markdown(source, 0, 0, markdownTheme).render(80);
      expect(lines.some((line) => line.includes(literal))).toBe(true);
      expect(lines.some((line) => line.includes("unexpected custom"))).toBe(false);
    }
    expect(renderedCodes).toEqual([]);
  });

  test("passes closed and streaming fence state to custom renderers", () => {
    const closedStates: boolean[] = [];
    installCustomMarkdownCodeBlocks([
      {
        language: "notice",
        render: ({ closed }) => {
          closedStates.push(closed);
          return [String(closed)];
        },
      },
    ]);

    new Markdown("```notice\ncomplete\n```", 0, 0, markdownTheme).render(80);
    new Markdown("```notice\nstreaming", 0, 0, markdownTheme).render(80);

    expect(closedStates).toEqual([true, false]);
  });

  test("applies transform once to the complete source at content width", () => {
    installCustomMarkdownCodeBlocks([noticeRenderer]);
    const source = "Before\n\n```notice\nhello\n```\n\nAfter";
    const calls: Array<{ markdown: string; width: number }> = [];
    const options: TransitionalMarkdownOptions = {
      transform: (markdown, availableWidth) => {
        calls.push({ markdown, width: availableWidth });
        return markdown;
      },
    };

    const lines = new Markdown(source, 3, 0, markdownTheme, undefined, options).render(40);

    expect(calls).toEqual([{ markdown: source, width: 34 }]);
    expect(lines).toContain("custom: hello");
  });

  test("caches transformed output until invalidation or width changes", () => {
    installCustomMarkdownCodeBlocks([noticeRenderer]);
    let transformCount = 0;
    const options: TransitionalMarkdownOptions = {
      transform: (markdown) => {
        transformCount++;
        return markdown;
      },
    };
    const component = new Markdown(
      "```notice\nhello\n```",
      0,
      0,
      markdownTheme,
      undefined,
      options,
    );

    const first = component.render(80);
    expect(component.render(80)).toBe(first);
    expect(transformCount).toBe(1);

    const resized = component.render(100);
    expect(resized).not.toBe(first);
    expect(transformCount).toBe(2);
    expect(component.render(100)).toBe(resized);

    component.invalidate();
    const invalidated = component.render(100);
    expect(invalidated).not.toBe(resized);
    expect(transformCount).toBe(3);
  });

  test("discovers diff fences created by transform", () => {
    installCustomMarkdownCodeBlocks([diffRenderer]);
    const options: TransitionalMarkdownOptions = {
      transform: () => "```diff\n-old\n+new\n```",
    };

    const lines = new Markdown("diff placeholder", 0, 0, markdownTheme, undefined, options).render(
      80,
    );

    expect(lines).toContain("diff custom: -old\n+new");
  });

  test("does not dispatch diff fences removed by transform", () => {
    let renderCount = 0;
    installCustomMarkdownCodeBlocks([
      {
        language: "diff",
        render: () => {
          renderCount++;
          return ["unexpected custom diff"];
        },
      },
    ]);
    const options: TransitionalMarkdownOptions = {
      transform: () => "The diff was removed.",
    };

    const lines = new Markdown(
      "```diff\n-old\n+new\n```",
      0,
      0,
      markdownTheme,
      undefined,
      options,
    ).render(80);

    expect(renderCount).toBe(0);
    expect(lines.some((line) => line.includes("The diff was removed."))).toBe(true);
  });

  test("renders transformed ordinary content around custom blocks", () => {
    installCustomMarkdownCodeBlocks([noticeRenderer]);
    const options: TransitionalMarkdownOptions = {
      transform: () => "Transformed intro\n\n```notice\nhello\n```\n\nTransformed outro",
    };

    const lines = new Markdown("original", 0, 0, markdownTheme, undefined, options).render(80);

    expect(lines.some((line) => line.includes("Transformed intro"))).toBe(true);
    expect(lines).toContain("custom: hello");
    expect(lines.some((line) => line.includes("Transformed outro"))).toBe(true);
  });

  test("preserves delegated options without rerunning transform", () => {
    installCustomMarkdownCodeBlocks([noticeRenderer]);
    let transformCount = 0;
    const options: TransitionalMarkdownOptions = {
      preserveBackslashEscapes: true,
      renderLatex: false,
      transform: (markdown) => {
        transformCount++;
        return markdown;
      },
    };

    const lines = new Markdown(
      "escaped\\! and $x^2$",
      0,
      0,
      markdownTheme,
      undefined,
      options,
    ).render(80);

    expect(transformCount).toBe(1);
    expect(lines.some((line) => line.includes("escaped\\! and $x^2$"))).toBe(true);
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

  test("replaces a stale wrapper while preserving state and refreshing the registry", () => {
    installCustomMarkdownCodeBlocks([noticeRenderer]);
    const staleRender = function staleRender(): string[] {
      return ["stale"];
    };
    Markdown.prototype.render = staleRender;

    installCustomMarkdownCodeBlocks([{ language: "other", render: ({ code }) => [`other: ${code}`] }]);

    expect(Markdown.prototype.render).not.toBe(staleRender);
    const lines = new Markdown("```other\nvalue\n```", 0, 0, markdownTheme).render(80);
    expect(lines).toContain("other: value");
  });
});
