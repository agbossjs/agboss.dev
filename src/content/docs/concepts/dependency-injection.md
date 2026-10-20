---
title: Dependency Injection & Lifecycle
description: How @Injectable constructor injection, class-inheritance overrides, OnInit/OnStart/OnStop/OnDestroy lifecycle hooks, ExecutionContext, Clock, and Logger work in AGBoss.
---

AGBoss includes a deterministic dependency injection container modeled on Angular and NestJS. Every component (`@Injectable`, `@Tool`, `@Action`, `@Router`, `@Arbiter`, `@Judge`, `@Guardrail`, `@PiiPolicy`, `@Channel`, `@Rag`, `@Budget`) declares its constructor dependencies in `deps: [...]`, and the container resolves them at application startup.

## How `@Injectable`, `Clock`, and `ExecutionContext` injection work

Instead of calling `Date.now()`, `process.env`, or global singletons, AGBoss components inject framework contracts through `deps`:

- **`Clock` (`deps: [Clock]`):** Every timestamp and sleep (`this.clock.now()`, `await this.clock.sleep(seconds(30))`) goes through the application's `Clock`. Under `testWith`, the container provides a `VirtualClock` that advances instantly with `await clock.advance(seconds(30))`.
- **`ApplicationContext` (`deps: [ApplicationContext]`):** Provides `this.applicationContext.environment` (typed by your `AppEnvironment` contract) and `environmentName`.
- **`ExecutionContext` (`deps: [ExecutionContext]`):** Provides read-only access to the current step's frame (`executionId`, `threadId`, `ownerId`, `tenant.tenantId`, `signal`, and `step.idempotencyKey`), safe across concurrent runs and parallel branches.

```ts title="src/services/audit-trail.service.ts"
import { Clock, Injectable, Tool, type OnDestroy, type OnInit, type OnStart, type OnStop, type ToolHandler } from "agboss";
import { Text } from "agboss/dto";
import { seconds } from "agboss/units";

export class JobQueryDto {
  @Text()
  query!: string;
}

@Injectable()
export class ConnectionPool implements OnInit, OnDestroy {
  onInit(): Promise<void> {
    return this.ping();
  }
  onDestroy(): Promise<void> {
    return this.end();
  }
  ping(): Promise<void> {
    return Promise.resolve();
  }
  drain(): Promise<void> {
    return Promise.resolve();
  }
  end(): Promise<void> {
    return Promise.resolve();
  }
}

@Injectable({ deps: [ConnectionPool, Clock] })
export class JobIndexService implements OnInit, OnStart, OnStop, OnDestroy {
  constructor(
    private readonly pool: ConnectionPool,
    private readonly clock: Clock,
  ) {}

  async onInit(): Promise<void> {
    await this.pool.ping();
  }

  onStart(): void {
    void this.clock.now();
  }

  async onStop(): Promise<void> {
    await this.clock.sleep(seconds(1));
    await this.pool.drain();
  }

  async onDestroy(): Promise<void> {
    await this.pool.end();
  }
}

@Tool({
  name: "search_jobs",
  description: "Searches indexed jobs using a warmed prepared statement",
  input: JobQueryDto,
  output: JobQueryDto,
  deps: [ConnectionPool],
})
export class SearchJobsTool
  implements ToolHandler<JobQueryDto, JobQueryDto>, OnInit, OnDestroy
{
  constructor(private readonly pool: ConnectionPool) {}

  async onInit(): Promise<void> {
    // Runs only AFTER ConnectionPool.onInit() succeeds
    await this.pool.ping();
  }

  async onDestroy(): Promise<void> {
    await this.pool.drain();
  }

  run(input: JobQueryDto): Promise<JobQueryDto> {
    return Promise.resolve(input);
  }
}
```

```ts title="src/audit.application.ts" no-check: context tab
import { Application } from "agboss";
import { AuditWorkflow } from "./workflows/audit.workflow.js";

@Application({
  name: "audit-application",
  version: "1.0.0",
  workflows: [AuditWorkflow],
})
export class AuditApplication {}
```

## When the 4 container lifecycle hooks run across all elements

Every component the container creates — `@Injectable` services, repositories, `@Tool`, `@Action`, `@Router`, `@Arbiter`, `@Judge`, `@Channel`, `@Guardrail`, `@PiiPolicy`, `@Rag`, `@HealthCheck`, and `@Application({ observers })` — can implement any combination of `OnInit`, `OnStart`, `OnStop`, and `OnDestroy`:

| Hook | When It Runs | Typical Use Case |
| :--- | :--- | :--- |
| `onInit()` | After the component's own `deps` have been created and completed their `onInit` | Opening database pools, preparing statements, warming caches (failing `onInit` aborts startup and runs `onDestroy` on already-initialized dependencies) |
| `onStart()` | After every component in the application has completed `onInit`, before `execute` | Starting background listeners, readiness checks, or startup audit logs |
| `onStop()` | When `app.close()` or `SIGTERM` arrives (new executions refused with `ApplicationStoppingError`, active ones draining up to `shutdownTimeout`) | Stopping intake queues and flushing pending operations |
| `onDestroy()` | After all running executions have finished, paused, or released their 30s leases to another instance | Closing database pools, sockets, and telemetry exporters |

For **per-execution and per-node callbacks** across every element of the workflow graph (`OnExecutionStart/Pause/Resume/End/Error/Rejected`, `OnAgentStart/End`, `OnRouterStart/End`, `OnToolStart/End`, `OnModelStart/End`, `OnRagStart/End`, `OnActionStart/End`, `OnGuardrailStart/End`, `OnChannelStart/End`, `OnJudgeStart/End`, `OnValuesOutdated`, `OnLaunchItemsTruncated`, `OnQuorumDecided`), register an observer class in `@Application({ observers })` — see [Observability & Tracing](/guides/observability-and-tracing/).

## How class inheritance resolves contracts and test overrides

Infrastructure contracts (`CostLedgerRepository`, `ExecutionRecordRepository`, `PausedExecutionRepository`, `ExecutionLeaseRepository`, `ExecutionTreeRepository`, `RateLimitRepository`, `Clock`, `Logger`, and `@ChannelRole` classes) are resolved by **class inheritance**: listing a subclass in `@Application({ providers })` binds it to the base contract. In unit tests (`testTool`, `testAction`, etc.), pass `overrides: [override(ConnectionPool, FakeConnectionPool)]` to swap any `@Injectable` dependency with a subclass.

