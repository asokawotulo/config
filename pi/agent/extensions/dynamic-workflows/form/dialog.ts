import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  Key,
  matchesKey,
  wrapTextWithAnsi,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import type { ResolvedWorkflow, RoleDefinition } from "../types.ts";
import {
  addAgent,
  deleteAgent,
  parseWorkflowDraft,
  renameAgent,
  reorderAgent,
  validateWorkflowDraft,
} from "./state.ts";
import { serializeWorkflowDraft } from "./serialize.ts";
import { MAX_CONTEXT_BYTES_PER_AGENT, MAX_CONTEXT_FILES_PER_AGENT } from "../workflow.ts";
import type { RoleCatalog, WorkflowAgentDraft, WorkflowDraft } from "./types.ts";
import {
  checkbox,
  DIALOG_SELECTION_MARKER,
  DialogComponent,
  layoutDialogColumns,
  selectedLine,
} from "./render.ts";

type Section = "workflow" | "agents" | "review" | "raw";
type Row = {
  label: string;
  value?: string;
  activate?: () => void;
  adjust?: (direction: -1 | 1) => void;
};

export interface WorkflowDialogOptions {
  tui: TUI;
  theme: Theme;
  source: string;
  roles: RoleCatalog;
  resolveSource: (source: string) => ResolvedWorkflow;
  onDone: (plan: ResolvedWorkflow | undefined) => void;
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

function cycle<T>(values: readonly T[], current: T, direction: -1 | 1): T | undefined {
  if (!values.length) return undefined;
  const index = Math.max(0, values.indexOf(current));
  return values[(index + direction + values.length) % values.length];
}

function compact(value: string, empty = "none"): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text || empty;
}

/** Structured workflow approval dialog with an explicit raw-source recovery mode. */
export class WorkflowDialogComponent extends DialogComponent<ResolvedWorkflow> {
  private draft?: WorkflowDraft;
  private section: Section = "raw";
  private previousSection: Exclude<Section, "raw"> = "workflow";
  private selectedAgent = 0;
  private selectedRow = 0;
  private reviewScroll = 0;
  private editCommit?: (value: string) => void;
  private editTitle = "";
  private parseError?: string;
  private actionError?: string;
  private issues: string[] = [];
  private plan?: ResolvedWorkflow;
  private readonly editor: Editor;
  private readonly roles: RoleCatalog;
  private readonly roleNames: string[];
  private readonly resolveSource: (source: string) => ResolvedWorkflow;
  private readonly terminalRows: number;

  constructor(options: WorkflowDialogOptions) {
    super(options.theme, options.onDone, () => options.tui.requestRender());
    this.roles = options.roles;
    this.roleNames = [...options.roles.keys()];
    this.resolveSource = options.resolveSource;
    this.terminalRows = options.tui.terminal?.rows ?? 24;
    this.editor = new Editor(options.tui, editorTheme(options.theme), { paddingX: 1 });
    this.editor.onChange = () => this.changed();
    this.editor.onSubmit = (value) => this.submitEditor(value);
    try {
      this.draft = parseWorkflowDraft(options.source);
      this.section = "workflow";
      this.refreshValidation();
    } catch (error) {
      this.section = "raw";
      this.parseError = error instanceof Error ? error.message : String(error);
      this.editor.setText(options.source);
    }
  }

  protected override propagateFocus(focused: boolean): void {
    this.editor.focused = focused && (this.section === "raw" || this.editCommit !== undefined);
  }

  override invalidate(): void {
    super.invalidate();
    this.editor.invalidate();
  }

  private currentAgent(): WorkflowAgentDraft | undefined {
    if (!this.draft?.agents.length) return undefined;
    this.selectedAgent = Math.min(this.selectedAgent, this.draft.agents.length - 1);
    return this.draft.agents[this.selectedAgent];
  }

  private refreshValidation(): void {
    this.plan = undefined;
    this.issues = [];
    if (!this.draft) return;
    const validation = validateWorkflowDraft(this.draft, this.roles);
    this.issues = validation.issues.map((issue) => `${issue.path}: ${issue.message}`);
    if (!validation.valid) return;
    try {
      this.plan = this.resolveSource(serializeWorkflowDraft(this.draft));
    } catch (error) {
      this.issues.push(error instanceof Error ? error.message : String(error));
    }
  }

  private mutate(operation: () => void): void {
    this.actionError = undefined;
    try { operation(); }
    catch (error) { this.actionError = error instanceof Error ? error.message : String(error); }
    this.refreshValidation();
    this.clampRow();
    this.changed();
  }

  private beginEdit(title: string, value: string, commit: (value: string) => void): void {
    this.editTitle = title;
    this.editCommit = commit;
    this.editor.setText(value);
    this.changed();
  }

  private submitEditor(value: string): void {
    if (this.section === "raw") {
      try {
        this.draft = parseWorkflowDraft(value);
        this.parseError = undefined;
        this.actionError = undefined;
        this.section = this.previousSection;
        this.editCommit = undefined;
        this.selectedAgent = 0;
        this.selectedRow = 0;
        this.refreshValidation();
      } catch (error) {
        this.parseError = error instanceof Error ? error.message : String(error);
      }
      this.changed();
      return;
    }
    if (!this.editCommit) return;
    try {
      this.editCommit(value);
      this.editCommit = undefined;
      this.actionError = undefined;
      this.refreshValidation();
    } catch (error) {
      this.actionError = error instanceof Error ? error.message : String(error);
    }
    this.changed();
  }

  private openRaw(): void {
    if (!this.draft) return;
    this.previousSection = this.section === "raw" ? this.previousSection : this.section;
    this.section = "raw";
    this.editCommit = undefined;
    this.parseError = undefined;
    this.editor.setText(serializeWorkflowDraft(this.draft));
    this.changed();
  }

  private metadataRows(): Row[] {
    if (!this.draft) return [];
    return [
      {
        label: "Name", value: this.draft.name,
        activate: () => this.beginEdit("Workflow name", this.draft!.name, (value) => { this.draft!.name = value; }),
      },
      {
        label: "Description", value: this.draft.description ?? "",
        activate: () => this.beginEdit("Workflow description", this.draft!.description ?? "", (value) => {
          if (value.trim()) this.draft!.description = value;
          else delete this.draft!.description;
        }),
      },
    ];
  }

  private roleFor(agent: WorkflowAgentDraft): RoleDefinition | undefined {
    return this.roles.get(agent.role);
  }

  private agentRows(): Row[] {
    const draft = this.draft;
    const agent = this.currentAgent();
    if (!draft || !agent) return [{ label: "Add agent", activate: () => this.addNewAgent() }];
    const role = this.roleFor(agent);
    const rows: Row[] = [
      {
        label: "ID", value: agent.id,
        activate: () => {
          const oldId = agent.id;
          this.beginEdit("Agent id", oldId, (value) => renameAgent(draft, oldId, value.trim()));
        },
      },
      {
        label: "Role", value: role ? `${role.name} — ${role.description}` : agent.role || "none",
        adjust: (direction) => this.changeRole(agent, direction),
        activate: () => this.changeRole(agent, 1),
      },
      {
        label: "Prompt", value: compact(agent.prompt, "required"),
        activate: () => this.beginEdit(`Prompt for ${agent.id}`, agent.prompt, (value) => { agent.prompt = value; }),
      },
      {
        label: "Context files",
        value: agent.contextFiles?.length ? agent.contextFiles.join(", ") : "none",
        activate: () => this.beginEdit(
          `Context files for ${agent.id} (one worktree-relative path per line)`,
          agent.contextFiles?.join("\n") ?? "",
          (value) => {
            const paths = value.split(/\r?\n/).map((path) => path.trim()).filter(Boolean);
            if (paths.length) agent.contextFiles = paths;
            else delete agent.contextFiles;
          },
        ),
      },
    ];

    for (const dependency of draft.agents) {
      if (dependency === agent) continue;
      rows.push({
        label: `Dependency ${checkbox(this.theme, agent.dependsOn.includes(dependency.id))}`,
        value: dependency.id,
        activate: () => this.mutate(() => {
          agent.dependsOn = agent.dependsOn.includes(dependency.id)
            ? agent.dependsOn.filter((id) => id !== dependency.id)
            : [...agent.dependsOn, dependency.id];
        }),
      });
    }

    rows.push({
      label: `Narrow tools ${checkbox(this.theme, agent.tools !== undefined)}`,
      value: agent.tools === undefined ? "inherit role" : `${agent.tools.length}/${role?.tools.length ?? 0} selected`,
      activate: () => this.mutate(() => {
        if (agent.tools === undefined) agent.tools = [...(role?.tools ?? [])];
        else delete agent.tools;
      }),
    });
    if (agent.tools !== undefined) {
      for (const tool of role?.tools ?? []) rows.push(this.listToggleRow("Tool", tool, agent.tools, (value) => { agent.tools = value; }));
    }

    rows.push({
      label: `Narrow skills ${checkbox(this.theme, agent.skills !== undefined)}`,
      value: agent.skills === undefined ? "inherit role" : `${agent.skills.length}/${role?.skills.length ?? 0} selected`,
      activate: () => this.mutate(() => {
        if (agent.skills === undefined) agent.skills = [...(role?.skills ?? [])];
        else delete agent.skills;
      }),
    });
    if (agent.skills !== undefined) {
      for (const skill of role?.skills ?? []) rows.push(this.listToggleRow("Skill", skill, agent.skills, (value) => { agent.skills = value; }));
    }
    rows.push(
      { label: "Add agent", value: "after current list", activate: () => this.addNewAgent() },
      {
        label: "Move agent up", value: this.selectedAgent > 0 ? "available" : "already first",
        activate: () => this.moveCurrentAgent(-1),
      },
      {
        label: "Move agent down", value: this.selectedAgent < draft.agents.length - 1 ? "available" : "already last",
        activate: () => this.moveCurrentAgent(1),
      },
      {
        label: "Delete agent", value: agent.id,
        activate: () => this.mutate(() => {
          deleteAgent(draft, agent.id);
          this.selectedAgent = Math.max(0, this.selectedAgent - 1);
        }),
      },
    );
    return rows;
  }

  private listToggleRow(
    kind: string,
    item: string,
    values: string[],
    assign: (values: string[]) => void,
  ): Row {
    return {
      label: `${kind} ${checkbox(this.theme, values.includes(item))}`,
      value: item,
      activate: () => this.mutate(() => assign(values.includes(item) ? values.filter((value) => value !== item) : [...values, item])),
    };
  }

  private changeRole(agent: WorkflowAgentDraft, direction: -1 | 1): void {
    this.mutate(() => {
      const next = cycle(this.roleNames, agent.role, direction);
      if (!next) return;
      agent.role = next;
      const role = this.roles.get(next)!;
      if (agent.tools) agent.tools = agent.tools.filter((tool) => role.tools.includes(tool));
      if (agent.skills) agent.skills = agent.skills.filter((skill) => role.skills.includes(skill));
    });
  }

  private addNewAgent(): void {
    if (!this.draft) return;
    this.mutate(() => {
      addAgent(this.draft!, { role: this.roleNames[0] ?? "", prompt: "Describe this agent's task", dependsOn: [] });
      this.selectedAgent = this.draft!.agents.length - 1;
      this.selectedRow = 0;
    });
  }

  private moveCurrentAgent(direction: -1 | 1): void {
    if (!this.draft?.agents.length) return;
    const to = Math.max(0, Math.min(this.draft.agents.length - 1, this.selectedAgent + direction));
    this.mutate(() => {
      if (reorderAgent(this.draft!, this.selectedAgent, to)) this.selectedAgent = to;
    });
  }

  private rows(): Row[] {
    if (this.section === "workflow") return this.metadataRows();
    if (this.section === "agents") return this.agentRows();
    return [];
  }

  private clampRow(): void {
    const rows = this.rows();
    this.selectedRow = Math.max(0, Math.min(this.selectedRow, Math.max(0, rows.length - 1)));
  }

  private switchSection(direction: -1 | 1): void {
    const sections: Exclude<Section, "raw">[] = ["workflow", "agents", "review"];
    const next = cycle(sections, this.section as Exclude<Section, "raw">, direction);
    if (!next) return;
    this.section = next;
    this.previousSection = next;
    this.selectedRow = 0;
    this.reviewScroll = 0;
    this.actionError = undefined;
    this.changed();
  }

  private approve(): void {
    if (!this.draft || this.issues.length || !this.plan) return;
    const source = serializeWorkflowDraft(this.draft);
    try {
      // Approval always re-resolves canonical source and revalidates runtime resources.
      const plan = this.resolveSource(source);
      this.done(plan);
    } catch (error) {
      this.issues = [error instanceof Error ? error.message : String(error)];
      this.plan = undefined;
      this.changed();
    }
  }

  override handleInput(data: string): void {
    if (this.section === "raw" || this.editCommit) {
      if (matchesKey(data, Key.escape)) {
        if (this.section === "raw") {
          if (!this.draft) { this.done(undefined); return; }
          this.section = this.previousSection;
          this.parseError = undefined;
        } else {
          this.editCommit = undefined;
          this.actionError = undefined;
        }
        this.changed();
        return;
      }
      this.editor.handleInput(data);
      this.changed();
      return;
    }
    if (matchesKey(data, Key.escape)) { this.done(undefined); return; }
    if (matchesKey(data, "r")) { this.openRaw(); return; }
    if (matchesKey(data, Key.tab)) { this.switchSection(1); return; }
    if (matchesKey(data, Key.shift("tab"))) { this.switchSection(-1); return; }

    if (this.section === "agents") {
      if (matchesKey(data, "a")) { this.addNewAgent(); return; }
      if (matchesKey(data, Key.leftbracket) || matchesKey(data, Key.rightbracket)) {
        const count = this.draft?.agents.length ?? 0;
        if (count) {
          this.selectedAgent = (this.selectedAgent + (matchesKey(data, Key.leftbracket) ? -1 : 1) + count) % count;
          this.selectedRow = 0;
          this.changed();
        }
        return;
      }
      if (matchesKey(data, Key.ctrl("up")) || matchesKey(data, Key.ctrl("down"))) {
        if (!this.draft?.agents.length) return;
        this.moveCurrentAgent(matchesKey(data, Key.ctrl("up")) ? -1 : 1);
        return;
      }
      if (matchesKey(data, "x")) {
        const agent = this.currentAgent();
        if (agent) this.mutate(() => { deleteAgent(this.draft!, agent.id); this.selectedAgent = Math.max(0, this.selectedAgent - 1); });
        return;
      }
    }

    if (this.section === "review") {
      if (matchesKey(data, Key.up)) {
        this.reviewScroll = Math.max(0, this.reviewScroll - 1);
        this.changed();
      } else if (matchesKey(data, Key.down)) {
        this.reviewScroll += 1;
        this.changed();
      } else if (matchesKey(data, Key.enter)) this.approve();
      return;
    }
    const rows = this.rows();
    if (matchesKey(data, Key.up)) { this.selectedRow = Math.max(0, this.selectedRow - 1); this.changed(); return; }
    if (matchesKey(data, Key.down)) { this.selectedRow = Math.min(rows.length - 1, this.selectedRow + 1); this.changed(); return; }
    const row = rows[this.selectedRow];
    if ((matchesKey(data, Key.left) || matchesKey(data, Key.right)) && row?.adjust) {
      row.adjust(matchesKey(data, Key.left) ? -1 : 1);
      return;
    }
    if ((matchesKey(data, Key.enter) || matchesKey(data, Key.space)) && row?.activate) row.activate();
  }

  private sidebar(): string[] {
    const draft = this.draft;
    const lines = [this.theme.fg("accent", this.theme.bold("Workflow"))];
    if (!draft) return lines;
    lines.push(this.theme.fg("text", compact(draft.name, "Unnamed workflow")));
    if (draft.description) lines.push(this.theme.fg("muted", compact(draft.description)));
    lines.push("", this.theme.fg("accent", `Agents (${draft.agents.length})`));
    if (!draft.agents.length) lines.push(this.theme.fg("warning", "  No agents — press a"));
    for (const [index, agent] of draft.agents.entries()) {
      const marker = this.section === "agents" && index === this.selectedAgent ? ">" : " ";
      lines.push(`${this.theme.fg(index === this.selectedAgent ? "accent" : "muted", marker)} ${index + 1}. ${compact(agent.id, "invalid id")} · ${compact(agent.role, "no role")}`);
    }
    return lines;
  }

  private formBody(width: number): string[] {
    const sectionLabel = this.section === "workflow" ? "Workflow metadata" : "Agent definition";
    const lines = [this.theme.fg("accent", this.theme.bold(sectionLabel)), ""];
    const rows = this.rows();
    for (const [index, row] of rows.entries()) {
      const value = row.value === undefined ? "" : `: ${compact(row.value)}`;
      lines.push(...wrapTextWithAnsi(selectedLine(this.theme, index === this.selectedRow, `${row.label}${value}`), Math.max(1, width)));
      if (this.editCommit && index === this.selectedRow) {
        lines.push(this.theme.fg("muted", `  ${this.editTitle}`));
        lines.push(...this.editor.render(Math.max(1, width - 2)).map((line) => `  ${line}`));
      }
    }
    if (this.section === "agents") {
      lines.push("", this.theme.fg("dim", "[ / ] agent • a add • x delete agent • Ctrl+↑↓ reorder"));
    }
    return lines;
  }

  private reviewBody(width: number): string[] {
    const lines = [this.theme.fg("accent", this.theme.bold("Final review")), ""];
    if (!this.plan) {
      lines.push(this.theme.fg("warning", "Approval disabled until every error is fixed."));
    } else {
      lines.push(this.theme.fg("success", `Waves: ${this.plan.waves.map((wave, index) => `${index + 1}[${wave.join(", ")}]`).join(" → ")}`));
      for (const agent of this.plan.agents) {
        lines.push(
          "",
          this.theme.fg("accent", `${agent.id} · ${agent.role} · ${agent.resolvedRole.model}`),
          `depends: ${agent.dependsOn.join(", ") || "none"}`,
          `effective tools: ${agent.effectiveTools.join(", ") || "none"}`,
          `effective skills: ${agent.effectiveSkills.join(", ") || "none"}`,
          `approved context: ${agent.contextFiles?.join(", ") || "none"}`,
          `context bounds: ${MAX_CONTEXT_FILES_PER_AGENT} files / ${MAX_CONTEXT_BYTES_PER_AGENT} aggregate bytes per agent`,
          "command safety: Bash/Shell commands are inspected by CC Safety Net",
          "blocked commands require an explicit parent-user decision",
        );
      }
      lines.push("", this.theme.fg("success", "Enter — approve canonical workflow and run"));
    }
    return lines.flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width)));
  }

  private fitViewport(lines: string[]): string[] {
    const maxRows = Math.max(8, Math.floor(this.terminalRows * 0.9) - 2);
    const clean = (line: string) => line.split(DIALOG_SELECTION_MARKER).join("");
    if (lines.length <= maxRows) return lines.map(clean);

    const headerCount = 2;
    const footerCount = 2;
    const header = lines.slice(0, headerCount);
    const footer = lines.slice(-footerCount);
    const middle = lines.slice(headerCount, -footerCount);
    const capacity = Math.max(1, maxRows - header.length - footer.length);
    const marked = middle.findIndex((line) => line.includes(DIALOG_SELECTION_MARKER));
    const maxTop = Math.max(0, middle.length - capacity);
    const requestedTop = this.section === "review"
      ? this.reviewScroll
      : marked >= 0
        ? marked - Math.floor(capacity / 2)
        : 0;
    const top = Math.max(0, Math.min(maxTop, requestedTop));
    if (this.section === "review") this.reviewScroll = top;
    const visible = middle.slice(top, top + capacity).map(clean);
    if (top > 0 && visible.length) visible[0] = this.theme.fg("dim", "↑ more fields");
    if (top + capacity < middle.length && visible.length) {
      visible[visible.length - 1] = this.theme.fg("dim", "↓ more fields");
    }
    return [...header.map(clean), ...visible, ...footer.map(clean)];
  }

  protected override renderDialog(width: number): string[] {
    if (this.section === "raw") {
      const error = this.parseError ? ["", this.theme.fg("error", this.parseError)] : [];
      return this.fitViewport([
        this.theme.fg("accent", this.theme.bold(this.draft ? "Raw source escape hatch" : "Raw source recovery")),
        this.theme.fg("dim", "Edit static source, then Enter to parse into the safe structured form. Shift+Enter inserts a line."),
        ...error,
        "",
        ...this.editor.render(Math.max(1, width - 2)).map((line) => ` ${line}`),
        "",
        this.theme.fg("dim", this.draft ? "Enter parse • Esc return to form" : "Enter parse • Esc cancel"),
      ]);
    }

    const tabs = (["workflow", "agents", "review"] as const).map((section) => {
      const label = section === "workflow" ? "Workflow" : section === "agents" ? "Agents" : "Review";
      return section === this.section ? this.theme.bg("selectedBg", ` ${label} `) : this.theme.fg("muted", ` ${label} `);
    }).join(" ");
    const bodyWidth = width >= 100 ? width - Math.min(30, Math.max(24, Math.floor(width * 0.28))) - 3 : width;
    const body = this.section === "review" ? this.reviewBody(bodyWidth) : this.formBody(bodyWidth);
    const errors = [...(this.actionError ? [this.actionError] : []), ...this.issues];
    const errorLines = errors.length
      ? ["", this.theme.fg("error", `${errors.length} error${errors.length === 1 ? "" : "s"}:`), ...errors.slice(0, 6).map((error) => this.theme.fg("error", `• ${error}`))]
      : ["", this.theme.fg("success", "✓ Workflow and resources validate")];
    return this.fitViewport([
      ` ${tabs}`,
      "",
      ...layoutDialogColumns(this.sidebar(), [...body, ...errorLines], width),
      "",
      this.theme.fg("dim", "Tab sections • ↑↓ fields/scroll • ←→ choices • Enter edit/toggle • r raw source • Esc cancel"),
    ]);
  }
}
