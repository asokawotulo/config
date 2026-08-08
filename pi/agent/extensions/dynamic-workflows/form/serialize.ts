import type { WorkflowAgentDefinition, WorkflowDefinition } from "../types.ts";

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

/** Return a detached definition with canonical field ordering. */
export function canonicalWorkflow(definition: WorkflowDefinition): WorkflowDefinition {
  return {
    name: definition.name,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    agents: definition.agents.map(canonicalAgent),
  };
}

/** Serialize a definition as the only source form accepted by parseWorkflow. */
export function serializeWorkflow(definition: WorkflowDefinition): string {
  const json = JSON.stringify(canonicalWorkflow(definition), null, 2)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `export const workflow = ${json};\n`;
}
