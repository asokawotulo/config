import {
  createEditToolDefinition,
  createWriteToolDefinition,
  type EditToolDetails,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as Diff from "diff";
import {
  renderError,
  renderMutationHeader,
  renderStatus,
  ToolDiffComponent,
  type WriteDiffDetails,
} from "./render.ts";

const EDIT_COLLAPSED_ROWS = 60;
const WRITE_COLLAPSED_ROWS = 150;

function writePatch(path: string, before: string, after: string): string {
  return Diff.createTwoFilesPatch(path, path, before, after, undefined, undefined, {
    context: 4,
    headerOptions: Diff.FILE_HEADERS_ONLY,
  });
}

export default function toolDiffsExtension(pi: ExtensionAPI): void {
  // Register during extension loading so Pi's reload path sees these renderers
  // before it reconstructs historical ToolExecutionComponents.
  const edit = createEditToolDefinition(process.cwd());
  pi.registerTool({
    ...edit,
    async execute(toolCallId, params, signal, onUpdate, executionContext) {
      return createEditToolDefinition(executionContext.cwd).execute(
        toolCallId,
        params,
        signal,
        onUpdate,
        executionContext,
      );
    },
    renderCall(args, theme, context) {
      return renderMutationHeader("edit", args, theme, context.lastComponent);
    },
    renderResult(result, { expanded }, theme, context) {
      if (context.isError) return renderError(result, theme);
      const details = result.details as EditToolDetails | undefined;
      if (!details?.patch) return renderStatus(result, theme);
      return new ToolDiffComponent(
        details.patch,
        typeof context.args.path === "string" ? context.args.path : "",
        theme,
        expanded ? undefined : EDIT_COLLAPSED_ROWS,
      );
    },
  });

  const write = createWriteToolDefinition(process.cwd());
  pi.registerTool({
    ...write,
    async execute(toolCallId, params, signal, onUpdate, executionContext) {
      let before: string | null | undefined;
      const delegated = createWriteToolDefinition(executionContext.cwd, {
        operations: {
          async mkdir(path) {
            await mkdir(path, { recursive: true });
          },
          async writeFile(path, content) {
            try {
              before = await readFile(path, "utf8");
            } catch (error) {
              before = (error as NodeJS.ErrnoException).code === "ENOENT" ? null : undefined;
            }
            await writeFile(path, content, "utf8");
          },
        },
      });
      const result = await delegated.execute(
        toolCallId,
        params,
        signal,
        onUpdate,
        executionContext,
      );

      let details: WriteDiffDetails;
      if (before === undefined) {
        details = { kind: "snapshot-unavailable", path: params.path };
      } else if ((before ?? "") === params.content) {
        details = { kind: "no-change", path: params.path, created: before === null };
      } else {
        details = {
          kind: "diff",
          path: params.path,
          patch: writePatch(params.path, before ?? "", params.content),
          created: before === null,
        };
      }
      return { ...result, details };
    },
    renderCall(args, theme, context) {
      return renderMutationHeader("write", args, theme, context.lastComponent);
    },
    renderResult(result, { expanded }, theme, context) {
      if (context.isError) return renderError(result, theme);
      const details = result.details as WriteDiffDetails | undefined;
      if (details?.kind === "diff") {
        return new ToolDiffComponent(
          details.patch,
          details.path,
          theme,
          expanded ? undefined : WRITE_COLLAPSED_ROWS,
        );
      }
      if (details?.kind === "no-change") {
        return renderStatus(
          {
            content: [
              {
                type: "text",
                text: details.created ? "Created empty file" : "No changes",
              },
            ],
          },
          theme,
        );
      }
      return renderStatus(result, theme);
    },
  });
}
