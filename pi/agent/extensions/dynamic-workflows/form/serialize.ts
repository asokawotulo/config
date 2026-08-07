import type { WorkflowAgentDefinition, WorkflowDefinition } from "../types.ts";
import type { WorkflowDraft } from "./types.ts";

function canonicalAgent(agent: WorkflowAgentDefinition): WorkflowAgentDefinition {
  return {
    id: agent.id,
    role: agent.role,
    prompt: agent.prompt,
    dependsOn: [...agent.dependsOn],
    ...(agent.contextFiles === undefined ? {} : { contextFiles: [...agent.contextFiles] }),
    ...(agent.tools === undefined ? {} : { tools: [...agent.tools] }),
    ...(agent.skills === undefined ? {} : { skills: [...agent.skills] }),
  };
}

/** Return a detached object with canonical field ordering. */
export function canonicalWorkflow(draft: WorkflowDraft): WorkflowDefinition {
  return {
    name: draft.name,
    ...(draft.description === undefined ? {} : { description: draft.description }),
    agents: draft.agents.map(canonicalAgent),
  };
}

/** Serialize a draft as the only source form accepted by parseWorkflow. */
export function serializeWorkflowDraft(draft: WorkflowDraft): string {
  const json = JSON.stringify(canonicalWorkflow(draft), null, 2)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `export const workflow = ${json};\n`;
}

export const serializeWorkflow = serializeWorkflowDraft;
