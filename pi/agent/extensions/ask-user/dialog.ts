import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  type Focusable,
  Key,
  matchesKey,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  centeredDialogOverlay,
  DialogComponent,
  showDialog,
} from "../../shared/ui/index.ts";
import { renderQuestionnaire } from "./render.ts";
import { DialogSettler, QuestionnaireState } from "./state.ts";
import type { DialogResult, Question, QuestionnaireCommand } from "./types.ts";

class QuestionnaireDialog extends DialogComponent implements Focusable {
  focused = false;

  private readonly editor: Editor;
  private readonly state: QuestionnaireState;
  private readonly settler: DialogSettler;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    questions: Question[],
    signal: AbortSignal | undefined,
    done: (result: DialogResult) => void,
  ) {
    super(tui, theme, keybindings);
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
    if (this.matchesBinding(data, "tui.select.up")) return "up";
    if (this.matchesBinding(data, "tui.select.down")) return "down";
    if (matchesKey(data, Key.left)) return "left";
    if (matchesKey(data, Key.right)) return "right";
    if (this.matchesBinding(data, "tui.select.confirm")) return "enter";
    if (matchesKey(data, Key.space)) return "space";
    if (this.matchesBinding(data, "tui.select.cancel")) return "escape";
    return undefined;
  }

  handleInput(data: string) {
    if (this.state.editQuestionIndex !== undefined) {
      if (this.matchesBinding(data, "tui.select.cancel")) {
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

  protected renderContent(width: number) {
    return renderQuestionnaire(
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
      this.keybindings,
    );
  }

  override invalidate() {
    super.invalidate();
    this.editor.invalidate();
  }

  dispose() {
    this.settler.dispose();
  }
}

export function showQuestionnaire(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  questions: Question[],
  signal?: AbortSignal,
) {
  return showDialog<DialogResult>(
    pi,
    ctx,
    (tui, theme, keybindings, done) =>
      new QuestionnaireDialog(
        tui,
        theme,
        keybindings,
        questions,
        signal,
        done,
      ),
    {
      notification: {
        title: "Pi needs your input",
        body: questions.length === 1
          ? questions[0]?.question
          : `${questions.length} questions require your input`,
      },
      overlayOptions: centeredDialogOverlay({
        width: "75%",
        minWidth: 40,
        maxHeight: "90%",
      }),
    },
  );
}
