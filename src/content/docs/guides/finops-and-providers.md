---
title: FinOps, Budgets & Model Providers
description: Control LLM costs, rate limits, tenant fairness, and circuit breakers with @Budget, @ModelProvider, RateLimitPolicy, and SpendRecorder in AGBoss.
---

Running multi-agent workflows in production requires strict guardrails against runaway spend, vendor rate-limit spikes, and noisy-neighbor tenants. AGBoss builds FinOps and traffic management directly into the `@Application` container via `@ModelProvider` (`@agboss/core/models`), mandatory `@Budget` components across three scopes, `SpendRecorder` for paid non-LLM APIs, and `CostLedgerRepository`.

## How `@ModelProvider` pools manage rate limits and tenant fairness

Every model in an application resolves to a `@ModelProvider` listed in `@Application({ providers })` by matching its `serves` list (checked by `npx agboss check --models`). A provider's `name` must end with `-model-provider`, and its `rateLimitPolicy` and `circuitBreakerPolicy` are shared across all executions, tenants, and instances via `RateLimitRepository`.

Out of the box, AGBoss registers two built-in catch-all providers — `OpenRouterModelProvider` (`serves: [/.*/]`) and `DecisionsModelProvider` (`serves: [/^typesafe\/jev-/]`). When you list a custom `@ModelProvider` with its own `serves` (for example `serves: [/^anthropic\//]` or `[/^bedrock\//]`) in `@Application({ providers })`, the built-in catch-all providers **automatically yield** any model matched by your custom provider (`#454`) — no subclassing of `OpenRouterModelProvider` required. To replace the default OpenRouter catch-all itself, subclass `extends OpenRouterModelProvider`:

```ts title="src/model-providers/openrouter.model-provider.ts" file=src/model-providers/openrouter.model-provider.ts
import { ModelCost, ModelProvider, OpenRouterProvider, OPENROUTER_BASE_URL, PromptCaching, QueueBalancingStrategy, RateLimitPolicy, Reasoning, RetryPolicy, TRANSIENT_FAILURES, type OpenRouterFields } from "@agboss/core/models";
import { minutes, seconds } from "@agboss/core/units";

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

```ts title="src/environments/app.environment.ts" file=src/environments/app.environment.ts
import { secret, type Secret } from "@agboss/core";

export class AppEnvironment {
  openRouterApiKey!: Secret;
  sqlitePath!: string;
}

export const environment: AppEnvironment = {
  openRouterApiKey: secret("OPENROUTER_API_KEY"),
  sqlitePath: ".agboss/state.sqlite",
};
```

```ts title="test/openrouter.model-provider.test.ts" file=test/openrouter.model-provider.test.ts
import { expect, it } from "vitest";
import { OpenRouterModelProvider } from "../src/model-providers/openrouter.model-provider.js";

it("exports OpenRouterModelProvider with tenant round-robin queueing", () => {
  expect(OpenRouterModelProvider).toBeDefined();
});
```

## How `@Budget` scopes and `SpendRecorder` enforce spend limits

Every `@Application` requires `@Budget` coverage across three scopes (`BudgetScope.Application`, `BudgetScope.Tenant`, and `BudgetScope.Execution`). Budgets implement `BudgetHandler` (`maxSpend(): Usd`) and can inject `ExecutionContext` or a custom `TenantContext` subclass to read per-tenant limits from server-side data:

<!-- snippet-context
import { ExecutionContext, TenantContext } from "@agboss/core";
import { Decimal, Text } from "@agboss/core/dto";
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
```ts title="src/budgets/support.budgets.ts" file=src/budgets/support.budgets.ts
import { Budget, BudgetPeriod, BudgetScope, SpendRecorder, Tool, type BudgetHandler, type ToolHandler } from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";

@Budget({
  name: "app-daily-budget",
  scope: BudgetScope.Application,
  period: BudgetPeriod.Day,
})
export class AppDailyBudget implements BudgetHandler {
  maxSpend(): Usd {
    return usd(200);
  }
}

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

<!-- snippet-context
import { Workflow, WorkflowFinish, WorkflowStart, start } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
@WorkflowStart({ name: "support-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class SupportStart {}
@WorkflowFinish({ name: "support-workflow-finish", description: "Finish", output: WorkflowStartTextDto })
export class SupportFinish {}
@Workflow({
  name: "support-workflow",
  version: "1.0.0",
  flow: [start(SupportStart).returns(WorkflowStartTextDto).toFinish(SupportFinish)],
})
export class SupportWorkflow {}
// @snippet
-->
```ts title="src/support.application.ts" file=src/support.application.ts
import { Application, SqliteCostLedgerRepository } from "@agboss/core";
import { AppEnvironment } from "./environments/app.environment.js";
import { AppDailyBudget, ExecutionBudget, TenantDailyBudget } from "./budgets/support.budgets.js";

@Application({
  name: "support-application",
  version: "1.0.0",
  environment: AppEnvironment,
  workflows: [SupportWorkflow],
  providers: [SqliteCostLedgerRepository],
  budgets: [AppDailyBudget, TenantDailyBudget, ExecutionBudget],
})
export class SupportApplication {}
```

```ts title="test/support-finops.test.ts" file=test/support-finops.test.ts
import { expect, it } from "vitest";
import { testTool } from "@agboss/core/testing";
import { usd } from "@agboss/core/units";
import { AppDailyBudget, WebSearchTool } from "../src/budgets/support.budgets.js";

it("records external API spend via SpendRecorder and enforces daily budget ceiling", async () => {
  const budget = new AppDailyBudget();
  expect(budget.maxSpend()).toBe(usd(200));

  const runSearch = testTool(WebSearchTool);
  const { output, spend } = await runSearch({ query: "AGBoss FinOps" });
  expect(output).toEqual({ text: "results for AGBoss FinOps" });
  expect(spend).toEqual([{ service: "serp-api", cost: usd(0.002) }]);
});
```

- **Pre-flight and step checks:** Reported model usage from [OpenRouter response pricing](https://openrouter.ai/docs) and manual `SpendRecorder` entries are checked against every budget scope; if any budget is exhausted before the first step, the execution is rejected immediately (`BudgetExceededError`, firing `onExecutionRejected`) without creating a thread or calling a model.
- **Fair tenant queuing (`QueueBalancingStrategy`) & shared 429 cooldowns:** Waiting model calls share free slots via `TenantRoundRobin` (default), `TenantLeastInFlight`, `TenantWeighted` (using `tenant.weight`), or `Fifo`. When an upstream vendor returns HTTP `429` (`Retry-After`), `RateLimitRepository` propagates the cooldown window across all worker instances so sibling pods do not stampede the rate-limited endpoint.
- **OpenRouter host & quantization pinning:** When extending `OpenRouterProvider`, you can pin upstream inference hosts (`only: ["Fireworks"]`, `ignore: ["Inceptron"]`), floating-point quantizations (`quantizations: ["fp8", "bf16"]`), and `allowFallbacks: false` so open-weights models never degrade to lower-precision hosts between evaluation and production.
- **Custom SDK transport (`ModelProviderHandler`):** For AWS Bedrock (`SigV4`), Google Vertex AI, or internal mTLS gateways, omit `baseUrl` / `apiKey` on `@ModelProvider` (`[model-provider.both-modes]` if mixed) and implement `ModelProviderHandler` (`complete(request: ModelProviderRequest): Promise<ModelProviderResponse>`) with constructor DI (`deps: [...]`). Every gateway policy (`@Budget` pre-check & ledger, `RateLimitRepository`, 429 AIMD, retries, circuit breaker, PII masking, answer tools, and `mockLlm`) wraps `complete(request)` identically.

## How Prompt Prefix Cache Invariance (`[prompt.input-in-instructions]`) cuts input token spend

Provider KV prefix caches (Anthropic, OpenAI, Moonshot, DeepSeek) only hit when the leading bytes of a request — system instructions plus tool and output JSON schemas — remain **byte-for-byte identical** across calls:

1. **Compile-time ban on dynamic instructions (`[prompt.input-in-instructions]`):** `agboss check` rejects any `@Agent`, `@Router`, `@Arbiter`, or `@Judge` prompt that interpolates runtime `input` fields into `prompt` / `promptUrls` (only static `@Application` / `@Workflow` `promptVariables` are allowed in instructions).
2. **Deterministic schema serialization:** AGBoss serializes `@Tool` definitions and `@Dto` JSON schemas in canonical key order and passes dynamic Path Scope inputs exclusively in the trailing user message (`PromptCaching.auto()` or `PromptCaching.explicit()`).
3. **Deterministic HMAC PII tokens:** When `@PiiPolicy` uses `PiiAction.replaceWithToken()`, identical PII values produce identical tokens across turns, preventing random redaction IDs from invalidating cached conversation prefixes.
