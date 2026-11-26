---
title: "@Application & Runtime"
description: Assemble workflows, typed environments, model providers, budgets, PII policies, channels, health checks, and 4-stage storage scaling in a single @Application root.
---

Every AGBoss service has a single `@Application` assembly root that lists the workflows, typed environment contract, the explicit `@ModelProvider` classes (there are no built-in providers), mandatory `@Budget` ceilings (application, tenant, and execution scopes), `@PiiPolicy` rules, `@InputGuardrail` / `@OutputGuardrail` policies, `observers`, `@HealthCheck` probes, and the `storage` that says where the rows go (`@DatabaseStorage`). Both `createApp(Application, options)` and `testWith(Application)` boot this container, validating every contract at startup before any workflow executes.

## How to declare an `@Application` and its environment contract

An application's environment contract is a plain class declaring field types only (`environments/app.environment.ts` next to the application file — never place `secret()` or `env()` property initializers on the class itself, which triggers `[environment.contract-value]`). Each environment file (`dev.environment.ts`, `prod.environment.ts`, `test.environment.ts`) exports a typed `environment` object using `env()`, `env.optional()`, `env.integer()`, `env.flag()`, and `secret()`:

<!-- snippet-context
import { Application, Budget, BudgetPeriod, BudgetScope, type BudgetHandler } from "@agboss/core";
import { hours, seconds, usd, type Usd } from "@agboss/core/units";
import { AuditWorkflow, AuditAppBudget } from "./audit.workflow.js";
@Budget({ name: "audit-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class AuditTenantBudget implements BudgetHandler {
  maxSpend(): Usd {
    return usd(2);
  }
}
@Budget({ name: "audit-exec-budget", scope: BudgetScope.Execution })
export class AuditExecBudget implements BudgetHandler {
  maxSpend(): Usd {
    return usd(0.1);
  }
}
// @snippet
-->
```ts title="src/audit/audit.application.ts" file=src/audit/audit.application.ts
import { AppEnvironment } from "./environments/app.environment.js";

@Application({
  name: "audit-application",
  version: "1.0.0",
  environment: AppEnvironment,
  workflows: [AuditWorkflow],
  budgets: [AuditAppBudget, AuditTenantBudget, AuditExecBudget],
  retention: { pauseRecords: hours(24) },
  executionLimits: { shutdownTimeout: seconds(25), maxConcurrentSteps: 16 },
})
export class AuditApplication {}
```

```ts title="src/audit/environments/app.environment.ts" file=src/audit/environments/app.environment.ts
import type { Secret } from "@agboss/core";

export class AppEnvironment {
  auditUrl!: string;
  databaseUrl!: Secret;
  openRouterApiKey?: Secret;
}
```

```ts title="src/audit/audit.workflow.ts" file=src/audit/audit.workflow.ts
import { Budget, BudgetPeriod, BudgetScope, Workflow, WorkflowFinish, WorkflowStart, onStart, type BudgetHandler, Ttl } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
import { usd, type Usd } from "@agboss/core/units";

@WorkflowStart({ name: "audit-workflow-start", description: "A request", input: WorkflowStartTextDto })
export class AuditWorkflowStart {}

@WorkflowFinish({ name: "audit-workflow-finish", description: "The answer", output: WorkflowStartTextDto })
export class AuditWorkflowFinish {}

@Workflow({
  name: "audit-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [
    onStart(AuditWorkflowStart)
      .toFinish(AuditWorkflowFinish),
  ],
})
export class AuditWorkflow {}

@Budget({ name: "audit-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class AuditAppBudget implements BudgetHandler {
  maxSpend(): Usd { return usd(10); }
}
```

```ts title="src/audit/environments/prod.environment.ts" file=src/audit/environments/prod.environment.ts
import { env, secret } from "@agboss/core";
import type { AppEnvironment } from "./app.environment.js";

export const environment: AppEnvironment = {
  auditUrl: env("AUDIT_URL"),
  databaseUrl: secret("DATABASE_URL"),
  openRouterApiKey: secret("OPENROUTER_API_KEY"),
};
```

```ts title="src/audit/environments/test.environment.ts" file=src/audit/environments/test.environment.ts
import { secret } from "@agboss/core";
import type { AppEnvironment } from "./app.environment.js";

export const environment: AppEnvironment = {
  auditUrl: "http://127.0.0.1:4010/audit",
  databaseUrl: secret("DATABASE_URL"),
};
```

```ts title="test/audit.application.test.ts" file=test/audit.application.test.ts
import { expect } from "vitest";
import { ExecutionStatus, HealthStatus } from "@agboss/core";
import { testWith } from "@agboss/core/testing";
import { AuditApplication } from "../src/audit/audit.application.js";
import { AuditWorkflowFinish, AuditWorkflowStart } from "../src/audit/audit.workflow.js";

const test = testWith(AuditApplication, { env: "test" });

test("boots AuditApplication, executes AuditWorkflowStart, and checks probes", async ({
  app,
}) => {
  const result = await app.execute(AuditWorkflowStart, {
    text: "Run compliance audit",
  });
  expect(result.status).toBe(ExecutionStatus.Finished);
  expect(result.finish).toBe(AuditWorkflowFinish);
  expect(result.output).toEqual({ text: "Run compliance audit" });
  expect(HealthStatus.Healthy).toBeDefined();
});
```

## What `@Application` configures

| Option | Purpose |
| :--- | :--- |
| `workflows` | `@Workflow` classes exposed by the application. Calling `app.execute(StartClass, input)` runs the workflow owning that `@WorkflowStart`. |
| `environment` | Environment contract class (or `EmptyEnvironment` when no environment variables are needed). `Secret` fields mask as `***` everywhere except `.reveal()`. |
| `modelProvider` / `providers` | The `@ModelProvider` that serves every model naming none (`modelProvider`), and the infrastructure classes (`providers`): every `@ModelProvider`, custom `Logger` / `Clock` / `IdGenerator`. A model use whose cascade names no provider is `[model.missing-provider]`. |
| `storage` | Where the rows go: a `@DatabaseStorage` class (its `driver`, `auditLogTtl`, `ledgerEntriesTtl`, `idempotencySecret`, `piiSecret`) or `{ database, cluster?, objects? }` with a `@ClusterStorage` and an `@ObjectStorage`. Unset: the in-memory database. A store class listed in `providers` beside it is `[storage.providers-conflict]`. |
| `channels` / `channelSelectors` / `channelListeners` | The pause channels (`@Channel`), the selectors that pick a channel for a pause (`@ChannelSelector`) and the listeners told of every pause (`@ChannelListener`). |
| `endpoints` / `mesh` | The inbound protocol contracts (`@A2AEndpoint`, `@McpEndpoint`) and the `@Mesh` component that signs calls between AGBoss applications. |
| `budgets` | `@Budget` classes covering `BudgetScope.Application`, `BudgetScope.Tenant`, and `BudgetScope.Execution` (checked at assembly). A budget limits dollars (`maxSpend`) and tokens (`maxTokens`). |
| `piiPolicies` | Application-wide `@PiiPolicy` classes masking personal data at model boundaries and across logs, traces, and records. |
| `guardrails` | Application-wide `@InputGuardrail` and `@OutputGuardrail` classes cascaded to every workflow, agent, and model router. |
| `toolInterceptors` | `@ToolInterceptor` classes that see every tool call of the application. |
| `tenantContext` | A `@TenantContext` class: when it is declared, the point calls of `App` (`resume`, `cancel`, `getExecution`, …) take a required `{ tenantId }` — the tenant gate — and a call without one is `ValidationError.TenantRequired`. |
| `defaults` | The defaults of every workflow (`models`, `router`, `tools`, `guardrail`, `workflows: { placement }`). |
| `observers` | `@Observer` classes implementing hooks like `onExecutionEnd`, `onExecutionCancel`, `onExecutionStop`, `onAgentStart` or `onInterruptCleanupError`. |
| `healthChecks` | [`@HealthCheck`](/reference/health-check/) classes invoked by `app.checkLiveness()` and `app.checkReadiness()`. |
| `executionLimits` | The instance's limits: `maxConcurrentSteps` (instance-wide step ceiling; when saturated, `app.checkReadiness()` reports `Degraded` so Kubernetes load balancers shift new traffic to idle pods), `shutdownTimeout` (graceful drain on `app.close()` or `SIGTERM` / `SIGINT`, default `seconds(25)`, after which remaining runs release their leases for peer instances), `compensationTimeout`, `childClaimTimeout`. The flat `maxConcurrentSteps` / `shutdownTimeout` options of 0.1.0 are gone. |
| `retention` | `pauseRecords` (how long resolved pause records are kept before the 30-second recovery sweep purges them, default `hours(24)`), `executionRecords` (how long a root execution's history is kept; unset keeps nothing). The audit log and the ledger entries are kept as `@DatabaseStorage({ auditLogTtl, ledgerEntriesTtl })` says; an A2A endpoint keeps its tasks and messages as its own `ttl` says. |

## 4-Stage Progressive Infrastructure Scaling

Because `@Application({ storage })` names a storage component with a **driver**, you can scale from local unit tests to multi-pod Kubernetes clusters by changing the storage class, without changing a single line of `@Workflow` or `@Agent` code:

1. **Stage 1 — Local Dev & Isolated Tests:** no `storage`: the built-in in-memory database (`InMemoryDatabaseStorage`), `testWith(App)`, `VirtualClock`, and the unit runners (`testUnit`, `testAgent`, …).
2. **Stage 2 — Single-Node Durable Production (`node:sqlite` WAL):** `@DatabaseStorage({ driver: SqliteDriver({ path }), auditLogTtl, ledgerEntriesTtl })`. One file holds checkpoints, execution records, pauses, the cost ledger, leases, execution trees and rate limits.
3. **Stage 3 — Multi-Pod Cluster & K8s Probes:** Horizontal replicas coordinate via 30s leases, 30s orphan recovery sweeps, `executionLimits.maxConcurrentSteps`, and `app.checkLiveness()` / `app.checkReadiness()`. A `@ClusterStorage` (Redis) takes the leases, the child queue and the rate limits.
4. **Stage 4 — Networked and custom backends:** `PostgresDriver` or `MongoDriver` from the store packages (`@agboss/postgres`, `@agboss/mongodb`, `@agboss/redis`), or your own driver built with `defineStorageDriver` from `@agboss/core/stores`. A schema change of a networked store is `npx agboss migrate db`.

## How `app.execute`, `app.resume`, `app.cancel`, `app.stop`, `app.pause` and `app.close` work

- **`app.execute(StartClass, input, options?)`** — Starts or continues a workflow thread scoped by `{ threadId, ownerId, tenant: { tenantId, weight }, onStream }`, checking all budgets before the first step. The output is a union on `status`: `Finished` (with `output` and `finish`), `Paused`, `Stopped` or `Cancelled`.
- **`app.resume({ pauseId, decision }, options?)`** — Atomically records the answer of a human-in-the-loop pause (`Pending -> Resolved`), acquires the execution tree's 30-second lease, and continues from the checkpoint. The target's `permitAnswer` is enforced.
- **`app.cancel(threadId, { tenantId, ownerId, reason? })`** — Cancels an execution and undoes what it had undoable (`compensateWith`): `app.execute` / `app.resume` resolve `ExecutionStatus.Cancelled` instead of rejecting with `ExecutionCancelledError`. A cancel is a hard fence: nothing of the tree is written after it. It also closes the pending pauses of a paused thread (their channels hear it through `onPauseClosed`, a late `app.resume` gets `PauseError.Closed`).
- **`app.stop(threadId, { reason?, mode? })`** — Halts an execution where it stands: what it did is kept and nothing is undone. `mode` is `InterruptMode.AfterStep` (the default: the step in flight finishes and commits) or `Immediate` (the step in flight is aborted). It resolves `ExecutionStatus.Stopped` and returns `{ state: StopRequestState }`. `Cancel > Stop`.
- **`app.pause(threadId, { reason, mode })` / `app.unpause(threadId, { reason })`** — An operator's freeze: the execution rests at its checkpoint, `app.execute` resolves `ExecutionStatus.Paused` with `isExternallyPaused: true`, and `app.unpause` continues it from there (at a business pause it lifts only the freeze). `Cancel > Stop > Pause`.
- **`app.extendPause`, `app.reassignPause`, `app.listPauses`** — operate on the pauses of the application ([Channels & pauses](/guides/channels-and-pauses/)).
- **`app.getExecution` / `app.listExecutions`** — read the kept history of root executions as a `Page`.
- **`app.close({ timeout? })`** — Rejects new executions with `ApplicationStoppingError`, stops the recovery sweep, runs `onStop`, waits up to `timeout` for active steps to finish or pause, releases remaining leases so peer instances can recover them immediately, and runs `onDestroy`. `createApp` listens for `SIGTERM` / `SIGINT` only with `handleSignals: true`.
