# agent

The shell uses Homebrew Pi. Local Pi libraries are development dependencies for extension typechecking and tests, not the shell's CLI installation. The brace-expansion override keeps nested copies on Pi 1.1.0's security fix.

## Development

Install dependencies and run checks from this directory:

```sh
bun install --ignore-scripts
bun run check
bun test
```

`settings.json` selects the main model, thinking level, theme, fullscreen UI, and compaction behavior. It loads Fabric and FFF as Pi packages. The local session manager and Supacode-managed extension are excluded. `pi update --extensions` reconciles the configured packages. Pi supplies host peers to packages rather than installing duplicate Pi libraries under `npm/`.

## Tool workflow

Use `/skill:tool-workflow` for bounded codemode batches, large-result filtering, and recovery after a partially applied edit batch. The skill is also available for automatic discovery. Worker role files request it, but callers must apply those roles explicitly.

For an opt-in medium-thinking trial on extraction or drafting, start a new task with `pi --thinking medium`. Keep high thinking for security review, migration decisions, and integration debugging. Compare correctness, follow-up fixes, recorded cost, and completion time before changing defaults or trying another provider.

Supacode 0.10.8 uses an older embedded libghostty with OSC 3008 patches. Keep the Supacode integration and leave `PI_PROGRAM_STATUS` unset until its embedded terminal and UI support OSC 7501.

## Fabric

`fabric.json` uses TypeScript/QuickJS in orchestration-only mode, with `fullCodeMode: false`. Pi tools and local extension tools keep their native execution path. `ask_user` remains visible; `fabric_exec` orchestrates Fabric providers and workers.

Read, write, execute, network, and agent approval categories are configured to allow. Tool risk declarations classify questionnaires as read operations and Firecrawl tools as network operations. One-shot run artifacts are retained for seven days. Pi handles compaction.

Workers use Pi in separate processes with extensions enabled, medium thinking, and a maximum of four concurrent workers. Their default tools are `read`, `grep`, `find`, and `ls`. Add mutation or shell tools explicitly for implementation workers. Reviewers that need higher reasoning should request `thinking: "high"`. Partition concurrent edits by file or use worktrees. The files in `roles/` describe worker roles; Fabric does not enforce them.

Use `/fabric` for activity and child conversations. Use `/skill:fabric-workflow` for an explicitly requested workflow. Advanced Fabric skills remain user-invoked; do not copy their implementation into local skills.

Use FFF's native `find` and `grep` tools for search and Pi's native `read` tool for file contents. `pi.*` and `extensions.*` are unavailable inside `fabric_exec` in orchestration-only mode. FFF cursors belong to their originating process; do not transfer them between workers. Leave `PI_FFF_MULTIGREP` unset unless specifically testing that opt-in tool. Keep FFF mode `override`; a resumed session's saved `/fff-mode` can override startup settings.

Fabric recall returns historical evidence, not proof about current files. Follow source pointers and verify the current working tree before acting on an earlier conclusion.

## Native MCP

`mcp.json` contains no servers, and Fabric's `mcp.nativeServers` selection is empty.

Add servers with `pi mcp add`, then check them with `pi mcp list`. Add their exact names to `mcp.nativeServers` in `fabric.json` to use Pi-owned connections through Fabric's `mcp.<server>.<tool>` API. Run `/reload` for native server changes and `/fabric reload` for the Fabric selection. Pi owns authentication through `/mcp login`. Keep credentials in environment variables or a secret manager, never as literal tracked JSON values.

## Extensions

- `ask-user`: native questionnaires.
- `firecrawl`: web search/scraping and shared cache, classified as Fabric network operations.
- `session-manager`: temporarily disabled while trying Pi's native `/resume` selector. Its custom deletion gestures and implementation remain intact.
- `supacode-integration`: user-owned presence and notifications. Cancelled runs reset presence without sending completion alerts. The app-managed `supacode/index.ts` is excluded so it cannot send duplicate events.
- `ui-customization`: session metadata, Fabric worker activity, and deduplicated Main/Subagent costs. Incomplete coverage is labeled Reported.
- `custom-markdown-code-blocks`: response diff fences and shared side-by-side rendering.
- `@ff-labs/pi-fff`: search overrides and file completion.

`tool-diffs` has been removed. Markdown diff fences still use `lib/side-by-side-diff/`.

Press `Ctrl+L` or run `/resume` to try the native session manager. It supports rename with `Ctrl+R` and delete with `Ctrl+D`, followed by confirmation. To restore the custom manager, remove `-extensions/session-manager/index.ts` from `settings.json` and remove `app.session.resume` from `keybindings.json`, then run `/reload`.

Supacode can recreate `extensions/supacode/index.ts`; that directory is ignored by Git and its entry point stays excluded in `settings.json`. Keep custom changes in `extensions/supacode-integration/`, without the app's managed-file marker.

The sidebar shows workers, costs, current tools, timing, model/thinking, call counts, and actor ownership. Worker input/output and cache rows are omitted until reliable metrics are available. A public Fabric component polls metadata without model turns; compact custom entries preserve costs across resume. `bun test extensions/ui-customization/fabric-cost*.test.ts` checks the ledger. Missing history or unverified runner attribution is labeled incomplete rather than counted as zero.

`ui.widget: "hidden"` hides the duplicate above-editor Fabric widget. The dashboard and child conversations remain enabled.

## Shared UI

Reusable extension UI belongs in `shared/ui/`. Keep dialog framing, overlay defaults, and common lifecycle behavior there; keep extension-specific state and actions inside each extension directory.

Custom dialogs should use the shared dialog frame and `showDialog` overlay helper so backgrounds, borders, spacing, hints, configurable navigation keys, and once-only user notifications stay consistent.
