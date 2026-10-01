# agent

The shell uses Homebrew Pi. Local Pi libraries are development dependencies for extension typechecking and tests, not the shell's CLI installation.

## Development

Install dependencies and run checks from this directory:

```sh
bun install --ignore-scripts
bun run check
bun test
```

`settings.json` selects the main model, thinking level, theme, fullscreen UI, and compaction behavior. It loads Fabric and FFF as Pi packages and disables `tool-diffs`. `pi update --extensions` reconciles the configured packages. Pi supplies host peers to packages rather than installing duplicate Pi libraries under `npm/`.

## Fabric

`fabric.json` enables full code mode with TypeScript/QuickJS. The model sees only `fabric_exec`. Questionnaires and Firecrawl tools are captured along with other extension tools and are called through `extensions.ask_user` and `extensions.firecrawl_*` inside Fabric.

Read, write, execute, network, and agent approval categories are configured to allow. Captured questionnaires are classified as read operations and Firecrawl tools as network operations. One-shot run artifacts are retained for seven days. Pi handles compaction.

Workers use Pi in separate processes with extensions enabled, medium thinking, and a maximum of four concurrent workers. Their default tools are `read`, `grep`, `find`, and `ls`. Add mutation or shell tools explicitly for implementation workers. Reviewers that need higher reasoning should request `thinking: "high"`. Partition concurrent edits by file or use worktrees. The files in `roles/` describe worker roles; Fabric does not enforce them.

Use `/fabric` for activity and child conversations. Use `/skill:fabric-workflow` for an explicitly requested workflow. Advanced Fabric skills remain user-invoked; do not copy their implementation into local skills.

Use `pi.find` and `pi.grep` inside `fabric_exec` for FFF search. Fabric captures the overrides, extended schemas, and prompt guidance. `pi.read` remains Pi's reader. FFF cursors belong to their originating process; do not transfer them between workers. Leave `PI_FFF_MULTIGREP` unset unless specifically testing that opt-in tool. Keep FFF mode `override`; a resumed session's saved `/fff-mode` can override startup settings.

Fabric recall returns historical evidence, not proof about current files. Follow source pointers and verify the current working tree before acting on an earlier conclusion.

## Native MCP

`mcp.json` contains no servers, and Fabric's `mcp.nativeServers` selection is empty.

Add servers with `pi mcp add`, then check them with `pi mcp list`. Add their exact names to `mcp.nativeServers` in `fabric.json` to use Pi-owned connections through Fabric's `mcp.<server>.<tool>` API. Run `/reload` for native server changes and `/fabric reload` for the Fabric selection. Pi owns authentication through `/mcp login`. Keep credentials in environment variables or a secret manager, never as literal tracked JSON values.

## Extensions

- `ask-user`: questionnaires, called through Fabric.
- `firecrawl`: web search/scraping and shared cache, classified as Fabric network operations.
- `session-manager`: rename, delete, and resume Pi sessions.
- `supacode`: presence and notifications.
- `ui-customization`: session metadata, Fabric worker activity, and deduplicated Main/Subagent costs. Incomplete coverage is labeled Reported.
- `custom-markdown-code-blocks`: response diff fences and shared side-by-side rendering.
- `@ff-labs/pi-fff`: search overrides and file completion.

`tool-diffs` is present but disabled. Its native tests cover prompt metadata, mutation behavior, and historical replay; they do not certify Fabric's nested rendering. Markdown diff fences use the shared side-by-side renderer.

The sidebar shows workers, costs, current tools, timing, model/thinking, call counts, and actor ownership. Worker input/output and cache rows are omitted until reliable metrics are available. A public Fabric component polls metadata without model turns; compact custom entries preserve costs across resume. `bun test extensions/ui-customization/fabric-cost*.test.ts` checks the ledger. Missing history or unverified runner attribution is labeled incomplete rather than counted as zero.

`ui.widget: "hidden"` hides the duplicate above-editor Fabric widget. The dashboard and child conversations remain enabled.

## Shared UI

Reusable extension UI belongs in `shared/ui/`. Keep dialog framing, overlay defaults, and common lifecycle behavior there; keep extension-specific state and actions inside each extension directory.

Custom dialogs should use the shared dialog frame and `showDialog` overlay helper so backgrounds, borders, spacing, hints, configurable navigation keys, and once-only user notifications stay consistent.
