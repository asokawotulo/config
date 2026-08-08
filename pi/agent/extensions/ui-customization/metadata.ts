import { homedir } from "node:os";
import { basename, relative, resolve, sep } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type {
  DynamicWorkflowRunEvent,
  DynamicWorkflowRunSnapshot,
  DynamicWorkflowStateEvent,
} from "../../lib/dynamic-workflow-events.ts";

export interface GitMetadata {
  branchWorktree: string;
}

export interface SidebarMetadata {
  directory: string;
  branchWorktree: string;
  sessionName: string;
  workflowRuns: readonly DynamicWorkflowRunSnapshot[];
  contextTokens: string;
  contextWindow: string;
  contextPercent: number | null;
  /** Total session cost, including Dynamic Workflow subagents. */
  cost: number;
  mainCost: number;
  subagentCost: number;
  modelName: string;
  thinkingLevel: string;
}

export interface SessionCosts {
  total: number;
  main: number;
  subagents: number;
}

export function selectSidebarWorkflowRuns(
  runs: Iterable<DynamicWorkflowRunSnapshot>,
  sessionId: string,
): DynamicWorkflowRunSnapshot[] {
  return Array.from(runs)
    .filter((run) => run.sessionId === sessionId)
    .sort((left, right) => right.startedAt - left.startedAt);
}

/** Session-scoped event state kept separate from persisted sidebar metadata. */
export class DynamicWorkflowSidebarState {
  private sessionId: string | undefined;
  private runs = new Map<string, DynamicWorkflowRunSnapshot>();

  beginSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.runs.clear();
  }

  endSession(): void {
    this.sessionId = undefined;
    this.runs.clear();
  }

  applyRun(data: unknown): boolean {
    const event = data as Partial<DynamicWorkflowRunEvent> | undefined;
    const run = event?.run as Partial<DynamicWorkflowRunSnapshot> | undefined;
    if (
      !this.sessionId ||
      event?.sessionId !== this.sessionId ||
      run?.sessionId !== this.sessionId ||
      typeof run.runId !== "string"
    ) {
      return false;
    }

    this.runs.set(run.runId, event.run as DynamicWorkflowRunSnapshot);
    return true;
  }

  applyState(data: unknown): boolean {
    const event = data as Partial<DynamicWorkflowStateEvent> | undefined;
    if (
      !this.sessionId ||
      event?.sessionId !== this.sessionId ||
      !Array.isArray(event.runs)
    ) {
      return false;
    }

    const next = new Map<string, DynamicWorkflowRunSnapshot>();
    for (const run of event.runs) {
      if (
        run?.sessionId === this.sessionId &&
        typeof run.runId === "string"
      ) {
        next.set(run.runId, run);
      }
    }
    this.runs = next;
    return true;
  }

  getVisibleRuns(): DynamicWorkflowRunSnapshot[] {
    return this.sessionId
      ? selectSidebarWorkflowRuns(this.runs.values(), this.sessionId)
      : [];
  }

  getRuns(): DynamicWorkflowRunSnapshot[] {
    return this.sessionId
      ? Array.from(this.runs.values()).filter((run) => run.sessionId === this.sessionId)
      : [];
  }
}

function finiteCost(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

function usageCost(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const cost = (value as { cost?: unknown }).cost;
  return finiteCost(
    typeof cost === "number"
      ? cost
      : cost && typeof cost === "object"
        ? (cost as { total?: unknown }).total
        : undefined,
  );
}

function workflowDetails(value: unknown): {
  runId?: string;
  agents?: unknown[];
} {
  if (!value || typeof value !== "object") return {};
  const details = value as { runId?: unknown; agents?: unknown };
  return {
    ...(typeof details.runId === "string" ? { runId: details.runId } : {}),
    ...(Array.isArray(details.agents) ? { agents: details.agents } : {}),
  };
}

function workflowDetailsCost(agents: readonly unknown[] | undefined): number {
  let total = 0;
  for (const value of agents ?? []) {
    if (!value || typeof value !== "object") continue;
    const agent = value as { cost?: unknown; usage?: unknown };
    total += finiteCost(agent.cost) ?? usageCost(agent.usage) ?? 0;
  }
  return total;
}

/**
 * Partition persisted parent/tool usage from transient workflow snapshots.
 * A persisted dynamic_workflow result supersedes its event snapshot, avoiding
 * the progress-to-tool-result race from charging the same agents twice.
 */
export function calculateSessionCosts(
  entries: readonly SessionEntry[],
  workflowRuns: readonly DynamicWorkflowRunSnapshot[] = [],
): SessionCosts {
  let main = 0;
  let subagents = 0;
  const persistedWorkflowIds = new Set<string>();
  const chargedWorkflowIds = new Set<string>();

  for (const entry of entries) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      main += usageCost(entry.message.usage) ?? 0;
      continue;
    }
    if (entry.type === "message" && entry.message.role === "toolResult") {
      const message = entry.message;
      if (message.toolName !== "dynamic_workflow") {
        main += usageCost(message.usage) ?? 0;
        continue;
      }

      const details = workflowDetails(message.details);
      if (details.runId) persistedWorkflowIds.add(details.runId);
      if (details.runId && chargedWorkflowIds.has(details.runId)) continue;
      if (details.runId) chargedWorkflowIds.add(details.runId);
      subagents += usageCost(message.usage) ?? workflowDetailsCost(details.agents);
      continue;
    }
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      main += usageCost(entry.usage) ?? 0;
    }
  }

  const chargedActiveIds = new Set<string>();
  for (const run of workflowRuns) {
    if (
      persistedWorkflowIds.has(run.runId) ||
      chargedActiveIds.has(run.runId)
    ) {
      continue;
    }
    chargedActiveIds.add(run.runId);
    for (const agent of run.agents) subagents += finiteCost(agent.cost) ?? 0;
  }

  return { total: main + subagents, main, subagents };
}

/** Backward-compatible total-only helper. */
export function calculateSessionCost(
  entries: readonly SessionEntry[],
  workflowRuns: readonly DynamicWorkflowRunSnapshot[] = [],
): number {
  return calculateSessionCosts(entries, workflowRuns).total;
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
  workflowRuns: readonly DynamicWorkflowRunSnapshot[] = [],
  costWorkflowRuns: readonly DynamicWorkflowRunSnapshot[] = workflowRuns,
): SidebarMetadata {
  const usage = ctx.getContextUsage();
  const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
  const percent = usage?.percent;
  const costs = calculateSessionCosts(
    ctx.sessionManager.getEntries(),
    costWorkflowRuns,
  );

  return {
    directory: formatDirectory(ctx.cwd),
    branchWorktree: git.branchWorktree || "not a git worktree",
    sessionName: sanitizeTerminalText(pi.getSessionName() ?? "unnamed"),
    workflowRuns,
    contextTokens: formatTokenCount(usage?.tokens),
    contextWindow: formatTokenCount(contextWindow),
    contextPercent:
      typeof percent === "number" && Number.isFinite(percent) ? percent : null,
    cost: costs.total,
    mainCost: costs.main,
    subagentCost: costs.subagents,
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
