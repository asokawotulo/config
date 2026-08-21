import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, wrapTextWithAnsi, type TUI } from "@earendil-works/pi-tui";
import {
  centeredDialogOverlay,
  dialogContentWidth,
  DialogComponent,
  renderDialogFrame,
  showDialog,
} from "../../shared/ui/index.ts";
import { formatGuardrailDecision } from "./audit.ts";
import type { GuardrailDecisionChain } from "./types.ts";

export class GuardrailDecisionViewer extends DialogComponent {
  private scroll = 0;
  private readonly maxBodyRows: number;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    private readonly content: string,
    private readonly close: () => void,
  ) {
    super(tui, theme, keybindings);
    const terminalRows = tui.terminal?.rows ?? 24;
    this.maxBodyRows = Math.max(4, Math.floor(terminalRows * 0.75) - 8);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
      this.close();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.scroll = Math.max(0, this.scroll - 1);
      this.refresh();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.scroll++;
      this.refresh();
    }
  }

  protected renderContent(width: number): string[] {
    const contentWidth = dialogContentWidth(width);
    const body = this.content.split("\n").flatMap((line) => wrapTextWithAnsi(line || " ", contentWidth));
    const capacity = Math.max(1, this.maxBodyRows);
    const maxTop = Math.max(0, body.length - capacity);
    const top = Math.min(maxTop, this.scroll);
    this.scroll = top;
    const visible = body.slice(top, top + capacity);
    if (top > 0 && visible.length) visible[0] = this.theme.fg("dim", "↑ more details");
    if (top + capacity < body.length && visible.length) visible[visible.length - 1] = this.theme.fg("dim", "↓ more details");
    return renderDialogFrame(this.theme, width, {
      title: "Guardrails decision",
      body: visible,
      hints: ["↑/↓ scroll", "Enter/Esc close"],
    });
  }
}

export async function showGuardrailDecision(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  decision: GuardrailDecisionChain,
): Promise<void> {
  const content = formatGuardrailDecision(decision);
  if (ctx.mode !== "tui") {
    ctx.ui.notify(content, "info");
    return;
  }
  await showDialog<void>(
    pi,
    ctx,
    (tui, theme, keybindings, done) => new GuardrailDecisionViewer(tui, theme, keybindings, content, () => done(undefined)),
    {
      notification: { title: "Pi needs your input", body: "Inspect Guardrails decision" },
      overlayOptions: centeredDialogOverlay({ width: "85%", minWidth: 50, maxHeight: "75%" }),
    },
  );
}
