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
      dependsOn: []
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

Only static object, array, and primitive literals are accepted. Imports, function calls, spreads, templates, and arbitrary JavaScript execution are rejected. Agents whose dependencies are satisfied run in parallel, with a global concurrency cap of four.

## Approval form

The form uses a two-column agent navigator and detail view on wide terminals, and stacks the same regions on narrow terminals. It provides structured controls for:

- workflow name and description;
- agent id, role, multiline prompt, and dependencies;
- role-narrowed tools and skills;
- ordered command override rules (`pattern → allow | ask | deny`);
- adding, deleting, navigating, and reordering agents.

Use **Tab/Shift+Tab** to move among Workflow, Agents, and Review, arrow keys to navigate controls, **Enter** to edit or toggle, **[ / ]** to change agents, **a** to add, **x** to delete, and **Ctrl+Up/Down** to reorder. Embedded multiline editors support terminal cursor/IME propagation.

The final Review shows dependency waves, resolved models and resources, and the effective command-policy composition. Approval is disabled while draft, role/resource, DAG, output-reference, or policy errors remain. On approval the draft is serialized into canonical static source, then `resolveWorkflow` and runtime model/tool/skill validation run again before execution.

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
permissions:
  commands:
    "*": deny
    "git": ask
    "git status": allow
    "git diff *": allow
    "rg *": allow
---
Role-specific system prompt.
```

A workflow agent may provide narrower `tools`, `skills`, and `permissions.commands`. Tool and skill additions are rejected. Dynamic command policy is intersected with the role policy, so it cannot elevate a denied or ask-only command.

## Command safety

Every Bash command is passed as a direct argument to the locally installed:

```sh
cc-safety-net explain --json <command>
```

The subprocess runs in strict mode. Its structured parse supplies the command segments used by the workflow allowlist. Analysis failure, malformed JSON, invalid configuration, or unsupported dynamic tokens fail closed.

When the workflow policy says `ask`, or CC Safety Net blocks an otherwise allowed command, the user can:

- **Allow once** — scoped to that call and recorded in the run artifact.
- **Edit command** — both policies are run again on the edited command.
- **Deny**.

Parallel prompts are serialized. Headless runs cannot approve commands.

Workflow children filter out CC Safety Net's stock Pi extension because its independent block result cannot be overridden after approval. The dependency is used through its CLI only; other global extensions remain available subject to the child's tool allowlist.

## Observability

Use `/workflows` to list runs from the current Pi session and inspect agent state, current activity, results, errors, and permission decisions. A footer indicator is shown while runs are active.

Artifacts are written with restrictive permissions under:

```text
~/.pi/agent/dynamic-workflows/<runId>/
├── workflow.js
└── run.json
```

Esc aborts the parent tool and its active children. Failed dependencies cause descendants to be skipped while unrelated branches continue.
