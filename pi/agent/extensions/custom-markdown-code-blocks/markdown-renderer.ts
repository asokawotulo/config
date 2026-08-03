import type { Theme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import type {
  CustomCodeBlockRenderer,
  MarkdownInternals,
  MarkdownSection,
  OriginalRender,
  PatchState,
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

export function splitMarkdownCodeBlockSections(
  text: string,
  registeredLanguages: ReadonlySet<string>,
): MarkdownSection[] {
  const lines = text.split("\n");
  const sections: MarkdownSection[] = [];
  let markdownStart = 0;

  for (let index = 0; index < lines.length; index++) {
    const opening = /^( {0,3})(`{3,}|~{3,})\s*([^\s`]*)\s*$/.exec(lines[index] ?? "");
    const language = (opening?.[3] ?? "").toLowerCase();
    if (!opening || !registeredLanguages.has(language)) continue;

    if (index > markdownStart) {
      sections.push({ type: "markdown", text: lines.slice(markdownStart, index).join("\n") });
    }

    const marker = opening[2] ?? "```";
    const closingPattern = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`);
    let closingIndex = lines.length;
    for (let candidate = index + 1; candidate < lines.length; candidate++) {
      if (closingPattern.test(lines[candidate] ?? "")) {
        closingIndex = candidate;
        break;
      }
    }

    sections.push({
      type: "codeBlock",
      code: lines.slice(index + 1, closingIndex).join("\n"),
      language,
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

function renderOriginalSection(
  state: PatchState,
  source: MarkdownInternals,
  text: string,
  width: number,
): string[] {
  if (!text.trim()) return [];
  const component = new Markdown(
    text,
    source.paddingX,
    0,
    source.theme,
    source.defaultTextStyle,
    source.options,
  );
  return state.originalRender.call(component, width);
}

function renderOriginalCodeBlock(
  state: PatchState,
  source: MarkdownInternals,
  code: string,
  language: string,
  width: number,
): string[] {
  return renderOriginalSection(state, source, `\`\`\`${language}\n${code}\n\`\`\``, width);
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

    Markdown.prototype.render = function patchedMarkdownRender(width: number): string[] {
      const source = this as unknown as MarkdownInternals;
      const currentState = (Markdown.prototype as Markdown & { [PATCH_STATE]?: PatchState })[PATCH_STATE];
      if (!currentState) return state!.originalRender.call(this, width);

      const sections = splitMarkdownCodeBlockSections(
        source.text,
        new Set(currentState.renderers.keys()),
      );
      if (!sections.some((section) => section.type === "codeBlock")) {
        return currentState.originalRender.call(this, width);
      }

      const rendered: string[] = [];
      const emptyLine = " ".repeat(width);
      for (let index = 0; index < source.paddingY; index++) rendered.push(emptyLine);

      for (const section of sections) {
        if (section.type === "markdown") {
          rendered.push(...renderOriginalSection(currentState, source, section.text, width));
          continue;
        }

        const renderer = currentState.renderers.get(section.language);
        const customLines = renderer?.render({
          code: section.code,
          language: section.language,
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
            )),
        );
      }

      for (let index = 0; index < source.paddingY; index++) rendered.push(emptyLine);
      return rendered.length > 0 ? rendered : [""];
    };
  } else {
    state.renderers = rendererMap;
  }

  return (theme: Theme) => {
    state!.theme = theme;
  };
}
