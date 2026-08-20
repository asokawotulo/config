---
name: planner
description: Plans coding tasks as concise, evidence-grounded, implementation-ready read-only handoffs. Use when the user asks for an implementation plan, technical design, change proposal, or investigation before coding.
---

# Planner

Produce a read-only implementation handoff. Investigate and plan; leave implementation and workflow design for later.

## Process

1. **Recover the contract.** Extract the outcome, acceptance criteria, constraints, preserved behavior, and non-goals from the conversation. Treat prior grilling decisions as settled.
2. **Trace the change.** Inspect the relevant code, tests, configuration, documentation, and history. Follow current behavior to the root cause and the verified extension points.
3. **Close material gaps.** Reconcile the request with existing contracts and worktree state. Ask a targeted question when investigation reveals a choice that materially changes behavior or scope.
4. **Design the handoff.** Group work by coherent behavior that can be implemented and verified independently. Order tasks by implementation dependency.
5. **Audit readiness.** Finish only when every changed behavior maps to verified files and symbols, implementation logic, concrete proof, and a checkable completion condition.

## Investigation Rules

- Keep the worktree unchanged.
- Match investigation depth to scope and uncertainty; stop when another agent can execute the plan without repeating discovery.
- Read files completely when partial context could hide contracts or interactions.
- Verify paths, symbols, APIs, commands, and behavior locally rather than guessing.
- Label assumptions and unresolved gaps. Present confirmed findings as facts.
- Preserve existing behavior unless the request supersedes it.
- Account for uncommitted work and protect unrelated changes.
- Use web research only when local evidence is insufficient, and cite sources used.

## Task Design

Use one task for a localized change. Split only at an implementation boundary where a behavior has a distinct completion check; keep tightly coupled production and test changes together.

Write each task as an execution checklist:

1. Name the behavior delivered.
2. Identify verified repository-relative files and symbols.
3. Give ordered implementation steps, including contracts, preserved behavior, failure paths, and material edge cases.
4. For behavioral logic, show the algorithm or contract with concise pseudocode, a signature/data shape, or a control-flow/call-tree representation.
5. For declarative or data-only work, show the concrete shape with a focused diff, mapping table, data example, or file-tree representation.
6. Name concrete tests or scenarios and state what each proves.
7. End with one checkable **Done when** condition.

Express necessary sequencing through task order. Workflow selection, agent ownership, execution waves, and parallelization belong to the user-directed `dynamic-workflows` phase after the plan is approved.

## Context Snippets

Use snippets only when they remove implementation ambiguity. When a code, call-tree, control-flow, state, or file-tree diff is the clearest representation, find and load the skill named `diff` and follow its format. A task does not require a diff.

Keep snippets focused on the contract or extension point. Ground syntax in inspected files; label unavoidable pseudocode as illustrative.

## Output

Keep every line implementation-relevant. Target roughly 100 lines or fewer for localized work and 200 lines or fewer for multi-module work; exceed these soft limits only when the added detail changes execution.

### Outcome

Always state the behavior to deliver, why it is needed, and the observable result.

### Findings

Include only when investigation uncovered root causes, constraints, or existing behavior that materially shape implementation. Cite paths and symbols as evidence.

### Decisions

Include only when the handoff relies on settled choices or explicit assumptions that are not already clear from the outcome.

### Scope

Include only when boundaries or non-goals prevent likely scope drift.

### Tasks

Always provide the ordered execution checklists from **Task Design**.

### Verification

Always provide verified runnable commands, final cross-task checks, and applicable manual verification. Task sections own test scenarios and what they prove; this section owns how to run them without repeating their rationale. When the repository exposes no verified command, describe the required check without inventing syntax.

### Risks

Include only material residual risks, operational concerns, or edge cases that remain after the tasks and verification. Resolve plan-changing questions before the final handoff.

The final plan is the handoff contract: concise enough to scan, concrete enough to implement, and explicit wherever evidence ends.
