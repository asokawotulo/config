import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Editor,
  type EditorTheme,
  type Focusable,
  Key,
  matchesKey,
  type TUI,
} from "@earendil-works/pi-tui";
import { renderQuestionnaire } from "./render.ts";
import { DialogSettler, QuestionnaireState } from "./state.ts";
import type { DialogResult, Question, QuestionnaireCommand } from "./types.ts";

class QuestionnaireDialog implements Component, Focusable {
  focused = false;

  private cachedWidth?: number;
  private cachedLines?: string[];
  private readonly editor: Editor;
  private readonly state: QuestionnaireState;
  private readonly settler: DialogSettler;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    questions: Question[],
    signal: AbortSignal | undefined,
    done: (result: DialogResult) => void,
  ) {
    this.state = new QuestionnaireState(questions);
    this.settler = new DialogSettler(signal, done);

    const editorTheme: EditorTheme = {
      borderColor: (text) => theme.fg("accent", text),
      selectList: {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      },
    };
    this.editor = new Editor(tui, editorTheme, { paddingX: 0 });
    this.editor.onSubmit = (value) => {
      if (this.state.submitCustomAnswer(value) === "ignored") return;
      this.closeEditor();
      this.refresh();
    };
  }

  private refresh() {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.tui.requestRender();
  }

  private openEditor() {
    this.editor.setText(this.state.customDraft ?? "");
    this.editor.focused = this.focused;
    this.refresh();
  }

  private closeEditor() {
    this.editor.focused = false;
    this.editor.setText("");
  }

  private commandFor(data: string): QuestionnaireCommand | undefined {
    if (matchesKey(data, Key.up)) return "up";
    if (matchesKey(data, Key.down)) return "down";
    if (matchesKey(data, Key.left)) return "left";
    if (matchesKey(data, Key.right)) return "right";
    if (matchesKey(data, Key.enter)) return "enter";
    if (matchesKey(data, Key.space)) return "space";
    if (matchesKey(data, Key.escape)) return "escape";
    return undefined;
  }

  handleInput(data: string) {
    if (this.state.editQuestionIndex !== undefined) {
      if (matchesKey(data, Key.escape)) {
        this.state.handle("escape");
        this.closeEditor();
        this.refresh();
        return;
      }
      this.editor.handleInput(data);
      this.refresh();
      return;
    }

    const command = this.commandFor(data);
    if (!command) return;
    const transition = this.state.handle(command);
    if (transition === "submitted") {
      this.settler.finish({ kind: "submitted", answers: this.state.answers });
      return;
    }
    if (transition === "declined") {
      this.settler.finish({ kind: "declined" });
      return;
    }
    if (transition === "open-editor") {
      this.openEditor();
      return;
    }
    if (transition === "changed") this.refresh();
  }

  render(width: number) {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    this.cachedLines = renderQuestionnaire(
      {
        questions: this.state.questions,
        answers: this.state.answers,
        cursors: this.state.cursors,
        screen: this.state.screen,
        editQuestionIndex: this.state.editQuestionIndex,
        editor: this.editor,
      },
      this.theme,
      width,
    );
    this.cachedWidth = width;
    return this.cachedLines;
  }

  invalidate() {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.editor.invalidate();
  }

  dispose() {
    this.settler.dispose();
  }
}

export function showQuestionnaire(
  ctx: ExtensionContext,
  questions: Question[],
  signal?: AbortSignal,
) {
  return ctx.ui.custom<DialogResult>(
    (tui, theme, _keybindings, done) =>
      new QuestionnaireDialog(tui, theme, questions, signal, done),
    {
      overlay: true,
      overlayOptions: {
        width: "75%",
        minWidth: 40,
        maxHeight: "90%",
        anchor: "center",
        margin: 1,
      },
    },
  );
}
