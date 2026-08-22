# Questionnaire design

Use this procedure before sending an `ask_user` questionnaire. It governs Pi questionnaire items, not free-form interview prompts or general surveys.

An item is ready only when an unfamiliar user can predict what every selection changes and gives up without repository knowledge.

## Build one item

Work through the gates in order. If an item fails a gate, return to that gate instead of patching later wording.

### 1. Verify the choice

Find every environmental fact and invariant that changes the available options. Inspect the filesystem, code, tools, or documentation yourself. Facts are the agent's responsibility; decisions belong to the user.

Discard and rebuild the item when new evidence changes its alternatives.

**Pass when:** Every option is possible under the verified constraints, and the question states each constraint the user needs to choose.

### 2. Isolate one decision

Ask one decision whose prerequisites are settled. Questions in the same `ask_user` call must be independent. If the answer to question A changes question B's options, defer B to the next round.

Split an item when it mixes:

- independent fields with an exclusive strategy;
- a product decision with its implementation detail;
- a current decision with a decision that depends on it.

Make each question self-contained. Avoid references such as "that distinction" which require the user to reconstruct earlier context.

**Pass when:** The user can answer the item without guessing another unsettled answer.

### 3. Choose the control

Use `single` when one selection rules out the others. Use `multiple` when selections can coexist.

Keep independent selections separate. For example, offer `Email` and `In-app alert` in a `multiple` question instead of adding an overlapping `Email and in-app alert` option. A bundle is valid only when its parts form one indivisible strategy.

For `multiple`, state the selection rule in the question, such as "Select every channel the first version should support."

**Pass when:** Every valid answer can be expressed once, without selecting incompatible options or choosing between artificial bundles.

### 4. Write the question

The question should state:

1. the decision and why it matters now;
2. the result the answer will change;
3. verified constraints that affect the choice;
4. the recommended option or selections and the main reason when a reasoned preference exists;
5. how many options to select when the control does not make that obvious.

Keep necessary technical terms, but define them through effects the user can observe. For example, "Dual write sends each change to both columns, so old and new application versions keep working."

Use a numbered, concrete tab label such as `3. Audit storage`. Keep the topic short enough to remain recognizable when the tab truncates it.

**Pass when:** The user understands the decision before reading every option.

### 5. Build the option set

Usually offer two to four practical alternatives. Use a fifth only when omitting it would hide a common, distinct choice. Pi adds a free-form answer, so the options do not need to enumerate rare cases.

Each option must:

- answer the same decision at the same level;
- have a short, neutral, distinct label;
- represent a realistic choice;
- avoid overlap with another option.

Put reasoned recommendations first and mark each label `(recommended)`. In a `single` question, put the nearest alternative directly after the recommendation. Order the remaining choices by a stable logic.

**Pass when:** The user can explain why each option exists and no two options represent the same answer.

### 6. Describe each option

State the visible result, main cost or failure risk, and key difference from the nearest alternative. One or two prose sentences are enough for an ordinary choice.

If no material cost exists under the stated constraints, say so or name the boundary that would change the conclusion. Do not invent a minor downside to make the options look symmetrical.

Use plain prose by default. Add short Markdown labels such as `**Result.**` and `**Cost.**` when a dense comparison becomes easier to scan. Use inline code for literal names.

**Pass when:** The description says what the user gets and gives up without hiding the tradeoff behind judgments such as "safer," "simpler," or "flexible."

### 7. Choose a representation

Use the form that preserves the difference the user must inspect:

| Subject of the decision | Representation |
| --- | --- |
| Connections, ordering, branches, fan-in, or dependencies | Mermaid |
| A screen, layout, spatial arrangement, or other visual state | ASCII mockup |
| Code, configuration, a diff, or rendered text | Exact fenced specimen |
| A simple result with no visual distinction | Prose |

A visual earns its space when prose would make the user imagine the deciding difference. It supplements the written result and cost; it does not replace them.

#### Match every option

When options differ visually, show a specimen for every option. Hold the source case, scope, labels, direction, and state constant so only the proposed result changes. Show the complete result rather than cropping context.

Vertical scrolling is acceptable. Keep the changed region in a consistent place or mark it clearly so the user can find the difference in one focused pass. Split the decision when comparison requires repeated searching through large outputs.

#### Mermaid

Put Mermaid in an option description with a fenced `mermaid` block. Keep nearby prose sufficient to explain the result and cost.

Pi renders a supported, warning-free diagram only when it fits the available description width. Invalid, warning-producing, unsupported, and oversized graphs appear as fenced source. If a graph is too wide:

1. shorten labels or change direction without removing meaningful content;
2. try a complete ASCII rendering when it preserves the relationship;
3. use prose when neither visual remains readable.

Prefer prose for a simple sequence. Use Mermaid when the relationship itself decides the choice.

#### ASCII and exact specimens

Use a fenced `text` block for an ASCII mockup. ASCII is not limited to terminal interfaces; use it for any distinct visual result that cannot be shown directly or expressed as a graph.

Use the exact source format for literal output, such as `diff`, `json`, `yaml`, or `markdown`. Use the same small input case in every option, but show its complete resulting output.

**Pass when:** The representation clarifies the existing decision, every option receives equal visual treatment, and the result remains understandable if Mermaid falls back to source.

### 8. Run the preflight

Before sending the `ask_user` call, verify all of the following:

- Environmental facts and prerequisites are settled.
- Questions in the call are independent.
- `single` and `multiple` match the valid selection relationships.
- The question explains the decision, effect, constraints, and any reasoned recommendations.
- Option labels are distinct, neutral, and ordered for comparison.
- Every description states the result, main cost or boundary, and key difference.
- Necessary jargon is defined through an observable effect.
- Markdown or a visual is present only when it improves comparison.
- Matched specimens preserve complete results and visual parity.
- An unfamiliar user can predict what every selection changes and gives up.

If the user reports confusion, leave the decision unsettled. Identify the missing context, rewrite the item from the user's viewpoint, and split any bundled decisions.

## Core specimens

These examples diagnose the common cases. They are not fixed templates.

### Replace a technique question with a visible result

Weak:

```json
{
  "questions": [
    {
      "id": "audit-storage",
      "label": "1. Audit storage",
      "question": "Which storage strategy should we use?",
      "type": "single",
      "options": [
        { "label": "Session persistence" },
        { "label": "In-memory storage" }
      ]
    }
  ]
}
```

Rewrite:

```json
{
  "questions": [
    {
      "id": "audit-storage",
      "label": "1. Audit storage",
      "question": "After Pi reloads a session, should blocked-command history still be available? I recommend keeping it with the session so earlier blocks remain explainable without mixing unrelated work.",
      "type": "single",
      "options": [
        {
          "label": "Current session (recommended)",
          "description": "History remains available after this session reloads. Each session keeps its own copy, so there is no view across all work."
        },
        {
          "label": "Memory only",
          "description": "History disappears when Pi exits. This stores less data, but an earlier block cannot be explained after restart."
        }
      ]
    }
  ]
}
```

The rewrite names the retained behavior and the boundary of each choice.

### Split independent selections

Weak:

```json
{
  "questions": [
    {
      "id": "failure-alerts",
      "label": "2. Failure alerts",
      "question": "How should users receive build failures?",
      "type": "single",
      "options": [
        { "label": "Email" },
        { "label": "In-app" },
        { "label": "Email and in-app" }
      ]
    }
  ]
}
```

Rewrite:

```json
{
  "questions": [
    {
      "id": "failure-alerts",
      "label": "2. Failure alerts",
      "question": "Which channels should users be able to enable for build failures? Select every channel the first version should support. I recommend email and in-app alerts because they cover users both away from and inside the product without mobile infrastructure.",
      "type": "multiple",
      "options": [
        {
          "label": "Email (recommended)",
          "description": "Reaches users away from the product and leaves a searchable record. Delivery may be delayed, and the system must manage addresses and unsubscribe rules."
        },
        {
          "label": "In-app alert (recommended)",
          "description": "Appears immediately for users with the product open and can link to the failed build. It cannot reach users who are offline."
        },
        {
          "label": "Push notification",
          "description": "Reaches opted-in mobile users quickly. Unlike the other channels, it requires device-token storage and mobile platform integration."
        }
      ]
    }
  ]
}
```

The control now permits each valid combination exactly once.

### Compare complete visual results with ASCII

Question: "How should the work queue show each job's status and retry count? I recommend a table because aligned values make several jobs faster to compare."

Option: `Aligned table (recommended)`

Result: Every job occupies one row with aligned values. Long values may require a wider view than cards.

```text
┌ Work queue ──────────────────────────────────────────┐
│Job       Status   Retries                            │
│JOB-41    Running  0                                  │
│JOB-42    Failed   2                                  │
└──────────────────────────────────────────────────────┘
```

Option: `Stacked cards`

Result: Each job gets a labeled block that fits narrow views. Comparing values across many jobs requires more vertical scanning than the table.

```text
┌ Work queue ──────────────────────────────────────────┐
│JOB-41                                                │
│Status: Running                                       │
│Retries: 0                                            │
│                                                      │
│JOB-42                                                │
│Status: Failed                                        │
│Retries: 2                                            │
└──────────────────────────────────────────────────────┘
```

Both mockups use the same width and complete job data. Only the proposed layout changes.

## Further examples

Read [`QUESTION-DESIGN-EXAMPLES.md`](QUESTION-DESIGN-EXAMPLES.md) when a draft has hidden constraints, necessary jargon, overlapping options, no material downside, dependent questions, or a matched Mermaid or exact-output comparison.
