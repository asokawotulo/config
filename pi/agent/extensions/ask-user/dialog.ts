import {
  getMarkdownTheme,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
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
import { renderQuestionnaireView } from "./render.ts";
import { DialogSettler, QuestionnaireState } from "./state.ts";
import type {
  AnswerState,
  DetailViewport,
  DialogResult,
  Question,
  QuestionnaireCommand,
} from "./types.ts";

class QuestionnaireDialog extends DialogComponent implements Focusable {
  focused = false;

  private readonly editor: Editor;
  private readonly state: QuestionnaireState;
  private readonly settler: DialogSettler;
  private readonly maxFrameRows: number;
  private detailScroll = 0;
  private detailViewport?: DetailViewport;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    questions: Question[],
    signal: AbortSignal | undefined,
    done: (result: DialogResult) => void,
    initialAnswers: AnswerState[] = [],
  ) {
    super(tui, theme, keybindings);
    this.state = new QuestionnaireState(questions, initialAnswers);
    this.settler = new DialogSettler(signal, done);
    const terminalRows = Math.max(1, tui.terminal?.rows ?? 24);
    this.maxFrameRows = Math.max(
      1,
      Math.min(Math.floor(terminalRows * 0.9), Math.max(1, terminalRows - 2)),
    );

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
        this.detailScroll = 0;
        this.closeEditor();
        this.refresh();
        return;
      }
      this.editor.handleInput(data);
      this.refresh();
      return;
    }

    if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.pageDown)) {
      const viewport = this.detailViewport;
      if (!viewport) return;
      const delta = matchesKey(data, Key.pageUp)
        ? -viewport.pageSize
        : viewport.pageSize;
      this.detailScroll = Math.max(
        0,
        Math.min(viewport.maxTop, viewport.top + delta),
      );
      this.refresh();
      return;
    }

    const command = this.commandFor(data);
    if (!command) return;
    const previousScreen = this.state.screen;
    const previousCursor = this.state.cursors[previousScreen];
    const transition = this.state.handle(command);
    if (
      previousScreen !== this.state.screen ||
      previousCursor !== this.state.cursors[this.state.screen]
    ) {
      this.detailScroll = 0;
    }
    if (transition === "submitted") {
      this.settler.finish({ kind: "submitted", answers: this.state.answers });
      return;
    }
    if (transition === "declined") {
      this.settler.finish({ kind: "declined" });
      return;
    }
    if (transition === "open-editor") {
      this.detailScroll = 0;
      this.openEditor();
      return;
    }
    if (transition === "changed") this.refresh();
  }

  protected renderContent(width: number) {
    const rendered = renderQuestionnaireView(
      {
        questions: this.state.questions,
        answers: this.state.answers,
        cursors: this.state.cursors,
        screen: this.state.screen,
        editQuestionIndex: this.state.editQuestionIndex,
        editor: this.editor,
        markdownTheme: getMarkdownTheme(),
        maxFrameRows: this.maxFrameRows,
        detailScroll: this.detailScroll,
      },
      this.theme,
      width,
      this.keybindings,
    );
    this.detailViewport = rendered.detailViewport;
    return rendered.lines;
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
  initialAnswers: AnswerState[] = [],
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
        initialAnswers,
      ),
    {
      notification: {
        title: "Pi needs your input",
        body: questions.length === 1
          ? questions[0]?.question
          : `${questions.length} questions require your input`,
      },
      overlayOptions: centeredDialogOverlay({
        width: "90%",
        minWidth: 40,
        maxHeight: "90%",
      }),
    },
  );
}
