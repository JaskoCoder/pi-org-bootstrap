---
name: ux-design-chain
description: "Triggers the 4-stage UI/UX design agent chain: UX Research → UI Design → Heuristic Evaluation → Iteration. Use when designing new UI features, redesigning pages, or creating design proposals. Produces structured design proposals stored in .agents/designs/ with Nielsen heuristic scores, WCAG compliance, and design system checks. Triggers on keywords: design the UI, redesign, create a design for, layout, UX for, design proposal, UI/UX, user interface, wireframe, mockup, heuristic evaluation."
---

# UX Design Chain Skill

Orchestrates the 4-stage UI/UX agent chain that transforms UI feature requests into
structured, evaluated design proposals ready for implementation.

## When to Load

This skill activates when the user's task involves:
- Designing new UI features ("design the UI for...", "create a design for...")
- Redesigning existing pages ("redesign the...", "improve the layout of...")
- UX analysis ("UX for...", "user experience of...", "evaluate the UI")
- Design proposals ("design proposal", "wireframe", "mockup", "UI/UX")

## Chain Overview

```
Research → Design → Evaluate → (Iterate or Approve) → Implement
```

The chain produces **4 artifacts** stored in `.agents/designs/`:

| Artifact | Path | Stage |
|----------|------|-------|
| Research Brief | `.agents/designs/research-brief-{issue}.md` | Stage 1 |
| Design Proposal | `.agents/designs/proposal-{issue}.md` | Stage 2 |
| Evaluation Report | `.agents/designs/evaluation-{issue}.md` | Stage 3 |
| Chain Status | `.agents/designs/status-{issue}.json` | All stages |

---

## Execution Protocol

### Prerequisites

1. Extract the **issue number** from the task. If none exists, create a GitHub issue first:
   ```
   gh issue create --title "ui/ux: [feature description]" --body "[description]" --label "type:feature,scope:ui-ux"
   ```
2. Ensure `.agents/designs/` directory exists: `mkdir -p .agents/designs`
3. Initialize the status file (see [Status File Format](#status-file-format))

### Stage 1: UX Research

**Delegate to:** The team responsible for UI/UX (typically `frontend-team`)

**Task:**
```
Research the UI/UX context for issue #{issue_number}.
Read the existing codebase to audit:
<!-- BOOTSTRAP:UI-COMPONENT-PATHS-START -->
  - Relevant components in the project's component directory
  - Tailwind/styling config and design tokens
  - Existing patterns for similar features
  - Current layout and navigation structure
<!-- BOOTSTRAP:UI-COMPONENT-PATHS-END -->
Produce a Research Brief at .agents/designs/research-brief-{issue}.md
```

**Gate:** Research Brief must exist and contain sections 1-7 (Current State, Design System Audit, User Flows, Accessibility Requirements, Competitive Analysis, Constraints, Recommendations).

### Stage 2: UI Design

**Delegate to:** The team responsible for UI/UX (typically `frontend-team`)

**Task (initial):**
```
Create a Design Proposal for issue #{issue_number}.
Read the Research Brief at .agents/designs/research-brief-{issue}.md.
Survey existing components and design tokens.
Design layout with specific CSS/utility classes, component inventory, interaction patterns,
accessibility plan, and responsive breakpoints.
Write the proposal to .agents/designs/proposal-{issue}.md
```

**Task (iteration — use this when revising):**
```
Revise the Design Proposal for issue #{issue_number} (iteration N).
Read the Research Brief: .agents/designs/research-brief-{issue}.md
Read the Evaluation: .agents/designs/evaluation-{issue}.md
Address ALL feedback from the evaluation. Increment iteration number.
Archive the current proposal to .agents/designs/proposal-{issue}-v{N-1}.md
Write revised proposal to .agents/designs/proposal-{issue}.md
```

**Gate:** Design Proposal must exist with all 10 sections (Overview, Layout Spec, Component Inventory, Interaction Patterns, Typography & Color, Accessibility Plan, Responsive Breakpoints, Design Tokens, Implementation Notes, Visual Reference).

### Stage 3: UX Evaluation

**Delegate to:** The team responsible for UI/UX (typically `frontend-team`)

**Task:**
```
Evaluate the Design Proposal for issue #{issue_number}.
Read the proposal: .agents/designs/proposal-{issue}.md
Read the research brief: .agents/designs/research-brief-{issue}.md
Score against:
  - Nielsen's 10 Usability Heuristics (1-5 each)
  - WCAG 2.1 AA compliance (15 criteria)
  - Design system compliance (10 checks)
  - Responsive design (5 checks)
Compute overall score = (Nielsen_Avg × 0.4) + (WCAG_Rate × 5 × 0.3) + (DesignSystem_Rate × 5 × 0.3)
Write evaluation to .agents/designs/evaluation-{issue}.md
Update status file at .agents/designs/status-{issue}.json
```

**Gate (Approval Criteria):**
- Overall score ≥ 3.5 / 5.0
- No critical issues (blockers)
- WCAG pass rate = 100% (all 15 criteria pass)

### Stage 4: Iteration or Approval

```
Read .agents/designs/evaluation-{issue}.md
Extract the verdict:
  - APPROVED → proceed to implementation delegation
  - NEEDS_ITERATION → loop back to Stage 2
```

**Iteration Loop (max 3 rounds):**

```
for iteration in 1..3:
    run Stage 3 (evaluate)
    read evaluation verdict

    if APPROVED:
        update status to "approved"
        delegate to implementation team
        send_mail(implementation-team, "Design approved for #{issue}")
        BREAK

    if NEEDS_ITERATION and iteration < 3:
        run Stage 2 (revise design)
        continue loop

    if iteration == 3 (max reached):
        update status to "needs-human-review"
        send_mail(tech-lead, "Design chain max iterations reached for #{issue}")
        send_mail(all, "Issue #{issue} design needs human review after 3 iterations")
        BREAK
```

### Post-Approval: Implementation

**Delegate to:** The team responsible for UI implementation

**Task:**
```
Implement the approved Design Proposal for issue #{issue_number}.
Read the proposal: .agents/designs/proposal-{issue}.md
Read the research brief: .agents/designs/research-brief-{issue}.md

Follow the proposal exactly:
  - Use the specified component inventory (no substitutions without flagging)
  - Implement layout with the specified CSS/utility classes
  - Implement all interaction patterns (loading, error, empty states)
  - Implement the accessibility plan fully (ARIA, keyboard, focus management)
  - Verify responsive breakpoints match the proposal
  - Use design tokens only (no hardcoded values)
  - Match animation/transition specifications

Implementation checklist:
  - [ ] All components from Component Inventory used
  - [ ] Layout matches Layout Specification
  - [ ] Interaction patterns implemented
  - [ ] Accessibility plan fully implemented
  - [ ] Responsive breakpoints verified
  - [ ] Design tokens used (no hardcoded values)
  - [ ] Animations/transitions match specs
```

---

## Inter-Stage Communication

Between stages, use `send_mail` to notify the next team:

| Transition | Recipient | Subject |
|------------|-----------|---------|
| Research → Design | implementation team | "Research complete for #{issue}" |
| Design → Evaluate | implementation team | "Proposal ready for #{issue}" |
| Evaluate → Design (iterate) | implementation team | "Iteration needed for #{issue}" |
| Evaluate → Implement (approved) | implementation team | "Approved design for #{issue}" |
| Max iterations | `tech-lead` | "Design chain needs human review for #{issue}" |

---

## Status File Format

Write this JSON file at `.agents/designs/status-{issue}.json`:

```json
{
  "issue": 0,
  "status": "researching",
  "iteration": 0,
  "maxIterations": 3,
  "scoreThreshold": 3.5,
  "scores": [],
  "createdAt": "",
  "updatedAt": ""
}
```

**Status values:** `researching` | `designing` | `evaluating` | `approved` | `needs-human-review`

**Update after each stage:**
- After Stage 1: `status: "researching"` → `"designing"`
- After Stage 2: `status: "designing"` → `"evaluating"`, increment `iteration`
- After Stage 3: push score to `scores[]`, set `status` based on verdict
- After approval: `status: "approved"`
- After max iterations: `status: "needs-human-review"`

---

## Scoring Aggregation

```
Overall Score = (Nielsen_Average × 0.4) + (WCAG_PassRate × 5 × 0.3) + (DesignSystem_PassRate × 5 × 0.3)
```

Where:
- **Nielsen_Average** = mean of 10 heuristic scores (1-5 each)
- **WCAG_PassRate** = passed_criteria / 15 (0.0-1.0, scaled to 5)
- **DesignSystem_PassRate** = passed_checks / 10 (0.0-1.0, scaled to 5)

**Pass threshold:** Overall Score ≥ 3.5 / 5.0

### Scoring Rubric (per criterion)

| Score | Meaning |
|-------|---------|
| 5 — Excellent | Exceeds best practice, innovative and effective |
| 4 — Good | Meets best practice with minor suggestions |
| 3 — Adequate | Meets minimum requirements, some improvement possible |
| 2 — Below Standard | Missing key requirements, needs rework |
| 1 — Failing | Violates fundamental principles, must redesign |

---

## Error Handling

| Scenario | Action |
|----------|--------|
| Researcher finds no relevant components | Proceed with partial brief, flag gaps for designer |
| Designer produces incomplete proposal | Evaluator identifies gaps, requests iteration |
| Evaluator consistently below threshold | Escalate to tech-lead after 3 iterations |
| MCP tools unavailable (Figma, browser) | Proceed without MCP data, note limitation |
| Sub-agent fails | Retry once, then escalate to tech-lead |

---

## Artifact Archive Convention

Each iteration is preserved for traceability:

```
.agents/designs/
├── research-brief-{issue}.md           # Stage 1 output (stable)
├── proposal-{issue}-v1.md              # Iteration 1 archive
├── proposal-{issue}-v2.md              # Iteration 2 archive (if iterated)
├── proposal-{issue}.md                 # Latest proposal
├── evaluation-{issue}.md               # Latest evaluation
└── status-{issue}.json                 # Chain state
```

Before each design revision, archive the current proposal:
```bash
cp .agents/designs/proposal-{issue}.md .agents/designs/proposal-{issue}-v{N}.md
```
