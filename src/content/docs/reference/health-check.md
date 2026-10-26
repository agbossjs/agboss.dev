---
title: "@HealthCheck & Pod Lifecycle"
description: Reference for @HealthCheck, app.checkLiveness(), app.checkReadiness(), graceful SIGTERM pod shutdown, and 4-stage lifecycle hooks in AGBoss.
---

AGBoss applications running in Kubernetes or multi-instance worker clusters expose liveness and readiness health probes via `await app.checkLiveness()` and `await app.checkReadiness()`, register custom dependency probes with `@HealthCheck`, and coordinate graceful `SIGTERM` / `SIGINT` lease handoff through the 4-stage container lifecycle (`OnInit`, `OnStart`, `OnStop`, `OnDestroy`).

## Complete `@HealthCheck`, Liveness, and Readiness example

```ts title="src/health/claims-api.health-check.ts" file=src/health/claims-api.health-check.ts
import {
  HealthCheck,
  HealthCheckResult,
  Injectable,
  type HealthCheckHandler,
  type OnDestroy,
  type OnInit,
  type OnStart,
  type OnStop,
} from "@agboss/core";
import { seconds } from "@agboss/core/units";

@Injectable()
export class ClaimsApiService implements OnInit, OnStart, OnStop, OnDestroy {
  private ready = false;

  onInit(): void {
    // 1. Runs in topological dependency order during createApp()
  }

  onStart(): void {
    // 2. Opens connections after all onInit() hooks complete
    this.ready = true;
  }

  onStop(): void {
    // 3. Runs in reverse topological order on app.close() / SIGTERM
    this.ready = false;
  }

  onDestroy(): void {
    // 4. Final cleanup after active execution leases are released
  }

  ping(): Promise<boolean> {
    return Promise.resolve(this.ready);
  }
}

@HealthCheck({
  name: "claims-api-health-check",
  timeout: seconds(2),
  deps: [ClaimsApiService],
})
export class ClaimsApiHealthCheck implements HealthCheckHandler {
  constructor(private readonly claimsApiService: ClaimsApiService) {}

  async check(): Promise<HealthCheckResult> {
    return (await this.claimsApiService.ping())
      ? HealthCheckResult.healthy()
      : HealthCheckResult.degraded({ reason: "claims API warming up" });
  }
}
```

<!--
```ts file=src/environments/app.environment.ts
export class ClusterEnvironment {
  sqlitePath!: string;
}
```
```ts file=src/environments/prod.environment.ts
import type { ClusterEnvironment } from "./app.environment.js";

export const environment: ClusterEnvironment = {
  sqlitePath: ":memory:",
};
```
```ts file=src/worker-ping.workflow.ts
import { Budget, BudgetPeriod, BudgetScope, Workflow, WorkflowFinish, WorkflowStart, start, type BudgetHandler } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
import { usd, type Usd } from "@agboss/core/units";

@WorkflowStart({ name: "worker-ping-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class WorkerPingStart {}
@WorkflowFinish({ name: "worker-ping-workflow-finish", description: "Finish", output: WorkflowStartTextDto })
export class WorkerPingFinish {}

@Workflow({
  name: "worker-ping-workflow",
  version: "1.0.0",
  flow: [
    start(WorkerPingStart)
      .returns(WorkflowStartTextDto)
      .toFinish(WorkerPingFinish),
  ],
})
export class WorkerPingWorkflow {}

@Budget({ name: "worker-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class WorkerAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(50); } }
@Budget({ name: "worker-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class WorkerTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "worker-exec-budget", scope: BudgetScope.Execution })
export class WorkerExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }
```
-->

```ts title="src/worker-cluster.application.ts" file=src/worker-cluster.application.ts
import {
  Application,
  SqliteCheckpointSaver,
  SqliteCostLedgerRepository,
  SqliteExecutionLeaseRepository,
  SqliteExecutionRecordRepository,
  SqliteExecutionTreeRepository,
  SqlitePausedExecutionRepository,
  SqliteRateLimitRepository,
} from "@agboss/core";
import { hours, seconds } from "@agboss/core/units";
import { ClusterEnvironment } from "./environments/app.environment.js";
import { ClaimsApiHealthCheck, ClaimsApiService } from "./health/claims-api.health-check.js";
import {
  WorkerAppBudget,
  WorkerExecBudget,
  WorkerPingWorkflow,
  WorkerTenantBudget,
} from "./worker-ping.workflow.js";

@Application({
  name: "worker-cluster-application",
  version: "1.0.0",
  environment: ClusterEnvironment,
  workflows: [WorkerPingWorkflow],
  providers: [
    ClaimsApiService,
    SqliteExecutionRecordRepository,
    SqliteCostLedgerRepository,
    SqlitePausedExecutionRepository,
    SqliteCheckpointSaver,
    SqliteExecutionLeaseRepository,
    SqliteExecutionTreeRepository,
    SqliteRateLimitRepository,
  ],
  healthChecks: [ClaimsApiHealthCheck],
  budgets: [WorkerAppBudget, WorkerTenantBudget, WorkerExecBudget],
  maxConcurrentSteps: 32,
  compensationTimeout: seconds(15),
  shutdownTimeout: seconds(25),
  pauseRecordRetention: hours(24),
})
export class WorkerClusterApplication {}
```

```ts title="src/main.ts" file=src/main.ts
import { createServer } from "node:http";
import { HealthStatus, createApp, type HealthReport } from "@agboss/core";
import { WorkerClusterApplication } from "./worker-cluster.application.js";

export async function startProbeServer(): Promise<void> {
  const app = await createApp(WorkerClusterApplication, { env: "prod" });

  createServer((req, res) => {
    const probe: Promise<HealthReport> | undefined =
      req.url === "/livez"
        ? app.checkLiveness()
        : req.url === "/readyz"
          ? app.checkReadiness()
          : undefined;

    if (probe !== undefined) {
      void probe.then((report) => {
        res.writeHead(report.status === HealthStatus.Unhealthy ? 503 : 200, {
          "content-type": "application/json",
        });
        res.end(JSON.stringify(report));
      });
    }
  });
}
```

```ts title="test/claims-api.health-check.test.ts" file=test/claims-api.health-check.test.ts
import { expect } from "vitest";
import { HealthStatus } from "@agboss/core";
import { testWith } from "@agboss/core/testing";
import { WorkerClusterApplication } from "../src/worker-cluster.application.js";

const test = testWith(WorkerClusterApplication);

test("reports Healthy on checkLiveness and checkReadiness after startup", async ({ app }) => {
  const liveness = await app.checkLiveness();
  const readiness = await app.checkReadiness();

  expect(liveness.status).toBe(HealthStatus.Healthy);
  expect(readiness.status).toBe(HealthStatus.Healthy);
});
```

## What options does `@HealthCheck` accept?

Every `@HealthCheck` class implements `HealthCheckHandler`, has a `name` ending with `-health-check` (`[name.kind-suffix]`), and is registered in `@Application({ healthChecks })` (`[health.not-a-health-check]`, `[health.duplicate-name]`):

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | **Yes** | Unique kebab-case identifier ending with `-health-check` (e.g., `"claims-api-health-check"`). |
| `timeout` | `Milliseconds` | **Yes** | Maximum duration `check()` may take (`seconds(2)`); if exceeded or thrown, the component reports `HealthStatus.Unhealthy`. |
| `deps` | `readonly Token[]` | No | Constructor dependencies injected by the application container and verified against the constructor signature. |

## How `app.checkLiveness()` and `app.checkReadiness()` work

Both `app.checkLiveness()` and `app.checkReadiness()` resolve to a `HealthReport { status, components }` and never reject. The top-level `status` is the worst status across all checked components (`HealthStatus.Healthy`, `HealthStatus.Degraded`, or `HealthStatus.Unhealthy`):

| Probe | Checked Components (`HealthComponentKind`) | Behavior |
| :--- | :--- | :--- |
| **`app.checkLiveness()`** | `Application` (`"application"`), `RecoveryLoop` (`"recovery-loop"`) | Performs zero external I/O. Reports `Unhealthy` once `app.close()` begins (`stopping`) or if the 30-second recovery sweep has not completed within 90 seconds. |
| **`app.checkReadiness()`** | Liveness components + `Store` (`"store"`), `ModelProvider` (`"model-provider"`), `StepSlots` (`"step-slots"`), `Project` (`"project"`) | Calls `ping()` on every configured repository (`seconds(2)` timeout), checks every `@ModelProvider` circuit breaker (open breaker -> `Degraded`), checks `@Application({ maxConcurrentSteps })` saturation (all slots busy -> `Degraded`), and runs every `@HealthCheck` under its own `timeout`. |

Custom `@HealthCheck` classes return branded results built exclusively with `HealthCheckResult.healthy()`, `HealthCheckResult.degraded({ reason })`, or `HealthCheckResult.unhealthy({ reason })` (a `Degraded` instance continues serving traffic while signaling reduced capacity).

## Pod lifecycle and concurrency settings reference

| Setting / Hook | Where Configured | Default | Purpose |
| :--- | :--- | :--- | :--- |
| `healthChecks` | `@Application` | `[]` | `@HealthCheck` classes executed by `await app.checkReadiness()` under their configured `timeout`. |
| `maxConcurrentSteps` | `@Application` | Unbounded | Maximum concurrent agent, router, and action steps on this pod (`[limits.max-concurrent-steps-invalid]`). When all slots are busy, `checkReadiness()` reports `HealthStatus.Degraded` (`step-slots`). |
| `shutdownTimeout` | `@Application` | `seconds(25)` | Grace period on `app.close()` / `SIGTERM` before interrupting active executions and releasing their 30s leases (`< kubernetes terminationGracePeriodSeconds`). |
| `compensationTimeout` | `@Application` | `seconds(15)` | Clean-up deadline per automatic `@Action({ compensateWith })` rollback step. |
| `pauseRecordRetention` | `@Application` | `hours(24)` | How long resolved (`Taken`, `Cancelled`) pause records are retained in `PausedExecutionRepository` so duplicate webhook clicks receive `NotPausedError`. |
| `OnInit` / `OnStart` / `OnStop` / `OnDestroy` | `@Injectable()` providers | — | Deterministic 4-stage startup and reverse-topological shutdown hooks. |
