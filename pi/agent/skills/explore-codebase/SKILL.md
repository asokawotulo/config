---
name: explore-codebase
description: Explore and explain a local codebase from repository evidence.
disable-model-invocation: true
---

# Explore a codebase

Work read-only. Explain the current working tree as it exists, including relevant tracked and untracked changes. Use repository-local evidence only.

## Guardrails

- Use source search, file reads, repository metadata, local documentation, and Git inspection.
- Do not edit files or create artifacts.
- Do not run project code, tests, builds, typecheckers, formatters, generators, package managers, servers, or examples.
- Do not use web sources. Mark behavior owned by an external dependency or service as an external boundary.
- Do not quote credentials, tokens, private keys, or secret values. Cite the containing file and describe the value's role instead.

## 1. Establish the task

Take the text supplied after `/explore` as the exploration task. If it is empty, ask the user what they want to explore and stop.

Treat the current working directory as the target unless the task names another local repository. Find the repository root and load any governing agent instructions before exploring.

This step is complete when the task is non-empty, the target repository is known, and its governing instructions are loaded.

## 2. Build a map

Inspect repository metadata, manifests, local documentation, and the top-level layout. Identify:

- the repository's purpose and language or framework boundaries;
- source, test, configuration, generated, vendor, and build-output regions;
- likely entry points and implementation regions for the task;
- every materially different interpretation of the task that appears in the repository.

Use path and content search before broad directory traversal. After one or two useful searches, read the strongest matches and follow symbols from evidence rather than issuing many speculative searches.

Generated files, vendored dependencies, build output, and lockfiles belong on the map. Read inside them only when maintained source and configuration cannot explain behavior relevant to the task.

This step is complete when every material implementation is named with an entry point or strongest known location.

## 3. Trace behavior

Choose the branch that matches the task:

- **Repository orientation.** Explain purpose, major components, entry points, main runtime paths, and developer commands declared by the repository. Inspect commands but do not execute them.
- **Feature tracing.** Follow each relevant entry point through control flow, data flow, state, configuration, persistence, and external boundaries.
- **Concept explanation.** Find definitions, producers, consumers, lifecycle, and enforced invariants for the concept.

When a term matches several implementations, map all of them. Trace each far enough to establish its role, then deepen the paths needed to answer the task. Do not ask the user to choose among implementations discovered in the repository.

Record evidence as you work. For an important claim, capture the repository-relative path, symbol, and line range when available.

This step is complete when the requested behavior can be explained end to end and each material implementation or branch is accounted for at the depth needed by the task.

## 4. Cross-check central claims

Check central claims against directly related tests, configuration, and local documentation when those sources exist. Resolve contradictions by tracing the code that governs the current working tree. Use Git history only when the present files do not explain a relevant decision or behavior.

Inspect working-tree differences when they affect the task. Distinguish local behavior from `HEAD` in the report when the difference matters.

Label indirect conclusions as `Inference`. Label evidence gaps as `Unknown`. A missing second source is not an unknown when the implementation itself is direct and unambiguous.

This step is complete when central claims are supported, contradictions are resolved or exposed, and material unknowns are recorded.

## 5. Report

Write a concise synthesis with this fixed core:

```markdown
## Answer

## Execution path

## Evidence

## Open questions
```

Add task-specific sections only when they make the result easier to inspect. In the evidence section, cite locations as ``path/to/file.ext:line-line`` (`symbol`). Use a path and symbol without lines when line numbers are unavailable.

Include a compact file tree or Mermaid flow only when repository structure or branching behavior is difficult to follow in prose. Keep the report focused on findings. Omit the search diary and dead ends unless they change confidence in the answer.

The report is complete when it answers the task, shows the relevant path through the code, supports important claims with citations, and states all remaining open questions or says `None`.
