/**
 * User-owned Supacode + Pi integration. Keep this outside extensions/supacode/,
 * which Supacode rewrites. The app-managed copy is excluded in settings.json.
 *
 * Reports agent lifecycle and notifications to Supacode by emitting OSC 3008
 * escape sequences to the controlling terminal. The sequences are inert in any
 * terminal that does not handle OSC 3008, and reach Supacode over SSH too (no
 * local socket needed), matching the Claude / Codex / Kiro hook integrations.
 *
 * Required env var (injected automatically by Supacode on every surface):
 *   SUPACODE_SURFACE_ID  present only on a Supacode surface; absence is the
 *                        no-op gate. Signals are unauthenticated.
 * Optional:
 *   SUPACODE_SOCKET_PATH  present only on the local host; gates the local pid
 *                         so the app's liveness sweep can reap a crashed agent.
 *
 * Hook event mapping:
 *   extension load      -> session_start  (agent presence badge)
 *   Pi agent_start      -> busy
 *   Pi ui_prompt_start  -> idle while Pi waits for the user
 *   Pi ui_prompt_end    -> busy when agent work resumes
 *   Pi agent_settled    -> idle; non-aborted runs notify with last_assistant_message
 *   Pi session_shutdown -> session_end + idle (defensive activity reset)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { writeToTerminal } from "./terminal.ts";
import {
  SUPACODE_NOTIFICATION_EVENT,
  type SupacodeNotification,
} from "../../lib/supacode-events.ts";
import { utf8BytePrefix } from "../../lib/text.ts";

const AGENT = "pi";

type ActivityPresence = "busy" | "idle";
type PromptPhase = "start" | "end";

export interface PromptActivityTransition {
  waitingForUser: boolean;
  presence?: ActivityPresence;
}

/** Keep idle user-opened dialogs out of the agent activity state. */
export function promptActivityTransition(
  phase: PromptPhase,
  waitingForUser: boolean,
  agentIdle: boolean,
): PromptActivityTransition {
  if (phase === "start") {
    if (agentIdle || waitingForUser) return { waitingForUser };
    return { waitingForUser: true, presence: "idle" };
  }

  if (!waitingForUser) return { waitingForUser: false };
  return {
    waitingForUser: false,
    ...(agentIdle ? {} : { presence: "busy" as const }),
  };
}

function isSupacodeSurface(): boolean {
  const id = process.env["SUPACODE_SURFACE_ID"];
  return !!id && id.length > 0;
}

/**
 * The agent's local process id as an OSC pid suffix, but only on the local
 * host (SUPACODE_SOCKET_PATH is set). A remote pid over SSH would be
 * meaningless to the app's liveness sweep, so it is omitted there.
 */
function localPidSuffix(): string {
  return process.env["SUPACODE_SOCKET_PATH"] ? `;pid=${process.pid}` : "";
}

function emitPresence(event: string): void {
  const action = event === "session_end" ? "end" : "start";
  const meta = `event=${event}${localPidSuffix()}`;
  writeToTerminal(`\x1b]3008;${action}=${AGENT};${meta}\x1b\\`);
}

// JSON-escape (minus the surrounding quotes) so the wire matches the shell
// awk path, byte-cap to the same budget, then base64. App-side
// decodeNotifyValue reverses both and tolerates a mid-escape cut.
export function notifyField(value: string, budget: number): string {
  const escaped = JSON.stringify(value).slice(1, -1);
  return Buffer.from(utf8BytePrefix(escaped, budget), "utf8").toString(
    "base64",
  );
}

function emitNotification(content: SupacodeNotification): void {
  const meta =
    `kind=notify` +
    `;title=${notifyField(content.title ?? "", 160)}` +
    `;body=${notifyField(content.body ?? "", 1000)}`;
  writeToTerminal(`\x1b]3008;start=${AGENT};${meta}\x1b\\`);
}

function lastAssistantText(ctx: ExtensionContext): string | undefined {
  const entries = ctx.sessionManager.getBranch();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type !== "message") continue;
    if (entry.message.role !== "assistant") continue;

    const content = entry.message.content;
    if (!Array.isArray(content)) continue;

    const text = content
      .flatMap((block) => block.type === "text" ? [block.text] : [])
      .join("")
      .trim();

    if (text.length > 0) return text;
  }
  return undefined;
}

export default function (pi: ExtensionAPI) {
  // Not running under Supacode, or not a Supacode surface: stay inert.
  if (!isSupacodeSurface()) return;

  // Extension load = agent process running. Pi has no equivalent of
  // Claude's SessionStart hook, so we fire it ourselves.
  emitPresence("session_start");

  const unsubscribeNotification = pi.events.on(SUPACODE_NOTIFICATION_EVENT, (data) => {
    if (!data || typeof data !== "object") return;
    const content = data as SupacodeNotification;
    emitNotification({
      title: typeof content.title === "string" ? content.title : undefined,
      body: typeof content.body === "string" ? content.body : undefined,
    });
  });

  let waitingForUser = false;

  pi.on("agent_start", (_event, _ctx) => {
    waitingForUser = false;
    emitPresence("busy");
  });

  pi.on("ui_prompt_start", (_event, ctx) => {
    const transition = promptActivityTransition(
      "start",
      waitingForUser,
      ctx.isIdle(),
    );
    waitingForUser = transition.waitingForUser;
    if (transition.presence) emitPresence(transition.presence);
  });

  pi.on("ui_prompt_end", (_event, ctx) => {
    const transition = promptActivityTransition(
      "end",
      waitingForUser,
      ctx.isIdle(),
    );
    waitingForUser = transition.waitingForUser;
    if (transition.presence) emitPresence(transition.presence);
  });

  pi.on("agent_settled", (event, ctx) => {
    waitingForUser = false;
    // Atomic state-set: `idle` overwrites whatever was running on the
    // Supacode side only after retries and queued continuations have settled.
    emitPresence("idle");
    if (!event.aborted) emitNotification({ body: lastAssistantText(ctx) });
  });

  pi.on("session_shutdown", (_event, _ctx) => {
    unsubscribeNotification();
    waitingForUser = false;
    emitPresence("session_end");
    emitPresence("idle");
  });
}
