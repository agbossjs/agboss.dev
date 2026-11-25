---
title: Multi-Instance Distribution, Leases, Storage & Custom Drivers
description: "Scale AGBoss from in-memory unit tests to SQLite WAL, Postgres, MongoDB and Redis and Kubernetes pods using @DatabaseStorage, 30s execution leases, fencing, and @HealthCheck probes."
---
An AGBoss `@Application` can run as **multiple instances (processes, containers, or Kubernetes pods)** over shared storage: any instance can resume a pause created on another instance, recover an execution whose worker process died mid-step, or cancel a running thread across the cluster — while 30-second execution-tree leases guarantee that two instances never advance the same execution tree simultaneously.

---

## Multi-instance application & failover test

Below is a complete multi-instance application whose rows go to a `@DatabaseStorage` on SQLite WAL, and a multi-instance `testWith(App, { instances: 2 })` test suite. The stores come from the storage's **driver** — a store class listed in `providers` beside `storage` is `[storage.providers-conflict]`, and the 0.1.0 way of listing `Sqlite*Repository` classes is gone:

```ts title="src/support.database-storage.ts" file=src/support.database-storage.ts
import { DatabaseStorage, SqliteDriver, defineEnv, env, secret } from "@agboss/core";
import { hours } from "@agboss/core/units";

const databaseEnv = defineEnv({
  path: env("AGBOSS_SQLITE_PATH", { default: ".agboss/job-scout.sqlite" }), // a persistent volume
  idempotencySecret: secret("AGBOSS_IDEMPOTENCY_SECRET"),
});

@DatabaseStorage({
  name: "support-database-storage",
  driver: SqliteDriver({ path: databaseEnv.path }), // one file: shared by the processes on one machine
  auditLogTtl: hours(24 * 30),
  ledgerEntriesTtl: hours(24),
  idempotencySecret: databaseEnv.idempotencySecret,
})
export class SupportDatabaseStorage {}
```

```ts title="src/support.application.ts" file=src/support.application.ts
import { Application, Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, Workflow, WorkflowFinish, WorkflowStart, onStart, Ttl, type BudgetHandler } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
import { seconds, usd, type Usd } from "@agboss/core/units";
import { SupportDatabaseStorage } from "./support.database-storage.js";

@WorkflowStart({ name: "support-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class SupportStart {}
@WorkflowFinish({ name: "support-workflow-finish", description: "Finish", output: WorkflowStartTextDto })
export class SupportFinish {}
@Workflow({
  name: "support-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [
    onStart(SupportStart)
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

@Application({
  name: "support-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [SupportWorkflow],
  storage: SupportDatabaseStorage, // checkpoints, records, pauses, ledger, leases, trees, child queue, rate limits
  budgets: [SupportAppBudget, SupportTenantBudget, SupportExecBudget],
  executionLimits: {
    maxConcurrentSteps: 32,
    compensationTimeout: seconds(15),
    shutdownTimeout: seconds(25),
  },
})
export class SupportApplication {}
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

Because `@Agent`, `@Router`, `@Arbiter`, `@Action`, and `@Tool` classes never import storage drivers directly, your application scales across four infrastructure stages purely by changing `@Application({ storage })`:

| Stage | `@Application({ storage })` Configuration | Use Case |
| :--- | :--- | :--- |
| **Stage 1: In-Memory (Default)** | unset (the built-in `InMemoryDatabaseStorage`) | Local prototyping (`agboss chat`), unit tests (`testWith`), and deterministic CI suites |
| **Stage 2: Single-Node Durable** | `@DatabaseStorage({ driver: SqliteDriver({ path }) })` | Single-VM / single-container production with durable checkpoints, pauses, and spend ledgers |
| **Stage 3: Multi-Instance on One Machine** | The same SQLite file shared by several processes | Multiple worker processes on one host sharing WAL storage, 30s leases, and recovery sweeps |
| **Stage 4: Multi-Machine Cluster** | `PostgresDriver` or `MongoDriver` (`@agboss/postgres`, `@agboss/mongodb`), `RedisDriver` as a `@ClusterStorage`, `S3Driver` as an `@ObjectStorage` | Distributed backends across Kubernetes nodes; a schema change is `npx agboss migrate db` after the old pods are stopped |

---

## What the shared stores coordinate across instances

Every store is an infrastructure contract with a built-in in-memory default and a built-in zero-dependency `node:sqlite` WAL implementation, both supplied by the storage's driver (`SqliteConnection` moved to `@agboss/core/stores`; the SQLite schema is one 0.1.1 baseline created when the connection opens):

| Base Repository Contract | What It Coordinates Across Instances |
| :--- | :--- |
| `BaseCheckpointSaver` | Saves LangGraph state checkpoints so a pause or crash on Instance A resumes on Instance B; an ended tree's checkpoints are deleted with it |
| `PausedExecutionRepository` | Transitions pauses `Pending → Resolved` atomically (CAS) once, whichever instance handles `app.resume()`; keeps each pause's deadline, reminder and notices |
| `ExecutionRecordRepository` | Persists tenant-isolated threads, owners, execution records, and atomic CAS status transitions |
| `ExecutionHistoryRepository` | Persists each root execution's history (`steps[].decision`, `inputHash`, `toolCalls`, `origin`, kept for `retention.executionRecords`) for `agboss executions export`, `agboss generate eval-case --from-execution`, and `agboss hub` |
| `CostLedgerRepository` | Aggregates token and tool spend across all instances for `Execution`, `Tenant`, and `Application` `@Budget` scopes (dollars and tokens) |
| `ExecutionLeaseRepository` | Guarantees a single active holder (`seconds(30)` lease) per `(tenantId, rootExecutionId)` tree and per remote child; carries the tree's cancel, stop and external-pause marks |
| `ExecutionTreeRepository` | Shares request-scoped keys across the execution tree and the undo's durable marks |
| `ChildExecutionQueueRepository` | Distributes `ChildPlacement.AnyWorker` child workflow tasks (`Queued → Running → Finished`) across worker instances with work-stealing and per-child crash recovery |
| `RateLimitRepository` | Shares `@ModelProvider` concurrency slots, shared tree concurrency slots, per-minute call/token windows, 429 cooldowns, and open circuit breakers |
| `MeshRequestRepository` | Admits each signed mesh request's `jti` once and deduplicates incoming mesh requests |
| `ExecutionAuditLogRepository`, fenced-effect and outbound-call stores | The audit log of lease takeovers, and the rows of `Idempotency.runOnce` / `sendOnce` (each expires by its call's `ttl`) |

:::note[Multi-instance testing with the in-memory database vs SQLite `:memory:`]
`testWith(App, { instances: 2 })` shares the built-in in-memory stores across all instances in the test automatically. However, `SqliteDriver.inMemory()` creates a **separate** in-memory database per connection, so two instances will not see each other's rows. To test multiple instances against a shared SQLite database, point the driver's `path` in a test environment at a temporary file created with `fs.mkdtempSync`.
:::

---

## How 30-second execution leases & local fencing work

One lease exists per execution tree, keyed by `(tenantId, rootExecutionId)`, held by `ApplicationContext.instanceId`:

1. **Background renewal & pre-checkpoint renewal:** The active holder renews its `seconds(30)` lease every 10 seconds on the application's `Clock` and immediately before every checkpoint write. Paused or finished trees hold no lease. Under a `@ClusterStorage` the database's lease row is the authority for the token, the stop mark, the external pause and its fence, written before the cluster acknowledges.
2. **Immediate mid-tool-loop fencing (`ExecutionLeaseLostError`):** If a renewal returns `false` (the instance froze for >30s and another instance took the lease with `leaseEpoch + 1`), or if the lease store fails to confirm a renewal before `confirmedUntil` (local self-fencing), the holder immediately aborts `ExecutionContext.signal` with `ExecutionLeaseLostError` (`execution.lease-lost`). An `@Agent` tool loop starts no further model or tool calls, and the error bypasses `.onError` and `onExecutionError` because the new lease holder now owns the execution.
3. **Concurrent `app.resume()` calls:** `app.resume` runs in two phases: first it transitions the pause `Pending → Resolved` atomically (a duplicate click gets `PauseClosedError`), then it acquires or waits for the tree's lease. When two parallel branch pauses are answered simultaneously on two different instances, both decisions are recorded and drained in a single pass so each branch runs once.

---

## Crash recovery, cross-instance `app.cancel`, and mid-undo recovery

- **Automatic recovery sweep (every 30 s):** At startup and every 30 seconds, each instance scans `ExecutionRecordStatus.Running` records (`findByStatus`), claims any tree whose holder died or released its lease on shutdown, and resumes from the **last committed checkpoint** (`onExecutionResume` on an `@Observer`, with `ResumeReason.Recovered`). Because every finished step is checkpointed before the next starts, only the interrupted step runs again, and external side effects deduplicate via `executionContext.step.idempotencyKey`. The sweep also purges `Taken` / `Cancelled` pause records older than `@Application({ retention: { pauseRecords } })` (default `hours(24)`), the audit log's and the ledger's rows by `@DatabaseStorage({ auditLogTtl, ledgerEntriesTtl })`, but never the audit rows of a tree that is live or paused.
- **Cross-instance `app.cancel`, `app.stop` and `app.pause`:** Behind a load balancer these commands can land on any instance. A cancel is a **hard fence**: the request is written to the lease row first (`ExecutionLeaseRepository.requestCancel(tree)`), and once it is durable no fenced effect starts or commits and no outbound call is recorded for that tree, compensations excepted (`ExecutionCancelFencedError`); a finish never lands over a durable stop or cancel mark. `app.stop` marks a stop (`AfterStep` or `Immediate`), `app.pause` an external pause, and an `Immediate` one fences the row's token: a stale step of the old holder is refused (`ExecutionPauseFencedError`, `ExecutionStopFencedError`). The holding instance sees the mark on every lease renewal and ends the run as `Cancelled`, `Stopped` or `Paused` — outcomes, not thrown errors. `Cancel > Stop > Pause`.
- **Durable LIFO saga unwinding:** Before automatic LIFO rollback of [`@Action({ compensateWith })`](/guides/error-handling-and-rollback/) starts, the holder writes the undo's order and marks each completed compensator in the shared tree store. If the instance crashes or times out mid-rollback, the next instance taking the lease reads it, skips already-compensated steps, and finishes the remaining compensators in LIFO order. A child workflow's undoable actions bubble up to its parent: a child's finish moves them to the parent in the same write.

---

## Instance step caps (`executionLimits.maxConcurrentSteps`) & distributed child work-stealing (`ChildPlacement.AnyWorker`)

- **Local pod ceiling (`@Application({ executionLimits: { maxConcurrentSteps: 32 } })`):** Caps how many `@Agent`, `@Router`, and `@Action` steps run concurrently inside one process across all tenants and trees. When all slots are busy, additional steps wait in a deadlock-free priority queue:
  1. **Priority 1:** Steps that close a branch (right after a child workflow or `.join()` / `.joinQuorum()`).
  2. **Priority 2:** Deeper in-flight executions (`depth`, with +1 depth aging per 10s waited on the `Clock`).
  3. **Priority 3:** Newly arriving root `app.execute` calls.
- **Load-balancer readiness shedding (`isBusy`):** While all `maxConcurrentSteps` slots are busy, `await app.checkReadiness()` reports `isBusy` and not `isReady`, so Kubernetes / load balancers route new requests to idle pods, while `status` stays what the components say; the recovery sweep claims at most as many orphans as the instance has free slots.
- **Distributed child workflow queue (`ChildPlacement.AnyWorker` & `ChildExecutionQueueRepository`, `#333`):** By default, a child (`.toWorkflow(Child)`, `.forEachItem(toWorkflow(Child), …)`) runs on the parent's instance (`ChildPlacement.CurrentProcess`). `@Workflow({ placement: ChildPlacement.AnyWorker })` on the child (never on the flow; else `@Application({ defaults: { workflows: { placement } } })`) dispatches its executions through the child queue so any instance with free `maxConcurrentSteps` slots can claim and run them. `OtherWorker` is never claimed by the instance that queued it (`StepError.ChildWorkerUnavailable` after `executionLimits.childClaimTimeout`), and `IsolatedWorker` runs in a forked process of its own (`@Application({ isolatedWorker: { entry } })`):
  - **Shared tree concurrency slots (`RateLimitRepository`):** The root workflow's `executionLimits.maxConcurrency` cap (`SharedTreeSlots`) is enforced across all worker instances via `RateLimitRepository`.
  - **Parent lease yielding while waiting:** While the parent workflow waits for remote `AnyWorker` children to finish, it **releases its own tree lease** (`ExecutionLeaseRepository`) and local step slot so the parent pod is never blocked. Whichever instance finishes the last child wakes the parent from its checkpoint.
  - **Per-child 30s lease & per-child crash recovery:** Each `AnyWorker` child holds its own 30-second lease (`ExecutionLeaseRepository`) renewed every 10s. If the worker running Child #3 crashes mid-wave, another instance reclaims **only Child #3** (`Running` row with expired child lease) from its last checkpoint while sibling children continue uninterrupted. (If `ChildPlacement.AnyWorker` is used on the in-memory database, `agboss check` warns with `[application.in-memory-child-queue]`.)
- **Shared `@ModelProvider` rate limits (`RateLimitRepository`):** Across all instances, `RateLimitRepository` enforces a provider's `maxConcurrentCalls` slots (`acquire` / `renew` / `release`), per-minute call and token windows (`addToWindow`), and 429 `Retry-After` pauses / open circuit breakers (`pauseUntil` / `pausedUntil`).

---

## Writing a storage driver of your own

A store of your own is a **storage driver**: `defineStorageDriver({ role, backend, describes, settings, providers, … })` from `@agboss/core/stores` returns what `@DatabaseStorage({ driver })` takes, with the store classes — each `extends` its contract (`ExecutionLeaseRepository`, `PausedExecutionRepository`, `RateLimitRepository`, …) — in its `providers`, as `PostgresDriver`, `MongoDriver` and `RedisDriver` do; a driver with a `migrate` is what `npx agboss migrate db` runs. Each contract includes `ping(): Promise<void>`, which `await app.checkReadiness()` calls under a 2-second timeout. Every operation stays atomic, every time value comes from the framework (a lease or fenced store reads now from its `StoreClock`, the database's time when its `source` is `Database`), and the core's contract suites (`@agboss/core/testing/contracts`: `executionLeaseContract`, `checkpointSaverContract`, …) prove it — the very cases the in-memory and SQLite stores pass. A test replaces one store of an application with `testWith(App, { services: [MyLeaseRepository] })`. A store with a hostile or hanging database fails with `StoreCallTimeoutError`; one whose outcome is unknown with `StoreOutcomeUnknownError`.

---

## Standalone Executable Proofs

- **[Showcase: Distributed Agent Recovery (`agbossjs/distributed-agent-recovery`)](/examples/distributed-agent-recovery/):** Multi-process OS worker cluster and Docker Compose showcase ([GitHub](https://github.com/agbossjs/distributed-agent-recovery)) demonstrating `ChildPlacement.AnyWorker` cross-process load balancing, POSIX `SIGSTOP`/`SIGCONT` worker freeze past the 30s lease TTL, same-task checkpoint takeover (`execution.recovered`, `leaseEpoch 1 → 2`), two-layer zombie worker lease fencing, LIFO saga rollback, and live AI recovery planning across 8 automated invariants.
- **[`05-cluster-work-stealing`](https://github.com/agbossjs/agboss-examples/tree/main/05-cluster-work-stealing):** Multi-instance cluster harness in [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples) proving `ChildPlacement.AnyWorker` over the shared child queue, bounded recursive workflows (`maxDepth: 2`), 30s SQLite leases & fencing (`ExecutionLeaseLostError`), `maxConcurrentSteps: 2` backpressure (`isBusy`), `@HealthCheck` liveness/readiness probes, and cross-instance pause/resume/cancel (see [7 Verified Examples](/examples/verified-examples/)).
