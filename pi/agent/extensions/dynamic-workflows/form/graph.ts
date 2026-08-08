import type { Theme } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { render, type MermaidArt, type Span } from "grok-mermaid";
import type { WorkflowDefinition } from "../types.ts";

function mermaidSource(definition: WorkflowDefinition, direction: "LR" | "TD", compact = false): string {
  const indexes = new Map<string, number>();
  definition.agents.forEach((agent, index) => {
    if (!indexes.has(agent.id)) indexes.set(agent.id, index);
  });
  const nodes = definition.agents.map((agent, index) => `  n${index}[${JSON.stringify(compact ? String(index + 1) : agent.id)}]`);
  const unknown = new Map<string, string>();
  const edges: string[] = [];
  for (const [index, agent] of definition.agents.entries()) {
    for (const dependency of agent.dependsOn) {
      const dependencyIndex = indexes.get(dependency);
      if (dependencyIndex !== undefined) {
        edges.push(`  n${dependencyIndex} --> n${index}`);
        continue;
      }
      let node = unknown.get(dependency);
      if (!node) {
        node = `u${unknown.size}`;
        unknown.set(dependency, node);
        nodes.push(`  ${node}[${JSON.stringify(compact ? "?" : `${dependency} (missing)`)}]`);
      }
      edges.push(`  ${node} -.-> n${index}`);
    }
  }
  return [`flowchart ${direction}`, ...nodes, ...edges].join("\n");
}

/** Deterministic Mermaid source for the proposed workflow DAG. */
export function workflowMermaid(definition: WorkflowDefinition): string {
  return mermaidSource(definition, "TD");
}

function styleSpan(span: Span, theme: Theme): string {
  switch (span.cls) {
    case "border": return theme.fg("borderMuted", span.text);
    case "text": return theme.fg("text", span.text);
    case "edge": return theme.fg("accent", span.text);
    case "edgeLabel": return theme.fg("muted", span.text);
    case "title": return theme.fg("accent", theme.bold(span.text));
    case "none": return span.text;
  }
}

function themedLines(art: MermaidArt, theme: Theme): string[] {
  return art.styled.map((row) => row.map((span) => styleSpan(span, theme)).join(""));
}

function compactGraph(definition: WorkflowDefinition, width: number, theme: Theme): string[] {
  const safeWidth = Math.max(1, width);
  const lines: string[] = [];
  for (const agent of definition.agents) {
    const entries = agent.dependsOn.length
      ? agent.dependsOn.map((dependency) => `[${dependency}] ──▶ [${agent.id}]`)
      : [`[${agent.id}]`];
    for (const entry of entries) {
      lines.push(...wrapTextWithAnsi(theme.fg("muted", entry), safeWidth));
    }
  }
  return lines;
}

/** Render with Pi's Mermaid engine, falling back when the diagram cannot fit safely. */
export function renderWorkflowGraph(definition: WorkflowDefinition, width: number, theme: Theme): string[] {
  const safeWidth = Math.max(1, width);
  const art = render(workflowMermaid(definition));
  if (art && art.warnings.length === 0 && art.width <= safeWidth) return themedLines(art, theme);

  const compactArt = render(mermaidSource(definition, "TD", true));
  if (compactArt && compactArt.warnings.length === 0 && compactArt.width <= safeWidth) {
    const legend = definition.agents.flatMap((agent, index) =>
      wrapTextWithAnsi(theme.fg("muted", `${index + 1}: ${agent.id}`), safeWidth),
    );
    return [...themedLines(compactArt, theme), "", theme.fg("dim", "Agents"), ...legend];
  }
  return compactGraph(definition, safeWidth, theme);
}
