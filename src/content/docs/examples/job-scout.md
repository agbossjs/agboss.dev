---
title: "Examples: 7 Verified Applications (01–07), flow-patterns & job-scout"
description: Explore the 7 standalone verified examples in agbossjs/agboss-examples (01–07) alongside examples/flow-patterns and examples/job-scout in agbossjs/agboss.
---

AGBoss provides two complementary repositories of runnable, CI-verified examples so you can prove compile-time and runtime guarantees in seconds for `$0` and inspect production-grade reference architectures.

1. **7 Standalone Verified Examples ([`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples)):** Seven self-contained applications (`01-hello-agboss` through `07-langgraph-migration`) following the **`Promise → Failure Injection → Reproducible Proof`** discipline — each with its own `package.json`, canonical `1 class = 1 file` component subfolder layout, symmetric Spring-style `tests/` mirroring `src/`, `.claude/skills/agboss/`, `npx agboss check`, and `$0` offline test & demo suites.
2. **In-Repository Examples (`examples/flow-patterns` & `examples/job-scout` in [`agbossjs/agboss`](https://github.com/agbossjs/agboss)):** `examples/flow-patterns` verifies loops, code/model routers, parallel waves, and `ThisWorkflow` recursion in `< 5 seconds` for `$0`, alongside the interactive `examples/job-scout` career assistant.

---

## The 7 Verified Examples in [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples)

| Example | Architectural Proof & Capabilities Demonstrated | Key Primitives & CLI Commands |
| :--- | :--- | :--- |
| **[`01-hello-agboss`](https://github.com/agbossjs/agboss-examples/tree/main/01-hello-agboss)** | **First-run, real HTTP service DI, web server & CLI scaffolding:** Demonstrates `PricingCatalogService` (`async onInit()`, `fetch` with `ExecutionContext.signal` + `step.idempotencyKey`), `src/http/server.ts` (multi-tenant headers, `202 Accepted` on pauses, `/api/pauses/:pauseId/resume`, `/health/live`, `/health/ready`), and canonical `1 class = 1 file` + symmetric `tests/` layout. | `@Application`, `@Workflow`, `@Agent`, `@Router`, `@Tool`, `@Injectable`, `testWith`, `mockOf` |
| **[`02-path-scope-proof`](https://github.com/agbossjs/agboss-examples/tree/main/02-path-scope-proof)** | **Compile-time Path Scope vs raw LangGraph:** Proves 4 structural graph bug classes (`01-missing-input`, `02-outdated-data`, `03-parallel-invalidation`, `04-uncompensated-action`) that pass `tsc --noEmit` in raw LangGraph `Annotation.Root` (`langgraph-broken/`) and are caught before runtime by `agboss check` (`agboss-broken/` vs `agboss-fixed/`). | `[input.missing-on-path]`, `[input.outdated-on-path]`, `[launch.branch-outdates-sibling]`, `[flow.uncompensated-action]` |
| **[`03-support-refund-desk`](https://github.com/agbossjs/agboss-examples/tree/main/03-support-refund-desk)** | **PII roundtrip, tool interception, in-memory BM25 RAG, compaction & 5-layer evals:** Reversible HMAC `@PiiPolicy` (`replaceWithToken`, `revealPii: true`, `PiiRefusedError`), `@ToolInterceptor` (`replyToModel`, `block`), `@InputGuardrail` (`DecidedBy.Code`), `@OutputGuardrail`, `InMemoryKnowledgeIndexService` + `RefundPolicyRetriever` (`@Rag`), `PolicyAwareCompaction`, and `@EvalSuite` with compact git-tracked `eval/baseline/main-baseline.json` and `agboss eval calibrate` (Cohen's $\kappa$). | `@PiiPolicy`, `@ToolInterceptor`, `@InputGuardrail`, `@OutputGuardrail`, `@Rag`, `@Compaction`, `@EvalSuite`, `agboss eval` |
| **[`04-travel-booking-saga`](https://github.com/agbossjs/agboss-examples/tree/main/04-travel-booking-saga)** | **Transactional LIFO sagas, idempotency, quorums, HITL withdrawal & HTTP server:** Reverse-order LIFO compensation across `payment-saga`, `budget-saga`, `quorum-saga` (`.joinQuorum({ min: 2, max: 2 })`), and `hitl-hold-saga` (`Channel.withdraw()`, `NotPausedError`), idempotent external ledgers (`step.idempotencyKey`), SQLite WAL crash recovery, and `src/http/server.ts`. | `@Action({ compensateWith, committedBy })`, `.toParallelAgents().acceptedBy().joinQuorum()`, `@ChannelRole`, `@Channel` |
| **[`05-cluster-work-stealing`](https://github.com/agbossjs/agboss-examples/tree/main/05-cluster-work-stealing)** | **Distributed scheduling, 30s leases, fencing & backpressure:** Parent `CoordinatorWorkflow` fans out `ChunkWorkerWorkflow` with `ChildPlacement.AnyInstance` over `SqliteChildExecutionQueueRepository`, runs bounded recursive `ThisWorkflow` (`maxDepth: 2`), enforces 30s SQLite leases & fencing (`ExecutionLeaseLostError`), `maxConcurrentSteps: 2` backpressure (`HealthComponentKind.StepSlots`), `@HealthCheck`, and `IncompatibleResumeError`. | `ChildPlacement.AnyInstance`, `SqliteChildExecutionQueueRepository`, `ThisWorkflow`, `@HealthCheck`, `SqliteExecutionLeaseRepository` |
| **[`06-enterprise-agent-mesh`](https://github.com/agbossjs/agboss-examples/tree/main/06-enterprise-agent-mesh)** | **3-service A2A + MCP mesh, Ed25519 envelopes, loop guard & federation Blast Radius:** Connects `apps/1-order-gateway`, `apps/2-billing-a2a` (`@A2AExpose`), and `apps/3-catalog-mcp` (`@McpExpose`) with Ed25519-signed `agboss-mesh` JWS envelopes, `MeshLoopDetectedError` / `HopsLimitExceededError`, MCP `_meta.callId` deduplication (`SqliteMeshRequestRepository`), and `agboss check --federation` (`federation/`). | `@A2AExpose`, `@A2AAgent`, `@McpExpose`, `@McpTool`, `SqliteMeshRequestRepository`, `agboss check --federation`, `agboss hub` |
| **[`07-langgraph-migration`](https://github.com/agbossjs/agboss-examples/tree/main/07-langgraph-migration)** | **Side-by-side comparison (`before-langgraph/` vs `after-agboss/`):** Compares a raw 15-field LangGraph `Annotation.Root` God State (`before-langgraph/support.graph.ts`) with the migrated AGBoss implementation (`after-agboss/src/` + `after-agboss/tests/`) using 10 narrow `@Dto`s, `DecidedBy.Model` & `DecidedBy.Code` `@Router`s, bounded `.toParallelAgents()`, idempotent `@Action`, typed `@Channel`, and co-located `.prompt.md` files. | `@Dto`, `@Router`, `.switch(caseOf())`, `.toParallelAgents()`, `@Action`, `@Channel`, `13-migrating-from-langgraph.md` |

### Canonical Project Layout (`1 class = 1 file` & Symmetric `tests/`)

Every project in [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples) enforces a clean, navigable folder convention:
- **1 class per file** with kind-suffixed filenames (`*.application.ts`, `*.workflow.ts`, `*.workflow-start.ts`, `*.workflow-finish.ts`, `*.agent.ts`, `*.router.ts`, `*.action.ts`, `*.tool.ts`, `*.service.ts`, `*.dto.ts`).
- **Component subfolders** grouping each workflow (`src/workflows/<name>/` with its workflow, start, and finishes) and each model-driven component (`src/agents/<name>/` and `src/routers/<name>/` co-locating the `.ts` class with its immutable `.prompt.md` file).
- **Symmetric Spring-style `tests/` directory** mirroring `src/` 1-to-1 (`tests/services/`, `tests/tools/`, `tests/actions/`, `tests/routers/`, `tests/guardrails/`, `tests/interceptors/`, `tests/http/`, `tests/workflows/<name>/`) so coding agents and engineers know immediately where unit and workflow tests belong.

### Spotlight: `02-path-scope-proof` (4 Graph Bugs Caught Before Runtime)

In [`02-path-scope-proof`](https://github.com/agbossjs/agboss-examples/tree/main/02-path-scope-proof), four structural bug cases (`cases/01-missing-input`, `cases/02-outdated-data`, `cases/03-parallel-invalidation`, `cases/04-uncompensated-action`) are each implemented in three variants — `langgraph-broken/` (compiles with `tsc --noEmit` yet fails or corrupts state at runtime), `agboss-broken/` (rejected before runtime by `agboss check --json` with an exact rule code and witness path), and `agboss-fixed/` (passes `agboss check` and executes cleanly):

1. **Missing input on a conditional route (`01-missing-input` → `[input.missing-on-path]`):** The `fast-track` branch of a router skips `ComplianceReview` (`ComplianceApprovalDto`), yet `PublishContract` requires `approval`. Raw LangGraph silently receives `undefined` at runtime; `agboss check` halts at compile time.
2. **Stale data after a revision cycle (`02-outdated-data` → `[input.outdated-on-path]`):** `QualityReviewer` emits `RevisionRequested` (`{ about: ContractDraftDto }`) and `RevisionWriter` replaces `ContractDraftDto`, making the earlier `LegalSignoffDto` stale. Skipping `LegalCheck` on the second pass is rejected by `agboss check`.
3. **Parallel sibling invalidation (`03-parallel-invalidation` → `[launch.branch-outdates-sibling]`):** Inside a parallel launch, `PricingRewriter` replaces `QuoteSheetDto` while its sibling `TaxAudit` concurrently audits the pre-launch `QuoteSheetDto`. `agboss check` rejects the race condition statically.
4. **Uncompensated side effect on an error path (`04-uncompensated-action` → `[flow.uncompensated-action]`):** `ReserveInventory` (`compensateWith: ReleaseInventory`) is followed by `ChargeCard`, whose `.onError(...)` path reaches `OrderFailedFinish` without invoking `ReleaseInventory`. `agboss check` refuses to compile the uncompensated path.

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
