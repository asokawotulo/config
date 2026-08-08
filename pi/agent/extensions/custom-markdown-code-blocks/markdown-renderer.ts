import type { Theme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import type {
  CustomCodeBlockRenderer,
  MarkdownInternals,
  MarkdownSection,
  OriginalRender,
  PatchState,
  ResolvedCodeBlockLanguage,
  ThemeSetter,
} from "./types.ts";

const PATCH_STATE = Symbol.for("asoka.pi.custom-markdown-code-blocks");

function createRendererMap(
  renderers: readonly CustomCodeBlockRenderer[],
): ReadonlyMap<string, CustomCodeBlockRenderer> {
  const byLanguage = new Map<string, CustomCodeBlockRenderer>();
  for (const renderer of renderers) {
    const language = renderer.language.toLowerCase();
    if (byLanguage.has(language)) {
      throw new Error(`Duplicate custom Markdown code block renderer: ${language}`);
    }
    byLanguage.set(language, renderer);
  }
  return byLanguage;
}

export function resolveCodeBlockLanguage(
  infoString: string,
  registeredLanguages: ReadonlySet<string>,
): ResolvedCodeBlockLanguage | undefined {
  const normalized = infoString.toLowerCase();
  if (registeredLanguages.has(normalized)) return { language: normalized };

  const parts = normalized.split(":");
  if (parts.length !== 2) return undefined;
  const [language, inheritedLanguage] = parts;
  if (!language || !inheritedLanguage || !registeredLanguages.has(language)) return undefined;
  return { language, inheritedLanguage };
}

export function splitMarkdownCodeBlockSections(
  text: string,
  registeredLanguages: ReadonlySet<string>,
): MarkdownSection[] {
  const lines = text.split("\n");
  const sections: MarkdownSection[] = [];
  let markdownStart = 0;

  for (let index = 0; index < lines.length; index++) {
    const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(lines[index] ?? "");
    if (!opening) continue;

    const marker = opening[2] ?? "```";
    const rawInfoString = opening[3] ?? "";
    // Backticks are forbidden in the info string of a backtick fence.
    if (marker[0] === "`" && rawInfoString.includes("`")) continue;

    const closingPattern = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`);
    let closingIndex = lines.length;
    for (let candidate = index + 1; candidate < lines.length; candidate++) {
      if (closingPattern.test(lines[candidate] ?? "")) {
        closingIndex = candidate;
        break;
      }
    }

    const resolvedLanguage = resolveCodeBlockLanguage(
      rawInfoString.trim(),
      registeredLanguages,
    );
    if (!resolvedLanguage) {
      // Everything through the matching close belongs literally to this
      // ordinary fence, so custom-looking fences inside it are not top-level.
      if (closingIndex >= lines.length) break;
      index = closingIndex;
      continue;
    }

    const { language, inheritedLanguage } = resolvedLanguage;

    if (index > markdownStart) {
      sections.push({ type: "markdown", text: lines.slice(markdownStart, index).join("\n") });
    }

    sections.push({
      type: "codeBlock",
      code: lines.slice(index + 1, closingIndex).join("\n"),
      language,
      ...(inheritedLanguage ? { inheritedLanguage } : {}),
      closed: closingIndex < lines.length,
    });

    if (closingIndex >= lines.length) {
      markdownStart = lines.length;
      break;
    }

    index = closingIndex;
    markdownStart = closingIndex + 1;
  }

  if (markdownStart < lines.length) {
    sections.push({ type: "markdown", text: lines.slice(markdownStart).join("\n") });
  }

  return sections;
}

function withoutTransform(
  options: MarkdownInternals["options"],
): MarkdownInternals["options"] {
  const { transform: _transform, ...delegatedOptions } = options;
  return delegatedOptions;
}

function renderOriginalMarkdown(
  state: PatchState,
  source: MarkdownInternals,
  text: string,
  width: number,
  paddingY: number,
  options: MarkdownInternals["options"],
): string[] {
  if (!text.trim()) return [];
  const component = new Markdown(
    text,
    source.paddingX,
    paddingY,
    source.theme,
    source.defaultTextStyle,
    options,
  );
  return state.originalRender.call(component, width);
}

function renderOriginalSection(
  state: PatchState,
  source: MarkdownInternals,
  text: string,
  width: number,
  options: MarkdownInternals["options"],
): string[] {
  return renderOriginalMarkdown(state, source, text, width, 0, options);
}

function renderOriginalCodeBlock(
  state: PatchState,
  source: MarkdownInternals,
  code: string,
  language: string,
  width: number,
  options: MarkdownInternals["options"],
): string[] {
  return renderOriginalSection(
    state,
    source,
    `\`\`\`${language}\n${code}\n\`\`\``,
    width,
    options,
  );
}

function patchedMarkdownRender(this: Markdown, width: number): string[] {
  const source = this as unknown as MarkdownInternals;
  const currentState = (Markdown.prototype as Markdown & { [PATCH_STATE]?: PatchState })[
    PATCH_STATE
  ];
  if (!currentState) throw new Error("Custom Markdown code block patch state is unavailable");

  if (
    source.cachedLines &&
    source.cachedText === source.text &&
    source.cachedWidth === width
  ) {
    return source.cachedLines;
  }

  const cache = (lines: string[]): string[] => {
    source.cachedText = source.text;
    source.cachedWidth = width;
    source.cachedLines = lines;
    return lines;
  };

  const contentWidth = Math.max(1, width - source.paddingX * 2);
  const transform = source.options.transform;
  const transformedText = transform?.(source.text, contentWidth) ?? source.text;
  const delegatedOptions = withoutTransform(source.options);
  const sections = splitMarkdownCodeBlockSections(
    transformedText,
    new Set(currentState.renderers.keys()),
  );
  if (!sections.some((section) => section.type === "codeBlock")) {
    if (!transform) return currentState.originalRender.call(this, width);
    return cache(
      renderOriginalMarkdown(
        currentState,
        source,
        transformedText,
        width,
        source.paddingY,
        delegatedOptions,
      ),
    );
  }

  const rendered: string[] = [];
  const emptyLine = " ".repeat(width);
  for (let index = 0; index < source.paddingY; index++) rendered.push(emptyLine);

  for (const section of sections) {
    if (section.type === "markdown") {
      rendered.push(
        ...renderOriginalSection(
          currentState,
          source,
          section.text,
          width,
          delegatedOptions,
        ),
      );
      continue;
    }

    const renderer = currentState.renderers.get(section.language);
    const customLines = renderer?.render({
      code: section.code,
      language: section.language,
      inheritedLanguage: section.inheritedLanguage,
      closed: section.closed,
      highlightCode: source.theme.highlightCode,
      width,
      paddingX: source.paddingX,
      theme: currentState.theme,
    });
    rendered.push(
      ...(customLines ??
        renderOriginalCodeBlock(
          currentState,
          source,
          section.code,
          section.language,
          width,
          delegatedOptions,
        )),
    );
  }

  for (let index = 0; index < source.paddingY; index++) rendered.push(emptyLine);
  return cache(rendered.length > 0 ? rendered : [""]);
}

export function installCustomMarkdownCodeBlocks(
  renderers: readonly CustomCodeBlockRenderer[],
): ThemeSetter {
  const rendererMap = createRendererMap(renderers);
  const prototype = Markdown.prototype as Markdown & { [PATCH_STATE]?: PatchState };
  let state = prototype[PATCH_STATE];

  if (!state) {
    state = {
      originalRender: Markdown.prototype.render as OriginalRender,
      renderers: rendererMap,
    };
    prototype[PATCH_STATE] = state;
  } else {
    state.renderers = rendererMap;
  }

  // Reassign the wrapper on every install so /reload picks up framework code
  // changes without wrapping the previous implementation.
  Markdown.prototype.render = patchedMarkdownRender;

  return (theme: Theme) => {
    state!.theme = theme;
  };
}
