---
title: "@Application"
description: Complete API reference for the @Application decorator in AGBoss — all configuration options, createApp(), App runtime methods, contexts, repositories, and testWith().
---

The `@Application` decorator defines the single assembly root (`*.application.ts`) of an AGBoss service. It wires your top-level `@Workflow` classes, typed `environment` contract, `@ModelProvider` gateways, mandatory `@Budget` caps, `@PiiPolicy` rules, `ExecutionObserver` hooks, and multi-instance storage repositories into one container verified at startup by `createApp(Application)` and in tests by `testWith(Application)`.

## What options does `@Application` accept?

Every `@Application` class name ends with `Application` and its `name` option ends with `-application`:

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier ending with `-application` (e.g., `"job-scout-application"`). |
| `version` | `string` | Yes | Semantic release version of the application (`"0.0.2"`), recorded in logs and traces. |
| `workflows` | `readonly Class[]` | Yes | Top-level `@Workflow` classes registered in the application; child workflows are discovered automatically. |
| `environment` | `Class` | Yes | Environment contract class (`AppEnvironment` or `EmptyEnvironment`) validated at startup. |
| `providers` | `readonly Provider[]` | No | Infrastructure repository implementations (`Sqlite*Repository`), `@ModelProvider` classes, `@Channel` implementations, and shared `@Injectable` services. |
| `budgets` | `readonly Class[]` | No | `@Budget` classes enforcing spend caps across `Application`, `Tenant`, and `Execution` scopes. |
| `observers` | `readonly ObserverClass[]` | No | `@Injectable` classes implementing `OnExecutionEnd`, `OnToolCallEnd`, `OnSpend`, `OnValuesOutdated`, and other observer hooks. |
| `healthChecks` | `readonly Class[]` | No | `@HealthCheck` classes executed by `app.checkReadiness()` and `app.checkLiveness()` alongside built-in repository and concurrency checks. |
| `piiPolicies` | `readonly Class[]` | No | Application-wide `@PiiPolicy` classes applied to every agent, router, log entry, and trace. |
| `pseudonymKey` | `string` | No | Name of a `Secret` field on the `environment` class used for HMAC token pseudonymization across all pods. |
| `tenantContext` | `TenantContextClass` | No | Custom subclass of `TenantContext` whose decorated DTO fields are required on `app.execute(..., { tenant })`. |
| `executionContext` | `ExecutionContextClass` | No | Custom subclass of `ExecutionContext` carrying per-execution identity fields passed via `app.execute(..., { execution })`. |
| `defaults` | `WorkflowDefaults` | No | Default `models`, `router`, `guardrail`, `tools`, `history`, and `flow` settings inherited by all workflows. |
| `pauseRecordRetention` | `Milliseconds` | No | How long resolved or cancelled pause records remain stored (`hours(24)` by default). |
| `maxInstanceConcurrency` | `number` | No | Local concurrency ceiling for active steps on a single pod (`32` by default; `<= 0` or non-integer fails assembly with `[application.invalid-instance-concurrency]`). Queues surplus work across 3 deadlock-safe priority levels (1: finishing `.join()`, `.joinQuorum()`, `.onError()`, `.onJoinError()`, `@WorkflowFinish`; 2: deeper in-flight steps with wait-time aging; 3: new `execute`/`resume` and parallel branch items) and flips `app.checkReadiness()` to `HealthStatus.Degraded`. |
| `compensationTimeout` | `Milliseconds` | No | Maximum time budget for automatic LIFO saga unwinding (`compensateWith`) on cancellation, `FailFast`, quorum `Surplus`, or `@Budget` breach (`seconds(15)` by default). |
| `shutdownTimeout` | `Milliseconds` | No | Grace period for `app.close()` and `SIGTERM` / `SIGINT` drain before releasing active execution leases (`seconds(25)` by default). |

## Complete `@Application` example with all capabilities

```ts title="src/support.application.ts" no-check: reference example
import { Application, EmptyEnvironment, ExecutionContext, Injectable, OnExecutionEnd, SqliteCheckpointSaver, SqliteCostLedgerRepository, SqliteExecutionLeaseRepository, SqliteExecutionRecordRepository, SqliteExecutionTreeRepository, SqlitePausedExecutionRepository, SqliteRateLimitRepository, TenantContext, createApp, env, secret, type ExecutionEndEvent } from "agboss";
import { Integer, Text } from "agboss/dto";
import { Reasoning } from "agboss/models";
import { hours, seconds } from "agboss/units";
import { ApplicationDailyBudget, ExecutionBudget, TenantDailyBudget } from "./config/budget.config.js";
import { OpenRouterProvider, RouterDecisionsProvider } from "./config/models.config.js";
import { ContactPiiPolicy } from "./config/pii.config.js";
import { SlackRefundApprovalChannel } from "./channels/slack-refund-approval.channel.js";
import { SupportWorkflow } from "./workflows/support.workflow.js";
import { ChatWorkflowStart } from "./workflow-starts/chat.workflow-start.js";

export class AppEnvironment {
  openRouterApiKey = secret("OPENROUTER_API_KEY");
  piiPseudonymKey = secret("PII_PSEUDONYM_KEY");
  sqlitePath = env("AGBOSS_SQLITE_PATH", { default: ".agboss/support.sqlite" });
}

export class SupportTenantContext extends TenantContext {
  @Text({ prompt: "Tenant organization identifier" })
  override tenantId!: string;

  @Integer({ min: 1, max: 10, prompt: "Fairness queue scheduling weight" })
  override weight!: number;
}

export class SupportExecutionContext extends ExecutionContext {
  @Text({ prompt: "Authenticated customer account ID" })
  accountId!: string;
}

@Injectable()
export class MetricsObserver implements OnExecutionEnd {
  onExecutionEnd(event: ExecutionEndEvent): void {
    console.log(event.workflow.name, event.status, event.durationMs);
  }
}

@Application({
  name: "support-application",
  version: "0.0.2",
  workflows: [SupportWorkflow],
  environment: AppEnvironment,
  tenantContext: SupportTenantContext,
  executionContext: SupportExecutionContext,
  providers: [
    OpenRouterProvider,
    RouterDecisionsProvider,
    SlackRefundApprovalChannel,
    SqliteCheckpointSaver,
    SqliteCostLedgerRepository,
    SqliteExecutionRecordRepository,
    SqlitePausedExecutionRepository,
    SqliteExecutionLeaseRepository,
    SqliteExecutionTreeRepository,
    SqliteRateLimitRepository,
  ],
  budgets: [
    ApplicationDailyBudget,
    TenantDailyBudget,
    ExecutionBudget,
  ],
  piiPolicies: [ContactPiiPolicy],
  pseudonymKey: "piiPseudonymKey",
  observers: [MetricsObserver],
  defaults: {
    models: {
      temperature: 0,
      reasoning: Reasoning.on({ effort: "low" }),
    },
    router: {
      model: "typesafe/jev-1.13",
    },
    tools: {
      maxToolCalls: 8,
    },
  },
  pauseRecordRetention: hours(48),
  maxInstanceConcurrency: 32,
  compensationTimeout: seconds(15),
  shutdownTimeout: seconds(25),
})
export class SupportApplication {}
```

```ts title="src/environments/prod.environment.ts" no-check: reference example
import { env, secret } from "agboss";
import type { AppEnvironment } from "../support.application.js";

export const environment: AppEnvironment = {
  openRouterApiKey: secret("OPENROUTER_API_KEY"),
  piiPseudonymKey: secret("PII_PSEUDONYM_KEY"),
  sqlitePath: env("AGBOSS_SQLITE_PATH", { default: ".agboss/state.sqlite" }),
  webhookBaseUrl: env.optional("WEBHOOK_BASE_URL"),
};
```

```ts title="src/budgets/support.budgets.ts" no-check: reference example
import { Budget, BudgetPeriod, BudgetScope, type BudgetHandler } from "agboss";
import { usd, type Usd } from "agboss/units";

@Budget({ name: "app-daily-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class AppDailyBudget implements BudgetHandler {
  maxSpend(): Usd { return usd(200); }
}

@Budget({ name: "tenant-monthly-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Month })
export class TenantMonthlyBudget implements BudgetHandler {
  maxSpend(): Usd { return usd(50); }
}

@Budget({ name: "execution-run-budget", scope: BudgetScope.Execution })
export class ExecutionRunBudget implements BudgetHandler {
  maxSpend(): Usd { return usd(0.5); }
}
```

## What related entities work with `@Application`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `createApp(AppClass, options?)` | `"agboss"` | Boots the container, runs `onInit()` and `onStart()` on all components, starts recovery sweeps, and returns the `App` handle. |
| `App` (`execute`, `resume`, `cancel`, `checkReadiness`, `checkLiveness`, `close`, `tool`) | `"agboss"` | Runtime handle used to start workflows, resume pauses, cancel runs (`app.cancel(threadId)`), report pod health (`HealthStatus.Healthy` / `HealthStatus.Degraded` / `HealthStatus.Unhealthy`), invoke isolated tools, and drain gracefully on shutdown. |
| `EmptyEnvironment` | `"agboss"` | Built-in empty contract class for applications that do not read environment variables. |
| `env()`, `env.optional()`, `secret()` | `"agboss"` | Readers used in `environments/*.environment.ts` files to bind and validate `process.env` variables at startup. |
| `ApplicationContext`, `Clock`, `Logger` | `"agboss"` | Built-in container singletons injectable into any service, action, tool, or observer via `deps`. |
| `Sqlite*Repository` (7 classes) | `"agboss"` | Zero-dependency `node:sqlite` WAL implementations of the 7 multi-instance durability contracts. |
| `testWith(AppClass, options?)` | `"agboss/testing"` | Deterministic test harness that boots one or more application instances with DI `overrides` and a `VirtualClock`. |

### Booting, executing, resuming, and shutting down `App`

```ts title="src/main.ts" no-check: reference example
import { ExecutionStatus, createApp } from "agboss";
import { seconds } from "agboss/units";
import { SupportApplication } from "./support.application.js";
import { ChatWorkflowStart } from "./workflow-starts/chat.workflow-start.js";

const app = await createApp(SupportApplication, { env: "prod" });

const result = await app.execute(
  ChatWorkflowStart,
  { text: "Please refund order #A-1042" },
  {
    threadId: "thread-1042",
    ownerId: "user-42",
    tenant: { tenantId: "acme", weight: 3 },
    execution: { accountId: "acc-99" },
    record: true,
  },
);

if (result.status === ExecutionStatus.Paused) {
  const pause = result.pending[0]!;
  await app.resume(
    { pauseId: pause.pauseId, decision: { approved: true } },
    { tenantId: "acme", answeredBy: "finance-lead" },
  );
}

process.once("SIGTERM", () => {
  void app.close({ timeout: seconds(25) });
});
```

```ts title="test/support.application.test.ts" no-check: reference example
import { expect } from "vitest";
import { testWith } from "agboss/testing";
import { SupportApplication } from "../src/support.application.js";
import { ChatWorkflowStart } from "../src/workflow-starts/chat.workflow-start.js";

const test = testWith(SupportApplication);

test("boots the application container and executes ChatWorkflowStart", async ({ app }) => {
  const res = await app.execute(ChatWorkflowStart, { text: "Refund order #194" });
  expect(res.record.executionId).toBeDefined();
});
```
