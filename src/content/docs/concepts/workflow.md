---
title: Workflow HDSL — HarnessDSL & Canonical Topology
description: "Master HarnessDSL (HDSL) — the declarative workflow grammar inside AGBoss for canonical topology, Path Scope DTOs, parallel quorums, and LIFO sagas."
---

In **AGBoss** (*Agent Graph Builder Open Source System*), a workflow is written in **HarnessDSL (`HDSL`)** — the declarative graph grammar and verification specification built into `AGBoss` (analogous to JSX in React or PSL in Prisma). While `AGBoss` is the framework, static compiler (`agboss check`), and production runtime on LangGraph (`npm i @agboss/core`), `HarnessDSL` is the grammar used inside `*.workflow.ts` and contract decorators to specify `flow` chains, narrow `@Dto` contracts, `Path Scope`, `in-degree = 1` vs `in-degree >= 2` canonical topology, `{ about }` staleness tracking, quorums, and `compensateWith` / `committedBy` sagas. In a `@Workflow` class, `flow` is a list of **paths**. Each path reads like a sentence starting at a source (`start(StartClass)`, `agent(AgentClass)`, `router(RouterClass)`, `action(ActionClass)`, `workflow(ChildWorkflow)`), with **strictly one chained call per line** (`@stylistic/newline-per-chained-call`), and every value produced on an edge declared explicitly via `.returns(...)`.

## Canonical Topology Isomorphism (`in-degree = 1` vs `in-degree >= 2`)

When AI coding agents edit unconstrained graph definitions, they can format the exact same topology in ten different ways — creating deep nesting pyramids and unreviewable Git diffs. AGBoss enforces a **1-to-1 structural isomorphism** ([Principle 3](/concepts/architecture/#3-canonical-topology-isomorphism)) verified by `agboss check`:

1. **Single incoming edge (`in-degree = 1`):** A node reached from only one predecessor **must** be chained inline (`.toAgent(NextStep)`).
2. **Convergence node (`in-degree >= 2`):** A node reached from two or more edges (for example, `MainRouter` reached both from `start(IntakeWorkflowStart)` and from the `caseOf(ProfileDto)` loop-back) **must** be extracted as a top-level entry (`router(MainRouter)`, `agent(ReviewerAgent)`, `action(MergeAction)`) in the `flow: [...]` array (`[flow.shared-node-inline]`).
3. **One chained call per line:** Every builder method call occupies its own line, and inline branch nesting is capped at depth 4 (`[flow.path-too-deep]`).

## How HDSL paths, `.chooseOne(route())`, and `.switch(caseOf())` work

Components declare their typed `input` fields and `output` DTO (or `oneOf(DtoA, DtoB)` union), while the `@Workflow({ flow: [...] })` array holds the entire control-flow topology and data flow:

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
import { Workflow, caseOf, route, router, start } from "@agboss/core";
import { WorkflowStartTextDto, oneOf } from "@agboss/core/dto";

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

```ts title="src/chat.components.ts" file=chat.components.ts
import { Agent, DecidedBy, Router, WorkflowFinish, WorkflowStart } from "@agboss/core";
import { Text, WorkflowStartTextDto, oneOf, optional } from "@agboss/core/dto";

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

<!-- snippet-context
import { Budget, BudgetPeriod, BudgetScope, type BudgetHandler } from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";
@Budget({ name: "chat-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class ChatAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(50); } }
@Budget({ name: "chat-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class ChatTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "chat-exec-budget", scope: BudgetScope.Execution })
export class ChatExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }
// @snippet
-->
```ts title="test/chat.workflow.test.ts" file=chat.workflow.test.ts
import { Application, EmptyEnvironment } from "@agboss/core";
import { expect } from "vitest";
import { replyWith, routeTo, testWith } from "@agboss/core/testing";
import { ChatWorkflow } from "./chat.workflow.js";
import {
  ChatWorkflowFinish,
  IntakeWorkflowStart,
  MainRouter,
  OpeningsDto,
  ProfileDto,
  ProfilerAgent,
  ScoutAgent,
} from "./chat.components.js";

@Application({
  name: "chat-workflow-app",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [ChatWorkflow],
  budgets: [ChatAppBudget, ChatTenantBudget, ChatExecBudget],
})
export class ChatWorkflowApp {}

const test = testWith(ChatWorkflowApp);

test("loops from ProfilerAgent back to MainRouter and finishes via ScoutAgent", async ({
  app,
  mockLlm,
}) => {
  mockLlm(MainRouter).thenReturn(
    routeTo(ProfilerAgent),
    routeTo(ScoutAgent),
  );
  mockLlm(ProfilerAgent).thenReturn(
    replyWith(ProfileDto, { summary: "Principal TypeScript Engineer" }),
  );
  mockLlm(ScoutAgent).thenReturn(
    replyWith(OpeningsDto, { openings: "Staff Backend @ Acme" }),
  );

  const result = await app.execute(IntakeWorkflowStart, {
    text: "Here is my resume, find openings",
  });
  expect(result.finish).toBe(ChatWorkflowFinish);
  expect(result.output).toEqual({ openings: "Staff Backend @ Acme" });
});
```

## How review loops use `{ about }` and `historyOf`

When a reviewer evaluates an artifact (such as `OfferDraftDto`), attach `{ about: OfferDraftDto }` (or `{ about: [DtoA, DtoB] }`) on a single output `.returns(CritiqueDto, { about: PlanDto })` or on a specific union branch `caseOf(ChangesRequestedDto, { about: OfferDraftDto })` (never on `.returns(oneOf(...))` and never as a positional helper):

- **Automatic outdating of stale reviews:** When the editor produces a fresh `OfferDraftDto`, any earlier `ChangesRequestedDto` or `DraftApprovedDto` that was `{ about: OfferDraftDto }` is automatically marked outdated in Path Scope so downstream nodes can never consume a stale v1 decision paired with a v2 draft (`[input.outdated-on-path]`, `[launch.branch-outdates-sibling]`).
- **Bounded iteration history (`historyOf(Dto, { limit })`):** Steps that need to inspect prior drafts or critique rounds declare `historyOf(OfferDraftDto, { limit: 3 })` in their `input` contract to receive `{ current, previous: [...] }` instead of manual state arrays or legacy string tags.

## How parallel launches, quorums, and recursion work

For concurrent execution and hierarchical composition, HarnessDSL (`HDSL`) provides four additional primitives:

1. **Parallel launches (`.toParallelAgents()` / `.toParallelWorkflows()`):** Run multiple distinct agents (`SecurityAgent, LegalAgent, { maxConcurrency: 3 }`) or fan out across a `listOf(ItemDto)` (`{ maxItems: 20, maxConcurrency: 4 }`), followed by `.join()` and `.onJoinError(...)`.
2. **Consensus quorums (`.joinQuorum()` / `.joinQuorumGroups()`):** Continue as soon as `{ min, max, deadline: seconds(30) }` answers are accepted by `@Arbiter` rules attached via `.acceptedBy(ArbiterClass)` or `.acceptedBy(anyOf(A, B))`, cancelling surplus branches immediately.
3. **Workflow as a step (`.toWorkflow(ChildWorkflow)` / `.toParallelWorkflows()`):** Run a child `@Workflow` as an isolated execution with its own `maxSteps` and Path Scope, branching on its finishes via `.returns(oneOf(...)).switch(caseOf(...)...)`.
4. **Bounded self-recursion (`ThisWorkflow`):** Pass `ThisWorkflow` to `.toWorkflow(ThisWorkflow)`, `route(ThisWorkflow)`, or `.toParallelWorkflows(ThisWorkflow, { maxItems })` with `@Workflow({ maxDepth: 3, maxConcurrentExecutions: 6 })`. At `depth === maxDepth` (soft stop), the runtime automatically strips the recursive `oneOf` variant or router target from the model's schema so the run converges cleanly (warming two prefix cache entries: `depth < maxDepth` and `depth === maxDepth`).
