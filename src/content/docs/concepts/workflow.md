---
title: Workflow DSL
description: Master the AGBoss Workflow DSL — one-call-per-line paths, DTO contracts, review loops with about and historyOf, branching, parallel waves, and quorums.
---

In AGBoss, a workflow is a `@Workflow` class whose `flow` is a list of **paths**. Each path reads like a sentence starting at a source (`start(StartClass)`, `agent(AgentClass)`, `router(RouterClass)`, `workflow(ChildWorkflow)`), with **strictly one chained call per line** (`@stylistic/newline-per-chained-call`), and every value produced on an edge declared explicitly via `.returns(...)`.

## How paths, `.chooseOne(route())`, and `.switch(caseOf())` work

Components declare their typed `input` fields and `output` DTO (or `oneOf(DtoA, DtoB)` union), while the `@Workflow({ flow: [...] })` array holds the entire control-flow topology and data flow. When a node is reached from multiple places (such as a router or reviewer in a loop), it starts its own path in `flow`:

<!--
```ts file=chat.components.ts
import { Agent, DecidedBy, Router, WorkflowFinish, WorkflowStart } from "agboss";
import { Text, WorkflowStartTextDto, oneOf, optional } from "agboss/dto";

export class ProfileDto {
  @Text({ prompt: "the candidate's profile" })
  summary!: string;
}
export class ResumeMissingDto {
  @Text({ prompt: "why no resume was found", optional: true })
  reason?: string;
}
export class OpeningsDto {
  @Text({ prompt: "the openings found" })
  openings!: string;
}
@WorkflowStart({ name: "intake-workflow-start", description: "A customer's message", input: WorkflowStartTextDto })
export class IntakeWorkflowStart {}
@Agent({
  name: "profiler-agent",
  description: "Reads the resume into a profile",
  prompt: "Read the resume.",
  model: "moonshotai/kimi-k2.6",
  input: { message: WorkflowStartTextDto },
  output: oneOf(ProfileDto, ResumeMissingDto),
})
export class ProfilerAgent {}
@Agent({
  name: "scout-agent",
  description: "Finds openings for the profile",
  prompt: "Find openings.",
  model: "moonshotai/kimi-k2.6",
  input: { profile: optional(ProfileDto) },
  output: OpeningsDto,
})
export class ScoutAgent {}
@WorkflowFinish({ name: "ask-resume-workflow-finish", description: "Asks for a resume", output: ResumeMissingDto })
export class AskResumeWorkflowFinish {}
@WorkflowFinish({ name: "chat-workflow-finish", description: "The openings found", output: OpeningsDto })
export class ChatWorkflowFinish {}
@WorkflowFinish({ name: "no-reply-workflow-finish", description: "Ends without a reply", output: WorkflowStartTextDto })
export class NoReplyWorkflowFinish {}
@Router({
  name: "main-router",
  description: "Sends the message to the step that handles it",
  decidedBy: DecidedBy.Model,
  model: "typesafe/jev-1.13",
  prompt: "Pick who handles the customer's message next.",
  input: { message: WorkflowStartTextDto },
  maxVisits: 3,
  routes: [
    { target: ProfilerAgent, prompt: "The customer sends or changes their resume" },
    { target: ScoutAgent, prompt: "The customer asks for job openings" },
    { target: NoReplyWorkflowFinish, prompt: "Stop without a reply" },
  ],
})
export class MainRouter {}
```
-->

<!-- snippet-context
import {
  AskResumeWorkflowFinish,
  ChatWorkflowFinish,
  IntakeWorkflowStart,
  MainRouter,
  NoReplyWorkflowFinish,
  OpeningsDto,
  ProfileDto,
  ProfilerAgent,
  ResumeMissingDto,
  ScoutAgent,
} from "./chat.components.js";
-->
```ts title="src/chat.workflow.ts" file=chat.workflow.ts
import { Workflow, caseOf, route, router, start } from "agboss";
import { WorkflowStartTextDto, oneOf } from "agboss/dto";

@Workflow({
  name: "chat-workflow",
  version: "1.0.0",
  flow: [
    start(IntakeWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toRouter(MainRouter),

    router(MainRouter)
      .chooseOne(
        route(ProfilerAgent)
          .returns(oneOf(ProfileDto, ResumeMissingDto))
          .switch(
            caseOf(ProfileDto)
              .toRouter(MainRouter),
            caseOf(ResumeMissingDto)
              .toFinish(AskResumeWorkflowFinish),
          ),
        route(ScoutAgent)
          .returns(OpeningsDto)
          .toFinish(ChatWorkflowFinish),
        route(NoReplyWorkflowFinish),
      ),
  ],
  maxSteps: 8,
})
export class ChatWorkflow {}
```

```ts title="src/chat.components.ts" no-check: context tab
import { Agent, DecidedBy, Router, WorkflowFinish, WorkflowStart } from "agboss";
import { Text, WorkflowStartTextDto, oneOf, optional } from "agboss/dto";

export class ProfileDto {
  @Text({ prompt: "the candidate's profile" })
  summary!: string;
}
export class ResumeMissingDto {
  @Text({ prompt: "why no resume was found", optional: true })
  reason?: string;
}
export class OpeningsDto {
  @Text({ prompt: "the openings found" })
  openings!: string;
}
@WorkflowStart({ name: "intake-workflow-start", description: "A customer's message", input: WorkflowStartTextDto })
export class IntakeWorkflowStart {}
@Agent({
  name: "profiler-agent",
  description: "Reads the resume into a profile",
  prompt: "Read the resume.",
  model: "moonshotai/kimi-k2.6",
  input: { message: WorkflowStartTextDto },
  output: oneOf(ProfileDto, ResumeMissingDto),
})
export class ProfilerAgent {}
@Agent({
  name: "scout-agent",
  description: "Finds openings for the profile",
  prompt: "Find openings.",
  model: "moonshotai/kimi-k2.6",
  input: { profile: optional(ProfileDto) },
  output: OpeningsDto,
})
export class ScoutAgent {}
@WorkflowFinish({ name: "ask-resume-workflow-finish", description: "Asks for a resume", output: ResumeMissingDto })
export class AskResumeWorkflowFinish {}
@WorkflowFinish({ name: "chat-workflow-finish", description: "The openings found", output: OpeningsDto })
export class ChatWorkflowFinish {}
@WorkflowFinish({ name: "no-reply-workflow-finish", description: "Ends without a reply", output: WorkflowStartTextDto })
export class NoReplyWorkflowFinish {}
@Router({
  name: "main-router",
  description: "Sends the message to the step that handles it",
  decidedBy: DecidedBy.Model,
  model: "typesafe/jev-1.13",
  prompt: "Pick who handles the customer's message next.",
  input: { message: WorkflowStartTextDto },
  maxVisits: 3,
  routes: [
    { target: ProfilerAgent, prompt: "The customer sends or changes their resume" },
    { target: ScoutAgent, prompt: "The customer asks for job openings" },
    { target: NoReplyWorkflowFinish, prompt: "Stop without a reply" },
  ],
})
export class MainRouter {}
```

## How review loops use `{ about }` and `historyOf`

When a reviewer requests changes to an artifact (such as an `OfferDraftDto`), attach `{ about: OfferDraftDto }` on `.returns(ChangesRequestedDto, { about: OfferDraftDto })` or `caseOf(ChangesRequestedDto, { about: OfferDraftDto })`:

- **Automatic outdating of stale reviews:** When the editor produces a fresh `OfferDraftDto`, any earlier `ChangesRequestedDto` that was `{ about: OfferDraftDto }` is automatically marked outdated in path scope so the reviewer only sees current values (`onValuesOutdated` fires for observers).
- **Bounded iteration history (`historyOf(Dto, { limit })`):** Steps that need to inspect prior drafts or critique rounds declare `historyOf(OfferDraftDto, { limit: 3 })` in their `input` contract instead of manual state arrays.

## How parallel launches, quorums, and recursion work

For concurrent execution and hierarchical composition, the Workflow DSL provides four additional primitives:

1. **Parallel launches (`.toParallelAgents()` / `.toParallelActions()`):** Run multiple distinct agents (`ResearcherAgent, CriticAgent, { maxConcurrency: 3 }`) or fan out one agent across a `listOf(ItemDto)` (`{ maxItems: 20, maxConcurrency: 4 }`), followed by `.join()` and `.onJoinError(...)`.
2. **Consensus quorums (`.joinQuorum()` / `.joinQuorumGroups()`):** Continue as soon as `{ min, max, deadline: seconds(30) }` answers are accepted by `@Arbiter` rules attached via `.acceptedBy(ArbiterClass)` or `.acceptedBy(anyOf(A, B))`, cancelling surplus branches immediately.
3. **Workflow as a step (`.toWorkflow(ChildWorkflow)` / `.toParallelWorkflows()`):** Run a child `@Workflow` as an isolated execution with its own `maxSteps` and path scope, branching on its finishes via `.returns(oneOf(...)).switch(caseOf(...)...)`.
4. **Bounded self-recursion (`ThisWorkflow`):** Pass `ThisWorkflow` to `.toWorkflow(ThisWorkflow)`, `route(ThisWorkflow)`, or `.toParallelWorkflows(ThisWorkflow, { maxItems })` with `@Workflow({ maxDepth: 3, maxConcurrentExecutions: 6 })`. At `depth === maxDepth`, the framework removes the recursive branch from the model's schema and routes automatically.
