import type { Editor, MarkdownTheme } from "@earendil-works/pi-tui";

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  id: string;
  label?: string;
  question: string;
  type: "single" | "multiple";
  options: QuestionOption[];
}

export interface AskUserInput {
  questions: Question[];
}

export interface AnswerState {
  selected: Set<number>;
  custom?: string;
}

export interface SubmittedAnswer {
  kind: "option" | "custom";
  label: string;
  optionIndex?: number;
}

export interface QuestionResult {
  id: string;
  question: string;
  type: Question["type"];
  answered: boolean;
  answers: SubmittedAnswer[];
}

export interface AskUserDetails {
  status: "submitted" | "declined" | "cancelled" | "no_ui";
  questions: QuestionResult[];
}

export type DialogResult =
  | { kind: "submitted"; answers: AnswerState[] }
  | { kind: "declined" }
  | { kind: "cancelled" };

export type QuestionnaireCommand =
  | "up"
  | "down"
  | "left"
  | "right"
  | "enter"
  | "space"
  | "escape";

export type QuestionnaireTransition =
  | "changed"
  | "open-editor"
  | "submitted"
  | "declined"
  | "ignored";

export interface CurrentQuestionState {
  question: Question;
  answer: AnswerState;
  cursor: number;
}

export interface RenderState {
  questions: Question[];
  answers: AnswerState[];
  cursors: number[];
  screen: number;
  editQuestionIndex?: number;
  editor: Editor;
  markdownTheme: MarkdownTheme;
  maxFrameRows?: number;
  detailScroll?: number;
}

export interface DetailViewport {
  top: number;
  maxTop: number;
  pageSize: number;
  overflow: boolean;
}

export interface QuestionnaireRenderView {
  lines: string[];
  masterDetail: boolean;
  detailViewport?: DetailViewport;
}

export interface QuestionTab {
  plain: string;
  active: boolean;
  answered: boolean;
  confirmation: boolean;
}
