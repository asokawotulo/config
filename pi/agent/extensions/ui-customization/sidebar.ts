import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  dynamicWorkflowDisplayText,
  type DynamicWorkflowAgentStatus,
  type DynamicWorkflowRunSnapshot,
  type DynamicWorkflowStatus,
} from "../../lib/dynamic-workflow-events.ts";
import type { SidebarRenderer } from "./layout.ts";
import type { SidebarMetadata } from "./metadata.ts";

type SidebarColor = "muted" | "dim" | "warning" | "success" | "error";

interface WorkflowRow {
  text: string;
  color: SidebarColor;
  activity?: WorkflowRow;
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

function workflowRows(runs: readonly DynamicWorkflowRunSnapshot[]): WorkflowRow[] {
  const rows: WorkflowRow[] = [];
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
      rows.push({
        text: `  ${appearance.symbol} ${agent.status} ${id}${role ? ` · ${role}` : ""}`,
        color: appearance.color,
        ...(agent.status === "running" && activity
          ? { activity: { text: `    ↳ ${activity}`, color: "dim" as const } }
          : {}),
      });
    }

    const undisplayed = Math.max(0, run.agentCount - run.agents.length);
    if (undisplayed) {
      rows.push({ text: `  … ${undisplayed} more agents`, color: "dim" });
    }
  }
  return rows;
}

export class SidebarComponent implements SidebarRenderer {
  constructor(
    private readonly getMetadata: () => SidebarMetadata,
    private readonly getTheme: () => Theme,
  ) {}

  render(width: number, height: number): string[] {
    const metadata = this.getMetadata();
    const theme = this.getTheme();
    const contentWidth = Math.max(1, width - 3);
    const rows: string[] = [];

    const empty = () => rows.push("");
    const heading = (text: string) =>
      rows.push(theme.bold(theme.fg("accent", text)));
    const coloredValue = (text: string, color: SidebarColor = "muted") =>
      rows.push(theme.fg(color, truncateToWidth(text, contentWidth, "…")));
    const value = (text: string) => coloredValue(text);

    empty();
    heading("Directory");
    value(metadata.directory);
    value(metadata.branchWorktree);
    empty();
    heading("Session");
    value(metadata.sessionName);

    if (metadata.workflowRuns.length) {
      empty();
      heading("Workflow");

      const essential = workflowRows(metadata.workflowRuns);
      // Reserve the trailing Context and Model sections before spending spare
      // rows on optional activity details.
      const trailingMetadataRows = 9;
      const availableRows = Math.max(0, height - rows.length - trailingMetadataRows);
      let activityRows = Math.max(0, availableRows - essential.length);
      for (const row of essential) {
        coloredValue(row.text, row.color);
        if (row.activity && activityRows > 0) {
          coloredValue(row.activity.text, row.activity.color);
          activityRows -= 1;
        }
      }
    }

    empty();
    heading("Context");
    value(`${metadata.contextTokens}/${metadata.contextWindow}`);
    value(metadata.contextPercent);
    value(`$${metadata.cost.toFixed(3)}`);
    empty();
    heading("Model");
    value(metadata.modelName);
    value(metadata.thinkingLevel);

    const visibleRows = rows.slice(0, height);
    while (visibleRows.length < height) visibleRows.push("");

    return visibleRows.map((content) => {
      const clipped = truncateToWidth(content, contentWidth, "");
      const padded = ` ${clipped}${" ".repeat(
        Math.max(0, contentWidth - visibleWidth(clipped)),
      )} `;
      return (
        theme.fg("borderMuted", "│") +
        theme.bg("customMessageBg", truncateToWidth(padded, width - 1, ""))
      );
    });
  }
}
