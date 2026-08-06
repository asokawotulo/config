import {
  CustomEditor,
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import {
  DYNAMIC_WORKFLOW_OPEN_AGENT_EVENT,
  DYNAMIC_WORKFLOW_RUN_EVENT,
  DYNAMIC_WORKFLOW_STATE_EVENT,
  DYNAMIC_WORKFLOW_STATE_REQUEST_EVENT,
  type DynamicWorkflowOpenAgentEvent,
  type DynamicWorkflowStateRequestEvent,
} from "../../lib/dynamic-workflow-events.ts";
import { PatchedLayout, resolvePi083Root } from "./layout.ts";
import {
  DISABLE_MOUSE_REPORTING,
  ENABLE_MOUSE_REPORTING,
  isMouseInput,
  parseLeftClick,
  parseScrollInput,
} from "./mouse.ts";
import {
  buildSidebarMetadata,
  DynamicWorkflowSidebarState,
  resolveGitMetadata,
  type GitMetadata,
} from "./metadata.ts";
import { ChatScrollState } from "./scroll-state.ts";
import { SidebarComponent } from "./sidebar.ts";

const SUPPORTED_PI_VERSION = "0.83.0";
const WHEEL_SCROLL_LINES = 3;

type Cleanup = () => void;

export default function uiCustomization(pi: ExtensionAPI) {
  let currentContext: ExtensionContext | undefined;
  let tui: TUI | undefined;
  let cleanup: Cleanup | undefined;
  let git: GitMetadata = { branchWorktree: "" };
  let gitRefreshGeneration = 0;
  let gitRefreshRunning = false;
  let gitRefreshPending = false;
  let warned = false;
  const workflows = new DynamicWorkflowSidebarState();

  const requestRender = () => tui?.requestRender();

  // Register bus listeners during extension setup so startup hydration cannot race them.
  pi.events.on(DYNAMIC_WORKFLOW_RUN_EVENT, (data) => {
    if (workflows.applyRun(data)) requestRender();
  });
  pi.events.on(DYNAMIC_WORKFLOW_STATE_EVENT, (data) => {
    if (workflows.applyState(data)) requestRender();
  });

  const refreshGit = async (ctx: ExtensionContext) => {
    currentContext = ctx;
    gitRefreshPending = true;
    if (gitRefreshRunning) return;

    gitRefreshRunning = true;
    try {
      while (gitRefreshPending) {
        gitRefreshPending = false;
        const generation = gitRefreshGeneration;
        const nextGit = await resolveGitMetadata(pi, ctx.cwd);
        if (generation !== gitRefreshGeneration) return;
        git = nextGit;
        requestRender();
      }
    } finally {
      gitRefreshRunning = false;
    }
  };

  const updateContext = (ctx: ExtensionContext, refreshRepository = false) => {
    currentContext = ctx;
    requestRender();
    if (refreshRepository) void refreshGit(ctx);
  };

  const uninstall = () => {
    gitRefreshGeneration += 1;
    gitRefreshPending = false;
    cleanup?.();
    cleanup = undefined;
    tui = undefined;
    currentContext = undefined;
  };

  const install = (nextTui: TUI, ctx: ExtensionContext): boolean => {
    const root = resolvePi083Root(nextTui);
    if (!root) {
      if (!warned) {
        warned = true;
        ctx.ui.notify(
          "ui-customization could not find the Pi 0.83.0 TUI layout; using the default UI.",
          "warning",
        );
      }
      return false;
    }

    uninstall();
    currentContext = ctx;
    tui = nextTui;
    git = { branchWorktree: "" };

    const scroll = new ChatScrollState();
    const sidebar = new SidebarComponent(
      () => {
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
      },
      () => ctx.ui.theme,
    );
    const layout = new PatchedLayout(nextTui, root, scroll, sidebar);
    const originalRender = nextTui.render;
    nextTui.render = (width: number) => layout.render(width);

    const stopInput = ctx.ui.onTerminalInput((data) => {
      const input = parseScrollInput(data);
      if (input) {
        if (input === "wheel-up") scroll.scrollBy(-WHEEL_SCROLL_LINES);
        else if (input === "wheel-down") scroll.scrollBy(WHEEL_SCROLL_LINES);
        else if (input === "page-up") scroll.scrollPage(-1);
        else scroll.scrollPage(1);

        nextTui.requestRender();
        return { consume: true };
      }

      const click = parseLeftClick(data);
      if (click) {
        const target = layout.hitTestSidebar(click.column, click.row);
        if (target) {
          const event: DynamicWorkflowOpenAgentEvent = target;
          // Dynamic Workflows owns suspend/attach/detach. The sidebar only
          // publishes the selected identity and never starts a process.
          pi.events.emit(DYNAMIC_WORKFLOW_OPEN_AGENT_EVENT, event);
        }
        return { consume: true };
      }
      return isMouseInput(data) ? { consume: true } : undefined;
    });

    nextTui.terminal.write(ENABLE_MOUSE_REPORTING);
    cleanup = () => {
      stopInput();
      nextTui.terminal.write(DISABLE_MOUSE_REPORTING);
      nextTui.render = originalRender;
    };

    void refreshGit(ctx);
    nextTui.requestRender(true);
    return true;
  };

  pi.on("session_start", (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    workflows.beginSession(sessionId);
    requestRender();
    const request: DynamicWorkflowStateRequestEvent = { sessionId };
    pi.events.emit(DYNAMIC_WORKFLOW_STATE_REQUEST_EVENT, request);

    if (ctx.mode !== "tui") return;

    if (VERSION !== SUPPORTED_PI_VERSION) {
      ctx.ui.notify(
        `ui-customization supports Pi ${SUPPORTED_PI_VERSION}; resolved ${VERSION}. Using the default UI.`,
        "warning",
      );
      return;
    }

    ctx.ui.setEditorComponent((nextTui, theme, keybindings) => {
      install(nextTui, ctx);
      return new CustomEditor(nextTui, theme, keybindings);
    });
  });

  pi.on("session_info_changed", (_event, ctx) => updateContext(ctx));
  pi.on("model_select", (_event, ctx) => updateContext(ctx));
  pi.on("thinking_level_select", (_event, ctx) => updateContext(ctx));
  pi.on("message_end", (_event, ctx) => updateContext(ctx));
  pi.on("turn_end", (_event, ctx) => updateContext(ctx));
  pi.on("session_compact", (_event, ctx) => updateContext(ctx));
  pi.on("input", (_event, ctx) => {
    updateContext(ctx, true);
    return { action: "continue" };
  });
  pi.on("tool_execution_end", (_event, ctx) => updateContext(ctx, true));
  pi.on("session_shutdown", () => {
    workflows.endSession();
    uninstall();
  });
}
