import { truncateUtf8 } from "./protocol.ts";
import type { WorkflowRun } from "./types.ts";

export const MAX_PARENT_RESULT_BYTES = 50 * 1024;

function fairBodyBudgets(bodies: readonly string[], totalBudget: number): number[] {
  const allocations = bodies.map(() => 0);
  const sizes = bodies.map((body) => Buffer.byteLength(body, "utf8"));
  let remainingBudget = Math.max(0, totalBudget);
  let active = bodies.map((_body, index) => index);

  while (active.length) {
    const share = Math.floor(remainingBudget / active.length);
    const completed = active.filter((index) => sizes[index]! <= share);
    if (!completed.length) {
      for (const index of active) allocations[index] = share;
      let remainder = remainingBudget - share * active.length;
      for (const index of active) {
        if (remainder-- <= 0) break;
        allocations[index]! += 1;
      }
      break;
    }
    const completedSet = new Set(completed);
    for (const index of completed) {
      allocations[index] = sizes[index]!;
      remainingBudget -= sizes[index]!;
    }
    active = active.filter((index) => !completedSet.has(index));
  }
  return allocations;
}

/** Format bounded parent output while reserving an equal opportunity for every agent body. */
export function parentResultText(run: WorkflowRun): string {
  const headers: string[] = [];
  const bodies: string[] = [];
  for (const agent of run.agents) {
    headers.push(`## ${agent.id} [${agent.status}]\n\n`);
    const summary = agent.finalSummary ?? agent.output;
    bodies.push(summary || (agent.error ? `Error: ${agent.error}` : "No final summary was produced."));
  }
  const separator = "\n\n";
  const overhead = headers.reduce((total, header) => total + Buffer.byteLength(header, "utf8"), 0)
    + Math.max(0, headers.length - 1) * Buffer.byteLength(separator, "utf8");
  const allocations = fairBodyBudgets(bodies, MAX_PARENT_RESULT_BYTES - overhead);
  return headers
    .map((header, index) => `${header}${truncateUtf8(bodies[index]!, allocations[index]!)}`)
    .join(separator);
}
