---
title: Multi-Instance Distribution, Leases, SQLite & Custom Stores
description: "Scale AGBoss from in-memory unit tests to SQLite WAL and Kubernetes pods using shared repositories, 30s execution leases, fencing, and @HealthCheck probes."
---

An AGBoss `@Application` can run as **multiple instances (processes, containers, or Kubernetes pods)** over shared storage: any instance can resume a pause created on another instance, recover an execution whose worker process died mid-step, or cancel a running thread across the cluster — while 30-second execution-tree leases guarantee that two instances never advance the same execution tree simultaneously.

---

## Multi-instance application & failover test

Below is a complete multi-instance application wired with the 7 `Sqlite*` WAL repositories, a custom `TableExecutionLeaseRepository extends ExecutionLeaseRepository` implementation, and a multi-instance `testWith(App, { instances: 2 })` test suite:

```ts title="src/environments/prod.environment.ts" file=src/environments/prod.environment.ts
import {
  SqliteCheckpointSaver,
  SqliteChildExecutionQueueRepository,
  SqliteCostLedgerRepository,
  SqliteExecutionHistoryRepository,
  SqliteExecutionLeaseRepository,
  SqliteExecutionRecordRepository,
  SqliteExecutionTreeRepository,
  SqliteMeshRequestRepository,
  SqlitePausedExecutionRepository,
  SqliteRateLimitRepository,
  env,
} from "@agboss/core";

export class StoreEnvironment {
  sqlitePath!: string;
}

export const environment: StoreEnvironment = {
  sqlitePath: env("AGBOSS_SQLITE_PATH", {
    default: ".agboss/job-scout.sqlite",
  }),
};

export const durableStores = [
  SqliteExecutionRecordRepository,
  SqliteExecutionHistoryRepository,
  SqliteCostLedgerRepository,
  SqlitePausedExecutionRepository,
  SqliteCheckpointSaver,
  SqliteExecutionLeaseRepository,
  SqliteExecutionTreeRepository,
  SqliteChildExecutionQueueRepository,
  SqliteRateLimitRepository,
  SqliteMeshRequestRepository,
];
```

<!-- snippet-context
import { Budget, BudgetPeriod, BudgetScope, Workflow, WorkflowFinish, WorkflowStart, start, type BudgetHandler } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
import { usd, type Usd } from "@agboss/core/units";
import { StoreEnvironment } from "./environments/prod.environment.js";

export { WorkflowStartTextDto };
@WorkflowStart({ name: "support-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class SupportStart {}
@WorkflowFinish({ name: "support-workflow-finish", description: "Finish", output: WorkflowStartTextDto })
export class SupportFinish {}
@Workflow({
  name: "support-workflow",
  version: "1.0.0",
  flow: [
    start(SupportStart)
      .returns(WorkflowStartTextDto)
      .toFinish(SupportFinish),
  ],
})
export class SupportWorkflow {}
@Budget({ name: "support-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class SupportAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(50); } }
@Budget({ name: "support-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class SupportTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(10); } }
@Budget({ name: "support-exec-budget", scope: BudgetScope.Execution })
export class SupportExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }
// @snippet
-->
```ts title="src/support.application.ts" file=src/support.application.ts
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
import { seconds } from "@agboss/core/units";

@Application({
  name: "support-application",
  version: "1.0.0",
  environment: StoreEnvironment,
  workflows: [SupportWorkflow],
  budgets: [SupportAppBudget, SupportTenantBudget, SupportExecBudget],
  providers: [
    SqliteExecutionRecordRepository,
    SqliteCostLedgerRepository,
    SqlitePausedExecutionRepository,
    SqliteCheckpointSaver,
    SqliteExecutionLeaseRepository,
    SqliteExecutionTreeRepository,
    SqliteRateLimitRepository,
  ],
  maxConcurrentSteps: 32,
  compensationTimeout: seconds(15),
  shutdownTimeout: seconds(25),
})
export class SupportApplication {}
```

```ts title="src/stores/table-lease.repository.ts" file=src/stores/table-lease.repository.ts
import {
  ExecutionLeaseRepository,
  Injectable,
  type ExecutionLease,
} from "@agboss/core";
import type { Milliseconds } from "@agboss/core/units";

@Injectable()
export class LeaseTableService {
  insertIfFree(
    _tenantId: string,
    _rootExecutionId: string,
    _lease: number,
  ): Promise<ExecutionLease | undefined> {
    return Promise.resolve(undefined);
  }
  extendIfHeld(
    _executionLease: ExecutionLease,
    _lease: number,
  ): Promise<boolean> {
    return Promise.resolve(false);
  }
  deleteIfHeld(_executionLease: ExecutionLease): Promise<void> {
    return Promise.resolve();
  }
  selectOne(): Promise<void> {
    return Promise.resolve();
  }
}

@Injectable({ deps: [LeaseTableService] })
export class TableExecutionLeaseRepository extends ExecutionLeaseRepository {
  constructor(private readonly leaseTableService: LeaseTableService) {
    super();
  }

  override acquire(
    tenantId: string,
    rootExecutionId: string,
    lease: Milliseconds,
  ): Promise<ExecutionLease | undefined> {
    return this.leaseTableService.insertIfFree(
      tenantId,
      rootExecutionId,
      lease,
    );
  }

  override renew(
    executionLease: ExecutionLease,
    lease: Milliseconds,
  ): Promise<boolean> {
    return this.leaseTableService.extendIfHeld(executionLease, lease);
  }

  override release(executionLease: ExecutionLease): Promise<void> {
    return this.leaseTableService.deleteIfHeld(executionLease);
  }

  override ping(): Promise<void> {
    return this.leaseTableService.selectOne();
  }
}
```

```ts title="test/multi-instance.test.ts" file=test/multi-instance.test.ts
import { Application, EmptyEnvironment } from "@agboss/core";
import { expect } from "vitest";
import { testWith } from "@agboss/core/testing";
import { seconds } from "@agboss/core/units";
import { SupportFinish, SupportStart, SupportWorkflow } from "../src/support.application.js";

@Application({
  name: "cluster-test-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [SupportWorkflow],
})
export class ClusterTestApplication {}

const test = testWith(ClusterTestApplication, { instances: 2 });

test("runs two application instances over shared stores and a shared virtual clock", async ({
  apps,
  clock,
}) => {
  const [instanceA, instanceB] = apps;
  if (!instanceA || !instanceB) throw new Error("Expected 2 instances");
  const first = await instanceA.execute(
    SupportStart,
    { text: "Turn 1 on instance A" },
    { threadId: "shared-thread-1" },
  );
  expect(first.finish).toBe(SupportFinish);

  await clock.advance(seconds(31));

  const second = await instanceB.execute(
    SupportStart,
    { text: "Turn 2 on instance B" },
    { threadId: "shared-thread-1" },
  );
  expect(second.output).toEqual({ text: "Turn 2 on instance B" });
});
```

---

## 4-stage progressive infrastructure scaling

Because `@Agent`, `@Router`, `@Arbiter`, `@Action`, and `@Tool` classes never import storage drivers directly, your application scales across four infrastructure stages purely by updating `@Application({ providers })`:

| Stage | `@Application({ providers })` Configuration | Use Case |
| :--- | :--- | :--- |
| **Stage 1: In-Memory (Default)** | `providers: []` (built-in `InMemory*` stores) | Local prototyping (`npm run chat`), unit tests (`testWith`), and deterministic CI suites |
| **Stage 2: Single-Node Durable** | Built-in `Sqlite*` WAL repositories (`sqlitePath`) | Single-VM / single-container production with durable checkpoints, pauses, and spend ledgers |
| **Stage 3: Multi-Instance on One Machine** | Shared `Sqlite*` WAL file + `SqliteExecutionLeaseRepository` | Multiple worker processes on one host sharing WAL storage, 30s leases, and recovery sweeps |
| **Stage 4: Multi-Machine Cluster Stores** | Custom `@Injectable()` classes extending `ExecutionRecordRepository`, `ExecutionLeaseRepository`, etc. | Distributed Postgres / Redis / DynamoDB backends across Kubernetes nodes |

---

## What the 10 shared stores coordinate across instances

Every store is an infrastructure contract with a built-in in-memory default (`InMemory*`) and a built-in zero-dependency `node:sqlite` WAL implementation (`Sqlite*`):

| Base Repository Contract | Built-in SQLite Implementation | What It Coordinates Across Instances |
| :--- | :--- | :--- |
| `BaseCheckpointSaver` | `SqliteCheckpointSaver` | Saves LangGraph state checkpoints so a pause or crash on Instance A resumes on Instance B |
| `PausedExecutionRepository` | `SqlitePausedExecutionRepository` | Transitions pauses `Pending → Resolved` atomically (CAS) once, whichever instance handles `app.resume()` |
| `ExecutionRecordRepository` | `SqliteExecutionRecordRepository` | Persists tenant-isolated threads, owners, `Tern` records, and atomic CAS status transitions |
| `ExecutionHistoryRepository` | `SqliteExecutionHistoryRepository` | Persists completed `ExecutionRecord` snapshots (`steps[].decision`, `inputHash`, `toolCalls`, `origin`, retained for `executionRecordRetention`) for `agboss records export`, `agboss generate eval-case --from-execution`, and `agboss hub` |
| `CostLedgerRepository` | `SqliteCostLedgerRepository` | Aggregates token and tool spend across all instances for `Execution`, `Tenant`, and `Application` `@Budget` scopes |
| `ExecutionLeaseRepository` | `SqliteExecutionLeaseRepository` | Guarantees a single active holder (`seconds(30)` lease) per `(tenantId, rootExecutionId)` tree and per remote child (`ChildPlacement.AnyInstance`) |
| `ExecutionTreeRepository` | `SqliteExecutionTreeRepository` | Shares request-scoped keys (`saveIfAbsent`), `@agboss/cancel-request`, and `@agboss/unwinding` across the execution tree |
| `ChildExecutionQueueRepository` | `SqliteChildExecutionQueueRepository` | Distributes `ChildPlacement.AnyInstance` child workflow tasks (`Queued → Running → Finished`) across worker instances with work-stealing and per-child crash recovery |
| `RateLimitRepository` | `SqliteRateLimitRepository` | Shares `@ModelProvider` concurrency slots (`<provider>:slots`), shared tree concurrency slots (`SharedTreeSlots`), per-minute call/token windows, 429 cooldowns, and open circuit breakers |
| `MeshRequestRepository` | `SqliteMeshRequestRepository` | Deduplicates incoming signed Agent Mesh (`@A2AExpose` / `@McpExpose`) requests by `origin.step.idempotencyKey` |

:::note[Multi-instance testing with `InMemory*` vs SQLite `:memory:` (`#458`)]
`testWith(App, { instances: 2 })` shares the built-in `InMemory*` stores across all instances in the test automatically. However, if your application lists `Sqlite*` stores and sets `sqlitePath: ":memory:"`, SQLite creates a **separate** in-memory database per connection (`SqliteConnection`), so two instances will not see each other's rows. To test multiple instances against a shared SQLite database, point `sqlitePath` in a test environment (e.g., `testWith(App, { instances: 2, env: "instances" })`) at a temporary file path created with `fs.mkdtempSync`.
:::

---

## How 30-second execution leases & local fencing work

One lease exists per execution tree, keyed by `(tenantId, rootExecutionId)`, held by `ApplicationContext.instanceId`:

1. **Background renewal & pre-checkpoint renewal:** The active holder renews its `seconds(30)` lease every 10 seconds on the application's `Clock` and immediately before every checkpoint write. Paused or finished trees hold no lease.
2. **Immediate mid-tool-loop fencing (`ExecutionLeaseLostError`):** If a renewal returns `false` (the instance froze for >30s and another instance took the lease with `leaseEpoch + 1`), or if the lease store fails to confirm a renewal before `confirmedUntil` (local self-fencing), the holder immediately aborts `ExecutionContext.signal` with `ExecutionLeaseLostError` (`execution.lease-lost`). An `@Agent` tool loop starts no further model or tool calls, and the error bypasses `.onError` and `onExecutionError` because the new lease holder now owns the execution.
3. **Concurrent `app.resume()` calls:** `app.resume` runs in two phases: first it transitions the pause `Pending → Resolved` atomically (a duplicate click gets `NotPausedError`), then it acquires or waits for the tree's lease. When two parallel branch pauses are answered simultaneously on two different instances, both decisions are recorded and drained in a single pass so each branch runs once.

---

## Crash recovery, cross-instance `app.cancel`, and mid-undo recovery

- **Automatic recovery sweep (every 30 s):** At startup and every 30 seconds, each instance scans `ExecutionRecordStatus.Running` records (`findByStatus`), claims any tree whose holder died or released its lease on shutdown, and resumes from the **last committed checkpoint** (`onExecutionResume` with `ResumeReason.Recovered`). Because every finished step is checkpointed before the next starts, only the interrupted step runs again, and external side effects deduplicate via `executionContext.step.idempotencyKey`. The sweep also purges `Taken` / `Cancelled` pause records older than `@Application({ pauseRecordRetention })` (default `hours(24)`).
- **Cross-instance `app.cancel(threadId)`:** Behind a load balancer, `app.cancel` can land on any instance. If the target thread is running on another instance, `app.cancel` writes the reserved key `@agboss/cancel-request` into the shared `ExecutionTreeRepository`. The holding instance checks this key on every lease renewal (every 10s and before each checkpoint write) and aborts the run with `ExecutionCancelledError`.
- **Durable LIFO saga unwinding (`@agboss/unwinding`):** Before automatic LIFO rollback of [`@Action({ compensateWith })`](/guides/error-handling-and-rollback/) starts, the holder writes `@agboss/unwinding` and marks each completed compensator under `@agboss/compensated/<key>`. If the instance crashes or times out mid-rollback, the next instance taking the lease reads `@agboss/unwinding`, skips already-compensated steps, and finishes the remaining compensators in LIFO order.

---

## Instance step caps (`maxConcurrentSteps`) & distributed child work-stealing (`ChildPlacement.AnyInstance`)

- **Local pod ceiling (`@Application({ maxConcurrentSteps: 32 })`):** Caps how many `@Agent`, `@Router`, and `@Action` steps run concurrently inside one process across all tenants and trees. When all slots are busy, additional steps wait in a deadlock-free priority queue:
  1. **Priority 1:** Steps that close a branch (right after a child workflow or `.join()` / `.joinQuorum()`).
  2. **Priority 2:** Deeper in-flight executions (`depth`, with +1 depth aging per 10s waited on the `Clock`).
  3. **Priority 3:** Newly arriving root `app.execute` calls.
- **Load-balancer readiness shedding (`step-slots`):** While all `maxConcurrentSteps` slots are busy, `await app.checkReadiness()` reports component `step-slots` as `HealthStatus.Degraded` so Kubernetes / load balancers route new requests to idle pods, and the recovery sweep claims at most as many orphans as the instance has free slots.
- **Distributed child workflow queue (`ChildPlacement.AnyInstance` & `ChildExecutionQueueRepository`, `#333`):** By default, `.toWorkflow(Child)` and `.toParallelWorkflows(Child, ...)` run on the parent's instance (`ChildPlacement.ParentInstance`). Passing `{ placement: ChildPlacement.AnyInstance }` (on `.toWorkflow`, `.toParallelWorkflows`, or `route(Child, { placement: ChildPlacement.AnyInstance })`) dispatches child workflow executions through `ChildExecutionQueueRepository` (`SqliteChildExecutionQueueRepository`) so any instance with free `maxConcurrentSteps` slots can claim and run them:
  - **Shared tree concurrency slots (`RateLimitRepository`):** The root workflow's `maxConcurrentExecutions` cap (`SharedTreeSlots`) is enforced across all worker instances via `RateLimitRepository`.
  - **Parent lease yielding while waiting:** While the parent workflow waits for remote `AnyInstance` children to finish, it **releases its own tree lease** (`ExecutionLeaseRepository`) and local step slot so the parent pod is never blocked. Whichever instance finishes the last child wakes the parent from its checkpoint.
  - **Per-child 30s lease & per-child crash recovery:** Each `AnyInstance` child holds its own 30-second lease (`ExecutionLeaseRepository`) renewed every 10s. If the worker running Child #3 crashes mid-wave, another instance reclaims **only Child #3** (`Running` row with expired child lease) from its last checkpoint while sibling children continue uninterrupted. (If `ChildPlacement.AnyInstance` is used without a shared `ChildExecutionQueueRepository` in `@Application({ providers })`, `agboss check` warns with `[application.in-memory-child-queue]`.)
- **Shared `@ModelProvider` rate limits (`RateLimitRepository`):** Across all instances, `RateLimitRepository` enforces a provider's `maxConcurrentCalls` slots (`acquire` / `renew` / `release`), per-minute call and token windows (`addToWindow`), and 429 `Retry-After` pauses / open circuit breakers (`pauseUntil` / `pausedUntil`).

---

## Extending SQLite stores or writing custom Postgres/Redis stores

You can either subclass a built-in `Sqlite*` store (injecting `SqliteConnection`, `Clock`, `ApplicationContext`, `IdGenerator`) to add custom audit logging, or subclass any of the 7 base repository contracts (`extends ExecutionLeaseRepository`, `extends PausedExecutionRepository`, `extends RateLimitRepository`, etc.) to back AGBoss with Postgres, Redis, or DynamoDB. Every store contract includes `ping(): Promise<void>`, which `await app.checkReadiness()` calls under a 2-second timeout to verify database connectivity.

---

## Standalone Executable Proofs

- **[Showcase: Distributed Agent Recovery (`agbossjs/distributed-agent-recovery`)](/examples/distributed-agent-recovery/):** Multi-process OS worker cluster and Docker Compose showcase ([GitHub](https://github.com/agbossjs/distributed-agent-recovery)) demonstrating `ChildPlacement.AnyInstance` cross-process load balancing, POSIX `SIGSTOP`/`SIGCONT` worker freeze past the 30s lease TTL, same-task checkpoint takeover (`execution.recovered`, `leaseEpoch 1 → 2`), two-layer zombie worker lease fencing, LIFO saga rollback, and live AI recovery planning across 8 automated invariants.
- **[`05-cluster-work-stealing`](https://github.com/agbossjs/agboss-examples/tree/main/05-cluster-work-stealing):** Multi-instance cluster harness in [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples) proving `ChildPlacement.AnyInstance` over `SqliteChildExecutionQueueRepository`, bounded recursive `ThisWorkflow` (`maxDepth: 2`), 30s SQLite leases & fencing (`ExecutionLeaseLostError`), `maxConcurrentSteps: 2` backpressure (`HealthComponentKind.StepSlots`), `@HealthCheck` liveness/readiness probes, and cross-instance pause/resume/cancel (see [7 Verified Examples](/examples/job-scout/)).
