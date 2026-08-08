---
description: Design and propose a dynamic subagent workflow
argument-hint: "[task]"
---
${ARGUMENTS:-Use the current conversation's task, constraints, and any approved plan as the workflow objective. If no unambiguous objective is available, ask me what workflow should be created.}

Before responding, load the skill named `dynamic-workflows` and follow it exactly.
