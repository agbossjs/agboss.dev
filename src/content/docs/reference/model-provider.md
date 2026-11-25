---
title: "@ModelProvider"
description: "Complete API reference for @ModelProvider in @agboss/core/models — drivers (OpenRouterDriver, OpenAiCompatibleDriver, DecisionsDriver), custom transports, the modelProvider cascade, cost, fallback and breaker."
---

The `@ModelProvider` decorator (`"@agboss/core/models"`) defines an application-level LLM gateway registered in [`@Application({ providers })`](/reference/application/). **There are no built-in providers and none is picked by a model's name**: a `@ModelProvider` is an independent class that speaks one protocol (its **driver**) and holds the model names of its own, and a component reaches it through `modelProvider` — its own, its workflow's or its application's — never by a regex over the model's name. An application that lists no provider has none: a model use whose cascade names no provider is `[model.missing-provider]` at assembly, in a test too.

`@ModelProvider` has two modes (`[model-provider.both-modes]` if mixed, or if neither):
1. **Driver mode:** `driver: OpenRouterDriver({ apiKey })`, `OpenAiCompatibleDriver({ baseUrl, apiKey? })` (OpenAI, LiteLLM, vLLM, Ollama, Groq, DeepSeek) or `DecisionsDriver({ baseUrl, apiKey? })` (OpenRouter's Decisions API: decision models such as `typesafe/jev-1.13`, for routers, guardrails, judges and arbiters; no chat). The class is empty. `baseUrl`, `apiKey` and header values are text, `env(…)` or `secret(…)` references read once when the application starts; a provider never reads `process.env` itself.
2. **Custom transport mode:** a class with `complete(request: ModelProviderRequest): Promise<ModelProviderResponse>` and constructor DI (`deps: [...]`) for AWS Bedrock, Google Vertex AI, or corporate mTLS gateways, while retaining every AGBoss gateway policy (`@Budget` pre-check and ledger, `RateLimitRepository`, 429 backoff, retries, circuit breaker, PII masking, answer tools, and `mockLlm` interception).

## Complete `@ModelProvider` example

```ts title="src/model-providers/openrouter.model-provider.ts" file=src/model-providers/openrouter.model-provider.ts
import { secret } from "@agboss/core";
import {
  DecisionsDriver,
  ModelCost,
  ModelProvider,
  OpenRouterDriver,
  PromptCaching,
  ProviderSort,
  QueueBalancingStrategy,
  RateLimitPolicy,
  Reasoning,
  RetryPolicy,
  CircuitBreakerPolicy,
  TRANSIENT_FAILURES,
} from "@agboss/core/models";
import { minutes, seconds } from "@agboss/core/units";

@ModelProvider({
  name: "openrouter-model-provider",
  description: "Serves primary chat and reasoning models via OpenRouter with tenant-fair queueing",
  driver: OpenRouterDriver({
    apiKey: secret("OPENROUTER_API_KEY"), // read from the process when the application starts
    routing: { ignore: ["Inceptron"], sort: ProviderSort.Price }, // OpenRouter's provider routing
  }),
  model: "moonshotai/kimi-k2.6", // the model of a component that names none
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
    maxConcurrentCalls: 16,
    perMinute: { calls: 240 },
    balancing: QueueBalancingStrategy.TenantRoundRobin,
  }),
  circuitBreakerPolicy: CircuitBreakerPolicy.fixed({
    failureThreshold: 5,
    failureWindow: minutes(1),
    openDuration: seconds(30),
  }),
})
export class CustomOpenRouterModelProvider {}

// decision models are a driver of their own; a router, arbiter or judge on one names this provider
@ModelProvider({
  name: "decisions-model-provider",
  description: "Decision models on OpenRouter's Decisions API",
  driver: DecisionsDriver({ baseUrl: "https://openrouter.ai/api/v1", apiKey: secret("OPENROUTER_API_KEY") }),
  timeout: seconds(30),
  cost: ModelCost.fromResponse(),
})
export class DecisionsModelProvider {}
```

A custom transport, for a gateway that is not an OpenAI-compatible HTTP server:

```ts title="src/model-providers/bedrock.model-provider.ts" file=src/model-providers/bedrock.model-provider.ts
// Custom transport (a complete(request) method + DI) for AWS Bedrock / Vertex AI
import { Injectable } from "@agboss/core";
import {
  ModelCost,
  ModelProvider,
  type ModelProviderRequest,
  type ModelProviderResponse,
} from "@agboss/core/models";
import { minutes, usd } from "@agboss/core/units";

@Injectable()
export class BedrockSdkClient {
  converse(model: string, promptCount: number): Promise<{ text: string; inTokens: number; outTokens: number }> {
    return Promise.resolve({
      text: `Bedrock(${model}) reply for ${String(promptCount)} messages`,
      inTokens: 120,
      outTokens: 45,
    });
  }
}

@ModelProvider({
  name: "bedrock-model-provider",
  description: "Serves bedrock/* models over the AWS Bedrock Converse SDK with SigV4 auth",
  model: "bedrock/claude-sonnet-4-5",
  timeout: minutes(2),
  cost: ModelCost.fromPrices({
    "bedrock/claude-sonnet-4-5": {
      inputPerMillion: usd(3),
      outputPerMillion: usd(15),
    },
  }),
  deps: [BedrockSdkClient],
})
export class BedrockModelProvider {
  constructor(private readonly bedrock: BedrockSdkClient) {}

  async complete(request: ModelProviderRequest): Promise<ModelProviderResponse> {
    const res = await this.bedrock.converse(request.model, request.messages.length);
    return {
      text: res.text,
      usage: {
        inputTokens: res.inTokens,
        outputTokens: res.outTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }
}
```

<!--
```ts file=src/provider-demo.application.ts
import {
  Agent,
  Application,
  EmptyEnvironment,
  Budget,
  BudgetPeriod,
  BudgetScope,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  onStart,
  type BudgetHandler,
  inline,
  Ttl,
} from "@agboss/core";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "@agboss/core/dto";
import { usd, type Usd } from "@agboss/core/units";
import {
  CustomOpenRouterModelProvider,
  DecisionsModelProvider,
} from "./model-providers/openrouter.model-provider.js";

@WorkflowStart({ name: "provider-demo-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class ProviderDemoWorkflowStart {}

@WorkflowFinish({ name: "provider-demo-workflow-finish", description: "Finish", output: WorkflowFinishTextDto })
export class ProviderDemoWorkflowFinish {}

@Agent({
  name: "provider-demo-agent",
  description: "Calls moonshotai/kimi-k2.6 via CustomOpenRouterModelProvider",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Reply concisely."),
})
export class ProviderDemoAgent {}

@Workflow({
  name: "provider-demo-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [
    onStart(ProviderDemoWorkflowStart)
      .toAgent(ProviderDemoAgent)
      .toFinish(ProviderDemoWorkflowFinish),
  ],
})
export class ProviderDemoWorkflow {}

@Budget({ name: "mp-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class MpAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(50); } }
@Budget({ name: "mp-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class MpTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "mp-exec-budget", scope: BudgetScope.Execution })
export class MpExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "provider-demo-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [ProviderDemoWorkflow],
  modelProvider: CustomOpenRouterModelProvider,
  providers: [CustomOpenRouterModelProvider, DecisionsModelProvider],
  budgets: [MpAppBudget, MpTenantBudget, MpExecBudget],
})
export class ProviderDemoApplication {}
```
--->

```ts title="test/openrouter.model-provider.test.ts" file=test/openrouter.model-provider.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "@agboss/core";
import { replyWith, testWith } from "@agboss/core/testing";
import {
  ProviderDemoAgent,
  ProviderDemoApplication,
  ProviderDemoWorkflowStart,
} from "../src/provider-demo.application.js";

const test = testWith(ProviderDemoApplication);

test("reaches moonshotai/kimi-k2.6 through the application's modelProvider", async ({
  app,
  mockLlm,
}) => {
  mockLlm(ProviderDemoAgent).thenReturn(replyWith("Served by CustomOpenRouterModelProvider"));
  const res = await app.execute(ProviderDemoWorkflowStart, { text: "Ping provider" });
  expect(res.status).toBe(ExecutionStatus.Finished);
});
```

## What options does `@ModelProvider` accept?

`name` and `description` are optional (the class name in kebab-case by default; `[name.kind-suffix]` is no longer raised). An option that is not on the list is `[decorator.unknown-option]`:

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | No | Unique kebab-case identifier; it keys the provider's shared state (slots, windows, pause and breaker in `RateLimitRepository`) and appears in logs and `agboss describe`. |
| `description` | `string` | No | Human-readable summary of which models and upstream endpoint this provider serves. |
| `driver` | `ModelDriver` | Driver mode | `OpenRouterDriver({ apiKey, baseUrl?, headers?, routing?, transforms? })`, `OpenAiCompatibleDriver({ baseUrl, apiKey?, headers?, requestFields? })` or `DecisionsDriver({ baseUrl, apiKey?, headers?, path?, knownModels? })`. A driver says what a model is: `ModelKind.Chat` or `ModelKind.Decisions`. |
| `deps` | `readonly Token[]` | Transport mode | Constructor dependencies (`@Injectable()` SDK clients, `ApplicationContext`, `TenantContext`, `ExecutionContext`) of a transport provider; it is created by the container on its first call. |
| `model` / `models` | `string` / `Record<string, string>` | One of the two for a component that names no model | The model names this provider owns: `model`, or `models`, a map of role names (`default`, `fast`) to the vendor's names. A component's `model: "fast"` is the vendor's name `models.fast` maps to; a name that is no role goes to the server as written. `[model.missing]` when a component names none and the provider has neither `model` nor `models.default`. |
| `timeout` | `Milliseconds` | **Yes** | Per-attempt request timeout (`minutes(2)`), passed via `request.signal`. |
| `cost` | `ModelCost` | No (a call with no cost fails closed) | `ModelCost.fromResponse()` (the provider reports `usage.cost`), `ModelCost.fromPrices({ "<model>": { inputPerMillion, outputPerMillion, cacheReadPerMillion?, cacheWritePerMillion? } })`. A model it does not price fails at start (`model.no-price`); a call with neither fails with `ModelCostError`. |
| `reasoning` | `Reasoning` | No | Default reasoning mode (`Reasoning.off()`, `Reasoning.on({ effort })`, or `Reasoning.modelDecides()`); a component overrides it. |
| `promptCaching` | `PromptCaching` | No | `PromptCaching.on({ retention, cachedParts, key? })` or `PromptCaching.off()`; unset caches opportunistically. `PromptCaching.whereSupported` is gone. |
| `retryPolicy` | `RetryPolicy` | No | Per-call retry backoff (`RetryPolicy.exponential({ maxAttempts, initialDelay, maxDelay, jitter, retryOn })` or `RetryPolicy.fixed(…)`); omit for no retries. |
| `rateLimitPolicy` | `RateLimitPolicy` | No | `RateLimitPolicy.of({ maxConcurrentCalls?, perMinute?: { calls?, tokens? }, balancing? })`: one limit for the whole application, coordinated via `RateLimitRepository`. Without it there is no limit. |
| `circuitBreakerPolicy` | `CircuitBreakerPolicy` | No | `CircuitBreakerPolicy.fixed({ failureThreshold, failureWindow, openDuration })`; it trips open across all instances and is half-open when it closes, shifting `app.checkReadiness()` to `HealthStatus.Degraded`. |
| `fallback` | `Class \| { provider, models }` | No | Another provider that answers an open breaker or an exhausted retry, chained (`A → B → C`); `{ provider, models }` maps the models. |

## The model cascade

A provider is named by `Component.modelProvider ?? Workflow.modelProvider ?? Application.modelProvider`. `@Agent`, a model `@Router`, `@Arbiter`, `@Judge`, `@InputGuardrail` / `@OutputGuardrail`, `@ChannelInterpreter`, a `@Memory`'s compaction and a `@PiiPolicy` (its `model`) take `modelProvider`, and so do `@Workflow` and `@Application`. A provider the cascade names is part of the application even when it is not in `providers`. A model for a component that names none comes from, in this order: its profile's override, its own `model`, the workflow's then the application's `defaults.models.model`, the provider's `model`, the provider's `models.default`. A router or an arbiter on a decision model names its own provider (`modelProvider: DecisionsModelProvider`); a chat provider does not serve it (`[model.incompatible-provider]`).

## What related entities work with `@ModelProvider`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `OpenRouterDriver`, `OpenAiCompatibleDriver`, `DecisionsDriver` | `"@agboss/core/models"` | The three drivers. `OpenRouterProvider`, `OpenAiCompatibleProvider`, `OpenRouterModelProvider`, `DecisionsModelProvider`, `JevModelProvider`, `DEFAULT_MODEL_PROVIDERS`, `serves`, `baseUrl`, `baseUrlField` and `apiKey` of 0.1.0 are removed. |
| A transport class with `complete(request)` | `"@agboss/core/models"` | For custom SDK/transport gateways (AWS Bedrock, Vertex AI, corporate proxies) wrapped by all AGBoss FinOps, rate-limit, circuit-breaker, and PII policies. A transport takes `model` / `models` like a driver one; `capabilities(model)` is optional. |
| `ModelProviderFailureError` | `"@agboss/core/models"` | Thrown inside `complete(request)` to report classified failures (`ModelFailure.RateLimited` with `retryAfter`, `Timeout`, `ServerError`, `NetworkError`) to the retry and breaker engines. |
| `DecisionModel` | `"@agboss/core"` | The injectable decisions service: [`DecisionModel`](/reference/decision-model/). |
| `RateLimitPolicy` & `QueueBalancingStrategy` | `"@agboss/core/models"` | Configures `maxConcurrentCalls`, `perMinute`, and `QueueBalancingStrategy` (`TenantRoundRobin`, `TenantLeastInFlight`, `TenantWeighted`, `Fifo`). |
| `RetryPolicy`, `CircuitBreakerPolicy` | `"@agboss/core/models"` | Per-call backoff and the shared multi-instance circuit breaker. |
| `ModelCost`, `Reasoning`, `PromptCaching` | `"@agboss/core/models"` | Token pricing, thinking effort (`ReasoningEffort`), and KV prefix cache policies. |
| `testWith(App)` | `"@agboss/core/testing"` | Scripts or replays models above the provider (`complete()` is never called by a scripted test) and needs no key. |
