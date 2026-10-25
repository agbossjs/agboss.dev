---
title: Path Scope & Provenance
description: "How AGBoss and HarnessDSL track Static Single Assignment (SSA) DTO slots, Produced<T, P> provenance, { about } review loops, and compile-time Path Scope."
---

Every path in an AGBoss `@Workflow` written in **HarnessDSL (`HDSL`)** carries a compile-time and runtime **Path Scope**: the Static Single Assignment (SSA) set of DTO values guaranteed to have been produced along that path so far. Components declare what they read by DTO class (`input: { draft: OfferDraftDto }`) and what they produce (`output: OfferDraftDto`), while the workflow writes each transition explicitly with `.returns(OfferDraftDto)` so `agboss check` and TypeScript verify every read before a single model call runs.

## How slots, writes, and narrowed `Produced<T, P>` reads work

A Path Scope stores **one slot per shape**: `OfferDraftDto` and `listOf(OfferDraftDto)` are distinct slots, and `listOf(oneOf(ApprovedDto, CritiqueDto))` is a single polymorphic list slot. Multiple outputs from a step or join are declared strictly by chaining `.returns(DtoA).returns(DtoB)` (the multi-argument `.returns(A, B)` form is not supported). Each write (`start(S).returns(...)`, `.returns(Dto)`, or `caseOf(Dto)`) replaces the current value in that slot while preserving earlier versions in the slot history.

When you run `npx agboss check`, the compiler performs dominance analysis (`[input.missing-on-path]`, `[input.never-produced]`, `[flow.unused-output]`, `[input.outdated-on-path]`, `[launch.branch-outdates-sibling]`) over every `@Workflow` and writes `.agboss/types.d.ts`:

- **`@Agent` inputs** receive each declared `input` field rendered as a structured Markdown/JSON section in the user message frame (keeping the system prompt 100% static for KV-cache hits).
- **Code handlers reading from Path Scope (`@Action`, `@Router` with `DecidedBy.Code`, and `FinishHandler` `@WorkflowFinish`)** receive each field from `InputOf<Self>` wrapped as `Produced<T, P>` (`{ value: T, producer: P }`), where `P` is the exact TypeScript union of step classes that could have produced that DTO on the incoming paths (e.g., `typeof DraftAgent | typeof EditorAgent`).
- **Fixed-source handlers (`@OnAnswer(Agent)`, `ToolHandler.run`, `ChannelAsk.value`, `ReplyInterpreterHandler.interpret({ ask, reply })`)** receive the bare `Dto` directly because the producer is single and fixed.

<!-- snippet-context
import {
  CandidateBriefDto,
  ChangesRequestedDto,
  DraftAgent,
  DraftApprovedDto,
  EditorAgent,
  OfferDraftDto,
  OfferFinish,
  OfferSentDto,
  OfferStart,
  ReviewerAgent,
  SendOfferAction,
} from "./offer.components.js";
-->
```ts title="src/workflows/offer-scope.workflow.ts" file=offer-scope.workflow.ts
import { Workflow, agent, caseOf, start } from "agboss";
import { oneOf } from "agboss/dto";

@Workflow({
  name: "offer-scope-workflow",
  version: "1.0.0",
  flow: [
    start(OfferStart)
      .returns(CandidateBriefDto)
      .toAgent(DraftAgent)
      .returns(OfferDraftDto)
      .toAgent(ReviewerAgent),

    agent(ReviewerAgent)
      .returns(oneOf(DraftApprovedDto, ChangesRequestedDto))
      .switch(
        caseOf(DraftApprovedDto, { about: OfferDraftDto })
          .toAction(SendOfferAction)
          .returns(OfferSentDto)
          .toFinish(OfferFinish),
        caseOf(ChangesRequestedDto, { about: OfferDraftDto })
          .toAgent(EditorAgent)
          .returns(OfferDraftDto)
          .toAgent(ReviewerAgent),
      ),
  ],
})
export class OfferScopeWorkflow {}
```

```ts title="src/workflows/offer.components.ts" file=offer.components.ts
import { Action, Agent, WorkflowFinish, WorkflowStart, type ActionHandler, type InputOf, type OutputOf } from "agboss";
import { Text, historyOf, oneOf } from "agboss/dto";

export class CandidateBriefDto {
  @Text({ prompt: "Candidate summary and target role" })
  roleTitle!: string;
}

export class OfferDraftDto {
  @Text({ prompt: "Offer letter markdown body" })
  text!: string;
}

export class DraftApprovedDto {
  @Text({ prompt: "Approval sign-off summary" })
  summary!: string;
}

export class ChangesRequestedDto {
  @Text({ prompt: "Specific edits required before approval" })
  notes!: string;
}

export class OfferSentDto {
  @Text()
  sentText!: string;

  @Text()
  draftedBy!: string;
}

@WorkflowStart({
  name: "offer-workflow-start",
  description: "Starts an offer drafting and review flow",
  input: CandidateBriefDto,
})
export class OfferStart {}

@WorkflowFinish({
  name: "offer-workflow-finish",
  description: "Returns the sent offer confirmation",
  output: OfferSentDto,
})
export class OfferFinish {}

@Agent({
  name: "draft-agent",
  description: "Writes the initial offer draft from the candidate brief",
  model: "moonshotai/kimi-k2.6",
  prompt: "Write an initial offer draft for the candidate.",
  input: { brief: CandidateBriefDto },
  output: OfferDraftDto,
})
export class DraftAgent {}

@Agent({
  name: "reviewer-agent",
  description: "Reviews the current offer draft",
  model: "moonshotai/kimi-k2.6",
  prompt: "Approve the draft or request specific changes.",
  input: { draft: OfferDraftDto },
  output: oneOf(DraftApprovedDto, ChangesRequestedDto),
  maxVisits: 3,
})
export class ReviewerAgent {}

@Agent({
  name: "editor-agent",
  description: "Revises the offer draft using bounded critique history",
  model: "moonshotai/kimi-k2.6",
  prompt: "Revise the offer draft addressing all critiques.",
  input: {
    draft: OfferDraftDto,
    critiques: historyOf(ChangesRequestedDto, { limit: 3 }),
  },
  output: OfferDraftDto,
})
export class EditorAgent {}

@Action({
  name: "send-offer-action",
  description: "Reads Produced<T, P> values with compile-checked provenance",
  input: {
    draft: OfferDraftDto,
    approval: DraftApprovedDto,
  },
  output: OfferSentDto,
})
export class SendOfferAction implements ActionHandler<SendOfferAction> {
  execute(
    input: InputOf<SendOfferAction>,
  ): Promise<OutputOf<SendOfferAction>> {
    // input.draft.producer is narrowed by .agboss/types.d.ts to:
    // typeof DraftAgent | typeof EditorAgent
    return Promise.resolve({
      sentText: input.draft.value.text,
      draftedBy: input.draft.producer.name,
    });
  }
}
```

<!-- snippet-context
import { Budget, BudgetPeriod, BudgetScope, type BudgetHandler } from "agboss";
import { usd, type Usd } from "agboss/units";
@Budget({ name: "offer-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class OfferAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(50); } }
@Budget({ name: "offer-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class OfferTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "offer-exec-budget", scope: BudgetScope.Execution })
export class OfferExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }
// @snippet
-->
```ts title="test/offer-scope.workflow.test.ts" file=offer-scope.workflow.test.ts
import { Application, EmptyEnvironment } from "agboss";
import { expect } from "vitest";
import { replyWith, testWith } from "agboss/testing";
import { OfferScopeWorkflow } from "./offer-scope.workflow.js";
import {
  ChangesRequestedDto,
  DraftAgent,
  DraftApprovedDto,
  EditorAgent,
  OfferDraftDto,
  OfferFinish,
  OfferStart,
  ReviewerAgent,
} from "./offer.components.js";

@Application({
  name: "offer-scope-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [OfferScopeWorkflow],
  budgets: [OfferAppBudget, OfferTenantBudget, OfferExecBudget],
})
export class OfferScopeApplication {}

const test = testWith(OfferScopeApplication);

test("tracks Produced<OfferDraftDto, P> producer across ReviewerAgent -> EditorAgent revision loop", async ({
  app,
  mockLlm,
}) => {
  mockLlm(DraftAgent).thenReturn(
    replyWith(OfferDraftDto, { text: "Draft v1" }),
  );
  mockLlm(ReviewerAgent).thenReturn(
    replyWith(ChangesRequestedDto, { notes: "Add equity cliff details" }),
    replyWith(DraftApprovedDto, { summary: "Approved v2" }),
  );
  mockLlm(EditorAgent).thenReturn(
    replyWith(OfferDraftDto, { text: "Draft v2 with equity cliff" }),
  );

  const result = await app.execute(OfferStart, {
    roleTitle: "Staff Distributed Systems Engineer",
  });
  expect(result.finish).toBe(OfferFinish);
  expect(result.output).toEqual({
    sentText: "Draft v2 with equity cliff",
    draftedBy: "EditorAgent",
  });
});
```

## How `about`, `historyOf`, and `OutdatedReason` prevent stale-state bugs

In cyclic review graphs (`DraftAgent -> ReviewerAgent -> EditorAgent -> ReviewerAgent`), an older approval or critique must never survive after `EditorAgent` produces a new draft. AGBoss solves this with **artifact provenance binding (`{ about: OfferDraftDto }`)**:

| Mechanism | API | Behavior |
| :--- | :--- | :--- |
| **Artifact binding** | `.returns(VerdictDto, { about: OfferDraftDto })` & `caseOf(VerdictDto, { about: OfferDraftDto })` | Binds the reviewer output to the specific `OfferDraftDto` instance it evaluated (or an array of targets: `{ about: [OfferDraftDto, TermsDto] }`). |
| **Automatic invalidation** | `OutdatedReason.AboutReplaced` & `OutdatedReason.TransitiveOutdated` | When `EditorAgent` runs and replaces `OfferDraftDto`, any value bound `{ about: OfferDraftDto }` (and anything transitively `{ about }` that value) is immediately marked outdated and evicted from current slots. |
| **Compile-time guard** | `[input.outdated-on-path]` & `[input.missing-on-path]` | `agboss check` rejects any workflow path where a downstream step tries to read a slot that was not produced on every incoming branch or was invalidated along that path. |
| **Bounded loop history** | `historyOf(ChangesRequestedDto, { limit: 3 })` | Gives the revising agent `{ current, previous }` over the last `limit` versions of a slot in chronological order, including values that were later outdated when a new draft was written. |

---

## Standalone Executable Proof: [`02-path-scope-proof`](https://github.com/agbossjs/agboss-examples/tree/main/02-path-scope-proof)

To see all four static dataflow & compensation diagnostics reproduced side by side against raw LangGraph (`cases/01-missing-input`, `02-outdated-data`, `03-parallel-invalidation`, `04-uncompensated-action`), inspect **[`02-path-scope-proof`](https://github.com/agbossjs/agboss-examples/tree/main/02-path-scope-proof)** and **[`07-langgraph-migration`](https://github.com/agbossjs/agboss-examples/tree/main/07-langgraph-migration)** in [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples) (see [7 Verified Examples](/examples/job-scout/)).
