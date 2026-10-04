import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  HStack,
  ScrollView,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import type { FabricWorkerRow } from "./fabric-state.ts";
import type { SidebarMetadata } from "./metadata.ts";

export const SIDEBAR_WIDTH = 40;

const CHROME_ROWS = 2;
const OPTIONAL_PRIORITIES = [0, 10, 20, 25, 30, 50, 55, 60] as const;

type OptionalPriority = (typeof OPTIONAL_PRIORITIES)[number];
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
  optionalPriority?: OptionalPriority;
  /** Keep a worker name with its following cost row in compact layouts. */
  keepWithNext?: boolean;
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

function cacheHitRateRows(rate: number | null): SidebarRow[] {
  if (rate === null || !Number.isFinite(rate)) return [];
  return [
    {
      text: `Cache hit ${Math.max(0, Math.min(100, rate)).toFixed(1)}%`,
      optionalPriority: 50,
    },
  ];
}

export function activityAppearance(status: string): {
  symbol: string;
  color: SidebarColor;
} {
  switch (status) {
    case "running":
      return { symbol: "●", color: "warning" };
    case "completed":
      return { symbol: "✓", color: "success" };
    case "queued":
      return { symbol: "○", color: "dim" };
    case "failed":
    case "timed_out":
      return { symbol: "✗", color: "error" };
    case "stopped":
    case "cancelled":
      return { symbol: "×", color: "muted" };
    case "stale":
      return { symbol: "!", color: "warning" };
    default:
      return { symbol: "?", color: "dim" };
  }
}

/** Shared ordering for compact and expanded views, including orphan/cyclic data. */
export function orderedFabricWorkers(workers: readonly FabricWorkerRow[]) {
  const key = (worker: FabricWorkerRow) =>
    JSON.stringify([worker.runner, worker.id]);
  const byId = new Map(workers.map((worker) => [key(worker), worker]));
  const children = new Map<string, FabricWorkerRow[]>();
  for (const worker of workers) {
    if (!worker.parentId) continue;
    const parent = JSON.stringify([worker.runner, worker.parentId]);
    children.set(parent, [...(children.get(parent) ?? []), worker]);
  }
  const ordered: Array<{ worker: FabricWorkerRow; depth: number }> = [];
  const visited = new Set<string>();
  const visit = (worker: FabricWorkerRow, depth: number) => {
    const id = key(worker);
    if (visited.has(id)) return;
    visited.add(id);
    ordered.push({ worker, depth: Math.min(depth, 4) });
    for (const child of children.get(id) ?? []) visit(child, depth + 1);
  };
  for (const worker of workers) {
    if (
      !worker.parentId ||
      !byId.has(JSON.stringify([worker.runner, worker.parentId]))
    )
      visit(worker, 0);
  }
  for (const worker of workers) visit(worker, 0);
  return ordered;
}

function fabricWorkerRows(
  worker: FabricWorkerRow,
  depth: number,
  compact: boolean,
): SidebarRow[] {
  const status =
    worker.stale && ["running", "queued"].includes(worker.status)
      ? "stale"
      : worker.status;
  const { symbol, color } = activityAppearance(status);
  const prefix = "  ".repeat(depth);
  const rows: SidebarRow[] = [
    {
      text: `${prefix}${symbol} ${worker.name}`,
      color,
      keepWithNext: true,
    },
    {
      text: `${prefix}  Cost ${worker.usage ? formatCost(worker.usage.cost) : "$?"}`,
    },
  ];
  if (compact) return rows;
  const end =
    worker.finishedAt ??
    (!worker.stale && ["running", "queued"].includes(worker.status)
      ? Date.now()
      : worker.updatedAt);
  const elapsed =
    worker.startedAt === undefined
      ? ""
      : ` · ${Math.max(0, Math.floor((end - worker.startedAt) / 1000))}s`;
  rows.push({
    text: `${prefix}  ${status}${elapsed}${worker.currentTool ? ` · ${worker.currentTool}` : ""}`,
    optionalPriority: 30,
  });
  if (worker.model)
    rows.push({
      text: `${prefix}  ${worker.model}${worker.thinking ? ` · ${worker.thinking}` : ""}`,
      optionalPriority: 10,
    });
  // TODO: Display worker context usage and latest-prompt cache hit rate when
  // Fabric exposes reliable metrics. Cumulative run usage is not occupancy.
  rows.push({
    text: `${prefix}  ${worker.toolCalls ?? 0} calls · ${worker.turns ?? 0} turns`,
    optionalPriority: 10,
  });
  if (worker.actorId)
    rows.push({
      text: `${prefix}  Actor ${worker.actorName ?? worker.actorId}`,
      optionalPriority: 20,
    });
  return rows;
}

function fabricRows(metadata: SidebarMetadata, compact = false): SidebarRow[] {
  const fabric = metadata.fabric;
  if (!fabric) return [{ text: "Fabric data unavailable", color: "dim" }];
  const rows: SidebarRow[] = [];
  const execution =
    fabric.executions.find((run) => run.status === "running") ??
    fabric.executions[0];
  if (!compact && execution) {
    rows.push({ text: execution.name });
    if (execution.phase)
      rows.push({
        text: `${execution.status} · ${execution.phase}`,
        color: activityAppearance(execution.status).color,
        optionalPriority: 25,
      });
  }
  if (fabric.connection !== "live")
    rows.push({
      text:
        fabric.connection === "connecting"
          ? "Connecting to Fabric…"
          : "Live data unavailable",
      color: "dim",
      optionalPriority: 10,
    });
  if (!compact && !fabric.complete)
    rows.push({
      text: "Cost coverage incomplete",
      color: "warning",
      optionalPriority: 25,
    });
  for (const { worker, depth } of orderedFabricWorkers(fabric.workers).slice(
    0,
    8,
  )) {
    rows.push(...fabricWorkerRows(worker, depth, compact));
  }
  if (fabric.workers.length > 8)
    rows.push({
      text: `… ${fabric.workers.length - 8} more workers`,
      color: "dim",
    });
  if (fabric.workers.length === 0)
    rows.push({ text: "No worker runs", color: "dim" });
  if (!compact)
    rows.push({
      text: "/fabric for details and controls",
      color: "dim",
      optionalPriority: 10,
    });
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
    ...cacheHitRateRows(metadata.latestCacheHitRate),
    {
      text: `${metadata.costComplete === false ? "Reported" : "Total"} ${formatCost(metadata.cost)}`,
    },
    ...(metadata.mainCost !== null && metadata.subagentCost !== null
      ? [
          {
            text: `Main ${formatCost(metadata.mainCost)}`,
            optionalPriority: 50 as const,
          },
          {
            text: `Subagents ${formatCost(metadata.subagentCost)}`,
            optionalPriority: 50 as const,
          },
        ]
      : []),
    spacer(),
    heading("Model"),
    { text: metadata.modelName },
    { text: metadata.thinkingLevel, optionalPriority: 55 },
    spacer(),
    heading("Fabric"),
    ...fabricRows(metadata),
  ];
}

function compactRows(metadata: SidebarMetadata, budget: number): SidebarRow[] {
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
  const available = Math.max(0, budget - rows.length);
  if (available > 0)
    rows.push({
      text: `Fabric · ${metadata.fabric?.workers.length ?? 0} workers · ${formatCost(metadata.subagentCost ?? 0)}`,
      heading: true,
    });
  const candidates = fabricRows(metadata, true);
  const capacity = Math.max(0, available - 1);
  if (candidates.length <= capacity) {
    rows.push(...candidates);
  } else if (capacity > 0) {
    const shown = candidates.slice(0, capacity - 1);
    if (shown.at(-1)?.keepWithNext) shown.pop();
    rows.push(...shown, { text: "… more in /fabric", color: "dim" });
  }
  return rows.slice(0, budget);
}

function fitRows(rows: readonly SidebarRow[], budget: number): SidebarRow[] {
  let remaining = Math.max(0, rows.length - Math.max(0, budget));
  if (remaining === 0) return [...rows];

  const buckets = new Map<OptionalPriority, SidebarRow[]>(
    OPTIONAL_PRIORITIES.map((priority) => [priority, []]),
  );
  for (const row of rows) {
    if (row.optionalPriority !== undefined) {
      buckets.get(row.optionalPriority)!.push(row);
    }
  }

  const removed = new Set<SidebarRow>();
  for (const priority of OPTIONAL_PRIORITIES) {
    for (const row of buckets.get(priority)!) {
      if (remaining === 0) break;
      removed.add(row);
      remaining -= 1;
    }
    if (remaining === 0) break;
  }
  return rows.filter((row) => !removed.has(row));
}

function renderSidebarContentLine(
  theme: Theme,
  width: number,
  text: string,
): string {
  const safeWidth = Math.max(1, Math.floor(width));
  const clipped = truncateToWidth(text, safeWidth, "");
  const padded = `${clipped}${" ".repeat(
    Math.max(0, safeWidth - visibleWidth(clipped)),
  )}`;
  return theme.bg("customMessageBg", padded);
}

class SidebarSeparatorComponent implements Component {
  constructor(
    private readonly getTheme: () => Theme,
    private readonly getHeight: () => number,
    private readonly isActive: () => boolean,
  ) {}

  invalidate(): void {}

  render(_width: number): string[] {
    if (!this.isActive()) return [" "];
    const line = this.getTheme().fg("borderMuted", "│");
    return Array.from(
      { length: Math.max(1, Math.floor(this.getHeight())) },
      () => line,
    );
  }
}

class SidebarContentComponent implements Component {
  private cachedMetadata: SidebarMetadata | undefined;
  private cachedWidth: number | undefined;
  private cachedHeight: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(
    private readonly getMetadata: () => SidebarMetadata,
    private readonly getTheme: () => Theme,
    private readonly getHeight: () => number,
    private readonly isActive: () => boolean,
  ) {}

  invalidate(): void {
    this.cachedMetadata = undefined;
    this.cachedWidth = undefined;
    this.cachedHeight = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (!this.isActive()) return [" ".repeat(Math.max(1, Math.floor(width)))];
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
      .map((line) => renderSidebarContentLine(theme, width, line));
    return this.cachedLines;
  }
}

/** Read-only inspector whose content owns a border-free selection region. */
export class SidebarComponent extends HStack {
  private readonly separator: SidebarSeparatorComponent;
  private readonly contentViewport: ScrollView;
  private readonly lifecycle: { active: boolean };
  private cachedWidth: number | undefined;
  private cachedHeight: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(
    getMetadata: () => SidebarMetadata,
    getTheme: () => Theme,
    private readonly getHeight: () => number,
  ) {
    const lifecycle = { active: true };
    const isActive = () => lifecycle.active;
    const separator = new SidebarSeparatorComponent(
      getTheme,
      getHeight,
      isActive,
    );
    const content = new SidebarContentComponent(
      getMetadata,
      getTheme,
      getHeight,
      isActive,
    );
    const contentViewport = new ScrollView(content, {
      primary: false,
      overscroll: "chain",
    });
    super([
      {
        component: separator,
        basis: 1,
        grow: 0,
        shrink: 0,
        minSize: 1,
        maxSize: 1,
      },
      {
        component: contentViewport,
        basis: 0,
        grow: 1,
        shrink: 1,
        minSize: 1,
      },
    ]);
    this.separator = separator;
    this.contentViewport = contentViewport;
    this.lifecycle = lifecycle;
  }

  deactivate(): void {
    if (!this.lifecycle.active) return;
    this.lifecycle.active = false;
    this.invalidate();
  }

  override invalidate(): void {
    super.invalidate();
    this.cachedWidth = undefined;
    this.cachedHeight = undefined;
    this.cachedLines = undefined;
  }

  /** Preserve normal component rendering for measurement and focused tests. */
  override render(width: number): string[] {
    const safeWidth = Math.max(1, Math.floor(width));
    if (!this.lifecycle.active) return [" ".repeat(safeWidth)];
    const height = Math.max(1, Math.floor(this.getHeight()));
    if (
      this.cachedLines &&
      this.cachedWidth === safeWidth &&
      this.cachedHeight === height
    ) {
      return this.cachedLines;
    }

    const separatorLines = this.separator.render(1);
    const contentLines =
      safeWidth === 1 ? [] : this.contentViewport.render(safeWidth - 1);
    this.cachedWidth = safeWidth;
    this.cachedHeight = height;
    this.cachedLines = separatorLines.map(
      (separator, index) => `${separator}${contentLines[index] ?? ""}`,
    );
    return this.cachedLines;
  }
}
