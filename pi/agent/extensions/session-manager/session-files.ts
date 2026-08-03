import { access, unlink } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { DeleteSessionResult, RunTrash } from "./types.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function deleteSessionFile(
  sessionPath: string,
  runTrash: RunTrash,
): Promise<DeleteSessionResult> {
  const args = sessionPath.startsWith("-")
    ? ["--", sessionPath]
    : [sessionPath];

  let trashError: string | undefined;
  try {
    const result = await runTrash(args);
    if (result.code === 0 || !(await exists(sessionPath))) {
      return { method: "trash" };
    }
    trashError = result.stderr?.trim().split("\n")[0];
  } catch (error) {
    trashError = error instanceof Error ? error.message : String(error);
  }

  try {
    await unlink(sessionPath);
    return { method: "unlink" };
  } catch (error) {
    const unlinkError = error instanceof Error ? error.message : String(error);
    throw new Error(
      trashError
        ? `${unlinkError} (trash: ${trashError.slice(0, 200)})`
        : unlinkError,
    );
  }
}

export function renameSessionFile(sessionPath: string, name: string): void {
  const nextName = name.trim();
  if (!nextName) throw new Error("Session name cannot be empty");
  SessionManager.open(sessionPath).appendSessionInfo(nextName);
}
