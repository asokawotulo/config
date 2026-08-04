import { resolve } from "node:path";
import type {
  ExtensionContext,
  KeybindingsManager,
  SessionInfo,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  centeredDialogOverlay,
  DialogComponent,
  keybindingHint,
  renderDialogFrame,
} from "../../shared/ui/index.ts";
import { DELETE_WINDOW_MS, SessionManagerState } from "./state.ts";
import type { SessionManagerAction } from "./types.ts";

const MAX_VISIBLE_SESSIONS = 10;
const MAX_TITLE_LENGTH = 100;
const MESSAGE_COLUMN_WIDTH = 10;
const MODIFIED_COLUMN_WIDTH = 16;
const OVERLAY_WIDTH =
  2 + MAX_TITLE_LENGTH + 2 + MESSAGE_COLUMN_WIDTH + 2 + MODIFIED_COLUMN_WIDTH;

function clean(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, " ").trim();
}

export function truncateSessionTitle(value: string): string {
  if (value.length <= MAX_TITLE_LENGTH) return value;
  return `${value.slice(0, MAX_TITLE_LENGTH - 3)}...`;
}

function formatModified(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function tableRow(
  title: string,
  messages: string,
  modified: string,
  width: number,
  selected = false,
): string {
  const prefix = selected ? "› " : "  ";
  const fixedWidth =
    visibleWidth(prefix) +
    2 +
    MESSAGE_COLUMN_WIDTH +
    2 +
    MODIFIED_COLUMN_WIDTH;
  const titleWidth = Math.max(1, width - fixedWidth);
  const titleCell = truncateToWidth(title, titleWidth, "…");
  return truncateToWidth(
    `${prefix}${titleCell}${" ".repeat(Math.max(0, titleWidth - visibleWidth(titleCell)))}  ${truncateToWidth(messages, MESSAGE_COLUMN_WIDTH, "").padStart(MESSAGE_COLUMN_WIDTH)}  ${truncateToWidth(modified, MODIFIED_COLUMN_WIDTH, "").padStart(MODIFIED_COLUMN_WIDTH)}`,
    width,
    "",
  );
}

function samePath(left: string | undefined, right: string): boolean {
  return left !== undefined && resolve(left) === resolve(right);
}

class SessionManagerDialog extends DialogComponent {
  private readonly state: SessionManagerState;
  private timer?: ReturnType<typeof setTimeout>;
  private status?: { type: "warning" | "error"; text: string };

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    private readonly sessions: SessionInfo[],
    private readonly currentSessionPath: string | undefined,
    selectedIndex: number,
    private readonly done: (action: SessionManagerAction) => void,
  ) {
    super(tui, theme, keybindings);
    this.state = new SessionManagerState(selectedIndex);
    this.state.clamp(sessions.length);
  }

  private clearTransientState(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.status = undefined;
    this.state.clearDelete();
  }

  private scheduleExpiry(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const changed = this.state.expireDelete(Date.now());
      if (changed) this.status = undefined;
      this.refresh();
    }, DELETE_WINDOW_MS + 1);
  }

  private selected(): SessionInfo | undefined {
    return this.sessions[this.state.selectedIndex];
  }

  handleInput(data: string): void {
    if (this.matchesBinding(data, "tui.select.cancel")) {
      this.clearTransientState();
      this.done({ kind: "close" });
      return;
    }

    if (
      this.matchesBinding(data, "tui.select.up") ||
      this.matchesBinding(data, "tui.select.down")
    ) {
      this.clearTransientState();
      this.state.move(
        this.matchesBinding(data, "tui.select.up") ? -1 : 1,
        this.sessions.length,
      );
      this.refresh();
      return;
    }

    const session = this.selected();
    if (!session) return;

    if (this.matchesBinding(data, "tui.select.confirm")) {
      this.clearTransientState();
      this.done({ kind: "resume", session, index: this.state.selectedIndex });
      return;
    }

    if (data === "r" || matchesKey(data, "r")) {
      this.clearTransientState();
      this.done({ kind: "rename", session, index: this.state.selectedIndex });
      return;
    }

    if (data === "d" || matchesKey(data, "d")) {
      if (samePath(this.currentSessionPath, session.path)) {
        this.clearTransientState();
        this.status = {
          type: "error",
          text: "Cannot delete the currently active session",
        };
        this.refresh();
        return;
      }

      const result = this.state.requestDelete(session.path, Date.now());
      if (result === "delete") {
        this.clearTransientState();
        this.done({ kind: "delete", session, index: this.state.selectedIndex });
        return;
      }

      this.status = {
        type: "warning",
        text: "Press d again within 2 seconds to delete",
      };
      this.scheduleExpiry();
      this.refresh();
    }
  }

  protected renderContent(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const lines: string[] = [];

    if (this.sessions.length === 0) {
      lines.push(
        truncateToWidth(
          ` ${this.theme.fg("muted", "No sessions in the current directory")}`,
          safeWidth,
          "…",
        ),
      );
    } else {
      lines.push(
        this.theme.fg(
          "dim",
          tableRow("Session", "Messages", "Modified", safeWidth),
        ),
      );

      const start = Math.max(
        0,
        Math.min(
          this.state.selectedIndex - Math.floor(MAX_VISIBLE_SESSIONS / 2),
          this.sessions.length - MAX_VISIBLE_SESSIONS,
        ),
      );
      const end = Math.min(start + MAX_VISIBLE_SESSIONS, this.sessions.length);

      for (let index = start; index < end; index++) {
        const session = this.sessions[index];
        if (!session) continue;
        const selected = index === this.state.selectedIndex;
        const current = samePath(this.currentSessionPath, session.path);
        const title = truncateSessionTitle(
          clean(session.name ?? session.firstMessage) || session.id,
        );
        const displayTitle = current ? `[current] ${title}` : title;
        let row = tableRow(
          displayTitle,
          String(session.messageCount),
          formatModified(session.modified),
          safeWidth,
          selected,
        );
        if (selected) row = this.theme.bg("selectedBg", this.theme.bold(row));
        else if (current) row = this.theme.fg("accent", row);
        else if (session.name) row = this.theme.fg("warning", row);
        lines.push(row);
      }

      if (this.sessions.length > MAX_VISIBLE_SESSIONS) {
        lines.push(
          this.theme.fg(
            "dim",
            truncateToWidth(
              ` ${this.state.selectedIndex + 1}/${this.sessions.length}`,
              safeWidth,
              "",
            ),
          ),
        );
      }
    }

    return renderDialogFrame(this.theme, safeWidth, {
      title: "Session Manager",
      body: lines,
      status: this.status,
      hints: [
        keybindingHint(this.keybindings, "tui.select.up", "previous", "↑"),
        keybindingHint(this.keybindings, "tui.select.down", "next", "↓"),
        keybindingHint(
          this.keybindings,
          "tui.select.confirm",
          "resume",
          "enter",
        ),
        "d d delete",
        "r rename",
        keybindingHint(
          this.keybindings,
          "tui.select.cancel",
          "close",
          "esc",
        ),
      ],
    });
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}

export function showSessionManager(
  ctx: ExtensionContext,
  sessions: SessionInfo[],
  currentSessionPath: string | undefined,
  selectedIndex: number,
): Promise<SessionManagerAction> {
  return ctx.ui.custom<SessionManagerAction>(
    (tui, theme, keybindings, done) =>
      new SessionManagerDialog(
        tui,
        theme,
        keybindings,
        sessions,
        currentSessionPath,
        selectedIndex,
        done,
      ),
    {
      overlay: true,
      overlayOptions: centeredDialogOverlay({
        width: OVERLAY_WIDTH,
        minWidth: 44,
        maxHeight: "85%",
      }),
    },
  );
}
