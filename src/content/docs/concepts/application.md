---
title: "@Application & Runtime"
description: Assemble workflows, typed environments, model providers, budgets, PII policies, channels, health checks, and 4-stage storage scaling in a single @Application root.
---

Every AGBoss service has a single `@Application` assembly root that lists the workflows, typed environment contract, shared `@ModelProvider` classes, mandatory `@Budget` ceilings (application, tenant, and execution scopes), `@PiiPolicy` rules, `@InputGuardrail` / `@OutputGuardrail` policies, `observers`, `@HealthCheck` probes, and storage repositories. Both `createApp(Application, options)` and `testWith(Application)` boot this container, validating every contract at startup before any workflow executes.

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
  pauseRecordRetention: hours(24),
  shutdownTimeout: seconds(25),
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
import { Budget, BudgetPeriod, BudgetScope, Workflow, WorkflowFinish, WorkflowStart, start, type BudgetHandler } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
import { usd, type Usd } from "@agboss/core/units";

@WorkflowStart({ name: "audit-workflow-start", description: "A request", input: WorkflowStartTextDto })
export class AuditWorkflowStart {}

@WorkflowFinish({ name: "audit-workflow-finish", description: "The answer", output: WorkflowStartTextDto })
export class AuditWorkflowFinish {}

@Workflow({
  name: "audit-workflow",
  version: "1.0.0",
  flow: [
    start(AuditWorkflowStart)
      .returns(WorkflowStartTextDto)
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
| `providers` | Infrastructure and shared providers: `@ModelProvider` classes, `@Channel` implementations, custom `Logger` / `Clock`, and `Sqlite*Repository` stores. |
| `budgets` | `@Budget` classes covering `BudgetScope.Application`, `BudgetScope.Tenant`, and `BudgetScope.Execution` (checked at assembly). |
| `piiPolicies` | Application-wide `@PiiPolicy` classes masking personal data at model boundaries and across logs, traces, and records. |
| `guardrails` | Application-wide `@InputGuardrail` and `@OutputGuardrail` classes cascaded to every workflow, agent, and model router. |
| `compaction` / `uncompactedTurns` | Application-wide `@Compaction` strategy (`SummaryQueue`, `SingleSummary`, `None`) and recent turn preservation window. |
| `observers` | `@Injectable()` observer classes implementing hooks like `OnExecutionEnd`, `OnAgentStart`, `OnExecutionRejected`, or `OnExecutionResume`. |
| `healthChecks` | [`@HealthCheck`](/reference/health-check/) classes invoked by `app.checkLiveness()` and `app.checkReadiness()`. |
| `maxConcurrentSteps` | Instance-wide step ceiling; when saturated, `app.checkReadiness()` reports `Degraded` so Kubernetes load balancers shift new traffic to idle pods. |
| `pauseRecordRetention` | How long resolved pause records are kept before the 30-second recovery sweep purges them (default `hours(24)`). |
| `shutdownTimeout` | Graceful drain window on `app.close()` or `SIGTERM` / `SIGINT` (default `seconds(25)`), after which remaining runs release their leases for peer instances. |

## 4-Stage Progressive Infrastructure Scaling

Because `@Application({ providers })` resolves storage contracts by class inheritance (`SqliteCheckpointSaver extends CheckpointSaver`), you can scale from local unit tests to multi-pod Kubernetes clusters without changing a single line of `@Workflow` or `@Agent` code:

1. **Stage 1 — Local Dev & Isolated Tests:** Default `InMemory*` stores, `testWith(App)`, `VirtualClock`, and 8 unit runners.
2. **Stage 2 — Single-Node Durable Production (`node:sqlite` WAL):** Register the 7 `Sqlite*` providers (`SqliteCheckpointSaver`, `SqliteExecutionRecordRepository`, `SqlitePausedExecutionRepository`, `SqliteCostLedgerRepository`, `SqliteExecutionLeaseRepository`, `SqliteExecutionTreeRepository`, `SqliteRateLimitRepository`).
3. **Stage 3 — Multi-Pod Cluster & K8s Probes:** Horizontal replicas coordinate via 30s leases, 30s orphan recovery sweeps, `maxConcurrentSteps`, and `app.checkLiveness()` / `app.checkReadiness()`.
4. **Stage 4 — Custom Enterprise Backends:** Subclass any of the 7 repository contracts (`PostgresCheckpointSaver extends CheckpointSaver`) and list it in `providers`.

## How `app.execute`, `app.resume`, `app.cancel`, and `app.close` work

- **`app.execute(StartClass, input, options?)`** — Starts or continues a workflow thread scoped by `{ threadId, ownerId, tenant: { tenantId, weight }, onStream }`, checking all budgets before the first step.
- **`app.resume({ pauseId, reply }, options?)`** — Atomically records a human-in-the-loop reply (`Pending -> Resolved`), acquires the execution tree's 30-second lease, and continues from the checkpoint.
- **`app.cancel(threadId, { tenantId, ownerId })`** — Aborts a running execution before its next model or tool call (`ExecutionCancelledError`) or withdraws pending pauses (`ChannelHandler.withdraw(info)`) on a paused thread.
- **`app.close({ timeout? })`** — Rejects new executions with `ApplicationStoppingError`, stops the recovery sweep, runs `onStop`, waits up to `timeout` for active steps to finish or pause, releases remaining leases so peer instances can recover them immediately, and runs `onDestroy`.
