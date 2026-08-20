---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
source: https://github.com/mattpocock/skills
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is complete when the frontier is empty: every branch of the design tree has been visited and nothing remains silently assumed.

End with a reviewable handoff in this form:

```markdown
## Decisions

1. **Decision topic:** Settled choice and any boundary or non-goal that defines it.
2. **Decision topic:** Settled choice and any boundary or non-goal that defines it.
```

Account for every settled branch once. Keep rationale only when it is needed to interpret the choice. The decision list is the final response of the grilling session: return it directly in the main editor, without an `ask_user` completion check, implementation plan, workflow proposal, or action. The user owns the next turn and may correct decisions, invoke `/plan`, or request an implementation plan.