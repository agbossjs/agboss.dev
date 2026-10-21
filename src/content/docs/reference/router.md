---
title: "@Router"
description: Complete API reference for @Router in AGBoss — DecidedBy.Model vs DecidedBy.Code, SpawnPolicy, FailurePolicy, RouterHandler, and testRouter().
---

The `@Router` decorator defines a control-flow decision node (`routers/*.router.ts`) in AGBoss. Routers decouple orchestration from domain agents and come in two forms discriminated by `decidedBy`: **`DecidedBy.Model`** (where a fast classifier model like `typesafe/jev-1.13` picks the target route from prompt criteria) and **`DecidedBy.Code`** (where deterministic TypeScript in `route(input)` with constructor DI picks the target at zero LLM cost and zero latency).

## What options does `@Router` accept?

Every `@Router` class name ends with `Router` and its `name` option ends with `-router`:

| Option | Applies To | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | Both | `string` | Yes | Unique kebab-case identifier ending with `-router` (e.g., `"main-router"`). |
| `description` | Both | `string` | Yes | Describes what decision this router makes. |
| `decidedBy` | Both | `DecidedBy.Model \| DecidedBy.Code` | Yes | Selects whether an LLM/decision model or a TypeScript `route(input)` method chooses the branch. |
| `input` | Both | `InputFields` | Yes | Non-empty map of DTOs read from Path Scope (`[router.empty-input]` if empty). |
| `routes` | Both | `readonly [RouterRoute, ...]` | Yes | List of allowed `target` components; must match the targets in `.chooseOne(route(...))` or `.toParallelAgents(...)` (`[router.routes-mismatch]`). |
| `maxVisits` | Both | `number` | No | Maximum visits per execution before throwing `VisitsLimitExceededError`. |
| `model` | `DecidedBy.Model` | `string` | No | Decision model (`"typesafe/jev-1.13"`) or chat model; inherits `defaults.router.model` when omitted. |
| `prompt` / `promptUrls` | `DecidedBy.Model` | `string` / `readonly string[]` | No | Instructions telling the model how to evaluate the input and select a route. |
| `promptVariables` | `DecidedBy.Model` | `Readonly<Record<string, string>>` | No | Static `{{key}}` variables interpolated into the router's prompt. |
| `piiPolicies` | `DecidedBy.Model` | `readonly Class[]` | No | `@PiiPolicy` classes masking inputs before they reach the router model. |
| `deps` | `DecidedBy.Code` | `readonly Token[]` | No | Constructor dependencies (`ExecutionContext`, `@Injectable` services) injected into the code router class. |

### Route entry options (`routes: [...]`)

Each item in `routes` configures a branch target for `.chooseOne(route(...))` or `.toParallelAgents(...)`:

| Route Field | Type | Description |
| :--- | :--- | :--- |
| `target` | `ComponentClass` | Target `@Agent`, `@Action`, `@Router`, or `@WorkflowFinish` class. |
| `prompt` | `string` | Required on `DecidedBy.Model` routes with `SpawnPolicy.OnDemand`; describes when the model should select `target`. Forbidden on `DecidedBy.Code` routes. |
| `spawn` | `SpawnPolicy.Always \| SpawnPolicy.OnDemand` | Used before `.toParallelAgents(...)`: `Always` launches unconditionally alongside chosen branches; `OnDemand` launches only when chosen by the router. |
| `failure` | `FailurePolicy.FailFast \| FailurePolicy.Skip` | Used before `.toParallelAgents(...)`: whether a failure in this target fails the parallel join (`FailFast`, default) or drops out (`Skip`). |

## Complete `@Router` examples (`DecidedBy.Model` and `DecidedBy.Code`)

```ts title="src/routers/support.routers.ts" no-check: reference example
import { DecidedBy, FailurePolicy, Router, SpawnPolicy, type InputOf, type RouteOf, type RouterHandler } from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";
import { BillingAgent, RefundAgent, TechnicalSupportAgent, AuditLogAgent } from "../agents/support.agents.js";
import { OutOfScopeWorkflowFinish } from "../workflow-finishes/out-of-scope.workflow-finish.js";
import { OrderPolicyService } from "../services/order-policy.service.js";
import { OrderClaimDto } from "../dto/order.dto.js";

// 1. Model-decided router (DecidedBy.Model — empty class, no route() method):
@Router({
  name: "intent-triage-router",
  description: "Routes incoming customer messages to the matching specialist or stops out-of-scope requests",
  decidedBy: DecidedBy.Model,
  model: "typesafe/jev-1.13",
  input: {
    message: WorkflowStartTextDto,
  },
  prompt: "Classify the user's support request and choose the most specific handler.",
  maxVisits: 3,
  routes: [
    {
      target: RefundAgent,
      prompt: "The customer is asking for a refund, chargeback, or order cancellation",
    },
    {
      target: BillingAgent,
      prompt: "The customer is asking about an invoice, receipt, or subscription charge",
    },
    {
      target: TechnicalSupportAgent,
      prompt: "The customer is reporting a bug, outage, or API integration problem",
    },
    {
      target: OutOfScopeWorkflowFinish,
      prompt: "Stop and send the answer: The request is unrelated to billing, refunds, or technical support",
    },
  ],
})
export class IntentTriageRouter {}

// 2. Code-decided router (DecidedBy.Code — implements RouterHandler<Self> with constructor DI):
@Router({
  name: "claim-tier-router",
  description: "Selects which specialist agents to launch based on deterministic order policy rules",
  decidedBy: DecidedBy.Code,
  input: {
    claim: OrderClaimDto,
  },
  deps: [OrderPolicyService],
  routes: [
    { target: AuditLogAgent, spawn: SpawnPolicy.Always, failure: FailurePolicy.Skip },
    { target: RefundAgent, spawn: SpawnPolicy.OnDemand },
    { target: BillingAgent, spawn: SpawnPolicy.OnDemand },
  ],
})
export class ClaimTierRouter implements RouterHandler<ClaimTierRouter> {
  constructor(private readonly orderPolicy: OrderPolicyService) {}

  async route(input: InputOf<ClaimTierRouter>): Promise<RouteOf<ClaimTierRouter>> {
    const requiresBillingReview = await this.orderPolicy.requiresFinanceSignOff(input.claim.amountCents);
    return requiresBillingReview ? [RefundAgent, BillingAgent] : RefundAgent;
  }
}
```

```ts title="src/workflows/support-routing.workflow.ts" no-check: reference example
import { SpawnPolicy, Workflow, route, start } from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";
import { ClaimTierRouter, IntentTriageRouter } from "../routers/support.routers.js";

@Workflow({
  name: "support-routing-workflow",
  version: "1.0.0",
  flow: [
    start(SupportStart)
      .returns(WorkflowStartTextDto)
      .toRouter(IntentTriageRouter)
      .chooseOne(
        route(BillingAgent)
          .toFinish(SupportFinish),
        route(RefundAgent)
          .toFinish(SupportFinish),
        route(TechnicalSupportAgent, { spawn: SpawnPolicy.OnDemand })
          .toFinish(SupportFinish),
        route(OutOfScopeWorkflowFinish),
      ),
  ],
})
export class SupportRoutingWorkflow {}
```

## What related entities work with `@Router`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `DecidedBy`, `SpawnPolicy`, `FailurePolicy` | `"agboss"` | Enums controlling decision mode (`Model` vs `Code`), parallel launch selection (`Always` vs `OnDemand`), and branch failure handling (`FailFast` vs `Skip`). |
| `RouterHandler<Self>` & `RouteOf<Self>` | `"agboss"` | Contract and return type for `DecidedBy.Code` routers (`route(input)` returns one target for `.chooseOne()` or one/many targets for `.toParallelAgents()`). |
| `.toRouter(R).chooseOne(route(Target)...)` | `"agboss"` | Connects a router to exclusive branch paths in `@Workflow({ flow })`. |
| `.toRouter(R).toParallelAgents(...)` | `"agboss"` | Uses a router to dynamically select which subset of `SpawnPolicy.OnDemand` agents to launch in parallel alongside `SpawnPolicy.Always` agents. |
| `RouterFailedError` & `RouterDecisionError` | `"agboss"` | Errors thrown when a router cannot select a valid route; catchable in the flow via `.onError(RouterFailedError, sidePath)`. |
| `testRouter(RouterClass, options?)` | `"agboss/testing"` | Unit runner that tests a model or code router in isolation without booting the workflow. |

### Unit-testing a `@Router` with `testRouter`

```ts title="test/support.routers.test.ts" no-check: reference example
import { expect, it } from "vitest";
import { decideWith, override, testRouter } from "agboss/testing";
import { ClaimTierRouter, IntentTriageRouter } from "./support.routers.js";
import { RefundAgent, BillingAgent } from "../agents/support.agents.js";

it("tests both a model router and a code router in isolation", async () => {
  const runModelRouter = testRouter(IntentTriageRouter, {
    decision: decideWith(RefundAgent),
  });
  const modelPicked = await runModelRouter({
    message: { text: "Please cancel my order and refund my card" },
  });
  expect(modelPicked.target).toBe(RefundAgent);

  const runCodeRouter = testRouter(ClaimTierRouter);
  const codePicked = await runCodeRouter({
    claim: { orderId: "A-1042", amountCents: 250_00 },
  });
  expect(codePicked.targets).toEqual([RefundAgent, BillingAgent]);
});
```

```ts title="src/dto/claim.dto.ts" no-check: reference example
import { Integer, Text } from "agboss/dto";

export class ClaimDto {
  @Text() claimId!: string;
  @Integer() amountCents!: number;
}
```
