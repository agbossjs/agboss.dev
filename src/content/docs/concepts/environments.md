---
title: Environments, Secrets & Units
description: Configure 12-factor typed environments with AppEnvironment, secret(), env(), env.optional(), and explicit unit types (usd, seconds, minutes, hours).
---

AGBoss enforces strict 12-factor dev/prod parity: workflows and components never read `process.env` directly. Instead, each `@Application` declares a single environment contract class (`environments/app.environment.ts`), and each deployment target (`prod.environment.ts`, `dev.environment.ts`, `test.environment.ts`) provides an object matching that contract.

## How to declare `AppEnvironment`, `secret()`, and `env()`

At `createApp(Application, { environment })` startup, AGBoss validates every required environment variable and secret before initializing services or running workflows, throwing `EnvironmentError` immediately if any variable is missing or invalid:

```ts title="src/environments/app.environment.ts" file=src/environments/app.environment.ts
import type { Secret } from "@agboss/core";
import type { Milliseconds, Usd } from "@agboss/core/units";

export class AppEnvironment {
  openRouterApiKey!: Secret;
  piiPseudonymKey!: Secret;
  sqlitePath!: string;
  webhookBaseUrl?: string;
  requestTimeout!: Milliseconds;
  dailyTenantCap!: Usd;
}
```

```ts title="src/environments/prod.environment.ts" file=src/environments/prod.environment.ts
import { env, secret } from "@agboss/core";
import { seconds, usd } from "@agboss/core/units";
import type { AppEnvironment } from "./app.environment.js";

export const environment: AppEnvironment = {
  openRouterApiKey: secret("OPENROUTER_API_KEY"),
  piiPseudonymKey: secret("PII_PSEUDONYM_KEY"),
  sqlitePath: env("AGBOSS_SQLITE_PATH", {
    default: "/var/lib/agboss/state.sqlite",
  }),
  webhookBaseUrl: env.optional("WEBHOOK_BASE_URL"),
  requestTimeout: seconds(30),
  dailyTenantCap: usd(50),
};
```

```ts title="src/environments/test.environment.ts" file=src/environments/test.environment.ts
import { secret } from "@agboss/core";
import { seconds, usd } from "@agboss/core/units";
import type { AppEnvironment } from "./app.environment.js";

export const environment: AppEnvironment = {
  openRouterApiKey: secret("OPENROUTER_API_KEY"),
  piiPseudonymKey: secret("PII_PSEUDONYM_KEY"),
  sqlitePath: ":memory:",
  requestTimeout: seconds(5),
  dailyTenantCap: usd(1),
};
```

```ts title="test/environments.test.ts" file=test/environments.test.ts
import { expect, it } from "vitest";
import { hours, minutes, seconds, usd } from "@agboss/core/units";
import { environment as testEnv } from "../src/environments/test.environment.js";

it("validates explicit unit factories and masks Secret instances in string serialization", () => {
  expect(testEnv.sqlitePath).toBe(":memory:");
  expect(testEnv.requestTimeout).toBe(seconds(5));
  expect(testEnv.dailyTenantCap).toBe(usd(1));
  expect(minutes(1)).toBe(seconds(60));
  expect(hours(1)).toBe(minutes(60));
});
```

> **Compiler diagnostic `[environment.contract-value]`:** `AppEnvironment` is a pure TypeScript contract class (`field!: Type`). Never assign default values or field initializers on `AppEnvironment` itself (`sqlitePath = ":memory:"` fails with `[environment.contract-value]`) — all concrete values and `env(..., { default })` calls belong in `environments/<name>.environment.ts`.

| Helper | Import | Behavior |
| :--- | :--- | :--- |
| `secret("ENV_VAR")` | `"@agboss/core"` | Reads a required secret into a `Secret` instance that prints as `"***"` in `String()`, `JSON.stringify()`, `util.inspect`, and logs; call `.reveal()` only when passing to a wire client. |
| `env("ENV_VAR", { default? })` | `"@agboss/core"` | Reads a required string variable (or falls back to `default` when unset). |
| `env.optional("ENV_VAR")` | `"@agboss/core"` | Returns `string \| undefined` without failing startup when the variable is unset. |
| `EmptyEnvironment` | `"@agboss/core"` | Built-in empty contract class for applications that do not require environment variables. |

## Why AGBoss requires explicit unit factories (`@agboss/core/units`)

Raw numbers in configuration are a major source of production bugs (confusing `30` seconds with `30` milliseconds, or passing negative/NaN floats as dollar budgets). Every timeout, TTL, retention window, and dollar amount in AGBoss uses branded unit factories from `@agboss/core/units`:

| Factory | Return Type | Validation & Usage |
| :--- | :--- | :--- |
| `usd(amount)` | `Usd` | Verifies finite `amount >= 0`; used in `@Budget.maxSpend()`, `SpendRecorder.record()`, and `replyWith(..., { cost })`. |
| `seconds(n)` | `Milliseconds` | Converts non-negative seconds to branded `Milliseconds` (`timeout`, `shutdownTimeout`, quorum `deadline`). |
| `minutes(n)` | `Milliseconds` | Converts non-negative minutes to branded `Milliseconds` (model provider `timeout`, circuit breaker cooldowns). |
| `hours(n)` | `Milliseconds` | Converts non-negative hours to branded `Milliseconds` (`pauseRecordRetention: hours(24)`, long quorum deadlines). |
