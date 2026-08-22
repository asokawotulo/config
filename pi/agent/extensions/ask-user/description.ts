import type { Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import { render, type Span } from "grok-mermaid";

type DescriptionSection =
  | { type: "markdown"; source: string }
  | { type: "mermaid"; code: string; source: string };

function splitDescription(markdown: string): DescriptionSection[] {
  const lines = markdown.split("\n");
  const sections: DescriptionSection[] = [];
  let markdownStart = 0;

  for (let index = 0; index < lines.length; index++) {
    const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(lines[index] ?? "");
    if (!opening) continue;

    const marker = opening[2] ?? "```";
    const rawInfoString = opening[3] ?? "";
    if (marker[0] === "`" && rawInfoString.includes("`")) continue;

    const closingPattern = new RegExp(
      `^ {0,3}${marker[0]}{${marker.length},}\\s*$`,
    );
    let closingIndex = lines.length;
    for (let candidate = index + 1; candidate < lines.length; candidate++) {
      if (closingPattern.test(lines[candidate] ?? "")) {
        closingIndex = candidate;
        break;
      }
    }

    const isMermaid = rawInfoString.trim().toLowerCase() === "mermaid";
    if (!isMermaid) {
      if (closingIndex >= lines.length) break;
      index = closingIndex;
      continue;
    }

    // ask_user receives complete tool input, so an unclosed fence is ordinary
    // Markdown source rather than a streaming diagram.
    if (closingIndex >= lines.length) break;

    if (index > markdownStart) {
      sections.push({
        type: "markdown",
        source: lines.slice(markdownStart, index).join("\n"),
      });
    }
    sections.push({
      type: "mermaid",
      code: lines.slice(index + 1, closingIndex).join("\n"),
      source: lines.slice(index, closingIndex + 1).join("\n"),
    });

    index = closingIndex;
    markdownStart = closingIndex + 1;
  }

  if (markdownStart < lines.length) {
    sections.push({
      type: "markdown",
      source: lines.slice(markdownStart).join("\n"),
    });
  }

  return sections;
}

function renderMarkdown(
  source: string,
  width: number,
  markdownTheme: MarkdownTheme,
): string[] {
  return new Markdown(source, 0, 0, markdownTheme).render(width);
}

function styleSpan(span: Span, theme: Theme): string {
  switch (span.cls) {
    case "border":
      return theme.fg("borderMuted", span.text);
    case "text":
      return theme.fg("text", span.text);
    case "edge":
      return theme.fg("accent", span.text);
    case "edgeLabel":
      return theme.fg("muted", span.text);
    case "title":
      return theme.fg("accent", theme.bold(span.text));
    case "none":
      return span.text;
  }
}

function renderMermaid(
  section: Extract<DescriptionSection, { type: "mermaid" }>,
  width: number,
  markdownTheme: MarkdownTheme,
  theme: Theme,
): string[] {
  try {
    const art = render(section.code);
    if (!art || art.warnings.length > 0 || art.width > width) {
      return renderMarkdown(section.source, width, markdownTheme);
    }
    return art.styled.map((row) =>
      row.map((span) => styleSpan(span, theme)).join("")
    );
  } catch {
    return renderMarkdown(section.source, width, markdownTheme);
  }
}

/** Render Markdown option details with local fenced Mermaid support. */
export function renderOptionDescription(
  markdown: string,
  width: number,
  markdownTheme: MarkdownTheme,
  theme: Theme,
): string[] {
  const safeWidth = Math.max(1, width);
  const sections = splitDescription(markdown);
  if (!sections.some((section) => section.type === "mermaid")) {
    return renderMarkdown(markdown, safeWidth, markdownTheme);
  }

  return sections.flatMap((section) =>
    section.type === "markdown"
      ? renderMarkdown(section.source, safeWidth, markdownTheme)
      : renderMermaid(section, safeWidth, markdownTheme, theme)
  );
}
