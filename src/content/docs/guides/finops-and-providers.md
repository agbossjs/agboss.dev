---
title: FinOps, Budgets & Model Providers
description: Control LLM costs, rate limits, tenant fairness, and circuit breakers with @Budget, @ModelProvider, RateLimitPolicy, SpendRecorder, and observers in AGBoss.
---

Running multi-agent workflows in production requires strict guardrails against runaway spend, vendor rate-limit spikes, and noisy-neighbor tenants. AGBoss builds FinOps and traffic management directly into the `@Application` container via `@ModelProvider` (`agboss/models`), mandatory `@Budget` components across three scopes, `SpendRecorder` for paid non-LLM APIs, and `CostLedgerRepository`.

## How `@ModelProvider` pools manage rate limits and tenant fairness

Every model in an application resolves to exactly one `@ModelProvider` listed in `@Application({ providers })` by matching its `serves` list (checked by `npx agboss check --models --workflow src/job-scout.workflow.ts`). A provider's `name` must end with `-model-provider`, and its `rateLimitPolicy` and `circuitBreakerPolicy` are shared across all executions, tenants, and instances via `RateLimitRepository`:

```ts title="src/model-providers/openrouter.model-provider.ts" file=src/model-providers/openrouter.model-provider.ts
import { ModelCost, ModelProvider, OpenRouterProvider, OPENROUTER_BASE_URL, PromptCaching, QueueBalancingStrategy, RateLimitPolicy, Reasoning, RetryPolicy, TRANSIENT_FAILURES, type OpenRouterFields } from "agboss/models";
import { minutes, seconds } from "agboss/units";

@ModelProvider({
  name: "openrouter-model-provider",
  description: "OpenRouter — shared chat model pool with tenant fairness",
  serves: [/.*/],
  baseUrl: OPENROUTER_BASE_URL,
  baseUrlField: "openRouterBaseUrl",
  apiKey: "openRouterApiKey",
  timeout: minutes(2),
  cost: ModelCost.fromResponse(),
  reasoning: Reasoning.modelDecides(),
  promptCaching: PromptCaching.off(),
  retryPolicy: RetryPolicy.exponential({
    maxAttempts: 3,
    initialDelay: seconds(1),
    maxDelay: seconds(20),
    jitter: true,
    retryOn: TRANSIENT_FAILURES,
  }),
  rateLimitPolicy: RateLimitPolicy.of({
    maxConcurrentCalls: 8,
    perMinute: { calls: 60 },
    balancing: QueueBalancingStrategy.TenantRoundRobin,
  }),
  circuitBreakerPolicy: {
    failureThreshold: 5,
    window: minutes(1),
    openFor: seconds(30),
  },
})
export class OpenRouterModelProvider extends OpenRouterProvider {
  override readonly requestFields: OpenRouterFields = {
    provider: { ignore: ["Inceptron"] },
  };
}
```

```ts title="src/environments/app.environment.ts" no-check: context tab
import { secret, type Secret } from "agboss";

export class AppEnvironment {
  openRouterApiKey!: Secret;
}

export const environment: AppEnvironment = {
  openRouterApiKey: secret("OPENROUTER_API_KEY"),
};
```

## How `@Budget` scopes and `SpendRecorder` enforce spend limits

Every `@Application` requires `@Budget` coverage across three scopes (`BudgetScope.Application`, `BudgetScope.Tenant`, and `BudgetScope.Execution`). Budgets implement `BudgetHandler` (`maxSpend(): Usd`) and can inject `ExecutionContext` or a custom `TenantContext` subclass to read per-tenant limits from server-side data:

<!-- snippet-context
import { ExecutionContext, TenantContext } from "agboss";
import { Decimal, Text } from "agboss/dto";
export class ShopTenantContext extends TenantContext {
  @Decimal()
  dailyBudgetUsd!: number;
}
export class SearchQueryDto {
  @Text({ prompt: "what to search the web for" })
  query!: string;
}
export class SearchResultsDto {
  @Text({ prompt: "what the search found" })
  text!: string;
}
-->
```ts title="src/budgets/support.budgets.ts"
import { Budget, BudgetPeriod, BudgetScope, SpendRecorder, Tool, type BudgetHandler, type ToolHandler } from "agboss";
import { usd, type Usd } from "agboss/units";

@Budget({
  name: "tenant-daily-budget",
  scope: BudgetScope.Tenant,
  period: BudgetPeriod.Day,
  deps: [ShopTenantContext],
})
export class TenantDailyBudget implements BudgetHandler {
  constructor(private readonly shopTenantContext: ShopTenantContext) {}

  maxSpend(): Usd {
    return usd(this.shopTenantContext.dailyBudgetUsd);
  }
}

@Budget({
  name: "execution-budget",
  scope: BudgetScope.Execution,
  deps: [ExecutionContext],
})
export class ExecutionBudget implements BudgetHandler {
  constructor(private readonly executionContext: ExecutionContext) {}

  maxSpend(): Usd {
    return this.executionContext.tenant.weight > 1 ? usd(0.5) : usd(0.1);
  }
}

@Tool({
  name: "web_search",
  description: "Searches the web (a paid API)",
  input: SearchQueryDto,
  output: SearchResultsDto,
  deps: [SpendRecorder],
})
export class WebSearchTool
  implements ToolHandler<SearchQueryDto, SearchResultsDto>
{
  constructor(private readonly spendRecorder: SpendRecorder) {}

  run({ query }: SearchQueryDto): Promise<SearchResultsDto> {
    this.spendRecorder.record({ service: "serp-api", cost: usd(0.002) });
    return Promise.resolve({ text: `results for ${query}` });
  }
}
```

```ts title="src/support.application.ts" no-check: context tab
import { Application, SqliteCostLedgerRepository } from "agboss";
import { AppDailyBudget, TenantMonthlyBudget, ExecutionRunBudget } from "./budgets/support.budgets.js";

@Application({
  name: "support-application",
  version: "1.0.0",
  workflows: [SupportWorkflow],
  providers: [SqliteCostLedgerRepository],
  budgets: [AppDailyBudget, TenantMonthlyBudget, ExecutionRunBudget],
})
export class SupportApplication {}
```

- **Pre-flight and step checks:** Reported model usage from [OpenRouter response pricing](https://openrouter.ai/docs) and manual `SpendRecorder` entries are checked against every budget scope; if any budget is exhausted before the first step, the execution is rejected immediately (`BudgetExceededError`, firing `onExecutionRejected`) without creating a thread or calling a model.
- **Fair tenant queuing (`QueueBalancingStrategy`):** Waiting model calls share free slots via `TenantRoundRobin` (default), `TenantLeastInFlight`, `TenantWeighted` (using `tenant.weight`), or `Fifo`.
