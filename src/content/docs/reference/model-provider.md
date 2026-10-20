---
title: "@ModelProvider"
description: Complete API reference for the @ModelProvider decorator in AGBoss — OpenAiCompatibleProvider, RateLimitPolicy, RetryPolicy, CircuitBreakerPolicy, ModelCost, and tenant fairness.
---

The `@ModelProvider` decorator (`config/models.config.ts`) defines an application-level LLM gateway registered in `@Application({ providers })`. Every model string referenced by an `@Agent`, `@Router`, `@Arbiter`, `@Judge`, or `@PiiPolicy` is matched at startup against the `serves` regular expressions of your registered `@ModelProvider` classes (`[model.unserved]` or `[model.ambiguous-provider]` if zero or multiple providers match).

## What options does `@ModelProvider` accept?

Every `@ModelProvider` class extends `OpenAiCompatibleProvider<Env>` (or implements `ModelProviderHandler`) and its `name` ends with `-model-provider`:

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier ending with `-model-provider` (e.g., `"openrouter-model-provider"`). |
| `description` | `string` | Yes | Human-readable summary of which models and upstream endpoint this provider serves. |
| `serves` | `readonly RegExp[]` | Yes | Non-empty array of regex patterns matching model IDs served by this provider (`[/^moonshotai\//, /^anthropic\//]`). |
| `baseUrl` | `string` | Yes | Default upstream base URL (`"https://openrouter.ai/api/v1"`). |
| `baseUrlField` | `string` | No | Optional field name on `AppEnvironment` (`env.optional("OPENROUTER_BASE_URL")`) that overrides `baseUrl` when set. |
| `apiKey` | `string` | No | Field name on `AppEnvironment` holding the `secret("...")` API key; omit for unauthenticated local model servers. |
| `timeout` | `Milliseconds` | Yes | Per-attempt HTTP request timeout (`seconds(60)`). |
| `cost` | `ModelCost` | Yes | Cost calculation policy (`ModelCost.reportedElse({ input, output })`, `ModelCost.perMillionTokens({ input, output })`, or `ModelCost.free()`). |
| `reasoning` | `Reasoning` | Yes | Default reasoning mode (`Reasoning.off()`, `Reasoning.on({ effort })`, or `Reasoning.modelDecides()`). |
| `promptCaching` | `PromptCaching` | Yes | Default prompt caching policy (`PromptCaching.off()` or `PromptCaching.ephemeral()`). |
| `retryPolicy` | `RetryPolicy` | Yes | Per-call retry backoff (`RetryPolicy.exponential({ maxAttempts, initialDelay, maxDelay })` or `RetryPolicy.none()`). |
| `rateLimitPolicy` | `RateLimitPolicy` | No | Cluster-wide concurrency, RPM, tenant fairness (`Fairness.TenantRoundRobin`), and `429` pause policy coordinated via `RateLimitRepository`. |
| `circuitBreakerPolicy` | `CircuitBreakerPolicy` | Yes | Trips open across all instances when upstream fails (`CircuitBreakerPolicy.of({ failuresBeforePause, pauseFor })`). |

## Complete `@ModelProvider` example with all capabilities

```ts title="src/model-providers/openrouter.model-provider.ts" no-check: reference example
import { CircuitBreakerPolicy, Fairness, ModelCost, ModelProvider, OpenAiCompatibleProvider, PromptCaching, RateLimitPolicy, Reasoning, RetryPolicy } from "agboss/models";
import { minutes, seconds, usd } from "agboss/units";
import type { AppEnvironment } from "../environments/app.environment.js";

@ModelProvider({
  name: "openrouter-model-provider",
  description: "Serves primary chat and reasoning models via OpenRouter with tenant-fair queueing",
  serves: [
    /^moonshotai\//,
    /^anthropic\//,
    /^google\//,
  ],
  baseUrl: "https://openrouter.ai/api/v1",
  baseUrlField: "openRouterBaseUrl",
  apiKey: "openRouterApiKey",
  timeout: seconds(60),
  cost: ModelCost.reportedElse({
    inputPerMillion: usd(0.6),
    outputPerMillion: usd(2.4),
  }),
  reasoning: Reasoning.on({ effort: "low" }),
  promptCaching: PromptCaching.ephemeral(),
  retryPolicy: RetryPolicy.exponential({
    maxAttempts: 3,
    initialDelay: seconds(1),
    maxDelay: seconds(10),
  }),
  rateLimitPolicy: RateLimitPolicy.of({
    maxConcurrent: 16,
    requestsPerMinute: 240,
    pauseOn429: seconds(30),
    maxWait: minutes(2),
    fairness: Fairness.TenantRoundRobin,
  }),
  circuitBreakerPolicy: CircuitBreakerPolicy.of({
    failuresBeforePause: 5,
    pauseFor: seconds(30),
  }),
})
export class OpenRouterProvider extends OpenAiCompatibleProvider<AppEnvironment> {}
```

```ts title="src/environments/app.environment.ts" no-check: reference example
import { env, secret, type Secret } from "agboss";

export class AppEnvironment {
  openRouterPrimaryKey!: Secret;
  openRouterBackupKey!: Secret;
  openRouterBaseUrl!: string;
}

export const environment: AppEnvironment = {
  openRouterPrimaryKey: secret("OPENROUTER_PRIMARY_KEY"),
  openRouterBackupKey: secret("OPENROUTER_BACKUP_KEY"),
  openRouterBaseUrl: env("OPENROUTER_BASE_URL", {
    default: "https://openrouter.ai/api/v1",
  }),
};
```

```ts title="src/support.application.ts" no-check: reference example
import { Application, SqliteRateLimitRepository } from "agboss";
import { DecisionsModelProvider } from "agboss/models";
import { AppEnvironment } from "./environments/app.environment.js";
import { OpenRouterModelProvider } from "./model-providers/openrouter.model-provider.js";

@Application({
  name: "support-application",
  version: "1.0.0",
  environment: AppEnvironment,
  workflows: [SupportWorkflow],
  providers: [
    OpenRouterModelProvider,
    DecisionsModelProvider,
    SqliteRateLimitRepository,
  ],
})
export class SupportApplication {}
```

## What related entities work with `@ModelProvider`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `OpenAiCompatibleProvider<Env>` | `"agboss/models"` | Base class for OpenAI-compatible chat and decision model servers (OpenRouter, OpenAI, vLLM, Ollama, LiteLLM). |
| `OpenRouterModelProvider` & `DecisionsModelProvider` | `"agboss/models"` | Built-in default providers used when `@Application({ providers })` lists no custom `@ModelProvider`. |
| `RateLimitPolicy` & `Fairness` | `"agboss/models"` | Configures `maxConcurrent`, `requestsPerMinute`, `pauseOn429`, `maxWait`, and `Fairness.TenantRoundRobin` (weighted by `tenant.weight`). |
| `RetryPolicy` & `CircuitBreakerPolicy` | `"agboss/models"` | Configures per-call exponential backoff and shared multi-instance circuit breaking. |
| `ModelCost`, `Reasoning`, `PromptCaching` | `"agboss/models"` | Configures token pricing fallbacks, thinking effort, and ephemeral cache breakpoints. |
| `RateLimitRepository` & `SqliteRateLimitRepository` | `"agboss"` | Storage contract that coordinates concurrency slots, `429` cooldown windows, and circuit breaker state across worker processes. |
