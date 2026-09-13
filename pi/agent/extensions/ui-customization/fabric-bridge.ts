import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
// Public package entry; Pi installs global packages under agent/npm, not agent/node_modules.
import {
  FABRIC_COMPONENT_DISCOVER_EVENT,
  FABRIC_COMPONENT_REGISTER_EVENT,
  readFabricToolResultProxyDetailsV1,
  type FabricComponentDefinition,
  type FabricComponentDiscovery,
} from "../../npm/node_modules/pi-fabric/dist/protocol.js";
import {
  FABRIC_SIDEBAR_ENTRY,
  FabricSidebarState,
  isRecord,
} from "./fabric-state.ts";

export const FABRIC_SIDEBAR_COMPONENT = "asoka.fabric-sidebar";
export function registerFabricSidebar(pi: ExtensionAPI, changed: () => void) {
  let state: FabricSidebarState | undefined;
  let current: ExtensionContext | undefined;
  let generation = 0;
  let lastSaved = "";
  let lastSaveAt = 0;
  const branch = (ctx: ExtensionContext) => ctx.sessionManager.getBranch();
  const persist = (force = false) => {
    if (!state || !current) return;
    const boundary = current.sessionManager.getLeafId();
    if (!boundary) return;
    const snapshot = state.checkpoint(boundary);
    if (!isRecord(snapshot)) return;
    const view = state.snapshot();
    const signature = JSON.stringify({
      workers: view.workers.map((w) => [w.id, w.runner, w.status, w.usage]),
      executions: view.executions,
      issues: view.issues,
    });
    if (signature === lastSaved || (!force && Date.now() - lastSaveAt < 30_000))
      return;
    pi.appendEntry(FABRIC_SIDEBAR_ENTRY, snapshot);
    lastSaved = signature;
    lastSaveAt = Date.now();
  };

  const component: FabricComponentDefinition = {
    name: FABRIC_SIDEBAR_COMPONENT,
    description: "Read-only Fabric worker metadata for the session sidebar",
    requires: ["agents.self", "agents.list"],
    guarantee: "managed",
    activate(context) {
      let disposed = false;
      let busy = false;
      const poll = async () => {
        if (
          disposed ||
          busy ||
          context.signal.aborted ||
          !state ||
          !current ||
          current.mode !== "tui"
        )
          return;
        const expected = state;
        const epoch = generation;
        busy = true;
        try {
          const self = await context.call("agents.self");
          if (
            !isRecord(self) ||
            self.kind !== "root" ||
            typeof self.rootId !== "string"
          )
            return;
          const [local, lineage] = await Promise.all([
            context.call("agents.list", { scope: "local" }),
            context.call("agents.list", { scope: "lineage" }),
          ]);
          if (
            disposed ||
            context.signal.aborted ||
            epoch !== generation ||
            expected !== state
          )
            return;
          expected.connected(self.rootId);
          expected.observeLive(local);
          expected.observeLive(lineage);
          changed();
          persist();
        } catch {
          if (!disposed && epoch === generation && expected === state) {
            expected.unavailable();
            changed();
          }
        } finally {
          busy = false;
        }
      };
      // Wait until component activation commits; no lifecycle calls from activate.
      const initial = setTimeout(() => void poll(), 0);
      const timer = setInterval(() => void poll(), 1_000);
      initial.unref?.();
      timer.unref?.();
      return () => {
        disposed = true;
        clearTimeout(initial);
        clearInterval(timer);
      };
    },
  };
  pi.events.emit(FABRIC_COMPONENT_REGISTER_EVENT, {
    version: 1,
    component,
    overwrite: true,
  });
  const unsubscribeDiscovery = pi.events.on(
    FABRIC_COMPONENT_DISCOVER_EVENT,
    (data) => {
      const discovery = data as FabricComponentDiscovery | undefined;
      if (discovery?.version === 1 && typeof discovery.register === "function")
        discovery.register(component, { overwrite: true });
    },
  );

  pi.on("session_start", (_event, ctx) => {
    generation++;
    current = ctx;
    state = new FabricSidebarState(ctx.sessionManager.getSessionId());
    state.hydrate(branch(ctx));
    lastSaved = "";
    lastSaveAt = Date.now();
    changed();
  });
  pi.on("session_tree", (_event, ctx) => {
    generation++;
    current = ctx;
    state = new FabricSidebarState(ctx.sessionManager.getSessionId());
    state.hydrate(branch(ctx));
    lastSaved = "";
    changed();
  });
  pi.on("tool_execution_start", (event, ctx) => {
    if (event.toolName !== "fabric_exec" || !state) return;
    current = ctx;
    state.execution(event.toolCallId, event.args);
    changed();
  });
  pi.on("tool_execution_update", (event) => {
    if (event.toolName !== "fabric_exec" || !state) return;
    state.execution(event.toolCallId, event.args, event.partialResult.details);
    state.ingestDetails(event.partialResult.details);
    changed();
  });
  pi.on("tool_result", (event, ctx) => {
    if (!state) return;
    current = ctx;
    const proxy = readFabricToolResultProxyDetailsV1(event.details);
    if (
      proxy &&
      event.toolCallId.startsWith("fabric_") &&
      proxy.ref === event.toolName &&
      ["agents.run", "agents.wait", "agents.spawn"].includes(proxy.ref)
    ) {
      state.observe(proxy.result);
      persist(true);
      changed();
    }
  });
  pi.on("message_end", (event, ctx) => {
    if (
      !state ||
      event.message.role !== "toolResult" ||
      event.message.toolName !== "fabric_exec"
    )
      return;
    current = ctx;
    state.execution(
      event.message.toolCallId,
      undefined,
      event.message.details,
      event.message.isError ? "failed" : "completed",
    );
    state.ingestDetails(event.message.details);
    persist(true);
    changed();
  });
  pi.on("agent_settled", (_event, ctx) => {
    current = ctx;
    persist(true);
  });
  pi.on("session_shutdown", () => {
    persist(true);
    generation++;
    state = undefined;
    current = undefined;
    unsubscribeDiscovery?.();
  });
  return { snapshot: () => state?.snapshot() };
}
