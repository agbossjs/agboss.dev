---
title: "@DatabaseStorage"
description: "Reference for @DatabaseStorage, @ClusterStorage and @ObjectStorage in AGBoss — where an application's rows go, storage drivers, TTLs, keys, and agboss migrate db."
---

`@DatabaseStorage` (`"@agboss/core"`, `storages/*.database-storage.ts`) says **where an application's durable rows go**. `@Application({ storage })` takes a `@DatabaseStorage` class, or `{ database, cluster?, objects? }` with a `@ClusterStorage` and an `@ObjectStorage`. A storage component holds a **driver** (`SqliteDriver({ path })` is the core's; `PostgresDriver`, `MongoDriver` and `RedisDriver` come from the store packages `@agboss/postgres`, `@agboss/mongodb` and `@agboss/redis`; `S3Driver`, `LocalDiskDriver` and `InMemoryObjectDriver()` keep files), and the driver holds its connection settings as `env(…)` / `secret(…)` references read once when the application starts, so `@Application` carries no host or password.

With no `storage` the built-in in-memory database runs (`InMemoryDatabaseStorage`): nothing is shared between instances, nothing survives a restart, and the `[application.in-memory-…]` warnings say so (an error under `--strict`). The stores come from the drivers, so a store class listed in `providers` beside `storage` is `[storage.providers-conflict]`. The 0.1.0 way — `Sqlite*Repository` classes in `providers` — is gone.

## Complete example

```ts title="src/claims/storages/claims.database-storage.ts" file=src/claims/storages/claims.database-storage.ts
import { DatabaseStorage, SqliteDriver, defineEnv, env, secret } from "@agboss/core";
import { hours } from "@agboss/core/units";

const databaseEnv = defineEnv({
  path: env("AGBOSS_SQLITE_PATH", { default: "/data/claims.sqlite" }), // a persistent volume
  idempotencySecret: secret("AGBOSS_IDEMPOTENCY_SECRET"),
  piiSecret: secret("PII_PSEUDONYM_KEY"),
});

@DatabaseStorage({
  name: "claims-database-storage",
  driver: SqliteDriver({ path: databaseEnv.path }),
  auditLogTtl: hours(24 * 30),
  ledgerEntriesTtl: hours(24),
  idempotencySecret: databaseEnv.idempotencySecret, // a key of its own: business keys of Idempotency
  piiSecret: databaseEnv.piiSecret, // the key of the application's PII tokens, the same on every instance
})
export class ClaimsDatabaseStorage {}
```

```ts title="src/claims/claims.application.ts" file=src/claims/claims.application.ts
import { Application, Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, type BudgetHandler } from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";
import { ClaimsDatabaseStorage } from "./storages/claims.database-storage.js";

@Budget({ name: "claims-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class ClaimsAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(20); } }
@Budget({ name: "claims-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class ClaimsTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "claims-exec-budget", scope: BudgetScope.Execution })
export class ClaimsExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "claims-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [],
  storage: ClaimsDatabaseStorage, // every store durable and shared: no [application.in-memory-…] warning
  budgets: [ClaimsAppBudget, ClaimsTenantBudget, ClaimsExecBudget],
})
export class ClaimsApplication {}
```

## What does the database hold?

| What the database holds | Used by |
| :--- | :--- |
| checkpoints | every step's checkpoint: a pause, a crash and a resume continue from it |
| execution records | threads, owners, execution records, who answered each pause, summaries |
| pauses | each pause's record (`Pending → Resolved → Taken`, or `Cancelled`), its deadline and its notices |
| cost ledger | the budgets' counters (dollars and tokens); `ledgerEntriesTtl` keeps its entries |
| leases, execution trees | one lease per execution tree: who moves it; cancel, stop and pause marks, the undo's marks |
| rate limits | a provider's slots, per-minute windows, 429 pause and circuit breaker |
| execution history | each root execution's history, only with `retention.executionRecords` |
| audit log | every takeover of a lease and every step handed over; kept `auditLogTtl` |
| idempotency rows | `Idempotency.runOnce` / `sendOnce`; each expires by its call's `ttl` |

## What options do the storage decorators accept?

| Decorator | Option | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `@DatabaseStorage` | `driver` | `StorageDriver` | Yes | `SqliteDriver({ path })`, `SqliteDriver.inMemory()`, or a store package's driver. |
| `@DatabaseStorage` | `auditLogTtl` | `Milliseconds \| Ttl` | Yes | How long an audit-log row is kept: a duration, `Ttl.Forever` (never swept) or `Ttl.None` (swept at the next look). Replaces `retention.auditLog` (`[storage.retention-conflict]` when both are set). |
| `@DatabaseStorage` | `ledgerEntriesTtl` | `Milliseconds \| Ttl` | Yes | How long a ledger entry is kept, above the 30 s lease (`[storage.ttl-invalid]`). Replaces `retention.costLedgerEntries`. |
| `@DatabaseStorage` | `idempotencySecret`, `previousIdempotencySecret` | `SecretRef` | No | The key the `Idempotency` wire keys are an HMAC under; a key of its own (`[storage.secret-shared]`, `[storage.key-conflict]`). |
| `@DatabaseStorage` | `piiSecret`, `previousPiiSecret` | `SecretRef` | No | The application's PII key (replaces `piiKeyField`); a `tokenize()` rule or a `sensitive: PiiAction.tokenize()` field without one fails the start (`[pii.secret-required]`). `previousPiiSecret` is for rotation. |
| `@ClusterStorage` | `driver` | `StorageDriver` | Yes | The rows that coordinate instances — leases, the child queue, rate limits — in a store such as Redis. It needs a database whose driver keeps durable lease rows (`[storage.cluster-needs-durable-lease-store]`) and a database beside it (`[storage.database-required]`). Under it the database's lease row is the authority, written before the cluster acknowledges. |
| `@ObjectStorage` | `driver` | `ObjectDriver` | Yes | Where files live: `S3Driver`, `LocalDiskDriver`, `InMemoryObjectDriver()`. |

A class in `storage` without its decorator is `[storage.not-a-storage]`, a bad driver `[storage.driver-invalid]`.

## SQLite and the networked stores

The SQLite driver shares **one file** over one `node:sqlite` connection per instance, in WAL mode with a 5 s busy timeout; every atomic operation runs in one `BEGIN IMMEDIATE`, every time value comes from the application's `Clock`, and a waiting writer waits asynchronously. SQLite shares state between **processes on one machine** (one volume). Several machines need a networked database: `PostgresDriver` or `MongoDriver` for the rows, `RedisDriver` as the `@ClusterStorage`. The SQLite schema is one 0.1.1 baseline created when the connection opens (`SqliteConnection` moved to `@agboss/core/stores`).

A schema change of a networked store is `npx agboss migrate db [--application <path>] [--profile <list>] [--allow-live-leases]`: it runs the migration of the application's storage driver on its resolved settings. **Stop every instance of the old version first** — the upgrade is not a rolling one; live leases refuse it with `store.live-leases` unless `--allow-live-leases`, which only the command line can say. The `agboss-postgres` and `agboss-mongodb` bins of the store packages are gone. A store of your own is a storage driver built with `defineStorageDriver({ role, backend, describes, settings, providers, … })` from `@agboss/core/stores`; the core's contract suites (`@agboss/core/testing/contracts`) prove it.

## What related entities work with the storage components?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `InMemoryDatabaseStorage` | `"@agboss/core"` | The built-in in-memory database used when `storage` is unset. |
| `defineEnv`, `env`, `secret` | `"@agboss/core"` | The references a driver's settings are written with, read once at start. |
| `Ttl`, `hours()`, `days()` | `"@agboss/core"`, `"@agboss/core/units"` | The retention values. |
| `testWith(App, { services: [MyLeaseRepository] })` | `"@agboss/core/testing"` | Replaces one store of an application in a test. |
| `agboss describe` | CLI | Lists each storage component of the application. |
