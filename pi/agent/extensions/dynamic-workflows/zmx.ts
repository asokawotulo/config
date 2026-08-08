import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants, existsSync } from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import type { ResolvedAgentDefinition } from "./types.ts";

const execFileAsync = promisify(execFile);
export const SUPACODE_BUNDLED_ZMX = "/Applications/supacode.app/Contents/Resources/zmx/zmx";
const CHILD_HOST_PATH = join(dirname(fileURLToPath(import.meta.url)), "child-host.ts");

function executable(path: string): boolean {
  try { accessSync(path, constants.X_OK); return true; }
  catch { return false; }
}

export function resolveZmxExecutable(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const directory of (environment.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, "zmx");
    if (executable(candidate)) return candidate;
  }
  return executable(SUPACODE_BUNDLED_ZMX) ? SUPACODE_BUNDLED_ZMX : undefined;
}

export function selectedExecutionBackend(zmxPath: string | undefined): "zmx" | "pi" {
  return zmxPath ? "zmx" : "pi";
}

export const MAX_ZMX_SESSION_NAME_BYTES = 46;

export function collisionSafeZmxName(runId: string, agentId: string): string {
  const suffix = randomBytes(6).toString("hex");
  const prefix = "pi-";
  const separator = "-";
  const baseBudget = MAX_ZMX_SESSION_NAME_BYTES - prefix.length - separator.length - suffix.length;
  const safe = `${runId}-${agentId}`
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .slice(0, baseBudget);
  return `${prefix}${safe || "agent"}${separator}${suffix}`;
}

export function piInvocation(): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript] };
  }
  const runtimeName = basename(process.execPath).toLowerCase();
  return /^(node|bun)(\.exe)?$/.test(runtimeName)
    ? { command: "pi", args: [] }
    : { command: process.execPath, args: [] };
}

export function childPiArguments(agent: ResolvedAgentDefinition, projectTrusted: boolean): string[] {
  const args = [
    "--model", agent.resolvedRole.model,
    ...(agent.resolvedRole.thinking ? ["--thinking", agent.resolvedRole.thinking] : []),
    ...(agent.effectiveTools.length ? ["--tools", agent.effectiveTools.join(",")] : ["--no-tools"]),
    "--no-extensions", "--extension", CHILD_HOST_PATH,
    "--no-skills",
    ...agent.effectiveSkills.flatMap((skill) => ["--skill", join(getAgentDir(), "skills", skill, "SKILL.md")]),
    "--no-context-files",
    projectTrusted ? "--approve" : "--no-approve",
    "--name", `Workflow ${agent.id}`,
  ];
  return args;
}

export interface StartZmxChildOptions {
  zmxPath: string;
  sessionName: string;
  configPath: string;
  agent: ResolvedAgentDefinition;
  cwd: string;
  projectTrusted: boolean;
  invocation?: { command: string; args: string[] };
  execute?: typeof execFileAsync;
}

/** Start a normal detached interactive Pi TUI; no Supacode CLI or tab API is used. */
export async function startZmxChild(options: StartZmxChildOptions): Promise<void> {
  const invocation = options.invocation ?? piInvocation();
  const args = [
    "run", options.sessionName, "-d",
    "/usr/bin/env",
    `PI_DYNAMIC_WORKFLOW_CHILD_CONFIG=${options.configPath}`,
    invocation.command,
    ...invocation.args,
    ...childPiArguments(options.agent, options.projectTrusted),
  ];
  const execute = options.execute ?? execFileAsync;
  try {
    await execute(options.zmxPath, args, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 15_000,
    });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr).trim() : "";
    throw new Error(`Unable to start detached zmx child${stderr ? `: ${stderr}` : `: ${error instanceof Error ? error.message : String(error)}`}`);
  }
}

/** Stop Pi's renderer while zmx owns the terminal, then restore it on detach. */
export async function attachZmxSession(
  tui: TUI,
  zmxPath: string,
  sessionName: string,
  spawnProcess: typeof spawn = spawn,
  writeTerminal: (value: string) => unknown = (value) => process.stdout.write(value),
): Promise<void> {
  if (process.platform === "win32") throw new Error("zmx attach is not supported on Windows");
  if (!/^pi-[A-Za-z0-9_-]+$/.test(sessionName)) throw new Error("Invalid zmx session identity");

  tui.stop();
  writeTerminal("\x1b[?1000l\x1b[?1006l\x1b[2J\x1b[H");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawnProcess(zmxPath, ["attach", sessionName], { stdio: "inherit" });
      let settled = false;
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        if (code === 0) resolve();
        else reject(new Error(`zmx attach exited with status ${code ?? "unknown"}`));
      });
    });
  } finally {
    tui.start();
    writeTerminal("\x1b[?1000h\x1b[?1006h");
    tui.requestRender(true);
  }
}

export async function killZmxSession(zmxPath: string, sessionName: string): Promise<void> {
  if (!/^pi-[A-Za-z0-9_-]+$/.test(sessionName)) throw new Error("Invalid zmx session identity");
  await execFileAsync(zmxPath, ["kill", sessionName, "--force"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 10_000,
  });
}
