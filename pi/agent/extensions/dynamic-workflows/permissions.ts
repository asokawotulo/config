import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionDecisionRecord } from "./types.ts";

const execFileAsync = promisify(execFile);
const SAFETY_NET_BIN = resolve(dirname(fileURLToPath(import.meta.url)), "../../node_modules/.bin/cc-safety-net");

interface ExplainResult {
  result: "allowed" | "blocked";
  reason?: string;
  segment?: string;
  configValid?: boolean;
}

export class PermissionApprovalQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export async function explainCommand(command: string, cwd: string, signal?: AbortSignal): Promise<ExplainResult> {
  const execution = await execFileAsync(SAFETY_NET_BIN, ["explain", "--json", command], {
    cwd,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: 15_000,
    signal,
    env: { ...process.env, CC_SAFETY_NET_STRICT: "1" },
  });
  let result: ExplainResult;
  try { result = JSON.parse(execution.stdout) as ExplainResult; }
  catch { throw new Error("CC Safety Net returned malformed JSON"); }
  if ((result.result !== "allowed" && result.result !== "blocked") || result.configValid === false) {
    throw new Error(result.configValid === false ? "CC Safety Net configuration is invalid" : "CC Safety Net returned an invalid verdict");
  }
  return result;
}

function suggestions(reason: string): string[] {
  const lower = reason.toLowerCase();
  if (lower.includes("git clean")) return ["Preview first: git clean -nd"];
  if (lower.includes("git push") && lower.includes("force")) return ["Prefer: git push --force-with-lease"];
  if (lower.includes("find") && lower.includes("delete")) return ["Replace -delete with -print to preview matches"];
  if (lower.includes("reset --hard")) return ["Inspect first: git status", "Preserve work: git stash push -u"];
  if (lower.includes("rm -rf")) return ["List the target first and remove only specific paths"];
  return [];
}

export interface AuthorizeCommandOptions {
  command: string;
  cwd: string;
  agentId: string;
  ctx: ExtensionContext;
  queue: PermissionApprovalQueue;
  signal?: AbortSignal;
  record: (decision: PermissionDecisionRecord) => void;
}

function log(options: AuthorizeCommandOptions, command: string, record: Omit<PermissionDecisionRecord, "at" | "agentId" | "command">) {
  options.record({ at: Date.now(), agentId: options.agentId, command, ...record });
}

async function promptDecision(
  options: AuthorizeCommandOptions,
  title: string,
  message: string,
): Promise<"allow" | "edit" | "deny"> {
  if (!options.ctx.hasUI) return "deny";
  return options.queue.run(async () => {
    const choice = await options.ctx.ui.select(`${title}\n\n${message}`, ["Allow once", "Edit command", "Deny"]);
    return choice === "Allow once" ? "allow" : choice === "Edit command" ? "edit" : "deny";
  });
}

/** Returns the approved (possibly edited) command, or a block reason. */
export async function authorizeCommand(options: AuthorizeCommandOptions): Promise<{ command?: string; block?: string }> {
  let command = options.command;
  while (true) {
    let explained: ExplainResult;
    try {
      explained = await explainCommand(command, options.cwd, options.signal);
    } catch (error) {
      const reason = `Command denied because CC Safety Net analysis failed: ${error instanceof Error ? error.message : String(error)}`;
      log(options, command, { source: "cc-safety-net", action: "deny", reason });
      return { block: reason };
    }

    if (explained.result === "allowed") {
      log(options, command, { source: "cc-safety-net", action: "allow", reason: "CC Safety Net allowed the command" });
      return { command };
    }

    const reason = explained.reason ?? "Blocked by CC Safety Net";
    const hints = suggestions(reason);
    const message = [command, `Reason: ${reason}`, explained.segment ? `Segment: ${explained.segment}` : "", ...hints].filter(Boolean).join("\n\n");
    const decision = await promptDecision(options, "CC Safety Net blocked this command", message);
    if (decision === "edit") {
      const edited = await options.queue.run(() => options.ctx.ui.editor("Edit command (it will be re-analysed)", command));
      if (edited === undefined || !edited.trim()) {
        const editReason = edited === undefined ? "Command edit cancelled" : "Command edit was blank";
        log(options, command, { source: "cc-safety-net", action: "deny", reason: editReason });
        return { block: editReason };
      }
      command = edited.trim();
      continue;
    }
    if (decision === "deny") {
      log(options, command, { source: "cc-safety-net", action: "deny", reason, segment: explained.segment });
      return { block: `BLOCKED by CC Safety Net: ${reason}` };
    }
    log(options, command, { source: "cc-safety-net", action: "allow", reason, segment: explained.segment, overridden: true });
    return { command };
  }
}
