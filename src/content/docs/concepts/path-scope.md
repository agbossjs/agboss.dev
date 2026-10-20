---
title: Path Scope & Provenance
description: How AGBoss tracks typed DTO slots, producer metadata, review loop provenance with about and historyOf, and automatic OutdatedReason invalidation.
---

Every path in an AGBoss `@Workflow` carries a compile-time and runtime **Path Scope**: the typed set of DTO values returned by steps along that path so far. Components declare what they read by DTO class (`input: { draft: OfferDraftDto }`) and what they produce (`output: OfferDraftDto`), while the workflow writes each transition explicitly with `.returns(OfferDraftDto)` so `agboss check` and TypeScript verify every read before a single model call runs.

## How slots, writes, and `Produced<T, P>` reads work

A Path Scope stores **one slot per shape**: `OfferDraftDto` and `listOf(OfferDraftDto)` are distinct slots, and `listOf(oneOf(ApprovedDto, CritiqueDto))` is a single polymorphic list slot. Each write (`start(S).returns(...)`, `.returns(Dto)`, or `caseOf(Dto)`) replaces the current value in that slot while preserving earlier versions in the slot history.

- **Agent inputs** receive each declared `input` field rendered as a structured Markdown/JSON section in declaration order.
- **Code handlers (`@Action`, `@Router` with `DecidedBy.Code`, `@WorkflowFinish`)** receive each field wrapped as `Produced<T, P>` (`{ value, producer }`), where `producer` is the union of step classes that could have written that slot.

```ts title="src/workflows/offer-scope.workflow.ts" no-check: reference example
import { Workflow, agent, caseOf, oneOf, start } from "agboss";
import { CandidateBriefDto, OfferDraftDto, DraftApprovedDto, ChangesRequestedDto } from "../dto/offer.dto.js";
import { OfferStart, OfferFinish } from "./offer.endpoints.js";
import { OfferWriterAgent, OfferReviewerAgent, SendOfferAction } from "./offer.components.js";

const writer = agent(OfferWriterAgent);

@Workflow({
  name: "offer-scope-workflow",
  version: "1.0.0",
  flow: [
    start(OfferStart)
      .returns(CandidateBriefDto)
      .toAgent(writer)
      .returns(OfferDraftDto)
      .toAgent(OfferReviewerAgent)
      .returns(oneOf(DraftApprovedDto, ChangesRequestedDto), { about: writer })
      .switch(
        caseOf(DraftApprovedDto, { about: writer })
          .toAction(SendOfferAction)
          .toFinish(OfferFinish),
        caseOf(ChangesRequestedDto, { about: writer })
          .toAgent(writer),
      ),
  ],
})
export class OfferScopeWorkflow {}
```

```ts title="src/agents/offer-writer.agent.ts" no-check: reference example
import { Agent, historyOf, optional } from "agboss";
import { CandidateBriefDto, OfferDraftDto, ChangesRequestedDto } from "../dto/offer.dto.js";

@Agent({
  name: "offer-writer-agent",
  description: "Writes or revises the candidate offer using bounded review history",
  model: "moonshotai/kimi-k2.6",
  prompt: "Write or revise the offer draft addressing all prior critiques.",
  input: {
    brief: CandidateBriefDto,
    priorDrafts: optional(historyOf(OfferDraftDto, { limit: 2 })),
    critiques: optional(historyOf(ChangesRequestedDto, { limit: 3 })),
  },
  output: OfferDraftDto,
  maxVisits: 4,
})
export class OfferWriterAgent {}
```

```ts title="src/actions/send-offer.action.ts" no-check: reference example
import { Action, type ActionHandler, type InputOf, type OutputOf } from "agboss";
import { OfferDraftDto, DraftApprovedDto, OfferSentDto } from "../dto/offer.dto.js";

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
  async execute(input: InputOf<SendOfferAction>): Promise<OutputOf<SendOfferAction>> {
    // Both input.draft.value and input.approval.value are guaranteed current (not stale)
    return {
      sentToRole: input.draft.value.roleTitle,
      approvedBy: input.approval.producer,
    };
  }
}
```

## How `about`, `historyOf`, and `OutdatedReason` prevent stale-state bugs

In cyclic review graphs (`Writer → Reviewer → Writer`), an older approval or critique must never survive after `Writer` produces a new draft. AGBoss solves this with **provenance binding (`about`)**:

| Mechanism | API | Behavior |
| :--- | :--- | :--- |
| **Target binding** | `.returns(VerdictDto, { about: writer })` / `caseOf(VerdictDto, { about: writer })` | Binds the reviewer output to the specific value instance produced by `writer`. |
| **Automatic invalidation** | `OutdatedReason.AboutReplaced` & `OutdatedReason.TransitiveOutdated` | When `writer` runs again and replaces `OfferDraftDto`, any value bound `{ about: writer }` is immediately marked outdated and evicted from current slots. |
| **Compile-time guard** | `[input.outdated-on-path]` | `agboss check` rejects any workflow path where a downstream step tries to read a slot that was invalidated along that path. |
| **Bounded loop history** | `historyOf(ChangesRequestedDto, { limit: 3 })` | Gives the revising agent the last `limit` versions of a slot in chronological order without colliding with the current slot. |
