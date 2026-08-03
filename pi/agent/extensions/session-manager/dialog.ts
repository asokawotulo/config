import { resolve } from "node:path";
import type {
  ExtensionContext,
  SessionInfo,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";
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

class SessionManagerDialog implements Component {
  private readonly state: SessionManagerState;
  private timer?: ReturnType<typeof setTimeout>;
  private status?: { type: "warning" | "error"; text: string };
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly sessions: SessionInfo[],
    private readonly currentSessionPath: string | undefined,
    selectedIndex: number,
    private readonly done: (action: SessionManagerAction) => void,
  ) {
    this.state = new SessionManagerState(selectedIndex);
    this.state.clamp(sessions.length);
  }

  private refresh(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.tui.requestRender();
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
    if (matchesKey(data, Key.escape)) {
      this.clearTransientState();
      this.done({ kind: "close" });
      return;
    }

    if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
      this.clearTransientState();
      this.state.move(matchesKey(data, Key.up) ? -1 : 1, this.sessions.length);
      this.refresh();
      return;
    }

    const session = this.selected();
    if (!session) return;

    if (matchesKey(data, Key.enter)) {
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

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const safeWidth = Math.max(1, width);
    const lines: string[] = [];
    const border = this.theme.fg("accent", "─".repeat(safeWidth));
    lines.push(border);
    lines.push(
      truncateToWidth(
        ` ${this.theme.fg("accent", this.theme.bold("Session Manager"))}`,
        safeWidth,
        "",
      ),
    );
    lines.push("");

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

    lines.push("");
    if (this.status) {
      lines.push(
        truncateToWidth(
          ` ${this.theme.fg(this.status.type, this.status.text)}`,
          safeWidth,
          "…",
        ),
      );
    }
    lines.push(
      truncateToWidth(
        ` ${this.theme.fg("dim", "↑↓ navigate · enter resume · d d delete · r rename · esc close")}`,
        safeWidth,
        "…",
      ),
    );
    lines.push(border);

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
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
    (tui, theme, _keybindings, done) =>
      new SessionManagerDialog(
        tui,
        theme,
        sessions,
        currentSessionPath,
        selectedIndex,
        done,
      ),
    {
      overlay: true,
      overlayOptions: {
        width: OVERLAY_WIDTH,
        minWidth: 44,
        maxHeight: "85%",
        anchor: "center",
        margin: 1,
      },
    },
  );
}
