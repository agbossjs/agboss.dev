---
title: "@Router"
description: Complete API reference for @Router in AGBoss — DecidedBy.Model vs DecidedBy.Code, .onRoute(…) and chooseMany launches, RouterHandler, and testUnit().
---

The `@Router` decorator defines a control-flow decision node (`routers/*.router.ts`) in AGBoss. Routers decouple orchestration from domain agents and come in two forms discriminated by `decidedBy`: **`DecidedBy.Model`** (where a fast classifier model like `typesafe/jev-1.13` picks the target route from prompt criteria) and **`DecidedBy.Code`** (where deterministic TypeScript in `route(input)` with constructor DI picks the target at zero LLM cost and zero latency).

## Complete `@Router` examples (`DecidedBy.Model` and `DecidedBy.Code`)

```ts title="src/routers/support.routers.ts" file=src/routers/support.routers.ts
import {
  DecidedBy,
  Router,
  type InputOf,
  type RouterAnswerOf,
  type RouterHandler,
  inline,
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
  prompt: inline("Classify the user's support request and choose the most specific handler."),
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
  routes: [ClaimRefundAgent, ClaimBillingAgent], // a code router's route is its class

})
export class ClaimTierRouter implements RouterHandler<ClaimTierRouter> {
  constructor(private readonly orderPolicy: OrderPolicyService) {}

  async route(input: InputOf<ClaimTierRouter>): Promise<RouterAnswerOf<ClaimTierRouter>> {
    // each input field is the DTO itself (Tracked<Dto, Producer>): input.claim.amountCents
    const requiresBillingReview = await this.orderPolicy.requiresFinanceSignOff(
      input.claim.amountCents,
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
import { Workflow, onStart, toAction, toAgent, toFinish, toRouter, Ttl } from "@agboss/core";
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
  historyTtl: Ttl.Forever,
  providers: [OrderPolicyService],
  flow: [
    onStart(SupportStart)
      .toRouter(IntentTriageRouter)
      .onRoute(
        toAgent(BillingAgent)
          .toFinish(SupportFinish),
      )
      .onRoute(
        toAgent(RefundAgent)
          .toFinish(SupportFinish),
      )
      .onRoute(
        toAgent(TechnicalSupportAgent)
          .toFinish(SupportFinish),
      ),

    onStart(ClaimStart)
      .inParallel([
        toAgent(AuditLogAgent), // always launched
        toRouter(ClaimTierRouter) // the router picks which of its routes run, none included
          .chooseMany([toAgent(ClaimRefundAgent), toAgent(ClaimBillingAgent)]),
      ])
      .join()
      .toAction(CombineClaimRepliesAction)
      .toFinish(SupportFinish),
  ],
})
export class SupportRoutingWorkflow {}
```

```ts title="test/support.routers.test.ts" file=test/support.routers.test.ts
import { expect, it } from "vitest";
import { routeTo, testUnit } from "@agboss/core/testing";
import { ClaimTierRouter, IntentTriageRouter } from "../src/routers/support.routers.js";
import {
  ClaimBillingAgent,
  ClaimRefundAgent,
  RefundAgent,
} from "../src/support.components.js";

it("tests both a model router and a code router in isolation", async () => {
  const runModelRouter = testUnit(IntentTriageRouter, {
    model: routeTo(RefundAgent),
  });
  const modelPicked = await runModelRouter({
    message: { text: "Please cancel my order and refund my card" }, // a plain DTO literal, tracked by default
  });
  expect(modelPicked.output).toBe(RefundAgent);

  const runCodeRouter = testUnit(ClaimTierRouter);
  const codePicked = await runCodeRouter({
    claim: { orderId: "A-1042", amountCents: 250_00 },
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
  inline,
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

@Agent({ name: "refund-agent", description: "Refunds", model: "moonshotai/kimi-k2.6", prompt: inline("Refund.") })
export class RefundAgent {}

@Agent({ name: "billing-agent", description: "Billing", model: "moonshotai/kimi-k2.6", prompt: inline("Billing.") })
export class BillingAgent {}

@Agent({ name: "technical-support-agent", description: "Tech support", model: "moonshotai/kimi-k2.6", prompt: inline("Support.") })
export class TechnicalSupportAgent {}

@Agent({ name: "audit-log-agent", description: "Audit log", model: "moonshotai/kimi-k2.6", prompt: inline("Audit."), input: { claim: OrderClaimDto } })
export class AuditLogAgent {}

@Agent({ name: "claim-refund-agent", description: "Claim refund", model: "moonshotai/kimi-k2.6", prompt: inline("Refund claim."), input: { claim: OrderClaimDto } })
export class ClaimRefundAgent {}

@Agent({ name: "claim-billing-agent", description: "Claim billing", model: "moonshotai/kimi-k2.6", prompt: inline("Billing claim."), input: { claim: OrderClaimDto } })
export class ClaimBillingAgent {}

@Action({
  name: "combine-claim-replies-action",
  description: "Combines parallel claim replies",
  input: { replies: listOf(WorkflowFinishTextDto) },
  output: WorkflowFinishTextDto,
})
export class CombineClaimRepliesAction implements ActionHandler<CombineClaimRepliesAction> {
  execute(input: InputOf<CombineClaimRepliesAction>): WorkflowFinishTextDto {
    const texts = input.replies.map((reply) => reply.text);
    return { text: texts.join("\n") };
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
| `routes` | Both | `readonly [Route, ...]` | Yes | The allowed targets. The flow must continue every route exactly once with `.onRoute(…)`, or list them in `.chooseMany([…])` (`[router.routes-mismatch]`). |
| `maxVisits` | Both | `number` | No | Maximum visits per execution before throwing `LimitError.Visits`. |
| `model` | `DecidedBy.Model` | `string` | No | Decision model (`"typesafe/jev-1.13"`) or chat model; inherits `defaults.router.model` when omitted. |
| `modelProvider` | `DecidedBy.Model` | `Class` | No | The provider of the router's model (a decision model needs a `DecisionsDriver` provider); the workflow's, then the application's, when omitted. |
| `prompt` | `DecidedBy.Model` | `PromptSource` | No | Instructions telling the model how to evaluate the input and select a route: a file path, `inline("…")` or a list. |
| `promptVariables` | `DecidedBy.Model` | `Record<string, string \| EnvRef<string>>` | No | Static `{{key}}` variables interpolated into the router's prompt. |
| `memory` | `DecidedBy.Model` | `Class` | No | The [`@Memory`](/reference/memory/) the model router reads; does not compile on a code router. |
| `piiPolicies` / `excludePiiPolicies` | Both | `readonly Class[]` | No | `@PiiPolicy` classes masking inputs before they reach the router model. |
| `guardrails` / `excludeGuardrails` | Both | `readonly Class[]` | No | `@InputGuardrail` classes evaluated before the router model runs. |
| `deps` | `DecidedBy.Code` | `readonly Token[]` | No | Constructor dependencies (`ExecutionContext`, `@Injectable` services) injected into the code router class. |

### Route entries (`routes: [...]`)

| Router | A route is | Description |
| :--- | :--- | :--- |
| `DecidedBy.Model` | `{ target, prompt }` | `target` is the `@Agent`, `@Action`, `@Router`, `@Workflow` or `@WorkflowFinish` class — or a thunk of one, `() => X`, when it is declared below the router or in a module that imports it back. `prompt` (a plain string, required: `[router.no-prompt]`) says when the model chooses it; a route to a finish is worded as a stop instruction. |
| `DecidedBy.Code` | the class | `routes: [RefundAgent, ChargeAction]`, or `() => X` thunks; `route(input)` returns one of them, typed by `Route<Self>`. In a launch it returns the chosen classes as a list, `[]` included. |

0.1.0's `SpawnPolicy`, `FailurePolicy`, `spawn` and `failure` on a route, `CodeRouterRoute`, `AlwaysRouterRoute` and `RouterRoute` are gone: a router in a launch is `toRouter(R).chooseMany([…])` and a failed branch is dropped with `.onError(E, skip())` on the branch.

## What related entities work with `@Router`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `DecidedBy` | `"@agboss/core"` | Enum controlling decision mode (`Model` vs `Code`). |
| `RouterHandler<Self>` & `Route<Self>` | `"@agboss/core"` | Contract and return type for `DecidedBy.Code` routers (`route(input)` returns one target for `.onRoute()` or a list of targets for `.chooseMany()`). |
| `.toRouter(R).onRoute(subPath)…` | `"@agboss/core"` | Connects a router to its exclusive branch paths in `@Workflow({ flow })`: one `.onRoute(toAgent(X)…)` per route. |
| `toRouter(R).chooseMany([toAgent(A), …])` | `"@agboss/core"` | A router as a branch of `.inParallel([…])`: it decides which of its routes are launched (none, some or all), while its siblings always run. |
| `StepError.Router` & `StepError.RouterDecision` | `"@agboss/core"` | Errors thrown when a router cannot select a valid route; catchable in the flow via `.onError(StepError.Router, sidePath)` right after the router. |
| `testUnit(RouterClass, options?)` | `"@agboss/core/testing"` | Unit runner that tests a model or code router in isolation without booting the workflow. |
