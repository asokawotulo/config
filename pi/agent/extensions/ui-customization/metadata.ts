import { homedir } from "node:os";
import { relative, resolve, sep } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { DynamicWorkflowRunSnapshot } from "../../lib/dynamic-workflow-events.ts";
import { sanitizeTerminalText } from "../../lib/text.ts";
import type { GitMetadata } from "./git-metadata.ts";
import { calculateSessionCosts } from "./session-cost.ts";

export {
  resolveGitMetadata,
  type GitMetadata,
} from "./git-metadata.ts";
export {
  calculateSessionCosts,
  type SessionCosts,
} from "./session-cost.ts";
export {
  DynamicWorkflowSidebarState,
  selectSidebarWorkflowRuns,
} from "./workflow-state.ts";
export { sanitizeTerminalText } from "../../lib/text.ts";

export interface SidebarMetadata {
  directory: string;
  branchWorktree: string;
  sessionName: string;
  workflowRuns: readonly DynamicWorkflowRunSnapshot[];
  contextTokens: string;
  contextWindow: string;
  contextPercent: number | null;
  latestCacheHitRate: number | null;
  /** Total session cost, including Dynamic Workflow subagents. */
  cost: number;
  mainCost: number;
  subagentCost: number;
  modelName: string;
  thinkingLevel: string;
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

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

/** Match Pi's footer semantics: the latest assistant prompt's cache hit rate. */
export function calculateLatestCacheHitRate(
  entries: readonly SessionEntry[],
): number | null {
  let hasCacheUsage = false;
  let latestRate: number | null = null;

  for (const entry of entries) {
    let usage: unknown;
    if (entry.type === "message") {
      if (
        entry.message.role === "assistant" ||
        entry.message.role === "toolResult"
      ) {
        usage = entry.message.usage;
      }
    } else if (entry.type === "compaction" || entry.type === "branch_summary") {
      usage = entry.usage;
    }
    if (!usage || typeof usage !== "object") continue;

    const values = usage as {
      input?: unknown;
      cacheRead?: unknown;
      cacheWrite?: unknown;
    };
    const input = tokenCount(values.input);
    const cacheRead = tokenCount(values.cacheRead);
    const cacheWrite = tokenCount(values.cacheWrite);
    if (cacheRead > 0 || cacheWrite > 0) hasCacheUsage = true;

    if (entry.type === "message" && entry.message.role === "assistant") {
      const promptTokens = input + cacheRead + cacheWrite;
      latestRate = promptTokens > 0 ? (cacheRead / promptTokens) * 100 : null;
    }
  }

  return hasCacheUsage ? latestRate : null;
}

export function buildSidebarMetadata(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  git: GitMetadata,
  workflowRuns: readonly DynamicWorkflowRunSnapshot[] = [],
  costWorkflowRuns: readonly DynamicWorkflowRunSnapshot[] = workflowRuns,
): SidebarMetadata {
  const usage = ctx.getContextUsage();
  const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
  const percent = usage?.percent;
  const entries = ctx.sessionManager.getEntries();
  const costs = calculateSessionCosts(entries, costWorkflowRuns);
  const latestCacheHitRate = calculateLatestCacheHitRate(entries);

  return {
    directory: formatDirectory(ctx.cwd),
    branchWorktree: git.branchWorktree || "not a git worktree",
    sessionName: sanitizeTerminalText(pi.getSessionName() ?? "unnamed"),
    workflowRuns,
    contextTokens: formatTokenCount(usage?.tokens),
    contextWindow: formatTokenCount(contextWindow),
    contextPercent:
      typeof percent === "number" && Number.isFinite(percent) ? percent : null,
    latestCacheHitRate,
    cost: costs.total,
    mainCost: costs.main,
    subagentCost: costs.subagents,
    modelName: sanitizeTerminalText(ctx.model?.name ?? ctx.model?.id ?? "no model"),
    thinkingLevel: sanitizeTerminalText(
      ctx.model?.reasoning ? (ctx.thinkingLevel ?? pi.getThinkingLevel()) : "off",
    ),
  };
}
