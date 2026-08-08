import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import type { ResolvedWorkflow, RoleDefinition, WorkflowDefinition } from "../types.ts";
import { MAX_CONTEXT_BYTES_PER_AGENT, MAX_CONTEXT_FILES_PER_AGENT, parseWorkflow } from "../workflow.ts";
import { renderWorkflowGraph } from "./graph.ts";
import { dialogColumnWidths, DialogComponent, layoutDialogColumns } from "./render.ts";
import { serializeWorkflow } from "./serialize.ts";

type Mode = "confirm" | "suggest" | "raw";

export const WORKFLOW_DIALOG_MAX_HEIGHT = "75%" as const;
const WORKFLOW_DIALOG_HEIGHT_RATIO = 0.75;

export type WorkflowReviewResult =
  | { action: "run"; plan: ResolvedWorkflow }
  | { action: "suggest"; suggestion: string }
  | { action: "cancel" };

export interface WorkflowDialogOptions {
  tui: TUI;
  theme: Theme;
  source: string;
  roles: ReadonlyMap<string, RoleDefinition>;
  resolveSource: (source: string) => ResolvedWorkflow;
  onDone: (result: WorkflowReviewResult | undefined) => void;
}

function editorTheme(theme: Theme): EditorTheme {
  return {
    borderColor: (text) => theme.fg("accent", text),
    selectList: {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    },
  };
}

function compact(value: string, empty = "none"): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text || empty;
}

interface AgentTableField {
  label: string;
  value: string;
  accent?: boolean;
}

function renderAgentTable(theme: Theme, width: number, fields: AgentTableField[]): string[] {
  const safeWidth = Math.max(1, width);
  if (safeWidth < 24) {
    return fields.flatMap((field) =>
      wrapTextWithAnsi(`${theme.fg("muted", field.label)}  ${field.value}`, safeWidth),
    );
  }

  const keyCellWidth = Math.min(17, Math.max(15, Math.floor(safeWidth * 0.22)));
  const valueCellWidth = safeWidth - keyCellWidth - 3;
  const keyContentWidth = keyCellWidth - 2;
  const valueContentWidth = valueCellWidth - 2;
  const border = (left: string, middle: string, right: string) => theme.fg(
    "borderMuted",
    `${left}${"─".repeat(keyCellWidth)}${middle}${"─".repeat(valueCellWidth)}${right}`,
  );
  const cell = (text: string, cellWidth: number, color: "muted" | "text" | "accent", bold = false) => {
    const contentWidth = cellWidth - 2;
    const clipped = truncateToWidth(text, contentWidth, "");
    const styled = theme.fg(color, bold ? theme.bold(clipped) : clipped);
    return ` ${styled}${" ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)))} `;
  };
  const lines = [border("┌", "┬", "┐")];
  fields.forEach((field, fieldIndex) => {
    const paragraphs = field.value.split(/\r?\n/);
    const valueLines = paragraphs.flatMap((paragraph) =>
      wrapTextWithAnsi(paragraph || " ", Math.max(1, valueContentWidth)),
    );
    const height = Math.max(1, valueLines.length);
    for (let lineIndex = 0; lineIndex < height; lineIndex++) {
      const key = lineIndex === 0 ? field.label : "";
      const value = valueLines[lineIndex] ?? "";
      lines.push(
        theme.fg("borderMuted", "│") +
        cell(key, keyCellWidth, "muted") +
        theme.fg("borderMuted", "│") +
        cell(value, valueCellWidth, field.accent ? "accent" : "text", field.accent) +
        theme.fg("borderMuted", "│"),
      );
    }
    if (fieldIndex < fields.length - 1) lines.push(border("├", "┼", "┤"));
  });
  lines.push(border("└", "┴", "┘"));
  return lines;
}

/** Read-only workflow confirmation with model-mediated free-text revision. */
export class WorkflowDialogComponent extends DialogComponent<WorkflowReviewResult> {
  private mode: Mode = "raw";
  private definition?: WorkflowDefinition;
  private canonicalSource?: string;
  private plan?: ResolvedWorkflow;
  private parseError?: string;
  private resolutionError?: string;
  private scroll = 0;
  private readonly editor: Editor;
  private readonly roles: ReadonlyMap<string, RoleDefinition>;
  private readonly resolveSource: (source: string) => ResolvedWorkflow;
  private readonly maxContentRows: number;

  constructor(options: WorkflowDialogOptions) {
    super(options.theme, options.onDone, () => options.tui.requestRender());
    this.roles = options.roles;
    this.resolveSource = options.resolveSource;
    const terminalRows = options.tui.terminal?.rows ?? 24;
    this.maxContentRows = Math.max(6, Math.floor(terminalRows * WORKFLOW_DIALOG_HEIGHT_RATIO) - 4);
    this.editor = new Editor(options.tui, editorTheme(options.theme), { paddingX: 1 });
    this.editor.onChange = () => this.changed();
    this.editor.onSubmit = (value) => this.submitEditor(value);
    this.loadSource(options.source);
  }

  protected override propagateFocus(focused: boolean): void {
    this.editor.focused = focused && (this.mode === "raw" || this.mode === "suggest");
  }

  override invalidate(): void {
    super.invalidate();
    this.editor.invalidate();
  }

  private loadSource(source: string): void {
    try {
      this.definition = parseWorkflow(source);
      this.canonicalSource = serializeWorkflow(this.definition);
      this.parseError = undefined;
      this.mode = "confirm";
      this.scroll = 0;
      this.resolveCanonicalSource();
    } catch (error) {
      this.definition = undefined;
      this.canonicalSource = undefined;
      this.plan = undefined;
      this.resolutionError = undefined;
      this.parseError = error instanceof Error ? error.message : String(error);
      this.mode = "raw";
      this.editor.setText(source);
    }
  }

  private resolveCanonicalSource(): void {
    this.plan = undefined;
    this.resolutionError = undefined;
    if (!this.canonicalSource) return;
    try {
      this.plan = this.resolveSource(this.canonicalSource);
    } catch (error) {
      this.resolutionError = error instanceof Error ? error.message : String(error);
    }
  }

  private submitEditor(value: string): void {
    if (this.mode === "raw") {
      this.loadSource(value);
      this.changed();
      return;
    }
    if (this.mode !== "suggest" || !value.trim()) return;
    this.done({ action: "suggest", suggestion: value });
  }

  private openSuggestion(): void {
    this.mode = "suggest";
    this.editor.setText("");
    this.changed();
  }

  private run(): void {
    if (!this.canonicalSource || !this.plan) return;
    try {
      const plan = this.resolveSource(this.canonicalSource);
      this.done({ action: "run", plan });
    } catch (error) {
      this.plan = undefined;
      this.resolutionError = error instanceof Error ? error.message : String(error);
      this.changed();
    }
  }

  override handleInput(data: string): void {
    if (this.mode === "raw") {
      if (matchesKey(data, Key.escape)) { this.done({ action: "cancel" }); return; }
      this.editor.handleInput(data);
      this.changed();
      return;
    }
    if (this.mode === "suggest") {
      if (matchesKey(data, Key.escape)) {
        this.mode = "confirm";
        this.changed();
        return;
      }
      this.editor.handleInput(data);
      this.changed();
      return;
    }
    if (matchesKey(data, Key.escape)) { this.done({ action: "cancel" }); return; }
    if (matchesKey(data, Key.space)) { this.openSuggestion(); return; }
    if (matchesKey(data, Key.enter)) { this.run(); return; }
    if (matchesKey(data, Key.up)) { this.scroll = Math.max(0, this.scroll - 1); this.changed(); return; }
    if (matchesKey(data, Key.down)) { this.scroll += 1; this.changed(); }
  }

  private agentLines(width: number): string[] {
    if (!this.definition) return [];
    const resolved = new Map(this.plan?.agents.map((agent) => [agent.id, agent]) ?? []);
    const lines: string[] = [];
    for (const agent of this.definition.agents) {
      const role = this.roles.get(agent.role);
      const resolvedAgent = resolved.get(agent.id);
      const tools = resolvedAgent?.effectiveTools ?? (agent.tools === undefined ? role?.tools : agent.tools);
      const skills = resolvedAgent?.effectiveSkills ?? (agent.skills === undefined ? role?.skills : agent.skills);
      lines.push(
        ...renderAgentTable(this.theme, width, [
          { label: "ID", value: agent.id, accent: true },
          { label: "Role", value: `${agent.role}${role?.description ? ` — ${role.description}` : ""}` },
          { label: "Model", value: resolvedAgent?.resolvedRole.model ?? role?.model ?? "unavailable" },
          { label: "Dependencies", value: agent.dependsOn.join(", ") || "none" },
          { label: "Tools", value: tools?.join(", ") || "none" },
          { label: "Skills", value: skills?.join(", ") || "none" },
          { label: "Context files", value: agent.contextFiles?.join(", ") || "none" },
          { label: "Prompt", value: agent.prompt },
        ]),
        "",
      );
    }
    return lines;
  }

  private confirmationBody(width: number): string[] {
    if (!this.definition) return [];
    const columns = dialogColumnWidths(width);
    const detailWidth = columns.left;
    const graphWidth = columns.right;
    const graph = [
      this.theme.fg("accent", this.theme.bold("Workflow graph")),
      "",
      ...renderWorkflowGraph(this.definition, graphWidth, this.theme),
    ];
    const details = [
      this.theme.fg("accent", this.theme.bold("Subagent capabilities")),
      "",
      ...this.agentLines(detailWidth),
    ];
    const content = layoutDialogColumns(details, graph, width);
    const validation = this.plan
      ? [this.theme.fg("success", "✓ Workflow and resources validate")]
      : [
          this.theme.fg("warning", "Run is disabled until the proposal validates."),
          this.theme.fg("error", this.resolutionError ?? "Workflow could not be resolved"),
        ];
    return [
      this.theme.fg("text", this.theme.bold(this.definition.name)),
      ...(this.definition.description ? [this.theme.fg("muted", compact(this.definition.description))] : []),
      ...validation,
      "",
      ...content,
      this.theme.fg("dim", `Context limit: ${MAX_CONTEXT_FILES_PER_AGENT} files / ${MAX_CONTEXT_BYTES_PER_AGENT} bytes per agent`),
      this.theme.fg("dim", "Bash/Shell commands are inspected by CC Safety Net; blocked commands require user approval."),
    ];
  }

  private viewport(header: string[], body: string[], footer: string[]): string[] {
    const maxRows = this.maxContentRows;
    const capacity = Math.max(1, maxRows - header.length - footer.length);
    const maxTop = Math.max(0, body.length - capacity);
    const top = Math.max(0, Math.min(maxTop, this.scroll));
    this.scroll = top;
    const visible = body.slice(top, top + capacity);
    if (top > 0 && visible.length) visible[0] = this.theme.fg("dim", "↑ more details");
    if (top + capacity < body.length && visible.length) visible[visible.length - 1] = this.theme.fg("dim", "↓ more details");
    return [...header, ...visible, ...footer];
  }

  protected override renderDialog(width: number): string[] {
    if (this.mode === "raw") {
      const body = [
        this.theme.fg("dim", "Edit static source, then Enter to parse. Shift+Enter inserts a line."),
        ...(this.parseError ? ["", this.theme.fg("error", this.parseError)] : []),
        "",
        ...this.editor.render(Math.max(1, width - 2)).map((line) => ` ${line}`),
      ];
      return this.viewport(
        [this.theme.fg("accent", this.theme.bold("Raw source recovery")), ""],
        body,
        ["", this.theme.fg("dim", "Enter parse • Esc cancel")],
      );
    }
    if (this.mode === "suggest") {
      return this.viewport(
        [this.theme.fg("accent", this.theme.bold("Suggest a workflow revision")), ""],
        [
          this.theme.fg("dim", "Describe what the workflow should do or look like."),
          "",
          ...this.editor.render(Math.max(1, width - 2)).map((line) => ` ${line}`),
        ],
        ["", this.theme.fg("dim", "Enter submit • Shift+Enter new line • Esc return")],
      );
    }
    return this.viewport(
      [this.theme.fg("accent", this.theme.bold("Confirm dynamic workflow")), ""],
      this.confirmationBody(width),
      [
        "",
        this.theme.fg("success", "Enter — Run") + "   " + this.theme.fg("accent", "Space — Suggest") + "   " + this.theme.fg("muted", "Esc — Cancel"),
        this.theme.fg("dim", "↑↓ scroll"),
      ],
    );
  }
}
