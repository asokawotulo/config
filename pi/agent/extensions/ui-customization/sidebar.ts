import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  dynamicWorkflowDisplayText,
  type DynamicWorkflowAgentStatus,
  type DynamicWorkflowAgentTarget,
  type DynamicWorkflowRunSnapshot,
  type DynamicWorkflowStatus,
} from "../../lib/dynamic-workflow-events.ts";
import type { SidebarRenderer } from "./layout.ts";
import type { SidebarMetadata } from "./metadata.ts";

type SidebarColor =
  | "muted"
  | "dim"
  | "accent"
  | "warning"
  | "success"
  | "error";

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

interface SidebarRow {
  text: string;
  color?: SidebarColor;
  heading?: boolean;
  spacer?: boolean;
  /** Lower values are removed first when even compact section spacing will not fit. */
  collapsePriority?: number;
  target?: DynamicWorkflowAgentTarget;
  optionalAfter?: Array<SidebarRow & { optionalKind: "cost" | "activity" }>;
}

function agentAppearance(
  status: DynamicWorkflowAgentStatus,
): { symbol: string; color: SidebarColor } {
  switch (status) {
    case "running": return { symbol: "●", color: "warning" };
    case "completed": return { symbol: "✓", color: "success" };
    case "failed": return { symbol: "✗", color: "error" };
    case "skipped": return { symbol: "–", color: "muted" };
    case "cancelled": return { symbol: "×", color: "muted" };
    case "queued": return { symbol: "○", color: "dim" };
  }
}

function workflowAppearance(
  status: DynamicWorkflowStatus,
): { symbol: string; color: SidebarColor } {
  switch (status) {
    case "running": return { symbol: "●", color: "warning" };
    case "completed": return { symbol: "✓", color: "success" };
    case "failed": return { symbol: "✗", color: "error" };
    case "cancelled": return { symbol: "×", color: "muted" };
    case "interrupted": return { symbol: "!", color: "warning" };
  }
}

function workflowRows(runs: readonly DynamicWorkflowRunSnapshot[]): SidebarRow[] {
  const rows: SidebarRow[] = [];
  for (const run of runs) {
    const runAppearance = workflowAppearance(run.status);
    rows.push({
      text: `${runAppearance.symbol} ${run.status} ${dynamicWorkflowDisplayText(run.name)}`,
      color: runAppearance.color,
    });

    for (const agent of run.agents) {
      const appearance = agentAppearance(agent.status);
      const id = dynamicWorkflowDisplayText(agent.id);
      const role = dynamicWorkflowDisplayText(agent.role);
      const activity = dynamicWorkflowDisplayText(agent.activity);
      const optionalAfter: NonNullable<SidebarRow["optionalAfter"]> = [];
      if (typeof agent.cost === "number" && Number.isFinite(agent.cost) && agent.cost >= 0) {
        optionalAfter.push({
          text: `    ${formatCost(agent.cost)}`,
          color: "dim",
          optionalKind: "cost",
        });
      }
      if (agent.status === "running" && activity) {
        optionalAfter.push({
          text: `    ↳ ${activity}`,
          color: "dim",
          optionalKind: "activity",
        });
      }
      rows.push({
        text: `  ${appearance.symbol} ${agent.status} ${id}${role ? ` · ${role}` : ""}`,
        color: appearance.color,
        target: { sessionId: run.sessionId, runId: run.runId, agentId: agent.id },
        ...(optionalAfter.length ? { optionalAfter } : {}),
      });
    }

    const undisplayed = Math.max(0, run.agentCount - run.agents.length);
    if (undisplayed) {
      rows.push({ text: `  … ${undisplayed} more agents`, color: "dim" });
    }
  }
  return rows;
}

function fitRows(rows: readonly SidebarRow[], height: number): SidebarRow[] {
  let essential = [...rows];
  if (essential.length > height) {
    essential = essential.filter((row) => !row.spacer);
  }
  if (essential.length > height) {
    const collapsible = essential
      .filter((row) => row.collapsePriority !== undefined)
      .sort((left, right) => left.collapsePriority! - right.collapsePriority!);
    for (const row of collapsible) {
      if (essential.length <= height) break;
      essential = essential.filter((candidate) => candidate !== row);
    }
  }

  let optionalBudget = Math.max(0, height - essential.length);
  const selected = new Set<SidebarRow>();
  for (const kind of ["cost", "activity"] as const) {
    for (const row of essential) {
      for (const optional of row.optionalAfter ?? []) {
        if (optionalBudget === 0) break;
        if (optional.optionalKind !== kind) continue;
        selected.add(optional);
        optionalBudget -= 1;
      }
    }
  }

  const fitted: SidebarRow[] = [];
  for (const row of essential) {
    fitted.push(row);
    for (const optional of row.optionalAfter ?? []) {
      if (selected.has(optional)) fitted.push(optional);
    }
  }
  return fitted.slice(0, height);
}

export class SidebarComponent implements SidebarRenderer {
  private readonly hitTargets = new Map<number, DynamicWorkflowAgentTarget>();
  private cachedMetadata: SidebarMetadata | undefined;
  private cachedWidth: number | undefined;
  private cachedHeight: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(
    private readonly getMetadata: () => SidebarMetadata,
    private readonly getTheme: () => Theme,
  ) {}

  hitTestAgent(row: number): DynamicWorkflowAgentTarget | undefined {
    return this.hitTargets.get(row);
  }

  invalidate(): void {
    this.cachedMetadata = undefined;
    this.cachedWidth = undefined;
    this.cachedHeight = undefined;
    this.cachedLines = undefined;
    this.hitTargets.clear();
  }

  render(width: number, height: number): string[] {
    if (
      this.cachedLines &&
      (this.cachedWidth !== width || this.cachedHeight !== height)
    ) {
      this.invalidate();
    }
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
    const contentWidth = Math.max(1, width - 3);
    const contextColor = contextUsageColor(metadata.contextPercent);
    const spacer = (): SidebarRow => ({ text: "", spacer: true });
    const heading = (text: string): SidebarRow => ({ text, heading: true });

    const rows: SidebarRow[] = [
      spacer(),
      heading("Directory"),
      { text: metadata.directory, collapsePriority: 3 },
      { text: metadata.branchWorktree, collapsePriority: 1 },
      spacer(),
      heading("Session"),
      { text: metadata.sessionName, collapsePriority: 2 },
      spacer(),
      heading("Context"),
      {
        text: `${metadata.contextTokens}/${metadata.contextWindow}`,
        color: contextColor,
      },
      { text: formatContextPercent(metadata.contextPercent), color: contextColor },
      { text: `Total ${formatCost(metadata.cost)}` },
      { text: `Main ${formatCost(metadata.mainCost)}` },
      { text: `Subagents ${formatCost(metadata.subagentCost)}` },
      spacer(),
      heading("Model"),
      { text: metadata.modelName },
      { text: metadata.thinkingLevel },
    ];

    if (metadata.workflowRuns.length) {
      rows.push(spacer(), heading("Workflow"), ...workflowRows(metadata.workflowRuns));
    }

    const visibleRows = fitRows(rows, height);
    this.hitTargets.clear();
    visibleRows.forEach((row, index) => {
      if (row.target) this.hitTargets.set(index, row.target);
    });
    while (visibleRows.length < height) visibleRows.push({ text: "" });

    const lines = visibleRows.map((row) => {
      const styled = row.heading
        ? theme.bold(theme.fg("accent", row.text))
        : theme.fg(row.color ?? "muted", truncateToWidth(row.text, contentWidth, "…"));
      const clipped = truncateToWidth(styled, contentWidth, "");
      const padded = ` ${clipped}${" ".repeat(
        Math.max(0, contentWidth - visibleWidth(clipped)),
      )} `;
      return (
        theme.fg("borderMuted", "│") +
        theme.bg("customMessageBg", truncateToWidth(padded, width - 1, ""))
      );
    });
    this.cachedWidth = width;
    this.cachedHeight = height;
    this.cachedLines = lines;
    return lines;
  }
}
