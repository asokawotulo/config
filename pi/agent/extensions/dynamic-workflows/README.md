# Dynamic Workflows

`dynamic_workflow` lets the parent model propose a complete static DAG of isolated Pi agents. A valid proposal opens directly in a structured approval form; invalid source opens in raw-source recovery. Nothing starts until the form is error-free and the user approves the final review.

## Workflow format

```js
export const workflow = {
  name: "inspect-implement-review",
  description: "Research in parallel, implement, then review",
  agents: [
    {
      id: "api-scout",
      role: "researcher",
      prompt: "Inspect the API implementation and report relevant files.",
      dependsOn: [],
      contextFiles: ["src/api.ts", "docs/api.md"]
    },
    {
      id: "test-scout",
      role: "researcher",
      prompt: "Inspect existing tests and report missing coverage.",
      dependsOn: []
    },
    {
      id: "worker",
      role: "implementer",
      prompt: "Implement the change using these findings:\n{{agents.api-scout.output}}\n{{agents.test-scout.output}}",
      dependsOn: ["api-scout", "test-scout"]
    },
    {
      id: "review",
      role: "reviewer",
      prompt: "Review the implementation result:\n{{agents.worker.output}}",
      dependsOn: ["worker"]
    }
  ]
};
```

Only static object, array, and primitive literals are accepted. Imports, function calls, spreads, templates, and arbitrary JavaScript execution are rejected. Agents whose dependencies are satisfied run in parallel, with a global concurrency cap of four. `{{agents.ID.output}}` remains the supported dependency syntax, but carries only that agent's final summary—not its transcript, tool calls, or session.

Each agent may declare `contextFiles`, an optional list of up to **16** worktree-relative paths. At approval/execution boundaries these resolve against the workflow cwd. Absolute/traversing paths, paths escaping through symlinks, missing or non-regular files, duplicate files, paths over 1,024 bytes, files over **131,072 bytes**, and a per-agent aggregate over **262,144 bytes** are rejected. Approved files are read once into a reusable bundle with path headings and explicit untrusted-content/soft-scope guidance; they are starting context, not a sandbox or instructions embedded in the files.

## Approval form

The form uses a two-column agent navigator and detail view on wide terminals, and stacks the same regions on narrow terminals. It provides structured controls for:

- workflow name and description;
- agent id, role, multiline prompt, dependencies, and one-path-per-line context files;
- role-narrowed tools and skills;
- adding, deleting, navigating, and reordering agents.

Use **Tab/Shift+Tab** to move among Workflow, Agents, and Review, arrow keys to navigate controls, **Enter** to edit or toggle, **[ / ]** to change agents, **a** to add, **x** to delete, and **Ctrl+Up/Down** to reorder. Embedded multiline editors support terminal cursor/IME propagation.

The final Review shows dependency waves, resolved models and resources, approved context paths and bounds, and the CC Safety Net command-inspection contract. Approval is disabled while draft, role/resource, DAG, or output-reference errors remain. On approval the draft is serialized into canonical static source, then `resolveWorkflow` and runtime model/tool/skill/context validation run again before execution.

Press **r** to use raw source explicitly. Raw mode is also the recovery path when the proposed source cannot be parsed; source must parse back into the structured form and pass the same review before it can run.

## Roles

Global roles are Markdown files in `~/.pi/agent/roles/*.md` (tracked here as `pi/agent/roles/*.md`):

```yaml
---
description: Reviews changes without modifying files
model: openai-codex/gpt-5.6-sol
thinking: high
tools: [read, grep, find, ls, bash]
skills: [diff]
---
Role-specific system prompt.
```

A workflow agent may provide narrower `tools` and `skills`; additions are rejected. Agent-level command policies are not supported.

## Command safety

Every Bash command is passed as a direct argument to the locally installed:

```sh
cc-safety-net explain --json <command>
```

The subprocess runs in strict mode and is the sole Bash/Shell command inspector. Allowed commands run automatically. Analysis failure, malformed JSON, or invalid configuration fails closed.

When CC Safety Net blocks a command, the parent alert includes the command, Safety Net's reason, and its blocked segment when available. The user can:

- **Allow once** — scoped to that call and recorded in the run artifact.
- **Edit command** — CC Safety Net analyzes the edited command again.
- **Deny**.

Parallel prompts are serialized. Headless runs cannot approve commands.

Workflow children use only the workflow child-host permission hook. For zmx children, every shell request crosses restrictive request/response artifacts to the same serialized parent approval queue; missing, malformed, timed-out, or aborted responses fail closed. The embedded fallback applies the identical broker in process. CC Safety Net is used through its CLI only.

## Execution backends and result isolation

When `zmx` is available on `PATH` (or at Supacode's bundled `/Applications/supacode.app/Contents/Resources/zmx/zmx`), every agent starts as a normal persistent interactive Pi TUI in a collision-safe detached `zmx run NAME -d ...` session. This does not invoke the Supacode CLI or create tabs. Parent completion follows the child-host's first settled status, so the idle Pi process remains attachable for inspection instead of being torn down when the workflow advances. Use `/workflows` → **Open agent**; Pi suspends its own TUI while zmx owns the terminal, and zmx's **Ctrl+\\** detach key returns to the parent TUI. Pi 0.84.1 does not expose safe pointer activation for docked extension components, so the session sidebar remains read-only. If zmx is absent, execution uses an embedded `AgentSession`; that process is disposed after completion, but its persistent JSONL transcript remains outside the parent conversation.

Approved context bundles are preloaded into each child's system context with an explicit instruction to use supplied files first and explore only when they are insufficient. Child transcripts, tool calls, and intermediate assistant messages never enter dependency placeholders, parent-facing progress, result content, or result details. `{{agents.ID.output}}` and final tool content use only bounded last non-empty assistant summaries; result details contain statuses and artifact references. Complete assistant, nested-tool, and summary-generation usage is aggregated into the parent tool result for Pi's normal token and cost accounting.

Whole-tool abort writes interrupt controls to every running child. Targeted `interrupt` invokes the selected child's abort context; `terminate` kills the selected zmx session. Use `/workflows` for keyboard-accessible Open, Interrupt, Terminate, and details actions.

## Observability

Use `/workflows` to list runs from the current Pi session and inspect agent state, current activity, results, errors, and permission decisions. Agent records keep `finalSummary`, persistent `session` metadata, `backend` identity, and complete pi-ai `usage` separate; persisted legacy `output` summaries remain readable. A footer indicator is shown while runs are active.

Shared events provide bounded run/state snapshots plus `dynamic-workflows:open-agent` and payload-free `dynamic-workflows:targeted-control` (`interrupt | terminate`) targets. Snapshots expose only sanitized per-agent total cost and optional zmx session identity in addition to status/timing labels. They never contain prompts, context contents, transcripts, tool arguments, permission commands, or approved workflow source.

Artifacts are written with restrictive permissions under:

```text
~/.pi/agent/dynamic-workflows/<runId>/
├── workflow.js
├── run.json
└── agents/<agentId>/
    ├── config.json
    ├── status.json
    ├── control.json
    └── permissions/{requests,responses}/
```

Esc aborts the parent tool and its active children. Failed dependencies cause descendants to be skipped while unrelated branches continue.
