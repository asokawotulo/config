import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  DYNAMIC_WORKFLOW_RUN_EVENT,
  DYNAMIC_WORKFLOW_STATE_EVENT,
  DYNAMIC_WORKFLOW_STATE_REQUEST_EVENT,
  type DynamicWorkflowStateRequestEvent,
} from "../../lib/dynamic-workflow-events.ts";
import { resolveGitMetadata, type GitMetadata } from "./git-metadata.ts";
import { Pi0840SidebarLayoutAdapter } from "./layout.ts";
import { buildSidebarMetadata } from "./metadata.ts";
import { SidebarComponent } from "./sidebar.ts";
import type { PendingGitRefresh } from "./types.ts";
import { DynamicWorkflowSidebarState } from "./workflow-state.ts";

export default function uiCustomization(pi: ExtensionAPI) {
  let currentContext: ExtensionContext | undefined;
  let layoutAdapter: Pi0840SidebarLayoutAdapter | undefined;
  let sidebar: SidebarComponent | undefined;
  let sidebarRequested = true;
  let compatibilityWarned = false;
  let restoreDefaultFooter: (() => void) | undefined;
  let git: GitMetadata = { branchWorktree: "" };
  let gitRefreshGeneration = 0;
  let gitRefreshRunning = false;
  let pendingGitRefresh: PendingGitRefresh | undefined;
  const workflows = new DynamicWorkflowSidebarState();

  const buildMetadata = () => {
    if (!currentContext) {
      throw new Error("ui-customization rendered after session shutdown");
    }
    return buildSidebarMetadata(
      pi,
      currentContext,
      git,
      workflows.getVisibleRuns(),
      workflows.getRuns(),
    );
  };

  const currentTheme = () => {
    if (!currentContext) {
      throw new Error("ui-customization themed after session shutdown");
    }
    return currentContext.ui.theme;
  };

  const reportLayoutResult = (
    result: "installed" | "waiting" | "incompatible" | undefined,
    ctx: ExtensionContext,
  ) => {
    if (result !== "incompatible") return;
    if (!compatibilityWarned) {
      compatibilityWarned = true;
      ctx.ui.notify(
        "ui-customization could not safely install the Pi 0.84.x fullscreen layout; using Pi's default layout.",
        "warning",
      );
    }
    restoreDefaultFooter?.();
  };

  const refreshSidebar = () => {
    sidebar?.invalidate();
    const result = layoutAdapter?.setSidebarVisible(sidebarRequested);
    if (currentContext) reportLayoutResult(result, currentContext);
  };

  const toggleSidebar = (ctx: ExtensionContext) => {
    currentContext = ctx;
    if (ctx.mode !== "tui") {
      ctx.ui.notify(
        "The session sidebar requires interactive TUI mode",
        "warning",
      );
      return;
    }

    sidebarRequested = !sidebarRequested;
    const result = layoutAdapter?.setSidebarVisible(sidebarRequested);
    reportLayoutResult(result, ctx);
  };

  pi.registerShortcut("ctrl+b", {
    description: "Show or hide the session sidebar",
    handler: (ctx) => toggleSidebar(ctx),
  });

  pi.registerCommand("sidebar", {
    description: "Show or hide the session sidebar",
    handler: async (_args, ctx) => toggleSidebar(ctx),
  });

  // Register bus listeners during extension setup so startup hydration cannot race them.
  pi.events.on(DYNAMIC_WORKFLOW_RUN_EVENT, (data) => {
    if (workflows.applyRun(data)) refreshSidebar();
  });
  pi.events.on(DYNAMIC_WORKFLOW_STATE_EVENT, (data) => {
    if (workflows.applyState(data)) refreshSidebar();
  });

  const refreshGit = async (ctx: ExtensionContext) => {
    currentContext = ctx;
    pendingGitRefresh = {
      generation: gitRefreshGeneration,
      cwd: ctx.cwd,
    };
    if (gitRefreshRunning) return;

    gitRefreshRunning = true;
    try {
      while (pendingGitRefresh) {
        const request = pendingGitRefresh;
        pendingGitRefresh = undefined;
        const nextGit = await resolveGitMetadata(pi, request.cwd);
        if (
          request.generation !== gitRefreshGeneration ||
          pendingGitRefresh
        ) {
          continue;
        }
        git = nextGit;
        refreshSidebar();
      }
    } finally {
      gitRefreshRunning = false;
    }
  };

  const updateContext = (
    ctx: ExtensionContext,
    options: { refreshRepository?: boolean } = {},
  ) => {
    currentContext = ctx;
    refreshSidebar();
    if (options.refreshRepository) void refreshGit(ctx);
  };

  const installFooterAndLayout = (ctx: ExtensionContext) => {
    ctx.ui.setFooter((tui) => {
      let active = true;
      let reconcileScheduled = false;
      let restoreScheduled = false;
      let nextAdapter: Pi0840SidebarLayoutAdapter | undefined;
      const nextSidebar = new SidebarComponent(
        buildMetadata,
        currentTheme,
        () =>
          nextAdapter?.getTranscriptHeight() ?? Math.max(1, tui.terminal.rows),
      );
      nextAdapter = new Pi0840SidebarLayoutAdapter(tui, nextSidebar);
      layoutAdapter = nextAdapter;
      sidebar = nextSidebar;

      const scheduleDefaultFooterRestore = () => {
        if (restoreScheduled) return;
        restoreScheduled = true;
        queueMicrotask(() => {
          if (!active || layoutAdapter !== nextAdapter) return;
          ctx.ui.setFooter(undefined);
        });
      };
      restoreDefaultFooter = scheduleDefaultFooterRestore;

      const scheduleReconcile = () => {
        if (reconcileScheduled) return;
        reconcileScheduled = true;
        queueMicrotask(() => {
          reconcileScheduled = false;
          if (!active) return;
          reportLayoutResult(nextAdapter?.reconcile(), currentContext ?? ctx);
        });
      };

      reportLayoutResult(nextAdapter.reconcile(), ctx);
      reportLayoutResult(nextAdapter.setSidebarVisible(sidebarRequested), ctx);

      return {
        render(): string[] {
          // Avoid mutating Pi's canonical root in the middle of its layout pass.
          scheduleReconcile();
          return [];
        },
        invalidate(): void {
          nextSidebar.invalidate();
          scheduleReconcile();
        },
        dispose(): void {
          active = false;
          nextAdapter?.uninstall();
          if (layoutAdapter === nextAdapter) layoutAdapter = undefined;
          if (sidebar === nextSidebar) sidebar = undefined;
          if (restoreDefaultFooter === scheduleDefaultFooterRestore) {
            restoreDefaultFooter = undefined;
          }
        },
      };
    });
  };

  const resetSessionState = () => {
    gitRefreshGeneration += 1;
    pendingGitRefresh = undefined;
    layoutAdapter?.uninstall();
    layoutAdapter = undefined;
    sidebar = undefined;
    restoreDefaultFooter = undefined;
    sidebarRequested = true;
    currentContext = undefined;
    git = { branchWorktree: "" };
  };

  pi.on("session_start", (_event, ctx) => {
    currentContext = ctx;
    git = { branchWorktree: "" };
    sidebarRequested = true;
    const sessionId = ctx.sessionManager.getSessionId();
    workflows.beginSession(sessionId);
    const request: DynamicWorkflowStateRequestEvent = { sessionId };
    pi.events.emit(DYNAMIC_WORKFLOW_STATE_REQUEST_EVENT, request);
    if (ctx.mode === "tui") {
      installFooterAndLayout(ctx);
      void refreshGit(ctx);
    }
  });

  pi.on("session_info_changed", (_event, ctx) => updateContext(ctx));
  pi.on("model_select", (_event, ctx) => updateContext(ctx));
  pi.on("thinking_level_select", (_event, ctx) => updateContext(ctx));
  pi.on("agent_settled", (_event, ctx) => updateContext(ctx));
  pi.on("message_end", (_event, ctx) => updateContext(ctx));
  pi.on("turn_end", (_event, ctx) => updateContext(ctx));
  pi.on("session_compact", (_event, ctx) => updateContext(ctx));
  pi.on("session_tree", (_event, ctx) => updateContext(ctx));
  pi.on("input", (_event, ctx) => {
    updateContext(ctx, { refreshRepository: true });
    return { action: "continue" };
  });
  pi.on("tool_execution_end", (_event, ctx) => {
    updateContext(ctx, { refreshRepository: true });
  });
  pi.on("session_shutdown", () => {
    workflows.endSession();
    resetSessionState();
  });
}
