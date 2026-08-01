import { createEmptyAnswer } from "./results.ts";
import type {
  AnswerState,
  CurrentQuestionState,
  DialogResult,
  Question,
  QuestionnaireCommand,
  QuestionnaireTransition,
} from "./types.ts";

export class QuestionnaireState {
  readonly answers: AnswerState[];
  readonly cursors: number[];
  screen = 0;
  editQuestionIndex?: number;

  constructor(readonly questions: Question[]) {
    this.answers = questions.map(createEmptyAnswer);
    this.cursors = questions.map(() => 0);
  }

  get isConfirmation() {
    return this.screen === this.questions.length;
  }

  get customDraft() {
    if (this.editQuestionIndex === undefined) return undefined;
    return this.answers[this.editQuestionIndex]?.custom ?? "";
  }

  current(): CurrentQuestionState | undefined {
    if (this.isConfirmation) return undefined;
    const question = this.questions[this.screen];
    const answer = this.answers[this.screen];
    const cursor = this.cursors[this.screen];
    if (!question || !answer || cursor === undefined) return undefined;
    return { question, answer, cursor };
  }

  submitCustomAnswer(value: string): QuestionnaireTransition {
    const questionIndex = this.editQuestionIndex;
    if (questionIndex === undefined) return "ignored";

    const trimmed = value.trim();
    if (!trimmed) return "ignored";

    const question = this.questions[questionIndex];
    const answer = this.answers[questionIndex];
    if (!question || !answer) return "ignored";

    if (question.type === "single") answer.selected.clear();
    answer.custom = trimmed;
    this.editQuestionIndex = undefined;
    if (question.type === "single") this.navigate(1);
    return "changed";
  }

  handle(command: QuestionnaireCommand): QuestionnaireTransition {
    if (this.editQuestionIndex !== undefined) {
      if (command !== "escape") return "ignored";
      this.editQuestionIndex = undefined;
      return "changed";
    }

    if (command === "escape") return "declined";
    if (command === "left") {
      this.navigate(-1);
      return "changed";
    }
    if (command === "right") {
      this.navigate(1);
      return "changed";
    }

    if (this.isConfirmation) {
      return command === "enter" ? "submitted" : "ignored";
    }

    const current = this.current();
    if (!current) return "ignored";
    const { question, answer, cursor } = current;
    const optionCount = question.options.length + 1;

    if (command === "up") {
      this.cursors[this.screen] = (cursor - 1 + optionCount) % optionCount;
      return "changed";
    }
    if (command === "down") {
      this.cursors[this.screen] = (cursor + 1) % optionCount;
      return "changed";
    }

    const isCustom = cursor === question.options.length;
    if (question.type === "single" && command === "enter") {
      if (isCustom) return this.openCustomEditor();
      answer.selected.clear();
      answer.selected.add(cursor);
      delete answer.custom;
      this.navigate(1);
      return "changed";
    }

    if (question.type !== "multiple") return "ignored";
    if (isCustom && command === "enter") return this.openCustomEditor();
    if (command !== "space") return "ignored";

    if (isCustom) {
      if (answer.custom) {
        delete answer.custom;
        return "changed";
      }
      return this.openCustomEditor();
    }

    if (answer.selected.has(cursor)) answer.selected.delete(cursor);
    else answer.selected.add(cursor);
    return "changed";
  }

  private openCustomEditor(): QuestionnaireTransition {
    this.editQuestionIndex = this.screen;
    return "open-editor";
  }

  private navigate(delta: number) {
    this.screen = Math.max(
      0,
      Math.min(this.questions.length, this.screen + delta),
    );
  }
}

export class DialogSettler {
  private settled = false;

  constructor(
    private readonly signal: AbortSignal | undefined,
    private readonly done: (result: DialogResult) => void,
  ) {
    signal?.addEventListener("abort", this.abort, { once: true });
    if (signal?.aborted) queueMicrotask(this.abort);
  }

  finish(result: DialogResult) {
    if (this.settled) return;
    this.settled = true;
    this.signal?.removeEventListener("abort", this.abort);
    this.done(result);
  }

  dispose() {
    this.signal?.removeEventListener("abort", this.abort);
  }

  private abort = () => this.finish({ kind: "cancelled" });
}
