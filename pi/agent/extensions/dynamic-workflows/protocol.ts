import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Usage } from "@earendil-works/pi-ai";

export const CHILD_PROTOCOL_VERSION = 1;
export const MAX_AGENT_SUMMARY_BYTES = 32 * 1024;
const MAX_PROTOCOL_FILE_BYTES = 1024 * 1024;

export interface ChildConfig {
  version: 1;
  runId: string;
  agentId: string;
  prompt: string;
  systemPrompt: string;
}

export interface ChildSettledStatus {
  version: 1;
  state: "settled";
  at: number;
  ok: boolean;
  finalSummary: string;
  usage: Usage;
  sessionId: string;
  sessionFile?: string;
  error?: string;
  cancelled?: boolean;
}

export interface ChildRunningStatus {
  version: 1;
  state: "starting" | "running";
  at: number;
  activity: string;
  sessionId?: string;
  sessionFile?: string;
}

export type ChildStatus = ChildRunningStatus | ChildSettledStatus;

export interface PermissionRequest {
  version: 1;
  id: string;
  command: string;
  at: number;
}

export interface PermissionResponse {
  version: 1;
  id: string;
  at: number;
  command?: string;
  block?: string;
}

export interface ChildControl {
  version: 1;
  sequence: string;
  action: "interrupt" | "terminate";
  at: number;
}

export interface ChildArtifactPaths {
  directory: string;
  config: string;
  status: string;
  control: string;
  requests: string;
  responses: string;
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(value)) throw new Error(`Invalid workflow artifact id ${JSON.stringify(value)}`);
  return value;
}

export function workflowArtifactDirectory(runId: string): string {
  return join(getAgentDir(), "dynamic-workflows", safeSegment(runId));
}

export function childArtifactPaths(runId: string, agentId: string): ChildArtifactPaths {
  const directory = join(workflowArtifactDirectory(runId), "agents", safeSegment(agentId));
  return {
    directory,
    config: join(directory, "config.json"),
    status: join(directory, "status.json"),
    control: join(directory, "control.json"),
    requests: join(directory, "permissions", "requests"),
    responses: join(directory, "permissions", "responses"),
  };
}

export function initializeChildArtifacts(paths: ChildArtifactPaths): void {
  for (const directory of [paths.directory, paths.requests, paths.responses]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }
}

export function atomicWriteJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.${randomBytes(5).toString("hex")}.tmp`;
  const content = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(content, "utf8") > MAX_PROTOCOL_FILE_BYTES) throw new Error(`Protocol artifact is too large: ${path}`);
  writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

export function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  const content = readFileSync(path);
  if (content.byteLength > MAX_PROTOCOL_FILE_BYTES) throw new Error(`Protocol artifact is too large: ${path}`);
  return JSON.parse(content.toString("utf8")) as T;
}

export function writeChildConfig(paths: ChildArtifactPaths, config: ChildConfig): void {
  initializeChildArtifacts(paths);
  atomicWriteJson(paths.config, config);
}

export function listPermissionRequests(paths: ChildArtifactPaths): PermissionRequest[] {
  if (!existsSync(paths.requests)) return [];
  const requests: PermissionRequest[] = [];
  for (const name of readdirSync(paths.requests).sort()) {
    if (!/^[a-f0-9]{24}\.json$/.test(name)) continue;
    const request = readJson<PermissionRequest>(join(paths.requests, name));
    if (request?.version === CHILD_PROTOCOL_VERSION && request.id === name.slice(0, -5) && typeof request.command === "string") requests.push(request);
  }
  return requests;
}

export function permissionResponsePath(paths: ChildArtifactPaths, id: string): string {
  if (!/^[a-f0-9]{24}$/.test(id)) throw new Error("Invalid permission request id");
  return join(paths.responses, `${id}.json`);
}

export function writePermissionRequest(paths: ChildArtifactPaths, command: string): PermissionRequest {
  if (!command || Buffer.byteLength(command, "utf8") > 128 * 1024) throw new Error("Shell command is empty or too large");
  const request: PermissionRequest = {
    version: CHILD_PROTOCOL_VERSION,
    id: randomBytes(12).toString("hex"),
    command,
    at: Date.now(),
  };
  atomicWriteJson(join(paths.requests, `${request.id}.json`), request);
  return request;
}

export function writeChildControl(paths: ChildArtifactPaths, action: ChildControl["action"]): ChildControl {
  initializeChildArtifacts(paths);
  const control: ChildControl = {
    version: CHILD_PROTOCOL_VERSION,
    sequence: randomBytes(12).toString("hex"),
    action,
    at: Date.now(),
  };
  atomicWriteJson(paths.control, control);
  return control;
}

export function truncateUtf8(value: string, maxBytes = MAX_AGENT_SUMMARY_BYTES): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const suffix = "\n[summary truncated]";
  const budget = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
  let bytes = Buffer.from(value, "utf8").subarray(0, budget);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let prefix = "";
  while (bytes.length) {
    try { prefix = decoder.decode(bytes); break; }
    catch { bytes = bytes.subarray(0, bytes.length - 1); }
  }
  return `${prefix}${suffix}`;
}

export function lastAssistantSummary(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const raw = messages[index];
    if (!raw || typeof raw !== "object") continue;
    const message = raw as { role?: string; content?: Array<{ type?: string; text?: string }> };
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) return truncateUtf8(text);
  }
  return "";
}

export function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
