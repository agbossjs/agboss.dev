---
title: Persistence, Leases & Multi-Instance Recovery
description: Run AGBoss across multiple processes using SQLite WAL repositories, 30-second execution leases, compare-and-swap completion, and crash recovery sweeps.
---

Stateful multi-agent workflows can run across parallel branches, spawn child workflows, or pause awaiting human approval. AGBoss coordinates multi-instance execution through seven storage repository contracts, each shipped with a ready-to-use [SQLite WAL](https://www.sqlite.org/wal.html) implementation enabled simply by listing it in `@Application({ providers })`.

## What are the 7 storage repositories in AGBoss?

| Base Repository Contract | Built-in SQLite Implementation | Responsibility |
| :--- | :--- | :--- |
| `ExecutionRecordRepository` | `SqliteExecutionRecordRepository` | Persists execution status (`Running`, `Completed`, `Failed`), output, and atomic CAS transitions |
| `CostLedgerRepository` | `SqliteCostLedgerRepository` | Tracks cumulative spend across execution, tenant, and application `@Budget` scopes |
| `PausedExecutionRepository` | `SqlitePausedExecutionRepository` | Stores `Pending`, `Resolved`, `Taken`, and `Cancelled` human-in-the-loop pauses |
| `BaseCheckpointSaver` | `SqliteCheckpointSaver` | Saves LangGraph checkpoints after every node transition |
| `ExecutionLeaseRepository` | `SqliteExecutionLeaseRepository` | Coordinates 30-second execution tree ownership leases across processes |
| `ExecutionTreeRepository` | `SqliteExecutionTreeRepository` | Tracks parent and child workflow execution trees |
| `RateLimitRepository` | `SqliteRateLimitRepository` | Shares `@ModelProvider` rate-limit slots, `Retry-After` pauses, and circuit-breaker state |

All listed SQLite repositories share a single SQLite file per machine (configured via `sqlitePath` on your `@Application` environment contract, running in WAL mode with `BEGIN IMMEDIATE` transactions and `sqlitePath: ":memory:"` in tests):

```ts title="src/environments/prod.environment.ts"
import { SqliteCheckpointSaver, SqliteCostLedgerRepository, SqliteExecutionLeaseRepository, SqliteExecutionRecordRepository, SqliteExecutionTreeRepository, SqlitePausedExecutionRepository, SqliteRateLimitRepository, env } from "agboss";

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
  SqliteCostLedgerRepository,
  SqlitePausedExecutionRepository,
  SqliteCheckpointSaver,
  SqliteExecutionLeaseRepository,
  SqliteExecutionTreeRepository,
  SqliteRateLimitRepository,
];
```

```ts title="src/support.application.ts" no-check: context tab
import { Application, SqliteCheckpointSaver, SqliteCostLedgerRepository, SqliteExecutionLeaseRepository, SqliteExecutionRecordRepository, SqliteExecutionTreeRepository, SqlitePausedExecutionRepository, SqliteRateLimitRepository } from "agboss";
import { seconds } from "agboss/units";

@Application({
  name: "support-application",
  version: "1.0.0",
  workflows: [SupportWorkflow],
  providers: [
    SqliteExecutionRecordRepository,
    SqliteCostLedgerRepository,
    SqlitePausedExecutionRepository,
    SqliteCheckpointSaver,
    SqliteExecutionLeaseRepository,
    SqliteExecutionTreeRepository,
    SqliteRateLimitRepository,
  ],
  maxInstanceConcurrency: 32,
  compensationTimeout: seconds(15),
  shutdownTimeout: seconds(25),
})
export class SupportApplication {}
```

## How execution leases, recovery sweeps, and rolling deploys work

1. **One holder per execution tree (`seconds(30)` lease):** `app.execute` and `app.resume` acquire the execution tree's lease (`seconds(30)`, renewed every 10 seconds on the application's `Clock` and before every checkpoint write).
2. **Immediate mid-tool-loop fencing (`ExecutionLeaseLostError`):** If an instance freezes past its lease expiry — even in the middle of an `@Agent`'s `maxToolCalls` iteration loop — the internal lease watchdog immediately aborts `ExecutionContext.signal` and throws `ExecutionLeaseLostError` (`execution.lease-lost`) before the next tool or model call executes. Every tool call iteration also carries a deterministic `step.idempotencyKey` (`${executionId}:${nodeId}:${visitNumber}:${copyNumber}:tool:${iteration}`) so external APIs can deduplicate side effects.
3. **Automatic recovery sweep (every 30 s):** At startup and every 30 seconds, each instance scans for `running` root and child executions whose holder died or stopped, acquires their lease, and resumes them from their last committed checkpoint (`onExecutionResume` with `ResumeReason.Recovered`).
4. **Zero-downtime rolling deploys (`app.close({ timeout })`):** On `SIGTERM` / `SIGINT` or `await app.close({ timeout: seconds(10) })`, the instance stops accepting new runs (`ApplicationStoppingError`), waits up to `timeout` (default `seconds(25)`) for active passes to finish, and then interrupts any still-running execution — releasing its lease immediately while keeping its record `running` so another instance continues it without waiting for the 30-second TTL to expire.

## How multi-instance work-stealing and `maxInstanceConcurrency` protect pods from overload

When a workflow fans out into dozens of parallel branches or child workflows (`.toParallelWorkflows`, `.toWorkflow`), AGBoss prevents individual Node.js pods from running out of memory and distributes child workflows across the cluster:

- **Local pod ceiling (`maxInstanceConcurrency`):** Configured on `@Application({ maxInstanceConcurrency: 32 })` (`<= 0` or non-integer fails assembly with `[application.invalid-instance-concurrency]`). When all 32 slots on a pod are occupied, additional steps enter an in-memory priority queue with three deadlock-safe levels: **Priority 1** for finishing parents (`.join()`, `.joinQuorum()`, `.onError()`, `.onJoinError()`, `@WorkflowFinish`), **Priority 2** for deeper in-flight steps (`depth`, then `visitNumber`) with wait-time aging, and **Priority 3** for newly arriving `app.execute` / `app.resume` calls and unstarted parallel branch items. While saturated, `await app.checkReadiness()` returns `HealthStatus.Degraded` (with `{ activeSlots, maxSlots, queuedCount }`) so Kubernetes / load balancers route new traffic to idle pods, and the recovery sweep only claims orphaned executions up to the number of free local slots.
- **Distributed child workflow work-stealing & parent yield:** When `ExecutionLeaseRepository` and `ExecutionRecordRepository` are shared across pods, `.toParallelWorkflows` and `.toWorkflow` persist each child workflow as `Pending` in storage, and the parent checkpoints its fan-out state and yields its lease while waiting. Idle cluster instances claim pending child workflows via `ExecutionLeaseRepository`, execute them with shared `@Budget` accounting, and wake the parent (`ResumeReason.ChildrenCompleted`) once all children finish or `FailurePolicy.FailFast` triggers.
- **Multi-turn `threadId` slot isolation & versioned child workflow upgrades:** Each root `app.execute` pass snapshots and writes its own workflow state keyed by `(threadId, executionId)` while carrying only conversation messages across turns on the same `threadId` — preventing stale slot values or `outdated` cascades from bleeding between turns. During rolling upgrades, registering multiple versions of a child workflow (`[ChildWorkflowV1, ChildWorkflowV2]`) allows long-sleeping pauses (`PendingPause`) to resume on the exact workflow version matching their saved `configHash`, while oversized `@Tool` / `@Rag` outputs are bounded before compaction so checkpoints stay compact.
- **Cross-pod `piiTokens` preservation:** Even if no `pseudonymKey` is configured, AGBoss generates and persists a random 32-byte fallback key per `rootExecutionId` in the root execution record so `piiTokens` maps (`[EMAIL_1]`, `[PHONE_1]`) unmask identically when a child workflow or resumed pause runs on a different pod.
- **Instant sibling abort on `@Budget` breach:** If any parallel branch or child workflow breaches an `Execution`, `Tenant`, or `Application` `@Budget`, the runtime immediately aborts `ExecutionContext.signal` across all sibling branches with `BudgetExceededError` (`execution.budget-exceeded`) and triggers LIFO saga compensation (`compensateWith`) without burning extra LLM tokens.
