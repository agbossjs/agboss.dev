---
title: FinOps, Budgets & Model Providers
description: Control LLM costs, rate limits, tenant fairness, and circuit breakers with @Budget, @ModelProvider, RateLimitPolicy, and SpendRecorder in AGBoss.
---

Running multi-agent workflows in production requires strict guardrails against runaway spend, vendor rate-limit spikes, and noisy-neighbor tenants. AGBoss builds FinOps and traffic management directly into the `@Application` container via `@ModelProvider` (`@agboss/core/models`), mandatory `@Budget` components across three scopes, `SpendRecorder` for paid non-LLM APIs, and `CostLedgerRepository`.

## How `@ModelProvider` pools manage rate limits and tenant fairness

Every model in an application is served by an explicit `@ModelProvider`: a class with a **driver** (`OpenRouterDriver`, `OpenAiCompatibleDriver`, or `DecisionsDriver` for decision models) or a transport class with `complete(request)`. A component reaches one through `modelProvider` — its own, its workflow's, or its application's (`@Application({ modelProvider })` names the provider of every model that names none) — never by a regex over the model's name; a model use whose cascade names no provider is `[model.missing-provider]`. A provider's `rateLimitPolicy` and `circuitBreakerPolicy` are shared across all executions, tenants, and instances via `RateLimitRepository`.

There are **no built-in providers**: 0.1.0's `OpenRouterModelProvider` and `DecisionsModelProvider` catch-alls, `serves`, `baseUrl`, `baseUrlField` and `apiKey` are gone. A key is `secret("OPENROUTER_API_KEY")` inside the driver, read once when the application starts (a missing key fails the start of an application that calls the provider, naming the variable, never a value; tests script models and need none). `npx agboss check --models` asks each provider whether its models exist (OpenRouter: each model's endpoints, `[model.no-matching-endpoint]`). A provider's `fallback` chains to another provider (`A → B → C`) when its breaker is open, and the breaker is half-open once it closes. Every call is attributed: `provider` is required on `UsageRecord`, `CostLine` and the model events, so the cost report shows which provider billed what.

```ts title="src/model-providers/openrouter.model-provider.ts" file=src/model-providers/openrouter.model-provider.ts
import { secret } from "@agboss/core";
import {
  CircuitBreakerPolicy,
  ModelCost,
  ModelProvider,
  OpenRouterDriver,
  PromptCaching,
  QueueBalancingStrategy,
  RateLimitPolicy,
  Reasoning,
  RetryPolicy,
  TRANSIENT_FAILURES,
} from "@agboss/core/models";
import { minutes, seconds } from "@agboss/core/units";

@ModelProvider({
  name: "openrouter-model-provider",
  description: "OpenRouter — shared chat model pool with tenant fairness",
  driver: OpenRouterDriver({
    apiKey: secret("OPENROUTER_API_KEY"),
    routing: { ignore: ["Inceptron"] }, // OpenRouter's provider routing
  }),
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
  circuitBreakerPolicy: CircuitBreakerPolicy.fixed({
    failureThreshold: 5,
    failureWindow: minutes(1),
    openDuration: seconds(30),
  }),
})
export class OpenRouterModelProvider {}
```

```ts title="src/environments/app.environment.ts" file=src/environments/app.environment.ts
export class AppEnvironment {} // the keys are secret(…) references in the drivers; nothing is read from here

export const environment: AppEnvironment = {};
```

```ts title="test/openrouter.model-provider.test.ts" file=test/openrouter.model-provider.test.ts
import { expect, it } from "vitest";
import { OpenRouterModelProvider } from "../src/model-providers/openrouter.model-provider.js";

it("exports OpenRouterModelProvider with tenant round-robin queueing", () => {
  expect(OpenRouterModelProvider).toBeDefined();
});
```

## How `@Budget` scopes and `SpendRecorder` enforce spend limits

Every `@Application` requires `@Budget` coverage across three scopes (`BudgetScope.Application`, `BudgetScope.Tenant`, and `BudgetScope.Execution`). A budget limits **dollars** (`maxSpend`) and **tokens** (`maxTokens`): constants in the decorator (`@Budget({ maxSpend: usd(200), maxTokens: 5_000_000 })`, or `defineEnv` values), a `maxSpend(): Usd` method (`BudgetHandler`), or a `limit()` method returning `{ maxSpend?, maxTokens? }`. A computed one can inject `ExecutionContext` or a custom `TenantContext` subclass to read per-tenant limits from server-side data. One `@Budget` can serve many workflows (`@Workflow({ budget })`); its counter is keyed by the budget's name, scope key and period, never by a workflow. Both caps fail closed:

<!-- snippet-context
import { ExecutionContext, TenantContext, inline } from "@agboss/core";
import { Float, Text } from "@agboss/core/dto";
export class ShopTenantContext extends TenantContext {
  @Float()
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
import { Budget, BudgetPeriod, BudgetScope, SpendRecorder, Tool, type BudgetHandler } from "@agboss/core";
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
export class WebSearchTool {
  constructor(private readonly spendRecorder: SpendRecorder) {}

  execute({ query }: SearchQueryDto): Promise<SearchResultsDto> {
    this.spendRecorder.record({ service: "serp-api", cost: usd(0.002) });
    return Promise.resolve({ text: `results for ${query}` });
  }
}
```

```ts title="src/support.database-storage.ts" file=src/support.database-storage.ts
import { DatabaseStorage, SqliteDriver } from "@agboss/core";
import { hours } from "@agboss/core/units";

@DatabaseStorage({
  name: "support-database-storage",
  driver: SqliteDriver({ path: ".agboss/state.sqlite" }),
  auditLogTtl: hours(24 * 30),
  ledgerEntriesTtl: hours(24),
})
export class SupportDatabaseStorage {}
```

<!-- snippet-context
import { Workflow, WorkflowFinish, WorkflowStart, onStart, Ttl } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
@WorkflowStart({ name: "support-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class SupportStart {}
@WorkflowFinish({ name: "support-workflow-finish", description: "Finish", output: WorkflowStartTextDto })
export class SupportFinish {}
@Workflow({
  name: "support-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [onStart(SupportStart).toFinish(SupportFinish)],
})
export class SupportWorkflow {}
// @snippet
-->
```ts title="src/support.application.ts" file=src/support.application.ts
import { Application } from "@agboss/core";
import { AppEnvironment } from "./environments/app.environment.js";
import { AppDailyBudget, ExecutionBudget, TenantDailyBudget } from "./budgets/support.budgets.js";
import { SupportDatabaseStorage } from "./support.database-storage.js";

@Application({
  name: "support-application",
  version: "1.0.0",
  environment: AppEnvironment,
  workflows: [SupportWorkflow],
  storage: SupportDatabaseStorage, // the cost ledger lives in the database storage; unset: in memory
  budgets: [AppDailyBudget, TenantDailyBudget, ExecutionBudget],
})
export class SupportApplication {}
```

```ts title="test/support-finops.test.ts" file=test/support-finops.test.ts
import { expect, it } from "vitest";
import { testUnit } from "@agboss/core/testing";
import { usd } from "@agboss/core/units";
import { AppDailyBudget, WebSearchTool } from "../src/budgets/support.budgets.js";

it("records external API spend via SpendRecorder and enforces daily budget ceiling", async () => {
  const budget = new AppDailyBudget();
  expect(budget.maxSpend()).toBe(usd(200));

  const runSearch = testUnit(WebSearchTool);
  const { output, spend } = await runSearch({ query: "AGBoss FinOps" });
  expect(output).toEqual({ text: "results for AGBoss FinOps" });
  expect(spend).toEqual([{ service: "serp-api", cost: usd(0.002) }]);
});
```

- **Pre-flight and step checks:** Reported model usage from [OpenRouter response pricing](https://openrouter.ai/docs) and manual `SpendRecorder` entries are checked against every budget scope (dollars and tokens); if any budget is exhausted before the first step, the execution is rejected immediately (`BudgetExceededError`, with `unit`: `BudgetUnit.Usd` or `Tokens`) without creating a thread or calling a model. A call that fails keeps its partial spend: a failed call's spend is in the cost report, a limit or a cancel passes its spend through, and a model with no price fails closed (`ModelCostError`). Every amount is `Usd` and a cost report carries tokens (`totalUsd`, `byCaller`, `byCategory`, `byModel`).
- **Fair tenant queuing (`QueueBalancingStrategy`) & shared 429 cooldowns:** Waiting model calls share free slots via `TenantRoundRobin` (default), `TenantLeastInFlight`, `TenantWeighted` (using `tenant.weight`), or `Fifo`. When an upstream vendor returns HTTP `429` (`Retry-After`), `RateLimitRepository` propagates the cooldown window across all worker instances so sibling pods do not stampede the rate-limited endpoint.
- **OpenRouter host & quantization pinning:** `OpenRouterDriver({ routing })` pins upstream inference hosts (`only: ["fireworks"]`, `ignore: ["Inceptron"]`), floating-point quantizations (`quantizations: [Quantization.Bf16]`), and `allowFallbacks: false` so open-weights models never degrade to lower-precision hosts between evaluation and production. Every call's `UsageRecord.servedBy` names the host that served it.
- **Custom SDK transport (`complete(request)`):** For AWS Bedrock (`SigV4`), Google Vertex AI, or internal mTLS gateways, give `@ModelProvider` no `driver` (`[model-provider.both-modes]` if mixed) and a `complete(request: ModelProviderRequest): Promise<ModelProviderResponse>` method with constructor DI (`deps: [...]`). Every gateway policy (`@Budget` pre-check & ledger, `RateLimitRepository`, 429 AIMD, retries, circuit breaker, PII masking, answer tools, and `mockLlm`) wraps `complete(request)` identically.

## How Prompt Prefix Cache Invariance (`[prompt.input-in-instructions]`) cuts input token spend

Provider KV prefix caches (Anthropic, OpenAI, Moonshot, DeepSeek) only hit when the leading bytes of a request — system instructions plus tool and output JSON schemas — remain **byte-for-byte identical** across calls:

1. **Compile-time ban on dynamic instructions (`[prompt.input-in-instructions]`):** `agboss check` rejects any `@Agent`, `@Router`, `@Arbiter`, or `@Judge` prompt that interpolates runtime `input` fields into its `prompt` (only static `@Application` / `@Workflow` `promptVariables` are allowed in instructions).
2. **Deterministic schema serialization:** AGBoss serializes `@Tool` definitions and `@Dto` JSON schemas in canonical key order and passes dynamic Path Scope inputs exclusively in the trailing user message (`PromptCaching.on({ retention, cachedParts })`; unset caches opportunistically).
3. **Deterministic HMAC PII tokens:** When `@PiiPolicy` uses `PiiKind.Email.tokenize()`, identical PII values produce identical tokens across turns, preventing random redaction IDs from invalidating cached conversation prefixes.
