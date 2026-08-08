import type { Theme } from "@earendil-works/pi-coding-agent";
import type {
  DefaultTextStyle,
  Markdown,
  MarkdownOptions,
  MarkdownTheme,
} from "@earendil-works/pi-tui";

export type OriginalRender = (this: Markdown, width: number) => string[];

export type TransitionalMarkdownOptions = MarkdownOptions & {
  transform?: (markdown: string, availableWidth: number) => string;
  renderLatex?: boolean;
};

export type MarkdownInternals = {
  text: string;
  paddingX: number;
  paddingY: number;
  defaultTextStyle?: DefaultTextStyle;
  theme: MarkdownTheme;
  options: TransitionalMarkdownOptions;
  cachedText?: string;
  cachedWidth?: number;
  cachedLines?: string[];
};

export type ResolvedCodeBlockLanguage = {
  language: string;
  inheritedLanguage?: string;
};

export type MarkdownSection =
  | { type: "markdown"; text: string }
  | {
      type: "codeBlock";
      code: string;
      language: string;
      inheritedLanguage?: string;
      closed: boolean;
    };

export type CodeBlockRenderContext = {
  code: string;
  language: string;
  inheritedLanguage?: string;
  closed: boolean;
  highlightCode?: MarkdownTheme["highlightCode"];
  width: number;
  paddingX: number;
  theme?: Theme;
};

export type CustomCodeBlockRenderer = {
  language: string;
  render(context: CodeBlockRenderContext): string[] | undefined;
};

export type PatchState = {
  originalRender: OriginalRender;
  renderers: ReadonlyMap<string, CustomCodeBlockRenderer>;
  theme?: Theme;
};

export type ThemeSetter = (theme: Theme) => void;
