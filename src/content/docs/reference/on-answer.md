---
title: "@OnAnswer"
description: Complete API reference for the @OnAnswer(AgentClass) method decorator in AGBoss — evaluating arriving parallel branch answers inside a DecidedBy.Code @Arbiter.
---

The `@OnAnswer(AgentClass)` method decorator (`"agboss"`) marks the per-agent evaluation method inside a `DecidedBy.Code` [`@Arbiter`](/reference/arbiter/) class. During a `.joinQuorum()` or `.joinQuorumGroups()` step, AGBoss invokes the matching `@OnAnswer(AgentClass)` method as each parallel branch finishes so your arbiter can return `true` (count toward quorum) or `false` (reject the branch answer) in real time.

## Complete `@OnAnswer` example

<!-- snippet-context
import {
  Action,
  Application,
  Budget,
  BudgetPeriod,
  BudgetScope,
  EmptyEnvironment,
  QuorumNotReachedError,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  listOf,
  start,
  toAction,
  type ActionHandler,
  type BudgetHandler,
  type InputOf,
} from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";
import { seconds, usd, type Usd } from "agboss/units";

// @snippet

@WorkflowStart({ name: "quote-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class QuoteStart {}
@WorkflowFinish({ name: "quote-workflow-finish", description: "Finish", output: PricingQuoteDto })
export class QuoteFinish {}

@Action({
  name: "pick-best-quote-action",
  description: "Picks the highest margin quote",
  input: { quotes: listOf(PricingQuoteDto) },
  output: PricingQuoteDto,
})
export class PickBestQuoteAction implements ActionHandler<PickBestQuoteAction> {
  execute(input: InputOf<PickBestQuoteAction>): Promise<PricingQuoteDto> {
    return Promise.resolve(input.quotes[0]!.value);
  }
}

@Action({
  name: "fallback-quote-action",
  description: "Fallback quote when quorum fails",
  input: { req: WorkflowStartTextDto },
  output: PricingQuoteDto,
})
export class FallbackQuoteAction implements ActionHandler<FallbackQuoteAction> {
  execute(_input: InputOf<FallbackQuoteAction>): Promise<PricingQuoteDto> {
    return Promise.resolve({ tierName: "standard", marginPercent: 25 });
  }
}

@Workflow({
  name: "pricing-quorum-workflow",
  version: "1.0.0",
  flow: [
    start(QuoteStart)
      .returns(WorkflowStartTextDto)
      .toParallelAgents(EnterprisePricingAgent, SelfServePricingAgent)
      .acceptedBy(MarginThresholdArbiter)
      .joinQuorum({ min: 1, deadline: seconds(5) })
      .onJoinError(
        QuorumNotReachedError,
        toAction(FallbackQuoteAction)
          .returns(PricingQuoteDto)
          .toFinish(QuoteFinish),
      )
      .returns(listOf(PricingQuoteDto))
      .toAction(PickBestQuoteAction)
      .returns(PricingQuoteDto)
      .toFinish(QuoteFinish),
  ],
  providers: [MarginPolicyService],
})
export class PricingQuorumWorkflow {}

@Budget({ name: "pq-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class PqAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(20); } }
@Budget({ name: "pq-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class PqTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "pq-exec-budget", scope: BudgetScope.Execution })
export class PqExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "pricing-quorum-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [PricingQuorumWorkflow],
  budgets: [PqAppBudget, PqTenantBudget, PqExecBudget],
})
export class PricingQuorumApplication {}
-->
```ts title="src/arbiters/margin-threshold.arbiter.ts" file=src/margin-threshold.ts
import {
  Agent,
  Arbiter,
  DecidedBy,
  ExecutionContext,
  Injectable,
  OnAnswer,
} from "agboss";
import { Integer, Text } from "agboss/dto";

export class PricingQuoteDto {
  @Text({ prompt: "Pricing tier name" })
  tierName!: string;

  @Integer({ min: 0, max: 100, prompt: "Gross margin percentage (0-100)" })
  marginPercent!: number;
}

@Agent({
  name: "enterprise-pricing-agent",
  description: "Generates enterprise tier quote",
  model: "moonshotai/kimi-k2.6",
  prompt: "Propose an enterprise pricing quote.",
  output: PricingQuoteDto,
})
export class EnterprisePricingAgent {}

@Agent({
  name: "self-serve-pricing-agent",
  description: "Generates self-serve tier quote",
  model: "moonshotai/kimi-k2.6",
  prompt: "Propose a self-serve pricing quote.",
  output: PricingQuoteDto,
})
export class SelfServePricingAgent {}

@Injectable()
export class MarginPolicyService {
  minMarginForTenant(_tenantId: string): number {
    return 30;
  }
}

@Arbiter({
  name: "margin-threshold-arbiter",
  decidedBy: DecidedBy.Code,
  deps: [ExecutionContext, MarginPolicyService],
})
export class MarginThresholdArbiter {
  constructor(
    private readonly ctx: ExecutionContext,
    private readonly policy: MarginPolicyService,
  ) {}

  @OnAnswer(EnterprisePricingAgent)
  fromEnterprisePricing(answer: PricingQuoteDto): boolean {
    const minMargin = this.policy.minMarginForTenant(this.ctx.tenant.tenantId);
    return answer.marginPercent >= minMargin;
  }

  @OnAnswer(SelfServePricingAgent)
  fromSelfServePricing(answer: PricingQuoteDto): boolean {
    return answer.marginPercent >= 20;
  }
}
```

```ts title="test/margin-threshold.arbiter.test.ts" file=test/margin-threshold.arbiter.test.ts
import { expect, it } from "vitest";
import { testArbiter } from "agboss/testing";
import {
  EnterprisePricingAgent,
  MarginThresholdArbiter,
} from "../src/margin-threshold.js";

it("accepts quotes meeting the margin threshold via @OnAnswer", async () => {
  const runArbiter = testArbiter(MarginThresholdArbiter);
  const { output } = await runArbiter(EnterprisePricingAgent, {
    tierName: "Enterprise",
    marginPercent: 42,
  });
  expect(output).toBe(true);
});
```

## How `@OnAnswer(AgentClass)` works inside `@Arbiter`

| Signature Part | Type | Description |
| :--- | :--- | :--- |
| `@OnAnswer(AgentClass)` | Method decorator | Binds the method on a `DecidedBy.Code` `@Arbiter` to a specific `@Agent` class launched by `.toParallelAgents(...)`. Every agent in the launch must have a corresponding `@OnAnswer` method (`[arbiter.unhandled-agent]`). |
| `answer` parameter | `ArbiterAnswerOf<typeof AgentClass>` | The plain validated output DTO produced by that `@Agent` branch. TypeScript rejects mismatched DTO types at compile time. |
| Return value | `boolean \| Promise<boolean>` | Returns `true` if the branch's answer counts toward the quorum, or `false` to reject it. |
