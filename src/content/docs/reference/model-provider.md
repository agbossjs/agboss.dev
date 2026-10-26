---
title: "@ModelProvider"
description: "Complete API reference for @ModelProvider in agboss/models — OpenRouterModelProvider, custom chat/decision/embedding adapters, and automatic yield rules."
---

The `@ModelProvider` decorator (`"@agboss/core/models"`) defines an application-level LLM gateway registered in [`@Application({ providers })`](/reference/application/). Every model string referenced by an `@Agent`, `@Router`, `@Arbiter`, `@Judge`, `@Compaction`, `@InputGuardrail`, `@OutputGuardrail`, or `@PiiPolicy` is matched at startup against the `serves` regular expressions of your registered `@ModelProvider` classes (`[model.unserved]` or `[model.ambiguous-provider]` if zero or multiple custom providers match).

:::tip[Built-in providers automatically yield claimed models (`#454`)]
Every application includes the built-in catch-all `OpenRouterModelProvider` (`serves: [/.*/]`) and `DecisionsModelProvider` (`serves: [/^typesafe\/jev-/]`). You do **not** need to subclass `OpenRouterModelProvider` just to add a custom `@ModelProvider` (such as an Anthropic, Bedrock, or local Ollama provider) — the built-in catch-all providers automatically yield any model matched by another `@ModelProvider` listed in `@Application({ providers })`. Subclass `OpenRouterModelProvider` (`extends OpenRouterModelProvider`) only when you want to replace the default OpenRouter catch-all itself.
:::

`@ModelProvider` supports two transport modes (`[model-provider.both-modes]` if mixed):
1. **HTTP base URL mode (`OpenRouterProvider` / `OpenAiCompatibleProvider`):** Configured with `baseUrl` / `baseUrlField` and optional `apiKey` (plus OpenRouter host and quantization pinning `only`, `ignore`, `quantizations`, `allowFallbacks`).
2. **Custom transport mode (`implements ModelProviderHandler`):** Implements `complete(request: ModelProviderRequest): Promise<ModelProviderResponse>` with constructor DI (`deps: [...]`) for AWS Bedrock SDK (`SigV4`), Google Vertex AI, or corporate mTLS gateways while retaining every AGBoss gateway policy (`@Budget` pre-check & ledger, `RateLimitRepository`, 429 AIMD, retries, circuit breaker, PII masking, structured output answer tools, and `mockLlm` interception).

## Complete `@ModelProvider` example

```ts title="src/model-providers/openrouter.model-provider.ts" file=src/model-providers/openrouter.model-provider.ts
import {
  DecisionsModelProvider,
  ModelCost,
  ModelProvider,
  OPENROUTER_BASE_URL,
  OpenRouterProvider,
  PromptCaching,
  QueueBalancingStrategy,
  RateLimitPolicy,
  Reasoning,
  RetryPolicy,
  TRANSIENT_FAILURES,
  type OpenRouterFields,
} from "@agboss/core/models";
import { minutes, seconds } from "@agboss/core/units";

export { DecisionsModelProvider };

@ModelProvider({
  name: "openrouter-model-provider",
  description: "Serves primary chat and reasoning models via OpenRouter with tenant-fair queueing",
  serves: [/^moonshotai\//, /^anthropic\//, /^google\//],
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
    maxConcurrentCalls: 16,
    perMinute: { calls: 240 },
    balancing: QueueBalancingStrategy.TenantRoundRobin,
  }),
  circuitBreakerPolicy: {
    failureThreshold: 5,
    window: minutes(1),
    openFor: seconds(30),
  },
})
export class CustomOpenRouterModelProvider extends OpenRouterProvider {
  override readonly requestFields: OpenRouterFields = {
    provider: {
      ignore: ["Inceptron"],
    },
  };
}
```

<!-- snippet-context
import { Injectable } from "@agboss/core";
import {
  ModelCost,
  PromptCaching,
  Reasoning,
  RetryPolicy,
  TRANSIENT_FAILURES,
} from "@agboss/core/models";
import { minutes, seconds, usd } from "@agboss/core/units";

export interface ModelProviderMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
}

export interface ModelProviderRequest {
  readonly model: string;
  readonly messages: readonly ModelProviderMessage[];
  readonly signal: AbortSignal;
}

export interface ModelProviderResponse {
  readonly text?: string;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

export interface ModelProviderHandler {
  complete(request: ModelProviderRequest): Promise<ModelProviderResponse>;
}

export function ModelProvider(_options: Record<string, unknown>) {
  return (_target: unknown, _context?: unknown): void => {};
}
// @snippet
-->
```ts title="src/model-providers/bedrock.model-provider.ts" file=src/model-providers/bedrock.model-provider.ts
// Custom transport (@ModelProvider + ModelProviderHandler + DI) for AWS Bedrock / Vertex AI
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
  serves: [/^bedrock\//],
  timeout: minutes(2),
  cost: ModelCost.fromPrices({
    "bedrock/claude-sonnet-4-5": {
      inputPerMillion: usd(3),
      outputPerMillion: usd(15),
    },
  }),
  reasoning: Reasoning.off(),
  promptCaching: PromptCaching.off(),
  retryPolicy: RetryPolicy.exponential({
    maxAttempts: 3,
    initialDelay: seconds(1),
    maxDelay: seconds(10),
    jitter: true,
    retryOn: TRANSIENT_FAILURES,
  }),
  deps: [BedrockSdkClient],
})
export class BedrockModelProvider implements ModelProviderHandler {
  constructor(private readonly bedrock: BedrockSdkClient) {}

  async complete(request: ModelProviderRequest): Promise<ModelProviderResponse> {
    const res = await this.bedrock.converse(request.model, request.messages.length);
    return {
      text: res.text,
      usage: {
        inputTokens: res.inTokens,
        outputTokens: res.outTokens,
      },
    };
  }
}
```

<!--
```ts file=src/environments/app.environment.ts
import type { Secret } from "@agboss/core";

export class ProviderEnv {
  openRouterApiKey!: Secret;
  openRouterBaseUrl?: string;
}
```
```ts file=src/provider-demo.application.ts
import {
  Agent,
  Application,
  Budget,
  BudgetPeriod,
  BudgetScope,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  start,
  type BudgetHandler,
} from "@agboss/core";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "@agboss/core/dto";
import { usd, type Usd } from "@agboss/core/units";
import { ProviderEnv } from "./environments/app.environment.js";
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
  prompt: "Reply concisely.",
})
export class ProviderDemoAgent {}

@Workflow({
  name: "provider-demo-workflow",
  version: "1.0.0",
  flow: [
    start(ProviderDemoWorkflowStart)
      .returns(WorkflowStartTextDto)
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
  environment: ProviderEnv,
  workflows: [ProviderDemoWorkflow],
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

test("matches moonshotai/kimi-k2.6 against CustomOpenRouterModelProvider serves regex", async ({
  app,
  mockLlm,
}) => {
  mockLlm(ProviderDemoAgent).thenReturn(replyWith("Served by CustomOpenRouterModelProvider"));
  const res = await app.execute(ProviderDemoWorkflowStart, { text: "Ping provider" });
  expect(res.status).toBe(ExecutionStatus.Finished);
});
```

## What options does `@ModelProvider` accept?

Every `@ModelProvider` class extends `OpenRouterProvider`, `OpenAiCompatibleProvider`, or implements `ModelProviderHandler`, and its `name` ends with `-model-provider` (class name ending with `ModelProvider`, `[name.kind-suffix]`):

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | **Yes** | Unique kebab-case identifier ending with `-model-provider` (e.g., `"openrouter-model-provider"`). |
| `description` | `string` | **Yes** | Human-readable summary of which models and upstream endpoint this provider serves. |
| `serves` | `readonly (string \| RegExp)[]` | **Yes** | Non-empty array of model names or regex patterns matching model IDs served by this provider (`[/^moonshotai\//, /^anthropic\//]`). |
| `baseUrl` | `string` | For HTTP providers | Default upstream base URL (`OPENROUTER_BASE_URL`). Forbidden when implementing `ModelProviderHandler` (`[model-provider.both-modes]`). |
| `baseUrlField` | `string` | No (HTTP only) | Optional field name on `AppEnvironment` (`env.optional("OPENROUTER_BASE_URL")`) that overrides `baseUrl` when set. |
| `apiKey` | `string` | No (HTTP only) | Field name on `AppEnvironment` holding the `secret("...")` API key; omit for unauthenticated local model servers. |
| `deps` | `readonly Token[]` | No (`ModelProviderHandler`) | Constructor dependencies (`@Injectable()` SDK clients, `ApplicationContext`, `TenantContext`, `ExecutionContext`) injected into custom transport providers. |
| `timeout` | `Milliseconds` | **Yes** | Per-attempt request timeout (`minutes(2)`), passed via `request.signal`. |
| `cost` | `ModelCost` | **Yes** | Cost calculation policy (`ModelCost.fromResponse()`, `ModelCost.fromPrices(...)`, or `ModelCost.free()`). |
| `reasoning` | `Reasoning` | **Yes** | Default reasoning mode (`Reasoning.off()`, `Reasoning.on({ effort })`, or `Reasoning.modelDecides()`). |
| `promptCaching` | `PromptCaching` | **Yes** | Default prompt caching policy (`PromptCaching.off()`, `PromptCaching.whereSupported(...)`). |
| `retryPolicy` | `RetryPolicy` | **Yes** | Per-call retry backoff (`RetryPolicy.exponential({ maxAttempts, initialDelay, maxDelay, jitter, retryOn })` or `RetryPolicy.none()`). |
| `rateLimitPolicy` | `RateLimitPolicy` | No | Cluster-wide concurrency (`maxConcurrentCalls`), RPM (`perMinute`), and tenant fairness (`QueueBalancingStrategy.TenantRoundRobin`) coordinated via `RateLimitRepository`. |
| `circuitBreakerPolicy` | `CircuitBreakerPolicy` | No | Trips open across all instances when upstream fails (`{ failureThreshold, window, openFor }`), shifting `app.checkReadiness()` to `HealthStatus.Degraded` and activating `fallbackModels`. |
| `only` / `ignore` / `quantizations` / `allowFallbacks` | `OpenRouterProvider` options | No | OpenRouter host and quantization pinning (`only: ["Fireworks"]`, `ignore: ["Inceptron"]`, `quantizations: ["fp8", "bf16"]`, `allowFallbacks: false`) to prevent silent quantization degradation in production and evals. |

## What related entities work with `@ModelProvider`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `OpenRouterProvider` & `OpenAiCompatibleProvider` | `"@agboss/core/models"` | Base classes for OpenRouter and OpenAI-compatible chat/decision model servers (OpenAI, vLLM, Ollama, LiteLLM). |
| `ModelProviderHandler` (`complete(request)`) | `"@agboss/core/models"` | Interface for custom SDK/transport gateways (AWS Bedrock, Vertex AI, corporate proxies) wrapped by all AGBoss FinOps, rate-limit, circuit-breaker, and PII policies. |
| `ModelProviderFailureError` | `"@agboss/core/models"` | Thrown inside `complete(request)` to report classified failures (`ModelFailure.RateLimit` with `retryAfter`, `ModelFailure.Overloaded`, `ModelFailure.InvalidOutput`, `ModelFailure.InvalidToolArguments`) to the retry and AIMD engines. |
| `OpenRouterModelProvider` & `DecisionsModelProvider` | `"@agboss/core/models"` | Built-in catch-all providers (`serves: [/.*/]` and `[/^typesafe\/jev-/]`) that automatically yield any model claimed by another `@ModelProvider` in `@Application({ providers })` (unless explicitly replaced by subclassing `extends OpenRouterModelProvider` or `extends DecisionsModelProvider`). |
| `RateLimitPolicy` & `QueueBalancingStrategy` | `"@agboss/core/models"` | Configures `maxConcurrentCalls`, `perMinute`, and `QueueBalancingStrategy` (`TenantRoundRobin`, `TenantLeastInFlight`, `TenantWeighted`, `Fifo`). |
| `RetryPolicy` & `CircuitBreakerPolicy` | `"@agboss/core/models"` | Configures per-call exponential backoff and shared multi-instance circuit breaking. |
| `ModelCost`, `Reasoning`, `PromptCaching` | `"@agboss/core/models"` | Configures token pricing, thinking effort (`ReasoningEffort`), and KV prefix cache policies. |
| `RateLimitRepository` & `SqliteRateLimitRepository` | `"@agboss/core"` | Storage contract that coordinates concurrency slots, `429` cooldown windows, and circuit breaker state across worker processes. |
