import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { minimatch } from "minimatch";
import { parse, quote, type ParseEntry } from "shell-quote";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionAction, PermissionDecisionRecord, ResolvedAgentDefinition } from "./types.ts";

const execFileAsync = promisify(execFile);
const SAFETY_NET_BIN = resolve(dirname(fileURLToPath(import.meta.url)), "../../node_modules/.bin/cc-safety-net");
const ACTION_WEIGHT: Record<PermissionAction, number> = { allow: 0, ask: 1, deny: 2 };

interface ExplainResult {
  result: "allowed" | "blocked";
  reason?: string;
  segment?: string;
  configValid?: boolean;
  trace?: { steps?: Array<{ type?: string; segments?: unknown }> };
}

export class PermissionApprovalQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function specificity(pattern: string): number {
  return pattern.replace(/[*?\[\]{}()!]/g, "").length * 10 + pattern.split(/\s+/).length;
}

export function matchCommandPolicy(command: string, rules: Record<string, PermissionAction>): { action: PermissionAction; pattern: string } {
  let winner: { action: PermissionAction; pattern: string; score: number; order: number } | undefined;
  let order = 0;
  for (const [pattern, action] of Object.entries(rules)) {
    const family = !/[\s*?\[\]{}()!]/.test(pattern) && (command === pattern || command.startsWith(`${pattern} `));
    const matched = family || minimatch(command, pattern, { dot: true, nocase: false });
    const candidate = { action, pattern, score: specificity(pattern), order: order++ };
    if (matched && (!winner || candidate.score > winner.score || (candidate.score === winner.score && candidate.order > winner.order))) winner = candidate;
  }
  return winner
    ? { action: winner.action, pattern: winner.pattern }
    : { action: "deny", pattern: "<implicit default deny>" };
}

function combine(left: PermissionAction, right: PermissionAction | undefined): PermissionAction {
  if (!right) return left;
  return ACTION_WEIGHT[left] >= ACTION_WEIGHT[right] ? left : right;
}

const COMMAND_SEPARATORS = new Set(["&&", "||", "|", "|&", ";", "&"]);
const UNSUPPORTED_OPERATORS = new Set(["(", ")", "<("]);

function hasUnclosedQuotes(command: string): boolean {
  let single = false;
  let double = false;
  let escaped = false;
  for (const character of command) {
    if (escaped) { escaped = false; continue; }
    if (character === "\\" && !single) { escaped = true; continue; }
    if (character === "'" && !double) single = !single;
    else if (character === '"' && !single) double = !double;
  }
  return single || double || escaped;
}

/** Preserve redirects in policy segments; CC Safety Net's trace intentionally omits them. */
function policySegments(command: string): string[] {
  if (hasUnclosedQuotes(command) || /`|\$\(|<\(|>\(/.test(command)) {
    throw new Error("Dynamic substitutions, process substitutions, and unclosed quotes are not supported by workflow command policies");
  }
  const entries = parse(command.replace(/[\r\n]+/g, " ; "), (name) => `$${name}`);
  const segments: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (!current.length) return;
    segments.push(current.join(" "));
    current = [];
  };
  for (const entry of entries as ParseEntry[]) {
    if (typeof entry === "string") { current.push(quote([entry])); continue; }
    if ("comment" in entry) continue;
    if (entry.op === "glob") { current.push(entry.pattern); continue; }
    if (COMMAND_SEPARATORS.has(entry.op)) { flush(); continue; }
    if (UNSUPPORTED_OPERATORS.has(entry.op)) throw new Error(`Unsupported shell operator ${entry.op}`);
    current.push(entry.op);
  }
  flush();
  if (!segments.length) throw new Error("Command contains no executable segments");
  return segments;
}

export async function explainCommand(command: string, cwd: string, signal?: AbortSignal): Promise<{ result: ExplainResult; segments: string[] }> {
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
  return { result, segments: policySegments(command) };
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
  agent: ResolvedAgentDefinition;
  ctx: ExtensionContext;
  queue: PermissionApprovalQueue;
  signal?: AbortSignal;
  record: (decision: PermissionDecisionRecord) => void;
}

function log(options: AuthorizeCommandOptions, record: Omit<PermissionDecisionRecord, "at" | "agentId" | "command">) {
  options.record({ at: Date.now(), agentId: options.agent.id, command: options.command, ...record });
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
    let explained: Awaited<ReturnType<typeof explainCommand>>;
    try {
      explained = await explainCommand(command, options.cwd, options.signal);
    } catch (error) {
      const reason = `Command denied because CC Safety Net analysis failed: ${error instanceof Error ? error.message : String(error)}`;
      log({ ...options, command }, { source: "cc-safety-net", action: "deny", reason });
      return { block: reason };
    }

    let policyAction: PermissionAction = "allow";
    const matches: string[] = [];
    for (const segment of explained.segments) {
      const roleMatch = matchCommandPolicy(segment, options.agent.resolvedRole.permissions.commands);
      const dynamicRules = options.agent.permissions?.commands;
      const dynamicMatch = dynamicRules ? matchCommandPolicy(segment, dynamicRules) : undefined;
      const action = combine(roleMatch.action, dynamicMatch?.action);
      if (ACTION_WEIGHT[action] > ACTION_WEIGHT[policyAction]) policyAction = action;
      matches.push(`${segment}: ${action} (role ${roleMatch.pattern}${dynamicMatch ? `, workflow ${dynamicMatch.pattern}` : ""})`);
    }

    if (policyAction === "deny") {
      const reason = `Denied by workflow command policy. ${matches.join("; ")}`;
      log({ ...options, command }, { source: "workflow-policy", action: "deny", reason });
      return { block: reason };
    }
    if (policyAction === "ask") {
      const decision = await promptDecision({ ...options, command }, "Workflow command requires permission", `${command}\n\n${matches.join("\n")}`);
      if (decision === "edit") {
        const edited = await options.queue.run(() => options.ctx.ui.editor("Edit command (it will be re-analysed)", command));
        if (edited === undefined || !edited.trim()) return { block: "Command edit cancelled" };
        command = edited.trim();
        continue;
      }
      if (decision === "deny") {
        log({ ...options, command }, { source: "workflow-policy", action: "deny", reason: "Denied by user" });
        return { block: "Command denied by user" };
      }
      log({ ...options, command }, { source: "workflow-policy", action: "allow", reason: matches.join("; "), overridden: true });
    }

    if (explained.result.result === "blocked") {
      const reason = explained.result.reason ?? "Blocked by CC Safety Net";
      const hints = suggestions(reason);
      const message = [command, `Reason: ${reason}`, explained.result.segment ? `Segment: ${explained.result.segment}` : "", ...hints].filter(Boolean).join("\n\n");
      const decision = await promptDecision({ ...options, command }, "CC Safety Net blocked this command", message);
      if (decision === "edit") {
        const edited = await options.queue.run(() => options.ctx.ui.editor("Edit command (it will be re-analysed)", command));
        if (edited === undefined || !edited.trim()) return { block: "Command edit cancelled" };
        command = edited.trim();
        continue;
      }
      if (decision === "deny") {
        log({ ...options, command }, { source: "cc-safety-net", action: "deny", reason, segment: explained.result.segment });
        return { block: `BLOCKED by CC Safety Net: ${reason}` };
      }
      log({ ...options, command }, { source: "cc-safety-net", action: "allow", reason, segment: explained.result.segment, overridden: true });
    } else {
      log({ ...options, command }, { source: "cc-safety-net", action: "allow", reason: "CC Safety Net allowed the command" });
    }
    return { command };
  }
}
