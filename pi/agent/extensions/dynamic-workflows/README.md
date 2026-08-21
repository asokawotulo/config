# Dynamic Workflows

`dynamic_workflow` lets the parent model propose a complete static DAG of isolated Pi agents. A valid proposal opens directly on a confirmation page; an invalid proposal returns a tool error to the parent model so it can correct and resubmit the complete workflow. Nothing starts until the proposal validates and the user confirms it.

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

## Confirmation

Valid proposals open directly on a read-only confirmation page. On wide terminals subagent details use roughly three quarters of the page on the left and a top-down Mermaid workflow graph uses the remaining quarter on the right; narrow terminals stack them. The page shows the workflow name and description plus a bordered field/value table for every agent's id, role, model and configured thinking level, full prompt, dependencies, effective tools and skills, and approved context paths. It also shows context bounds and the Guardrails command-inspection contract.

Pi's terminal Mermaid renderer draws the DAG with Unicode box art. If full agent labels do not fit the graph column, it renders a numbered top-down Mermaid graph with an agent legend; only widths too narrow for that use the wrapped dependency-edge fallback. Workflow information is never clipped.

The overlay is capped at 75% of terminal height so it stays clear of the editor; long tables and graphs remain accessible with **Up/Down** scrolling. Use **Enter** to run, **Space** to suggest a revision, and **Escape** to cancel. Suggest opens a multiline text field; **Enter** submits non-empty feedback, **Shift+Enter** inserts a line, and **Escape** returns to confirmation. Submission rejects the current proposal without launching agents and returns the feedback to the parent model, which must apply it and call `dynamic_workflow` again with a complete revised DAG.

Static source, role/resource, DAG, output-reference, model/tool/skill, and context validation complete before the confirmation page opens. A failure returns an errored tool result with the validation message to the parent model; the user is not asked to repair invalid source. On Run, canonical static source and runtime resources are validated again before execution. If that boundary fails because resources changed during confirmation, the dialog closes and the failure is returned to the parent model through the same errored tool result.

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

The standalone Guardrails extension owns CC Safety Net analysis, approval UI, serialization, and session audit records. Commands that CC Safety Net allows run automatically. A blocked command offers **Allow once**, **Edit command**, and **Deny** in the parent host. Edited commands are analyzed again. Headless runs and analysis failures fail closed.

Shell-capable workflows require an active Guardrails extension and pinned analyzer before confirmation. Read-only workflows do not.

Dynamic workflows owns child transport only. Embedded children use the shared Guardrails shell hook in process. Detached zmx children send commands through restrictive request/response artifacts to the parent Guardrails broker. Missing, malformed, timed-out, stale, or aborted responses fail closed. One parent FIFO queue serializes prompts across the main host and every child.

Guardrails stores blocked decision chains in the Pi session. Dynamic workflow `run.json` files retain the chains tagged for that run and agent. Clean commands that CC Safety Net allows automatically are not recorded.

## Execution backends and result isolation

When `zmx` is available on `PATH` (or at Supacode's bundled `/Applications/supacode.app/Contents/Resources/zmx/zmx`), every agent starts as a normal persistent interactive Pi TUI in a collision-safe detached `zmx run NAME -d ...` session. This does not invoke the Supacode CLI or create tabs. Parent completion follows the child-host's first settled status, so the idle Pi process remains attachable for inspection instead of being torn down when the workflow advances. Use `/workflows` → **Open agent**; Pi suspends its own TUI while zmx owns the terminal, and zmx's **Ctrl+\\** detach key returns to the parent TUI. Pi 0.84.2 does not expose safe pointer activation for docked extension components, so the session sidebar remains read-only. If zmx is absent, execution uses an embedded `AgentSession`; that process is disposed after completion, but its persistent JSONL transcript remains outside the parent conversation.

Approved context bundles are preloaded into each child's system context with an explicit instruction to use supplied files first and explore only when they are insufficient. Child transcripts, tool calls, and intermediate assistant messages never enter dependency placeholders, parent-facing progress, result content, or result details. `{{agents.ID.output}}` and final tool content use only the bounded text of each agent's final assistant message; a blank final assistant message fails settlement even when an earlier message was non-empty. Result details contain statuses and artifact references. Complete assistant, nested-tool, and summary-generation usage is aggregated into the parent tool result for Pi's normal token and cost accounting.

Whole-tool abort writes interrupt controls to every running child. Targeted `interrupt` invokes the selected child's abort context; `terminate` kills the selected zmx session. Use `/workflows` for keyboard-accessible Open, Interrupt, Terminate, and details actions.

## Observability

Use `/workflows` to list runs from the current Pi session and inspect agent state, current activity, results, errors, and Guardrails decisions. Agent records keep `finalSummary`, persistent `session` metadata, `backend` identity, and complete pi-ai `usage` separate; persisted legacy `output` summaries remain readable. A footer indicator is shown while runs are active.

Shared events provide bounded run/state snapshots plus `dynamic-workflows:open-agent` and payload-free `dynamic-workflows:targeted-control` (`interrupt | terminate`) targets. Snapshots expose only sanitized per-agent total cost and optional zmx session identity in addition to status/timing labels. They never contain prompts, context contents, transcripts, tool arguments, Guardrails commands, or approved workflow source.

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
