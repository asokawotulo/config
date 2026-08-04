import { homedir } from "node:os";
import { basename, relative, resolve, sep } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

export interface GitMetadata {
  branchWorktree: string;
}

export interface SidebarMetadata {
  directory: string;
  branchWorktree: string;
  sessionName: string;
  contextTokens: string;
  contextWindow: string;
  contextPercent: string;
  cost: number;
  modelName: string;
  thinkingLevel: string;
}

export function calculateSessionCost(entries: readonly SessionEntry[]): number {
  let cost = 0;

  for (const entry of entries) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      cost += entry.message.usage.cost.total;
    } else if (
      entry.type === "message" &&
      entry.message.role === "toolResult" &&
      entry.message.usage
    ) {
      cost += entry.message.usage.cost.total;
    } else if (
      (entry.type === "compaction" || entry.type === "branch_summary") &&
      entry.usage
    ) {
      cost += entry.usage.cost.total;
    }
  }

  return cost;
}

export function formatTokenCount(count: number | null | undefined): string {
  if (count === null || count === undefined || !Number.isFinite(count)) return "?";
  if (count < 1_000) return Math.max(0, Math.round(count)).toString();
  if (count < 1_000_000) return `${Math.round(count / 1_000)}K`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatDirectory(cwd: string, home = homedir()): string {
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const pathFromHome = relative(resolvedHome, resolvedCwd);
  const insideHome =
    pathFromHome === "" ||
    (pathFromHome !== ".." && !pathFromHome.startsWith(`..${sep}`));
  return sanitizeTerminalText(
    insideHome ? (pathFromHome ? `~${sep}${pathFromHome}` : "~") : cwd,
  );
}

export function buildSidebarMetadata(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  git: GitMetadata,
): SidebarMetadata {
  const usage = ctx.getContextUsage();
  const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
  const percent = usage?.percent;

  return {
    directory: formatDirectory(ctx.cwd),
    branchWorktree: git.branchWorktree || "not a git worktree",
    sessionName: sanitizeTerminalText(pi.getSessionName() ?? "unnamed"),
    contextTokens: formatTokenCount(usage?.tokens),
    contextWindow: formatTokenCount(contextWindow),
    contextPercent:
      percent === null || percent === undefined ? "?" : `${percent.toFixed(2)}%`,
    cost: calculateSessionCost(ctx.sessionManager.getEntries()),
    modelName: sanitizeTerminalText(ctx.model?.name ?? ctx.model?.id ?? "no model"),
    thinkingLevel: sanitizeTerminalText(
      ctx.model?.reasoning ? (ctx.thinkingLevel ?? pi.getThinkingLevel()) : "off",
    ),
  };
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

export function sanitizeTerminalText(text: string): string {
  return text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
