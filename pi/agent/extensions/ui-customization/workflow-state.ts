import {
  parseDynamicWorkflowRunEvent,
  parseDynamicWorkflowStateEvent,
  type DynamicWorkflowRunSnapshot,
} from "../../lib/dynamic-workflow-events.ts";

export function selectSidebarWorkflowRuns(
  runs: Iterable<DynamicWorkflowRunSnapshot>,
  sessionId: string,
): DynamicWorkflowRunSnapshot[] {
  return Array.from(runs)
    .filter((run) => run.sessionId === sessionId)
    .sort((left, right) => right.startedAt - left.startedAt);
}

/** Session-scoped event state kept separate from persisted sidebar metadata. */
export class DynamicWorkflowSidebarState {
  private sessionId: string | undefined;
  private runs = new Map<string, DynamicWorkflowRunSnapshot>();

  beginSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.runs.clear();
  }

  endSession(): void {
    this.sessionId = undefined;
    this.runs.clear();
  }

  applyRun(data: unknown): boolean {
    const event = parseDynamicWorkflowRunEvent(data);
    if (!this.sessionId || !event || event.sessionId !== this.sessionId) {
      return false;
    }

    this.runs.set(event.run.runId, event.run);
    return true;
  }

  applyState(data: unknown): boolean {
    const event = parseDynamicWorkflowStateEvent(data);
    if (!this.sessionId || !event || event.sessionId !== this.sessionId) {
      return false;
    }

    this.runs = new Map(event.runs.map((run) => [run.runId, run]));
    return true;
  }

  getVisibleRuns(): DynamicWorkflowRunSnapshot[] {
    return this.sessionId
      ? selectSidebarWorkflowRuns(this.runs.values(), this.sessionId)
      : [];
  }

  getRuns(): DynamicWorkflowRunSnapshot[] {
    return this.sessionId
      ? Array.from(this.runs.values()).filter(
          (run) => run.sessionId === this.sessionId,
        )
      : [];
  }
}
