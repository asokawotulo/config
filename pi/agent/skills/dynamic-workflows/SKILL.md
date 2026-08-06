---
name: dynamic-workflows
description: Designs and launches editable, statically declared DAGs of specialized Pi subagents with role-based tools, skills, command permissions, dependency ordering, and parallel execution. Use when a task benefits from multiple independent investigations, implementation/review phases, or explicit multi-agent coordination.
---

# Dynamic Workflows

Design a complete subagent graph, submit it through `dynamic_workflow`, and let the user review the structured approval form before anything runs.

## When to Use

Use a dynamic workflow when:

- two or more investigations can run independently in parallel;
- implementation should consume prior research or planning;
- a separate reviewer should verify completed work;
- isolated context windows improve focus;
- the user explicitly asks for subagents, a workflow, parallel agents, or multi-agent coordination.

Do not use a workflow for a small, localized task that the main agent can complete directly. Avoid creating agents whose work is trivial or substantially duplicated.

## Before Designing

1. Establish the outcome and useful verification boundary.
2. Inspect available roles when their capabilities are not already known:
   - global roles: `~/.pi/agent/roles/*.md`;
   - in this configuration repository: `pi/agent/roles/*.md`.
3. Respect each role's fixed model, tools, skills, prompt, and command policy.
4. Identify the smallest relevant file set before defining agents; avoid making every child rediscover the repository.
5. Decide which tasks are independent and which require earlier outputs.
6. Avoid parallel write-capable agents editing the same files. Prefer parallel read-only research followed by one implementation owner.

The standard roles currently provided are:

- `researcher`: read-only investigation and evidence gathering;
- `implementer`: focused file changes and verification;
- `reviewer`: read-only correctness and regression review.

Role files are authoritative if they differ from this summary.

## Required Workflow Shape

Call `dynamic_workflow` with exactly one static JavaScript declaration:

```js
export const workflow = {
  name: "short-workflow-name",
  description: "What the workflow accomplishes",
  agents: [
    {
      id: "research",
      role: "researcher",
      prompt: "Inspect the supplied files first. Explore further only if they are insufficient, and return concise concrete findings.",
      dependsOn: [],
      contextFiles: ["src/api.ts", "test/api.test.ts"],
      tools: ["read"],
      skills: []
    },
    {
      id: "implement",
      role: "implementer",
      prompt: "Implement the requested change using these findings:\n{{agents.research.output}}",
      dependsOn: ["research"]
    },
    {
      id: "review",
      role: "reviewer",
      prompt: "Review the implementation and report concrete issues:\n{{agents.implement.output}}",
      dependsOn: ["implement"],
      tools: ["read"],
      skills: []
    }
  ]
};
```

Only static object, array, string, number, boolean, and null literals are valid. Do not use imports, function calls, variables, spreads, template literals, callbacks, loops, or executable orchestration code.

## Agent Design Rules

Every agent requires:

- `id`: unique and stable; use letters, numbers, `_`, or `-`, beginning with a letter;
- `role`: the name of an existing role Markdown file;
- `prompt`: a self-contained task with explicit scope, ownership, constraints, and expected output;
- `dependsOn`: IDs that must complete successfully before this agent starts.

Optional fields:

- `contextFiles`: bounded worktree-relative files preloaded into the child context; identify these before launch and keep the set minimal;
- `tools`: a subset of the role's tools;
- `skills`: a subset of the role's skills;
- `permissions.commands`: a complete command-rule map containing `"*"`; it can only make the role policy stricter.

Agents whose dependencies are satisfied run in parallel, up to the extension's concurrency limit. Array order controls display and same-wave launch order, not dependency semantics.

## Output Handoffs

Reference prior results with:

```text
{{agents.AGENT_ID.output}}
```

An agent may only reference an agent it transitively depends on. Use output handoffs for concise findings, plans, implementation summaries, or review context. Dependent agents should still inspect the current files when correctness depends on repository state rather than trusting prose alone.

Do not create malformed or speculative placeholders. Renaming an agent in the approval form rewrites dependency and output references automatically.

## Permissions

Prefer least privilege:

- research/review agents usually need only `read`, or read-only search tools;
- implementation agents should own a disjoint set of files;
- omit `bash` when it is unnecessary;
- use `skills: []` when no skill is needed;
- provide `contextFiles` and tell the agent to use them first, exploring only when they are insufficient;
- workflow-level tools and skills cannot exceed the selected role.

Bash commands are checked by both the workflow command policy and `cc-safety-net explain --json`. An `ask` decision or CC Safety Net block opens a serialized user prompt with **Allow once**, **Edit command**, and **Deny**. Never design a workflow that depends on the user approving a destructive command.

## Approval and Execution

After calling `dynamic_workflow`:

1. The user receives a structured form rather than raw code by default.
2. They can edit metadata, agents, roles, prompts, dependencies, tools, skills, and command overrides.
3. The Review section must validate before approval.
4. Cancellation means no subagent runs; acknowledge it without immediately resubmitting.
5. During execution, the sidebar shows current-session workflows and subagent states.
6. `/workflows` shows persisted run details, results, errors, and permission decisions.

If a dependency fails, descendants are skipped while unrelated branches continue. Treat a partially failed workflow as evidence to inspect, not as automatic success.

## Recommended Patterns

### Parallel research, then synthesis

```text
research-a ─┐
            ├─ synthesis
research-b ─┘
```

Use for independent modules, competing hypotheses, or implementation/test reconnaissance.

### Research, implementation, review

```text
research → implement → review
```

Use when one implementation owner should consume evidence and a separate agent should assess the result.

### Parallel implementation

Only use when each implementer owns clearly disjoint files or modules. State file ownership in every prompt and add a later integration reviewer. Do not parallelize edits to shared manifests, lockfiles, generated files, or central types.

## Completion

After the workflow settles:

- summarize the run ID and overall status;
- report failed or skipped agents explicitly;
- synthesize results instead of merely repeating every agent output;
- run any final host-level integration checks that subagents intentionally did not run;
- remind the user that `/workflows` provides detailed observability when useful.
