import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import {
  dynamicWorkflowDisplayText,
  type DynamicWorkflowAgentStatus,
  type DynamicWorkflowRunSnapshot,
  type DynamicWorkflowStatus,
} from "../../lib/dynamic-workflow-events.ts";
import type { SidebarMetadata } from "./metadata.ts";

export const SIDEBAR_WIDTH = 50;

const CHROME_ROWS = 2;

type SidebarColor =
  | "muted"
  | "dim"
  | "accent"
  | "warning"
  | "success"
  | "error";

interface SidebarRow {
  text: string;
  color?: SidebarColor;
  heading?: boolean;
  optionalPriority?: number;
}

export function contextUsageColor(
  percent: number | null,
): "muted" | "accent" | "error" {
  if (percent === null || !Number.isFinite(percent) || percent <= 50) {
    return "muted";
  }
  return percent <= 80 ? "accent" : "error";
}

function formatContextPercent(percent: number | null): string {
  return percent === null || !Number.isFinite(percent)
    ? "?"
    : `${percent.toFixed(2)}%`;
}

function formatCost(cost: number): string {
  return `$${(Number.isFinite(cost) && cost >= 0 ? cost : 0).toFixed(3)}`;
}

function agentAppearance(status: DynamicWorkflowAgentStatus): {
  symbol: string;
  color: SidebarColor;
} {
  switch (status) {
    case "running":
      return { symbol: "●", color: "warning" };
    case "completed":
      return { symbol: "✓", color: "success" };
    case "failed":
      return { symbol: "✗", color: "error" };
    case "skipped":
      return { symbol: "–", color: "muted" };
    case "cancelled":
      return { symbol: "×", color: "muted" };
    case "queued":
      return { symbol: "○", color: "dim" };
  }
}

function workflowAppearance(status: DynamicWorkflowStatus): {
  symbol: string;
  color: SidebarColor;
} {
  switch (status) {
    case "running":
      return { symbol: "●", color: "warning" };
    case "completed":
      return { symbol: "✓", color: "success" };
    case "failed":
      return { symbol: "✗", color: "error" };
    case "cancelled":
      return { symbol: "×", color: "muted" };
    case "interrupted":
      return { symbol: "!", color: "warning" };
  }
}

function workflowRows(
  runs: readonly DynamicWorkflowRunSnapshot[],
): SidebarRow[] {
  if (runs.length === 0) return [{ text: "No workflow runs", color: "dim" }];

  const rows: SidebarRow[] = [];
  for (const run of runs) {
    const appearance = workflowAppearance(run.status);
    rows.push({
      text: `${appearance.symbol} ${run.status} ${dynamicWorkflowDisplayText(run.name)}`,
      color: appearance.color,
    });

    run.agents.forEach((agent) => {
      const agentStyle = agentAppearance(agent.status);
      rows.push({
        text: `  ${agentStyle.symbol} ${agent.status} ${dynamicWorkflowDisplayText(agent.id)}`,
        color: agentStyle.color,
        optionalPriority: 30,
      });
      if (typeof agent.cost === "number" && Number.isFinite(agent.cost)) {
        rows.push({
          text: `    ${formatCost(agent.cost)}`,
          color: "dim",
          optionalPriority: 20,
        });
      }
      if (agent.status === "running" && agent.activity) {
        rows.push({
          text: `    ↳ ${dynamicWorkflowDisplayText(agent.activity)}`,
          color: "dim",
          optionalPriority: 10,
        });
      }
    });

    const hidden = Math.max(0, run.agentCount - run.agents.length);
    if (hidden > 0) {
      rows.push({
        text: `  … ${hidden} more agents`,
        color: "dim",
        optionalPriority: 25,
      });
    }
  }
  return rows;
}

function expandedRows(metadata: SidebarMetadata): SidebarRow[] {
  const contextColor = contextUsageColor(metadata.contextPercent);
  const spacer = (): SidebarRow => ({ text: "", optionalPriority: 0 });
  const heading = (text: string): SidebarRow => ({ text, heading: true });

  return [
    heading("Directory"),
    { text: metadata.directory },
    { text: metadata.branchWorktree, optionalPriority: 60 },
    spacer(),
    heading("Session"),
    { text: metadata.sessionName },
    spacer(),
    heading("Context"),
    {
      text: `${metadata.contextTokens} / ${metadata.contextWindow}  ${formatContextPercent(metadata.contextPercent)}`,
      color: contextColor,
    },
    { text: `Total ${formatCost(metadata.cost)}` },
    { text: `Main ${formatCost(metadata.mainCost)}`, optionalPriority: 50 },
    {
      text: `Subagents ${formatCost(metadata.subagentCost)}`,
      optionalPriority: 50,
    },
    spacer(),
    heading("Model"),
    { text: metadata.modelName },
    { text: metadata.thinkingLevel, optionalPriority: 55 },
    spacer(),
    heading("Workflow"),
    ...workflowRows(metadata.workflowRuns),
  ];
}

function compactRows(
  metadata: SidebarMetadata,
  budget: number,
): SidebarRow[] {
  const rows: SidebarRow[] = [
    { text: `Directory  ${metadata.directory}`, heading: true },
    { text: `Session    ${metadata.sessionName}`, heading: true },
    {
      text: `Context    ${metadata.contextTokens}/${metadata.contextWindow} ${formatContextPercent(metadata.contextPercent)}`,
      color: contextUsageColor(metadata.contextPercent),
      heading: true,
    },
    { text: `Model      ${metadata.modelName}`, heading: true },
  ];
  const workflowBudget = Math.max(0, budget - rows.length);
  if (workflowBudget === 0) return rows.slice(0, budget);
  if (metadata.workflowRuns.length === 0) {
    rows.push({ text: "Workflow   No workflow runs", heading: true });
    return rows;
  }

  const needsOverflow = metadata.workflowRuns.length > workflowBudget;
  const visibleCount = Math.max(
    0,
    workflowBudget - (needsOverflow ? 1 : 0),
  );
  metadata.workflowRuns.slice(0, visibleCount).forEach((run, index) => {
    const appearance = workflowAppearance(run.status);
    const prefix = index === 0 ? "Workflow   " : "           ";
    rows.push({
      text: `${prefix}${appearance.symbol} ${run.status} ${dynamicWorkflowDisplayText(run.name)}`,
      color: appearance.color,
      heading: true,
    });
  });
  if (needsOverflow) {
    rows.push({
      text: `${visibleCount === 0 ? "Workflow   " : "           "}… ${metadata.workflowRuns.length - visibleCount} more workflows`,
      color: "dim",
      heading: true,
    });
  }
  return rows;
}

function fitRows(rows: readonly SidebarRow[], budget: number): SidebarRow[] {
  let fitted = [...rows];
  const optional = fitted
    .filter((row) => row.optionalPriority !== undefined)
    .sort((left, right) => left.optionalPriority! - right.optionalPriority!);
  for (const row of optional) {
    if (fitted.length <= budget) break;
    fitted = fitted.filter((candidate) => candidate !== row);
  }
  return fitted;
}

function renderSidebarLine(
  theme: Theme,
  width: number,
  text: string,
): string {
  const safeWidth = Math.max(1, Math.floor(width));
  const contentWidth = Math.max(0, safeWidth - 1);
  const clipped = truncateToWidth(text, contentWidth, "");
  const padded = `${clipped}${" ".repeat(
    Math.max(0, contentWidth - visibleWidth(clipped)),
  )}`;
  return `${theme.fg("borderMuted", "│")}${theme.bg("customMessageBg", padded)}`;
}

/** Read-only inspector sized to Pi's fullscreen transcript region. */
export class SidebarComponent implements Component {
  private cachedMetadata: SidebarMetadata | undefined;
  private cachedWidth: number | undefined;
  private cachedHeight: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(
    private readonly getMetadata: () => SidebarMetadata,
    private readonly getTheme: () => Theme,
    private readonly getHeight: () => number,
  ) {}

  invalidate(): void {
    this.cachedMetadata = undefined;
    this.cachedWidth = undefined;
    this.cachedHeight = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    const height = Math.max(1, Math.floor(this.getHeight()));
    if (
      this.cachedLines &&
      this.cachedWidth === width &&
      this.cachedHeight === height
    ) {
      return this.cachedLines;
    }

    const metadata = this.cachedMetadata ?? this.getMetadata();
    this.cachedMetadata = metadata;
    const theme = this.getTheme();
    const bodyBudget = Math.max(0, height - CHROME_ROWS);
    const expanded = fitRows(expandedRows(metadata), bodyBudget);
    const selected =
      expanded.length <= bodyBudget
        ? expanded
        : compactRows(metadata, bodyBudget);
    const body = selected.slice(0, bodyBudget);
    while (body.length < bodyBudget) body.push({ text: "" });

    const bodyLines = body.map((row) => {
      const text = truncateToWidth(row.text, Math.max(1, width - 1), "…");
      if (row.heading) return ` ${theme.fg("accent", theme.bold(text))}`;
      return ` ${theme.fg(row.color ?? "muted", text)}`;
    });

    this.cachedWidth = width;
    this.cachedHeight = height;
    this.cachedLines = [
      ` ${theme.fg("accent", theme.bold("Session Inspector"))}`,
      "",
      ...bodyLines,
    ]
      .slice(0, height)
      .map((line) => renderSidebarLine(theme, width, line));
    return this.cachedLines;
  }
}
