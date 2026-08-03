import { resolve } from "node:path";
import {
  SessionManager,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { showSessionManager } from "./dialog.ts";
import { deleteSessionFile, renameSessionFile } from "./session-files.ts";

function isSamePath(left: string | undefined, right: string): boolean {
  return left !== undefined && resolve(left) === resolve(right);
}

export default function sessionManagerExtension(pi: ExtensionAPI) {
  pi.registerCommand("sessions", {
    description: "Manage sessions for the current directory",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/sessions requires interactive TUI mode", "warning");
        return;
      }

      await ctx.waitForIdle();

      let selectedIndex = 0;
      const currentSessionPath = ctx.sessionManager.getSessionFile();

      while (true) {
        let sessions;
        try {
          sessions = await SessionManager.list(
            ctx.cwd,
            ctx.sessionManager.getSessionDir(),
          );
        } catch (error) {
          ctx.ui.notify(
            `Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
          return;
        }

        selectedIndex = Math.min(
          selectedIndex,
          Math.max(0, sessions.length - 1),
        );
        const action = await showSessionManager(
          ctx,
          sessions,
          currentSessionPath,
          selectedIndex,
        );

        if (!action || action.kind === "close") return;
        selectedIndex = action.index;

        if (action.kind === "resume") {
          if (isSamePath(currentSessionPath, action.session.path)) return;
          await ctx.switchSession(action.session.path);
          return;
        }

        if (action.kind === "rename") {
          const name = await ctx.ui.input(
            "Rename session",
            action.session.name ?? "Enter a session name",
          );
          if (name === undefined) continue;

          const nextName = name.trim();
          if (!nextName) {
            ctx.ui.notify("Session name cannot be empty", "warning");
            continue;
          }

          try {
            if (isSamePath(currentSessionPath, action.session.path)) {
              pi.setSessionName(nextName);
            } else {
              renameSessionFile(action.session.path, nextName);
            }
            ctx.ui.notify(`Session renamed to "${nextName}"`, "info");
          } catch (error) {
            ctx.ui.notify(
              `Failed to rename session: ${error instanceof Error ? error.message : String(error)}`,
              "error",
            );
          }
          continue;
        }

        if (isSamePath(currentSessionPath, action.session.path)) {
          ctx.ui.notify("Cannot delete the currently active session", "error");
          continue;
        }

        try {
          const result = await deleteSessionFile(
            action.session.path,
            async (args) => {
              const execution = await pi.exec("trash", args);
              return { code: execution.code, stderr: execution.stderr };
            },
          );
          ctx.ui.notify(
            result.method === "trash"
              ? "Session moved to trash"
              : "Session permanently deleted",
            result.method === "trash" ? "info" : "warning",
          );
        } catch (error) {
          ctx.ui.notify(
            `Failed to delete session: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
        }
      }
    },
  });
}
