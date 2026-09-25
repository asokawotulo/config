import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { resolveGitMetadata, type GitMetadata } from "./git-metadata.ts";
import { SidebarLayoutAdapter, type InstallResult } from "./layout.ts";
import { buildSidebarMetadata } from "./metadata.ts";
import { SidebarComponent } from "./sidebar.ts";
import type { PendingGitRefresh } from "./types.ts";
import { registerFabricSidebar } from "./fabric-bridge.ts";

export default function uiCustomization(pi: ExtensionAPI) {
  let currentContext: ExtensionContext | undefined;
  let layoutAdapter: SidebarLayoutAdapter | undefined;
  let sidebar: SidebarComponent | undefined;
  let sidebarRequested = true;
  let compatibilityWarned = false;
  let restoreDefaultFooter: (() => void) | undefined;
  let deactivateFooter: (() => void) | undefined;
  let git: GitMetadata = { branchWorktree: "" };
  let gitRefreshGeneration = 0;
  let gitRefreshRunning = false;
  let pendingGitRefresh: PendingGitRefresh | undefined;

  const buildMetadata = () => {
    if (!currentContext) {
      throw new Error("ui-customization rendered after session shutdown");
    }
    return buildSidebarMetadata(pi, currentContext, git, fabric.snapshot());
  };

  const currentTheme = () => {
    if (!currentContext) {
      throw new Error("ui-customization themed after session shutdown");
    }
    return currentContext.ui.theme;
  };

  const reportLayoutResult = (
    result: InstallResult | undefined,
    ctx: ExtensionContext,
  ) => {
    if (result?.status !== "incompatible") return;
    if (!compatibilityWarned) {
      compatibilityWarned = true;
      ctx.ui.notify(
        `Sidebar disabled: ${result.reason}. Using Pi's default layout.`,
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

  const fabric = registerFabricSidebar(pi, refreshSidebar);

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
        if (request.generation !== gitRefreshGeneration || pendingGitRefresh) {
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
      let nextAdapter: SidebarLayoutAdapter | undefined;
      const nextSidebar = new SidebarComponent(
        buildMetadata,
        currentTheme,
        () =>
          nextAdapter?.getTranscriptHeight() ?? Math.max(1, tui.terminal.rows),
      );
      nextAdapter = new SidebarLayoutAdapter(tui, nextSidebar);
      layoutAdapter = nextAdapter;
      sidebar = nextSidebar;

      const deactivate = () => {
        active = false;
        nextSidebar.deactivate();
      };
      deactivateFooter = deactivate;

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
        if (!active || reconcileScheduled) return;
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
          if (!active) return;
          nextSidebar.invalidate();
          scheduleReconcile();
        },
        dispose(): void {
          deactivate();
          nextAdapter?.uninstall();
          if (deactivateFooter === deactivate) deactivateFooter = undefined;
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
    deactivateFooter?.();
    layoutAdapter?.uninstall();
    deactivateFooter = undefined;
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
    resetSessionState();
  });
}
