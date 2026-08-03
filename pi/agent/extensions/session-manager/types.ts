import type { SessionInfo } from "@earendil-works/pi-coding-agent";

export interface ArmedDelete {
  path: string;
  armedAt: number;
}

export type SessionManagerAction =
  | { kind: "close" }
  | { kind: "resume"; session: SessionInfo; index: number }
  | { kind: "rename"; session: SessionInfo; index: number }
  | { kind: "delete"; session: SessionInfo; index: number };

export interface TrashResult {
  code: number | null;
  stderr?: string;
}

export type RunTrash = (args: string[]) => Promise<TrashResult>;

export interface DeleteSessionResult {
  method: "trash" | "unlink";
}
