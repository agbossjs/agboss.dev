---
title: Workflow HDSL — HarnessDSL & Canonical Topology
description: "Master HarnessDSL (HDSL) — the declarative workflow grammar inside AGBoss for canonical topology, Path Scope DTOs, parallel quorums, and LIFO sagas."
---

In **AGBoss** (*Agent Graph Builder Open Source System*), a workflow is written in **HarnessDSL (`HDSL`)** — the declarative graph grammar and verification specification built into `AGBoss` (analogous to JSX in React or PSL in Prisma). While `AGBoss` is the framework, static compiler (`agboss check`), and production runtime on LangGraph (`npm i @agboss/core`), `HarnessDSL` is the grammar used inside `*.workflow.ts` and contract decorators to specify `flow` chains, narrow DTO contracts, Path Scope, `in-degree = 1` vs `in-degree >= 2` canonical topology, quorums, and `compensateWith` / `committedBy` sagas. In a `@Workflow` class, `flow` is a list of **paths**. Each path reads like a sentence starting at a source (`onStart(StartClass)`, `onAgent(AgentClass)`, `onRouter(RouterClass)`, `onAction(ActionClass)`, `onWorkflow(ChildWorkflow)`, `onExternalTask(TaskClass)`), with **strictly one chained call per line** (`@stylistic/newline-per-chained-call`). Nothing is declared on an edge: what a step gives to the path is derived from its declaration — a start gives its `input`, an agent, action, external task or child workflow its `output`, a text agent its reply — so the grammar has no `.returns(...)`.

## Canonical Topology Isomorphism (`in-degree = 1` vs `in-degree >= 2`)

When AI coding agents edit unconstrained graph definitions, they can format the exact same topology in ten different ways — creating deep nesting pyramids and unreviewable Git diffs. AGBoss enforces a **1-to-1 structural isomorphism** ([Principle 3](/concepts/architecture/#3-canonical-topology-isomorphism)) verified by `agboss check`:

1. **Single incoming edge (`in-degree = 1`):** A node reached from only one predecessor **must** be chained inline (`.toAgent(NextStep)`).
2. **Convergence node (`in-degree >= 2`):** A node reached from two or more edges (for example, `ReviewerAgent` reached both from the draft step and from the editor's loop-back) is continued inline in every path that reaches it, and its own continuation is written **once**, as a top-level entry in the `flow: [...]` array: `onAgent(ReviewerAgent)`, `onRouter(MainRouter)`, `onAction(MergeAction)` (`[flow.shared-node-inline]`, `[flow.single-entry-own-path]`).
3. **One chained call per line:** Every builder method call occupies its own line, and inline branch nesting is capped at depth 4 (`[flow.path-too-deep]`).

## How HDSL paths, `.onRoute(…)`, and `.toOneOf([…])` work

Components declare their typed `input` fields and `output` DTO (or `oneOf(DtoA, DtoB)` union), while the `@Workflow({ flow: [...] })` array holds the entire control-flow topology and data flow. Two forms branch a path:

- **`.toRouter(R).onRoute(…)`** — the router's choice: exactly one `.onRoute(toAgent(X)…)` per route of the `@Router` (`[router.routes-mismatch]` otherwise), each continued to its own end. A route's starter is `toAgent`, `toAction`, `toRouter`, `toExternalTask`, `toWorkflow` or `toFinish`.
- **`.toOneOf([…])`** — one side path per variant of a step's `oneOf(A, B)` output. A branch takes the variant its first step reads as `input`; no DTO is named in the flow. A variant with no branch is `[flow.one-of-not-exhaustive]`, two branches reading one variant `[flow.one-of-ambiguous]`. A child workflow with two or more finishes is branched the same way by the finish class: `.toWorkflow(W).onFinish(WFinish, toAction(A)…)`.

<!-- snippet-context
import {
  AskResumeWorkflowFinish,
  ChatWorkflowFinish,
  IntakeWorkflowStart,
  MainRouter,
  NoReplyWorkflowFinish,
  ProfilerAgent,
  ScoutAgent,
} from "./chat.components.js";
-->
```ts title="src/chat.workflow.ts" file=chat.workflow.ts
import { Workflow, onAgent, onStart, toAgent, toFinish, toRouter, Ttl } from "@agboss/core";

@Workflow({
  name: "chat-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [
    onStart(IntakeWorkflowStart)
      .toRouter(MainRouter)
      .onRoute(
        toAgent(ProfilerAgent)
          .toOneOf([
            toAgent(ScoutAgent), // reached from two places: continued once, below
            toFinish(AskResumeWorkflowFinish),
          ]),
      )
      .onRoute(toAgent(ScoutAgent))
      .onRoute(toFinish(NoReplyWorkflowFinish)),

    onAgent(ScoutAgent)
      .toFinish(ChatWorkflowFinish),
  ],
  executionLimits: { maxSteps: 8 },
})
export class ChatWorkflow {}
```

```ts title="src/chat.components.ts" file=chat.components.ts
import { Agent, DecidedBy, Router, WorkflowFinish, WorkflowStart, inline, oneOf, optional } from "@agboss/core";
import { Text, WorkflowStartTextDto } from "@agboss/core/dto";
import { DecisionsModelProvider } from "./decisions.model-provider.js";

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
  prompt: inline("Read the resume."),
  model: "moonshotai/kimi-k2.6",
  input: { message: WorkflowStartTextDto },
  output: oneOf(ProfileDto, ResumeMissingDto),
})
export class ProfilerAgent {}
@Agent({
  name: "scout-agent",
  description: "Finds openings, for the profile when there is one",
  prompt: inline("Find openings."),
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
  modelProvider: DecisionsModelProvider,
  prompt: inline("Pick who handles the customer's message next."),
  input: { message: WorkflowStartTextDto },
  routes: [
    { target: ProfilerAgent, prompt: "The customer sends or changes their resume" },
    { target: ScoutAgent, prompt: "The customer asks for job openings" },
    { target: NoReplyWorkflowFinish, prompt: "Stop without a reply" },
  ],
})
export class MainRouter {}
```

A decision model such as `typesafe/jev-1.13` is served by a decisions provider; a component names it with `modelProvider` (there are no built-in providers, see [`@ModelProvider`](/reference/model-provider/)):

```ts title="src/decisions.model-provider.ts" file=decisions.model-provider.ts
import { secret } from "@agboss/core";
import { DecisionsDriver, ModelCost, ModelProvider } from "@agboss/core/models";
import { seconds } from "@agboss/core/units";

@ModelProvider({
  name: "decisions-model-provider",
  description: "Decision models on OpenRouter's Decisions API",
  driver: DecisionsDriver({ baseUrl: "https://openrouter.ai/api/v1", apiKey: secret("OPENROUTER_API_KEY") }),
  timeout: seconds(30),
  cost: ModelCost.fromResponse(),
})
export class DecisionsModelProvider {}
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
import { DecisionsModelProvider } from "./decisions.model-provider.js";
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
  modelProvider: DecisionsModelProvider,
  providers: [DecisionsModelProvider],
  budgets: [ChatAppBudget, ChatTenantBudget, ChatExecBudget],
})
export class ChatWorkflowApp {}

const test = testWith(ChatWorkflowApp);

test("the profiler's profile goes on to the scout and the run finishes", async ({
  app,
  mockLlm,
}) => {
  mockLlm(MainRouter).thenReturn(routeTo(ProfilerAgent));
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

## How a value's provenance is tracked: `Tracked` and `Metadata`

What the steps before gave is the node's **scope**. A node reads each `input` field from it **by class**, never by position, and receives the DTO itself: an action writes `input.order.orderId`, a field typed `Tracked<OrderDto, typeof IntakeAgent>`. Who made a value is read with `Metadata.createdBy(input.order)`, and `Metadata.of`, `.has`, `.ancestors` and `.with` read and state the rest of its facts (slot, visit number, item index, parents). The facts live outside the value, so JSON and `structuredClone` see plain data.

## How review loops use `historyOf` and outdating

In a loop a new value in a slot **outdates** everything built from the older one: after an editor returns a new `OfferDraftDto`, the old draft and the `ChangesRequestedDto` about it leave the scope, so a downstream node can never pair a stale v1 decision with a v2 draft. A field that would read an outdated value on some path fails assembly with `[input.outdated-on-path]` (`[launch.branch-outdates-sibling]` for a parallel branch renewing what a sibling read). There is no `{ about }` any more.

- **Bounded iteration history (`historyOf(Dto, { maxPrevious })`):** a step that needs the prior drafts declares `historyOf(OfferDraftDto, { maxPrevious: 2 })` in its `input` and receives `{ current, previous: [...] }` — `previous` oldest first, at most `maxPrevious` (a positive integer). It needs a current value on every path in.
- **Every node on a cycle needs `maxVisits`** (`[graph.cycle-without-max-visits]`); a reviewer in a loop is reached from two places, so its continuation is its own path: `onAgent(ReviewerAgent).toOneOf([…])`.

## How parallel launches, quorums, and recursion work

For concurrent execution and hierarchical composition, HarnessDSL (`HDSL`) provides four additional primitives:

1. **Parallel launches (`.inParallel([...])` / `.forEachItem(...)`):** Run branches of any kind in one array — `.inParallel([toAgent(SecurityAgent), toAgent(LegalAgent), toAction(ArchiveAction)], { maxConcurrency: 3 })` — or one run per item of the `listOf(ItemDto)` the step before gave — `.forEachItem(toAgent(ReviewerAgent), { takeFirst: 20, maxConcurrency: 4 })` (`takeFirst` runs the first N and records the rest as dropped, `maxItems` throws `LimitError.Items` before any branch starts). A launch is followed by `.join()` and, when a branch can fail, the join's `.onError(E, …)`; `.onError(E, skip())` on a branch drops its failure from the join and its value becomes `optional(…)`. A router inside a launch is `toRouter(R).chooseMany([toAgent(A), …])`: it picks which of its routes run, none included.
2. **Consensus quorums (`.arbitratedBy(...)` + `.joinQuorum()` / `.joinQuorumGroups()`):** One `@Arbiter` class decides which answers of the launch count — `.arbitratedBy(PanelScoreArbiter)` — and the join continues as soon as `{ min, max, deadline: seconds(30) }` answers are accepted, cancelling surplus branches. `.joinQuorumGroups({ deadline })` with `.onGroup([A, B], { priority: 1 }, subPath)` continues the first complete group, by priority, on its own path.
3. **Workflow as a step (`.toWorkflow(ChildWorkflow)` / `.forEachItem(toWorkflow(ChildWorkflow), …)`):** Run a child `@Workflow` as an isolated execution with its own limits and Path Scope, branching on its finishes with `.onFinish(ChildFinish, subPath)` or `.toOneOf([…])`. A child's undoable actions bubble up to its parent.
4. **Bounded self-recursion (`() => Self`):** A workflow launches itself with a thunk of its own class — `toWorkflow(() => TopicResearchWorkflow)` — and `@Workflow({ executionLimits: { maxDepth: 3, maxConcurrency: 6 } })`. At `depth === maxDepth` (soft stop), the runtime automatically strips the recursive `oneOf` variant or router target from the model's schema so the run converges cleanly (warming two prefix cache entries: `depth < maxDepth` and `depth === maxDepth`). `ThisWorkflow` is gone.
