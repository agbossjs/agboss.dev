---
title: "Examples: 7 Verified Applications, flow-patterns & job-scout"
description: Explore the 7 standalone verified examples in agbossjs/agboss-examples (including path-scope-proof, support-refund-desk, travel-booking-saga, enterprise-agent-mesh, cluster-work-stealing, and langgraph-migration-smoke) alongside examples/flow-patterns and examples/job-scout.
---

AGBoss provides two complementary repositories of runnable, CI-verified examples so you can prove compile-time graph invariants in seconds for `$0` and inspect production-grade reference architectures:

1. **7 Standalone Verified Examples ([`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples)):** Seven self-contained applications — each with its own `package.json`, `.agboss/types.d.ts`, `npx agboss check`, and offline Vitest suite (`npm test`).
2. **In-Repository Examples (`examples/flow-patterns` & `examples/job-scout` in [`agbossjs/agboss`](https://github.com/agbossjs/agboss)):** `examples/flow-patterns` verifies loops, code/model routers, parallel waves, and `ThisWorkflow` recursion in `< 5 seconds` for `$0`, alongside the interactive `examples/job-scout` career assistant.

---

## The 7 Verified Examples in [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples)

| Example | Architectural Proof & Capabilities Demonstrated | Key Primitives & CLI Commands |
| :--- | :--- | :--- |
| **[`01-hello-agboss`](https://github.com/agbossjs/agboss-examples/tree/main/01-hello-agboss)** | **Minimal starter application:** Cleanest entry point showing a typed `@Workflow`, `@Router`, `@Agent`, `@Tool`, `@Budget`, and deterministic `testWith(App)` test. | `@Application`, `@Workflow`, `@Agent`, `@Router`, `@Tool`, `testWith` |
| **[`02-path-scope-proof`](https://github.com/agbossjs/agboss-examples/tree/main/02-path-scope-proof)** | **Compile-time Path Scope vs raw LangGraph:** Proves 4 fatal graph bugs that pass `tsc --noEmit` in raw LangGraph `Annotation.Root` (`prove:langgraph-compiles`) and are caught before runtime by `agboss check` (`prove:agboss-catches`). | `[input.missing-on-path]`, `[input.outdated-on-path]`, `[launch.branch-outdates-sibling]`, `[flow.uncompensated-action]` |
| **[`03-support-refund-desk`](https://github.com/agbossjs/agboss-examples/tree/main/03-support-refund-desk)** | **PII masking, guardrails, human approval & 5-loop evals:** Multi-step customer support desk with boundary HMAC pseudonymization, two-phase human-in-the-loop pause/resume, and an `@EvalSuite` cascade. | `@PiiPolicy` (`replaceWithToken`), `@InputGuardrail`, `@OutputGuardrail`, `@ChannelRole`, `app.resume`, `@EvalSuite` |
| **[`04-travel-booking-saga`](https://github.com/agbossjs/agboss-examples/tree/main/04-travel-booking-saga)** | **Transactional LIFO sagas & parallel quorums:** Books flights, hotels, and insurance with `step.idempotencyKey`, parallel quorum fan-out, and automatic reverse-order LIFO rollback when a downstream step fails. | `@Action({ compensateWith, committedBy })`, `.toParallelAgents().acceptedBy().joinQuorum()`, `.onError()` |
| **[`05-cluster-work-stealing`](https://github.com/agbossjs/agboss-examples/tree/main/05-cluster-work-stealing)** | **Distributed child work-stealing & SQLite WAL leases:** Multi-instance worker cluster where parent workflows enqueue `ChildPlacement.AnyInstance` children into `SqliteChildExecutionQueueRepository`, yield parent leases while waiting, and recover crashed children individually. | `ChildPlacement.AnyInstance`, `SqliteChildExecutionQueueRepository`, `SqliteRateLimitRepository` (`SharedTreeSlots`), `SqliteExecutionLeaseRepository` |
| **[`06-enterprise-agent-mesh`](https://github.com/agbossjs/agboss-examples/tree/main/06-enterprise-agent-mesh)** | **Federated multi-service Agent Mesh & Mesh Hub:** Multiple `@Application` services communicating over A2A with Ed25519-signed `MeshEnvelope` (`agboss-mesh`), `caller-budget` propagation, cycle detection, and cross-service topology visualization. | `@A2AExpose`, `@A2AAgent`, `a2aHttpListener`, `A2ACallerResolver`, `agboss check --federation`, `agboss hub show --html` |
| **[`07-langgraph-migration-smoke`](https://github.com/agbossjs/agboss-examples/tree/main/07-langgraph-migration-smoke)** | **LangGraph-to-AGBoss migration reference:** Side-by-side migration of a raw LangGraph `StateAnnotation` / `addConditionalEdges` / `Send` / `interrupt` graph into typed AGBoss components using skill `13-migrating-from-langgraph.md`. | `@Dto`, `@Router`, `.switch(caseOf())`, `.toParallelAgents()`, `@ChannelRole` |

### Spotlight: `02-path-scope-proof` (4 Graph Bugs Caught Before Runtime)

In [`02-path-scope-proof`](https://github.com/agbossjs/agboss-examples/tree/main/02-path-scope-proof), the same four broken workflows are written twice — once in raw LangGraph (`src/langgraph/`) with `Annotation.Root` where every fields bag is optional/defaulted and `tsc --noEmit` exits `0`, and once in AGBoss (`src/agboss/`) where `npx agboss check` rejects all four before a single model call or side effect runs:

1. **Missing input on a branch (`[input.missing-on-path]`):** Branch B of a router skips the step that produces `FraudScoreDto`, yet a downstream node reads `fraudScore`. Raw LangGraph silently receives `undefined` at runtime; `agboss check` halts at compile time.
2. **Stale data after a review loop (`[input.outdated-on-path]`):** A draft is revised in a loop (`OfferDraftDto`), making the earlier `LegalReviewDto` (which was `{ about: OfferDraftDto }`) stale. Raw LangGraph ships the outdated approval; `agboss check` requires re-running the reviewer after revision.
3. **Parallel branch outdating a sibling (`[launch.branch-outdates-sibling]`):** One parallel branch rewrites a DTO that a sibling branch is simultaneously reading or reviewing. `agboss check` rejects the race condition statically.
4. **Uncompensated side effect (`[flow.uncompensated-action]`):** A payment or reservation `@Action` is followed by a step that can fail without declaring `compensateWith` or `committedBy` (or an explicit `.onError` rollback path). `agboss check` refuses to compile the dangling side effect.

---

## How the `examples/job-scout` application works

`examples/job-scout` reads a candidate's resume from disk, proposes a structured search brief, fetches live openings from public Greenhouse boards, ranks every match using the Jev decision model (`JobFitJudge`), explains why top matches fit using a SQLite FTS5 `@Rag` knowledge base (`company_notes`), and saves selected jobs through the official filesystem `@McpServer` after pausing for user approval (`TerminalUserChannel`):

<!-- snippet-context
import {
  ChatWorkflowFinish,
  ChatWorkflowStart,
  JobFitJudge,
  MainRouter,
  ProfilerAgent,
  ScoutAgent,
  ShortlistAgent,
} from "./job-scout.components.js";
-->
```ts title="src/job-scout.workflow.ts" file=job-scout.workflow.ts
import { Workflow, route, start } from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";

@Workflow({
  name: "job-scout-workflow",
  version: "1.0.0",
  flow: [
    start(ChatWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toRouter(MainRouter)
      .chooseOne(
        route(ProfilerAgent)
          .toFinish(ChatWorkflowFinish),
        route(ScoutAgent)
          .toFinish(ChatWorkflowFinish),
        route(ShortlistAgent)
          .toFinish(ChatWorkflowFinish),
      ),
  ],
  defaults: {
    models: { temperature: 0 },
    router: { model: "typesafe/jev-1.13" },
    tools: { maxToolCalls: 8 },
  },
  providers: [JobFitJudge],
})
export class JobScout {}
```

```ts title="src/job-scout.components.ts" file=job-scout.components.ts
import { Agent, DecidedBy, Injectable, Router, WorkflowFinish, WorkflowStart } from "agboss";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "agboss/dto";

@WorkflowStart({ name: "chat-workflow-start", description: "A message", input: WorkflowStartTextDto })
export class ChatWorkflowStart {}

@WorkflowFinish({ name: "chat-workflow-finish", description: "The answer", output: WorkflowFinishTextDto })
export class ChatWorkflowFinish {}

@Agent({ name: "profiler-agent", description: "Reads the resume", prompt: "Read the resume.", model: "moonshotai/kimi-k2.6" })
export class ProfilerAgent {}

@Agent({ name: "scout-agent", description: "Finds jobs", prompt: "Find jobs.", model: "moonshotai/kimi-k2.6" })
export class ScoutAgent {}

@Agent({ name: "shortlist-agent", description: "Saves jobs", prompt: "Save shortlist.", model: "moonshotai/kimi-k2.6" })
export class ShortlistAgent {}

@Router({
  name: "main-router",
  description: "Sends the message to the agent that answers it",
  decidedBy: DecidedBy.Model,
  prompt: "Pick the agent that answers the message.",
  input: { message: WorkflowStartTextDto },
  routes: [
    { prompt: "Reading the resume", target: ProfilerAgent },
    { prompt: "Finding jobs", target: ScoutAgent },
    { prompt: "Managing the shortlist", target: ShortlistAgent },
  ],
})
export class MainRouter {}

@Injectable()
export class JobFitJudge {}
```

<!-- snippet-context
import { Budget, BudgetPeriod, BudgetScope, type BudgetHandler } from "agboss";
import { usd, type Usd } from "agboss/units";
@Budget({ name: "js-ex-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class JsExAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(50); } }
@Budget({ name: "js-ex-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class JsExTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "js-ex-exec-budget", scope: BudgetScope.Execution })
export class JsExExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }
// @snippet
-->
```ts title="test/job-scout.workflow.test.ts" file=job-scout.workflow.test.ts
import { Application, EmptyEnvironment } from "agboss";
import { expect } from "vitest";
import { replyWith, routeTo, testWith } from "agboss/testing";
import { JobScout } from "./job-scout.workflow.js";
import {
  ChatWorkflowFinish,
  ChatWorkflowStart,
  MainRouter,
  ScoutAgent,
} from "./job-scout.components.js";

@Application({
  name: "job-scout-example-app",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [JobScout],
  budgets: [JsExAppBudget, JsExTenantBudget, JsExExecBudget],
})
export class JobScoutExampleApp {}

const test = testWith(JobScoutExampleApp);

test("routes job search queries through MainRouter to ScoutAgent", async ({
  app,
  mockLlm,
}) => {
  mockLlm(MainRouter).thenReturn(routeTo(ScoutAgent));
  mockLlm(ScoutAgent).thenReturn(
    replyWith("Found 2 matching Staff TypeScript roles."),
  );

  const result = await app.execute(ChatWorkflowStart, {
    text: "Find Staff TypeScript roles",
  });
  expect(result.finish).toBe(ChatWorkflowFinish);
  expect(result.output).toEqual({
    text: "Found 2 matching Staff TypeScript roles.",
  });
});
```

Run `examples/job-scout` from the repository root:

```bash
npm install && npm run build
cd examples/job-scout
npm run chat
npm run describe
```

## What patterns are demonstrated in `examples/flow-patterns`?

`examples/flow-patterns` (`src/flow-patterns.application.ts`) demonstrates four advanced AGBoss workflow patterns tested 100% offline with `testWith` and `agboss check`:

- **`src/offer/` (Review loop with `{ about }`):** `draft-agent` → `reviewer-agent` returning `oneOf(ChangesRequestedDto, DraftApprovedDto)`. When changes are requested, `caseOf(ChangesRequestedDto, { about: OfferDraftDto })` routes to `editor-agent` (`maxVisits: 2`), with `.onError(VisitsLimitExceededError, ...)` handling exhausted review cycles.
- **`src/credit/` (Code router beside model router):** Combines a Jev model router with `credit-limit-router` (`DecidedBy.Code`), routing small orders to `charge-card-action` and larger orders to `approval-agent`.
- **`src/review/` (Parallel launches in waves):** Runs a reviewer per document section via `.toParallelAgents(...)`, joins their outputs, and launches a second wave with a critic alongside parallel fact-checker copies.
- **`src/topic/` (Recursive `ThisWorkflow`):** Researches broad topics by launching `.toParallelWorkflows(ThisWorkflow, { maxItems })` with `@Workflow({ maxDepth: 3 })`.

Inspect the pattern application directly with the CLI:

```bash
cd examples/flow-patterns
npx agboss describe --application src/flow-patterns.application.ts
npm test
```
