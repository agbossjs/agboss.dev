---
title: "Examples: flow-patterns, job-scout & Two-Tier Showcase"
description: Explore the $0 examples/flow-patterns verification suite in the core agboss repo alongside the two-tier agbossjs/examples showcase — 8 focused 15-minute tutorials (01–08) and 4 production reference architectures.
---

AGBoss organizes runnable examples across two complementary layers so you can both verify every control-flow primitive in seconds for `$0` and study complete production reference architectures:

1. **In-repo `$0` verification (`examples/flow-patterns` & `examples/job-scout` in `agbossjs/agboss`):** `examples/flow-patterns` runs in `< 5 seconds` for `$0` on `mockLlm` to verify every Path Scope and concurrency pattern in CI, alongside `examples/job-scout`.
2. **Two-Tier `agbossjs/examples` Showcase Repository:**
   - **Tier 1 — Focused Step-by-Step Tutorials (`01` to `08`):** Self-contained 15-minute examples introducing 1–2 AGBoss concepts at a time.
   - **Tier 2 — Production Reference Architectures (`production/`):** Four end-to-end production harnesses (`support-refund-evals`, `job-scout-reference`, `enterprise-agent-mesh`, and `kubernetes-postgres-scaling`).

---

## Tier 1 & Tier 2: The `agbossjs/examples` Showcase Architecture

### Tier 1: Focused 15-Minute Step-by-Step Tutorials (`01`–`08`)

Each tutorial in Tier 1 focuses on 1–2 architectural concepts, compiles with `npx agboss check`, and passes `npm test` in milliseconds:

| Tutorial | Concepts Introduced | Key Primitives |
| :--- | :--- | :--- |
| **`01-hello-typed-flow`** | Single-agent typed flow & Path Scope | `@Application`, `@Workflow`, `@WorkflowStart`, `@Agent`, `@WorkflowFinish`, `@Dto` |
| **`02-code-and-model-routing`** | Deterministic vs LLM routing & unions | `@Router` (`DecidedBy.Code` & `DecidedBy.Model`), `.chooseOne(route())`, `.switch(caseOf())`, `oneOf` |
| **`03-review-loop-and-judges`** | Bounded review cycles & quality gates | `.returns(Dto, { about })`, `historyOf(Dto, { limit })`, `maxVisits`, `@Judge` (`DecidedBy.Code` & `DecidedBy.Model`) |
| **`04-parallel-quorum-and-arbiters`** | Parallel waves & quorum voting | `.toParallelAgents()`, `.toParallelWorkflows()`, `.joinQuorum()`, `@Arbiter`, `SpawnPolicy` |
| **`05-tools-interceptors-and-mcp`** | Tool loops, interceptors & MCP | `@Tool`, `@ToolInterceptor` (`ToolCallDecision.replyToModel`), `@McpServer`, `@McpTool`, `@McpExpose` |
| **`06-human-approval-and-sagas`** | Human-in-the-loop pauses & LIFO sagas | `@ChannelRole`, `@Channel`, `app.resume({ pauseId, decision })`, `@Action({ compensateWith, committedBy })` |
| **`07-memory-compaction-and-pii`** | Thread compaction, RAG & PII boundaries | `@Compaction` (`SummaryQueue`, `CompactionStrategy.Custom`), `@Rag`, `@PiiPolicy` (`replaceWithToken`), `@InputGuardrail` |
| **`08-eval-funnel-and-vcr`** | 5-Loop Verification Funnel & VCR | `testWith`, 10 unit runners, `toHaveCalledTools`, `VCRMode.RECORD_STALE`, `@EvalSuite` (`pass@k` / `pass^k`, Cohen's $\kappa$) |

### Tier 2: Production Reference Architectures (`production/`)

| Reference Architecture | What It Demonstrates End-to-End |
| :--- | :--- |
| **`production/support-refund-evals`** | Full [5-Loop Verification Funnel](/concepts/verification-funnel/) in action: `@ToolInterceptor` tenant ACLs, LIFO refund sagas, VCR cassettes (`[vcr.stale-cassette]`), `@EvalSuite` Fail-Fast cascades (`pass^5` vs `--baseline`), and `agboss eval calibrate` ($\kappa \ge 0.80$). |
| **`production/job-scout-reference`** | Multi-agent career assistant combining `MainRouter`, Greenhouse `@Tool` boards, `JobFitJudge` (`typesafe/jev-1.13`), SQLite FTS5 `@Rag` (`company_notes`), filesystem `@McpServer`, and interactive `@Channel` approval pauses. |
| **`production/enterprise-agent-mesh`** | Multi-service Agent Mesh across 3 `@Application` services communicating via `@A2AAgent`, `a2aHttpListener(app, { start, callerResolver })`, Ed25519-signed `MeshEnvelope` (`agboss-mesh`), `caller-budget` propagation, `MeshLoopDetectedError`, and `$ agboss check --federation`. |
| **`production/kubernetes-postgres-scaling`** | Multi-pod Kubernetes deployment with all 7 repository contracts, 30s execution leases, `SIGTERM` graceful drain, `@HealthCheck` (`checkLiveness` / `checkReadiness`), `maxConcurrentSteps` backpressure, and `OpenRouterProvider` quantization pinning. |

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
