---
title: "@Router"
description: Complete API reference for @Router in AGBoss — DecidedBy.Model vs DecidedBy.Code, SpawnPolicy, FailurePolicy, RouterHandler, and testRouter().
---

The `@Router` decorator defines a control-flow decision node (`routers/*.router.ts`) in AGBoss. Routers decouple orchestration from domain agents and come in two forms discriminated by `decidedBy`: **`DecidedBy.Model`** (where a fast classifier model like `typesafe/jev-1.13` picks the target route from prompt criteria) and **`DecidedBy.Code`** (where deterministic TypeScript in `route(input)` with constructor DI picks the target at zero LLM cost and zero latency).

## Complete `@Router` examples (`DecidedBy.Model` and `DecidedBy.Code`)

```ts title="src/routers/support.routers.ts" file=src/routers/support.routers.ts
import {
  DecidedBy,
  FailurePolicy,
  Router,
  SpawnPolicy,
  type InputOf,
  type RouterAnswerOf,
  type RouterHandler,
} from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
import {
  AuditLogAgent,
  BillingAgent,
  ClaimBillingAgent,
  ClaimRefundAgent,
  OrderPolicyService,
  RefundAgent,
  TechnicalSupportAgent,
} from "../support.components.js";
import { OrderClaimDto } from "../dto/order.dto.js";

// 1. Model-decided router (DecidedBy.Model — empty class, no route() method):
@Router({
  name: "intent-triage-router",
  description: "Routes incoming customer messages to the matching specialist",
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
    { target: ClaimRefundAgent, spawn: SpawnPolicy.OnDemand },
    { target: ClaimBillingAgent, spawn: SpawnPolicy.OnDemand },
  ],
})
export class ClaimTierRouter implements RouterHandler<ClaimTierRouter> {
  constructor(private readonly orderPolicy: OrderPolicyService) {}

  async route(input: InputOf<ClaimTierRouter>): Promise<RouterAnswerOf<ClaimTierRouter>> {
    // Single-value inputs in InputOf<Self> are wrapped in Produced<Dto, Producer> ({ value, producer }):
    const requiresBillingReview = await this.orderPolicy.requiresFinanceSignOff(
      input.claim.value.amountCents,
    );
    return requiresBillingReview ? [ClaimRefundAgent, ClaimBillingAgent] : [ClaimRefundAgent];
  }
}
```

```ts title="src/dto/order.dto.ts" file=src/dto/order.dto.ts
import { Integer, Text } from "@agboss/core/dto";

export class OrderClaimDto {
  @Text() orderId!: string;
  @Integer() amountCents!: number;
}
```

```ts title="src/workflows/support-routing.workflow.ts" file=src/workflows/support-routing.workflow.ts
import { Workflow, listOf, route, start } from "@agboss/core";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "@agboss/core/dto";
import { ClaimTierRouter, IntentTriageRouter } from "../routers/support.routers.js";
import {
  AuditLogAgent,
  BillingAgent,
  ClaimBillingAgent,
  ClaimRefundAgent,
  ClaimStart,
  CombineClaimRepliesAction,
  OrderPolicyService,
  RefundAgent,
  SupportFinish,
  SupportStart,
  TechnicalSupportAgent,
} from "../support.components.js";
import { OrderClaimDto } from "../dto/order.dto.js";

@Workflow({
  name: "support-routing-workflow",
  version: "1.0.0",
  providers: [OrderPolicyService],
  flow: [
    start(SupportStart)
      .returns(WorkflowStartTextDto)
      .toRouter(IntentTriageRouter)
      .chooseOne(
        route(BillingAgent)
          .toFinish(SupportFinish),
        route(RefundAgent)
          .toFinish(SupportFinish),
        route(TechnicalSupportAgent)
          .toFinish(SupportFinish),
      ),

    start(ClaimStart)
      .returns(OrderClaimDto)
      .toRouter(ClaimTierRouter)
      .toParallelAgents(AuditLogAgent, ClaimRefundAgent, ClaimBillingAgent)
      .join()
      .returns(listOf(WorkflowFinishTextDto))
      .toAction(CombineClaimRepliesAction)
      .returns(WorkflowFinishTextDto)
      .toFinish(SupportFinish),
  ],
})
export class SupportRoutingWorkflow {}
```

```ts title="test/support.routers.test.ts" file=test/support.routers.test.ts
import { expect, it } from "vitest";
import { routeTo, testRouter } from "@agboss/core/testing";
import { ClaimTierRouter, IntentTriageRouter } from "../src/routers/support.routers.js";
import {
  ClaimBillingAgent,
  ClaimRefundAgent,
  ClaimStart,
  RefundAgent,
  SupportStart,
} from "../src/support.components.js";

it("tests both a model router and a code router in isolation", async () => {
  const runModelRouter = testRouter(IntentTriageRouter, {
    model: routeTo(RefundAgent),
  });
  const modelPicked = await runModelRouter({
    message: {
      producer: SupportStart,
      value: { text: "Please cancel my order and refund my card" },
    },
  });
  expect(modelPicked.output).toBe(RefundAgent);

  const runCodeRouter = testRouter(ClaimTierRouter);
  const codePicked = await runCodeRouter({
    claim: {
      producer: ClaimStart,
      value: { orderId: "A-1042", amountCents: 250_00 },
    },
  });
  expect(codePicked.output).toEqual([ClaimRefundAgent, ClaimBillingAgent]);
});
```

<!--
```ts file=src/support.components.ts
import {
  Action,
  Agent,
  Injectable,
  WorkflowFinish,
  WorkflowStart,
  listOf,
  type ActionHandler,
  type InputOf,
} from "@agboss/core";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "@agboss/core/dto";
import { OrderClaimDto } from "./dto/order.dto.js";

@Injectable()
export class OrderPolicyService {
  requiresFinanceSignOff(amountCents: number): Promise<boolean> {
    return Promise.resolve(amountCents >= 100_00);
  }
}

@WorkflowStart({ name: "support-workflow-start", description: "Chat start", input: WorkflowStartTextDto })
export class SupportStart {}

@WorkflowStart({ name: "claim-workflow-start", description: "Claim start", input: OrderClaimDto })
export class ClaimStart {}

@WorkflowFinish({ name: "support-workflow-finish", description: "Support finish", output: WorkflowFinishTextDto })
export class SupportFinish {}

@Agent({ name: "refund-agent", description: "Refunds", model: "moonshotai/kimi-k2.6", prompt: "Refund." })
export class RefundAgent {}

@Agent({ name: "billing-agent", description: "Billing", model: "moonshotai/kimi-k2.6", prompt: "Billing." })
export class BillingAgent {}

@Agent({ name: "technical-support-agent", description: "Tech support", model: "moonshotai/kimi-k2.6", prompt: "Support." })
export class TechnicalSupportAgent {}

@Agent({ name: "audit-log-agent", description: "Audit log", model: "moonshotai/kimi-k2.6", prompt: "Audit.", input: { claim: OrderClaimDto } })
export class AuditLogAgent {}

@Agent({ name: "claim-refund-agent", description: "Claim refund", model: "moonshotai/kimi-k2.6", prompt: "Refund claim.", input: { claim: OrderClaimDto } })
export class ClaimRefundAgent {}

@Agent({ name: "claim-billing-agent", description: "Claim billing", model: "moonshotai/kimi-k2.6", prompt: "Billing claim.", input: { claim: OrderClaimDto } })
export class ClaimBillingAgent {}

@Action({
  name: "combine-claim-replies-action",
  description: "Combines parallel claim replies",
  input: { replies: listOf(WorkflowFinishTextDto) },
  output: WorkflowFinishTextDto,
})
export class CombineClaimRepliesAction implements ActionHandler<CombineClaimRepliesAction> {
  execute(input: InputOf<CombineClaimRepliesAction>): Promise<WorkflowFinishTextDto> {
    return Promise.resolve({
      text: input.replies.map((r) => r.value.text).join("\n"),
    });
  }
}
```
-->

<!--
```ts file=src/support-routing.application.ts
import { Application, Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, type BudgetHandler } from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";
import { SupportRoutingWorkflow } from "./workflows/support-routing.workflow.js";

@Budget({ name: "rt-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class RtAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(20); } }
@Budget({ name: "rt-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class RtTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "rt-exec-budget", scope: BudgetScope.Execution })
export class RtExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "support-routing-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [SupportRoutingWorkflow],
  budgets: [RtAppBudget, RtTenantBudget, RtExecBudget],
})
export class SupportRoutingApplication {}
```
-->

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
| `piiPolicies` / `excludePiiPolicies` | `DecidedBy.Model` | `readonly Class[]` | No | `@PiiPolicy` classes masking inputs before they reach the router model. |
| `guardrails` / `excludeGuardrails` | `DecidedBy.Model` | `readonly Class[]` | No | `@InputGuardrail` classes evaluated before the router model runs. |
| `compaction` / `uncompactedTurns` | `DecidedBy.Model` | `Class` / `number \| TurnLimit` | No | Overrides thread compaction or recent turn window for this router. |
| `deps` | `DecidedBy.Code` | `readonly Token[]` | No | Constructor dependencies (`ExecutionContext`, `@Injectable` services) injected into the code router class. |

### Route entry options (`routes: [...]`)

Each item in `routes` configures a branch target for `.chooseOne(route(...))` or `.toParallelAgents(...)`:

| Route Field | Type | Description |
| :--- | :--- | :--- |
| `target` | `ComponentClass` | Target `@Agent`, `@Action`, `@Router`, or `@WorkflowFinish` class. |
| `prompt` | `string` | Required on `DecidedBy.Model` routes with `SpawnPolicy.OnDemand`; describes when the model should select `target`. Forbidden on `DecidedBy.Code` routes. |
| `spawn` | `SpawnPolicy.Always \| SpawnPolicy.OnDemand` | Used before `.toParallelAgents(...)`: `Always` launches unconditionally alongside chosen branches; `OnDemand` launches only when chosen by the router. |
| `failure` | `FailurePolicy.FailFast \| FailurePolicy.Skip` | Used before `.toParallelAgents(...)`: whether a failure in this target fails the parallel join (`FailFast`, default) or drops out (`Skip`). |

## What related entities work with `@Router`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `DecidedBy`, `SpawnPolicy`, `FailurePolicy` | `"@agboss/core"` | Enums controlling decision mode (`Model` vs `Code`), parallel launch selection (`Always` vs `OnDemand`), and branch failure handling (`FailFast` vs `Skip`). |
| `RouterHandler<Self>` & `Route<Self>` | `"@agboss/core"` | Contract and return type for `DecidedBy.Code` routers (`route(input)` returns one target for `.chooseOne()` or one/many targets for `.toParallelAgents()`). |
| `.toRouter(R).chooseOne(route(Target)...)` | `"@agboss/core"` | Connects a router to exclusive branch paths in `@Workflow({ flow })`. |
| `.toRouter(R).toParallelAgents(...)` | `"@agboss/core"` | Uses a router to dynamically select which subset of `SpawnPolicy.OnDemand` agents to launch in parallel alongside `SpawnPolicy.Always` agents. |
| `RouterFailedError` & `RouterDecisionError` | `"@agboss/core"` | Errors thrown when a router cannot select a valid route; catchable in the flow via `.onError(RouterFailedError, sidePath)`. |
| `testRouter(RouterClass, options?)` | `"@agboss/core/testing"` | Unit runner that tests a model or code router in isolation without booting the workflow. |
