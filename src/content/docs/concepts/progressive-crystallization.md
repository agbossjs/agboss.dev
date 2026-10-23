---
title: Progressive Crystallization
description: How to evolve stochastic DecidedBy.Model routers and multi-tool @Agent loops into deterministic DecidedBy.Code routers and @Action steps using agboss describe --json (configHash, promptHash, schemaHash) and execution traces.
---

One of the costliest anti-patterns in production AI engineering is **permanent stochasticity**: keeping every routing decision and multi-step tool sequence inside an LLM call long after the underlying domain patterns have stabilized.

Early in a feature's lifecycle, you *want* the flexibility of [`DecidedBy.Model`](/reference/router/) routers and multi-tool [`@Agent`](/reference/agent/) loops so your system can handle messy, unanticipated user inputs. Over weeks of production traffic, however, 80–95% of executions often follow repeatable structural patterns:
- A `DecidedBy.Model` router consistently picks `EnterpriseApprovalAgent` whenever `order.amountCents > 100_000` or `order.region === "EU"`.
- An `@Agent` with four `@Tool` bindings calls `FetchInvoiceTool` followed immediately by `ValidateTaxIdTool` in the exact same order on 99% of runs.

**Progressive Crystallization** is the architectural practice of systematically identifying these settled stochastic **Desire Paths** via content-addressed revision hashes (`agboss describe --json`), multi-run `pass@k` vs `pass^k` reliability benchmarks, and execution traces (`ExecutionRecord` and Langfuse / OpenTelemetry spans), and replacing them in place without changing neighbor contracts:
- `DecidedBy.Model` `@Router` and `@Arbiter` $\to$ `DecidedBy.Code` (`0ms` LLM latency, `$0.00` token spend)
- `DecidedBy.Model` `@InputGuardrail`, `@OutputGuardrail`, and `@Judge` $\to$ `DecidedBy.Code` (`GuardrailHandler` / deterministic `JudgeHandler` inspecting DTOs and `toolCalls` at `$0.00` cost)
- Repetitive `@Tool` sequences inside an `@Agent` $\to$ deterministic `@Action` steps or `@ToolInterceptor` gates
- Model-summarized `@Compaction` $\to$ `CompactionStrategy.Custom` (`CompactionHandler`) writing structured facts into a knowledge graph or vector store
- Human-in-the-loop `ChannelOutcome.awaitReply()` pauses on low-risk cases $\to$ immediate auto-approved `ChannelOutcome.decided(...)`

---

## Step 1: Content-Addressed Revision Snapshots (`agboss describe --json`)

In typical agent frameworks, production traces in Langfuse or OpenTelemetry quickly drift from the Git repository: when looking at a trace from yesterday, neither an engineer nor an AI coding agent can tell whether the prompt text, DTO schema, or graph topology has changed since that run.

In AGBoss, `npx agboss describe --json` exports a deterministic, machine-readable snapshot of your entire `@Application` without requiring any API keys:

```bash
npx agboss describe --json
```

The JSON envelope includes three cryptographic content hashes:

| Hash Field | Scope | What It Hashes |
| :--- | :--- | :--- |
| **`configHash`** | Per `@Workflow` | Complete graph topology: start/finish nodes, step sequence, `.switch()` / `.chooseOne()` edges, `.joinQuorum()` rules, and `.onError()` paths |
| **`promptHash`** | Per `@Agent` / `@Router` / `@Arbiter` / `@Guardrail` | Resolved system prompt template (`prompt` + `promptUrls`) and model configuration |
| **`schemaHash`** | Per DTO Class | Normalized JSON Schema compiled from `@Text`, `@Integer`, `@Decimal`, `@Flag`, `@OneOf`, `@ListOf`, and `@Nested` decorators |

Every `ExecutionRecord` (`result.record`) and step trace emitted to [`OnExecutionEnd`](/guides/observability-and-tracing/) records these exact hashes (`configHash`, `promptHash`, `schemaHash`).

---

## Step 2: Crystallizing a `DecidedBy.Model` Router into `DecidedBy.Code`

Suppose you launch a workflow with a `DecidedBy.Model` router (`OrderTriageModelRouter`) that classifies incoming orders using a fast decision model (`typesafe/jev-1.13`). Once execution traces for `OrderTriageModelRouter`'s `promptHash` and `OrderTriageDto`'s `schemaHash` confirm that the routing boundary is a pure function of `OrderTriageDto` fields (or a deterministic database lookup via an `@Injectable()` service), you (or your coding agent) crystallize the router in place by switching `decidedBy` to `DecidedBy.Code`:

<!--
```ts file=src/routers/order-triage.contracts.ts
import { Action, Agent, type ActionHandler, type InputOf, type OutputOf } from "agboss";
import { Flag, Integer, Text } from "agboss/dto";

export class OrderTriageDto {
  @Text({ prompt: "Customer tier: free or enterprise" })
  tier!: string;

  @Integer({ min: 0, prompt: "Total order value in cents" })
  amountCents!: number;

  @Flag({ prompt: "Whether the shipping address is international" })
  isInternational!: boolean;
}

@Agent({ name: "compliance-review-agent", description: "Reviews order", model: "moonshotai/kimi-k2.6", prompt: "Review.", input: { order: OrderTriageDto }, output: OrderTriageDto })
export class ComplianceReviewAgent {}

@Action({ name: "fast-track-capture-action", description: "Captures order", input: { order: OrderTriageDto }, output: OrderTriageDto })
export class FastTrackCaptureAction implements ActionHandler<FastTrackCaptureAction> {
  execute(input: InputOf<FastTrackCaptureAction>): Promise<OutputOf<FastTrackCaptureAction>> { return Promise.resolve(input.order.value); }
}
```
-->
<!-- snippet-context
import { ComplianceReviewAgent, FastTrackCaptureAction } from "./order-triage.contracts.js";
// @snippet
-->
```ts title="src/routers/order-triage-model.router.ts" file=src/routers/order-triage-model.router.ts
import { DecidedBy, Router } from "agboss";
import { Flag, Integer, Text } from "agboss/dto";

export class OrderTriageDto {
  @Text({ prompt: "Customer tier: free or enterprise" })
  tier!: string;

  @Integer({ min: 0, prompt: "Total order value in cents" })
  amountCents!: number;

  @Flag({ prompt: "Whether the shipping address is international" })
  isInternational!: boolean;
}

@Router({
  name: "order-triage-model-router",
  description: "Routes orders to compliance review or fast-track capture",
  decidedBy: DecidedBy.Model,
  model: "typesafe/jev-1.13",
  prompt: "Route international orders or orders over $5,000 to compliance review; fast-track the rest.",
  input: { order: OrderTriageDto },
  routes: [
    {
      target: ComplianceReviewAgent,
      prompt: "Order requires manual or automated export/value compliance review",
    },
    {
      target: FastTrackCaptureAction,
      prompt: "Domestic standard order eligible for immediate capture",
    },
  ],
})
export class OrderTriageModelRouter {}
```

<!-- snippet-context
import { Workflow, WorkflowFinish, WorkflowStart, route, start } from "agboss";
import { ComplianceReviewAgent, FastTrackCaptureAction, OrderTriageDto } from "./order-triage.contracts.js";
export { ComplianceReviewAgent, FastTrackCaptureAction };
// @snippet
@WorkflowStart({ name: "triage-workflow-start", description: "Start", input: OrderTriageDto })
export class TriageStart {}
@WorkflowFinish({ name: "triage-workflow-finish", description: "Finish", output: OrderTriageDto })
export class TriageFinish {}
@Workflow({
  name: "order-triage-workflow",
  version: "1.0.0",
  flow: [
    start(TriageStart)
      .returns(OrderTriageDto)
      .toRouter(OrderTriageRouter)
      .chooseOne(
        route(ComplianceReviewAgent)
          .returns(OrderTriageDto)
          .toFinish(TriageFinish),
        route(FastTrackCaptureAction)
          .returns(OrderTriageDto)
          .toFinish(TriageFinish),
      ),
  ],
})
export class OrderTriageWorkflow {}
-->
```ts title="src/routers/order-triage.router.ts" file=src/routers/order-triage.router.ts
import {
  DecidedBy,
  Router,
  type InputOf,
  type Route,
  type RouterHandler,
} from "agboss";

@Router({
  name: "order-triage-router",
  description: "Deterministically routes international or high-value orders to compliance review",
  decidedBy: DecidedBy.Code,
  input: { order: OrderTriageDto },
  routes: [
    { target: ComplianceReviewAgent },
    { target: FastTrackCaptureAction },
  ],
})
export class OrderTriageRouter implements RouterHandler<OrderTriageRouter> {
  route(input: InputOf<OrderTriageRouter>): Route<OrderTriageRouter> {
    const { amountCents, isInternational } = input.order.value;
    return isInternational || amountCents > 500_000
      ? ComplianceReviewAgent
      : FastTrackCaptureAction;
  }
}
```

```ts title="test/order-triage.router.test.ts" file=test/order-triage.router.test.ts
import { expect, it } from "vitest";
import { testRouter } from "agboss/testing";
import {
  ComplianceReviewAgent,
  FastTrackCaptureAction,
  OrderTriageRouter,
  TriageStart,
} from "../src/routers/order-triage.router.js";

it("verifies crystallized DecidedBy.Code router with zero LLM calls", async () => {
  const runRouter = testRouter(OrderTriageRouter);

  const highValue = await runRouter({
    order: {
      value: { tier: "enterprise", amountCents: 750_000, isInternational: false },
      producer: TriageStart,
    },
  });
  expect(highValue.output).toBe(ComplianceReviewAgent);

  const standard = await runRouter({
    order: {
      value: { tier: "free", amountCents: 25_000, isInternational: false },
      producer: TriageStart,
    },
  });
  expect(standard.output).toBe(FastTrackCaptureAction);
});
```

Notice what **did not change**:
- The `@Workflow` definition (`*.workflow.ts`) is completely untouched — `.toRouter(OrderTriageRouter).chooseOne(...)` works identically whether `OrderTriageRouter` is `DecidedBy.Model` or `DecidedBy.Code`.
- Downstream Path Scope availability (`Produced<Dto, P>`) is preserved.
- Latency for this node drops from ~150–400ms to `<0.1ms`, and token spend drops to `$0.00`.

---

## Step 3: Crystallizing Repetitive `@Tool` Chains into an `@Action`

A second prime target for crystallization is an `@Agent` whose traces show a fixed sequence of tool calls before producing a structured DTO.

Instead of paying an LLM to orchestrate `ToolA -> ToolB` on every turn:
1. Extract the deterministic API/database calls into an [`@Injectable()`](/reference/injectable/) service or a dedicated [`@Action`](/reference/action/) node upstream of the `@Agent`.
2. Wire `.toAction(FetchAndEnrichAction).returns(EnrichedContextDto).toAgent(AnalystAgent)` in the workflow.
3. Now the deterministic data fetching executes with `0` LLM tokens and full [`ExecutionContext.step.idempotencyKey`](/concepts/application/) deduplication, while `AnalystAgent` receives the pre-fetched `EnrichedContextDto` in a single, KV-cache-friendly turn.

---

## Step 4: Discovering Crystallization Candidates (`pass@k` vs `pass^k`) & Verifying Zero Regression

When running an `@EvalSuite` with `--runs <k>` (for example, `k = 5`), AGBoss reports two complementary metrics for every case:
- **`pass@k` ($\ge 1$ of $k$ runs passed):** Measures whether the model *can* solve the task.
- **`pass^k` ($k$ of $k$ runs passed):** Measures whether the workflow solves the task *reliably* on every production execution.

A case with **high `pass@k` (`1.00`) but low `pass^k` (`0.20`–`0.60`)** is the canonical signal of a stochastic step that should be crystallized into a `DecidedBy.Code` router, guardrail, `@ToolInterceptor`, or `@Action`.

Before promoting a crystallized component to production, verify that end-to-end quality, routing accuracy, and [`@Judge`](/reference/judge/) pass rates remain identical (while cost and latency drop):

```bash
# 1. Capture recent production/staging tasks into a reusable golden dataset:
npx agboss golden add --name order-triage-core --from-last 20

# 2. Compare baseline vs candidate profile on the exact same golden tasks:
npx agboss compare --profiles base,candidate --golden order-triage-core

# 3. Run the evaluation suite across k=5 trials and gate against the main branch baseline:
$ agboss eval run --suite order-triage-eval-suite --runs 5 --baseline .artifacts/eval/main.json --fail-on-regression
```

See [Evaluation, Golden Sets & A/B Profiles](/guides/evaluation-and-profiles/) for full details on `@EvalSuite`, `pass@k` / `pass^k`, and CI regression gates.
