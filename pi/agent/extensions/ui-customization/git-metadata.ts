import { basename, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalText } from "../../lib/text.ts";

export interface GitMetadata {
  branchWorktree: string;
}

export async function resolveGitMetadata(
  pi: ExtensionAPI,
  cwd: string,
): Promise<GitMetadata> {
  const result = await pi.exec(
    "git",
    [
      "-C",
      cwd,
      "rev-parse",
      "--show-toplevel",
      "--git-dir",
      "--git-common-dir",
      "--abbrev-ref",
      "HEAD",
    ],
    { timeout: 3_000 },
  );
  if (result.code !== 0) return { branchWorktree: "" };

  const [topLevel, gitDir, commonGitDir, rawBranch] = result.stdout
    .trim()
    .split("\n");
  if (!topLevel || !gitDir || !commonGitDir || !rawBranch) {
    return { branchWorktree: "" };
  }

  const branch = rawBranch === "HEAD" ? "detached" : rawBranch;
  const absoluteGitDir = resolve(cwd, gitDir);
  const absoluteCommonGitDir = resolve(cwd, commonGitDir);
  const linkedWorktree = absoluteGitDir !== absoluteCommonGitDir;
  const worktree = linkedWorktree ? basename(topLevel) : "";

  return {
    branchWorktree: sanitizeTerminalText(
      worktree && worktree !== branch ? `${branch}/${worktree}` : branch,
    ),
  };
}
