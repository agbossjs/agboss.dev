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
  shutdownTimeout: seconds(25),
})
export class SupportApplication {}
```

## How execution leases, recovery sweeps, and rolling deploys work

1. **One holder per execution tree (`seconds(30)` lease):** `app.execute` and `app.resume` acquire the execution tree's lease (`seconds(30)`, renewed every 10 seconds on the application's `Clock` and before every checkpoint write).
2. **Fencing stale instances (`ExecutionLeaseLostError`):** If an instance freezes past its lease expiry, it aborts immediately with `ExecutionLeaseLostError` (`execution.lease-lost`) without emitting `onExecutionError` or writing a failed record — the new lease holder continues cleanly.
3. **Automatic recovery sweep (every 30 s):** At startup and every 30 seconds, each instance scans for `running` root executions whose holder died or stopped, acquires their lease, and resumes them from their last committed checkpoint (`onExecutionResume` with `ResumeReason.Recovered`).
4. **Zero-downtime rolling deploys (`app.close({ timeout })`):** On `SIGTERM` / `SIGINT` or `await app.close({ timeout: seconds(10) })`, the instance stops accepting new runs (`ApplicationStoppingError`), waits up to `timeout` (default `seconds(25)`) for active passes to finish, and then interrupts any still-running execution — releasing its lease immediately while keeping its record `running` so another instance continues it without waiting for the 30-second TTL to expire.
