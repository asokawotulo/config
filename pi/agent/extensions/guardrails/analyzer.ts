import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { MAX_GUARDRAIL_COMMAND_BYTES, type GuardrailStatus } from "./types.ts";

const execFileAsync = promisify(execFile);
export const SAFETY_NET_BIN = resolve(dirname(fileURLToPath(import.meta.url)), "../../node_modules/.bin/cc-safety-net");
const TIMEOUT_MS = 15_000;
const MAX_BUFFER = 2 * 1024 * 1024;

export interface GuardrailAnalysis {
  result: "allowed" | "blocked";
  reason?: string;
  segment?: string;
  ruleId?: string;
}

export interface GuardrailAnalyzer {
  analyze(command: string, cwd: string, signal?: AbortSignal): Promise<GuardrailAnalysis>;
  status(cwd: string, signal?: AbortSignal): Promise<GuardrailStatus>;
}

function validateCommand(command: string): void {
  if (!command.trim()) throw new Error("Shell command is empty");
  if (Buffer.byteLength(command, "utf8") > MAX_GUARDRAIL_COMMAND_BYTES) {
    throw new Error("Shell command is too large");
  }
}

function environment(): NodeJS.ProcessEnv {
  return { ...process.env, CC_SAFETY_NET_STRICT: "1" };
}

export function parseExplainResult(stdout: string): GuardrailAnalysis {
  let raw: unknown;
  try { raw = JSON.parse(stdout); }
  catch { throw new Error("CC Safety Net returned malformed JSON"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("CC Safety Net returned an invalid verdict");
  const result = raw as Record<string, unknown>;
  if (result.configValid === false) throw new Error("CC Safety Net configuration is invalid");
  if (result.result !== "allowed" && result.result !== "blocked") throw new Error("CC Safety Net returned an invalid verdict");
  for (const field of ["reason", "segment", "ruleId"] as const) {
    if (result[field] !== undefined && typeof result[field] !== "string") {
      throw new Error(`CC Safety Net returned an invalid ${field}`);
    }
  }
  return {
    result: result.result,
    ...(typeof result.reason === "string" ? { reason: result.reason } : {}),
    ...(typeof result.segment === "string" ? { segment: result.segment } : {}),
    ...(typeof result.ruleId === "string" ? { ruleId: result.ruleId } : {}),
  };
}

export class CliGuardrailAnalyzer implements GuardrailAnalyzer {
  constructor(readonly binary = SAFETY_NET_BIN) {}

  async analyze(command: string, cwd: string, signal?: AbortSignal): Promise<GuardrailAnalysis> {
    validateCommand(command);
    const execution = await execFileAsync(this.binary, ["explain", "--json", command], {
      cwd,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      timeout: TIMEOUT_MS,
      signal,
      env: environment(),
    });
    return parseExplainResult(execution.stdout);
  }

  async status(cwd: string, signal?: AbortSignal): Promise<GuardrailStatus> {
    try {
      await this.analyze("true", cwd, signal);
      const execution = await execFileAsync(this.binary, ["--version"], {
        encoding: "utf8",
        maxBuffer: MAX_BUFFER,
        timeout: TIMEOUT_MS,
        signal,
        env: environment(),
      });
      const version = execution.stdout.trim();
      if (!version) throw new Error("CC Safety Net returned an empty version");
      return { active: true, available: true, version, binary: this.binary };
    } catch (error) {
      return {
        active: true,
        available: false,
        binary: this.binary,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
