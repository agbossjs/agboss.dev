---
title: "@Injectable"
description: Complete API reference for the @Injectable decorator in AGBoss — constructor dependency injection, OnInit/OnStart/OnStop/OnDestroy lifecycle hooks, ExecutionObservers, and DI overrides.
---

The `@Injectable` decorator marks a TypeScript class (`services/*.service.ts` or `observers/*.observer.ts`) as a managed singleton in the AGBoss dependency injection container. Injectable classes receive their constructor dependencies via `deps: [...]`, participate in the four application lifecycle phases (`OnInit`, `OnStart`, `OnStop`, `OnDestroy`), can implement `ExecutionObserver` hooks (`OnExecutionEnd`, `OnToolEnd`, `OnSpend`, `OnValuesOutdated`), and are replaced in tests by class inheritance via `override(BaseService, FakeService)`.

## What options does `@Injectable` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `deps` | `readonly Token[]` | No | Ordered list of constructor dependency tokens (`AppEnvironment`, `ExecutionContext`, `TenantContext`, `ApplicationContext`, `Clock`, `Logger`, `ROUTER_FACTORY`, or other `@Injectable` classes) verified against constructor parameters by TypeScript. |

## Complete `@Injectable` example with lifecycle hooks and DI

```ts title="src/services/job-index.service.ts" no-check: reference example
import { ApplicationContext, Clock, ExecutionContext, Injectable, Logger, OnDestroy, OnInit, OnStart, OnStop } from "agboss";
import { AppEnvironment } from "../environments/app.environment.js";

@Injectable({
  deps: [AppEnvironment, ApplicationContext, ExecutionContext, Clock, Logger],
})
export class JobIndexService implements OnInit, OnStart, OnStop, OnDestroy {
  constructor(
    private readonly env: AppEnvironment,
    private readonly appContext: ApplicationContext,
    private readonly executionContext: ExecutionContext,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async onInit(): Promise<void> {
    this.logger.info(`Initializing index on host ${this.appContext.hostId}`);
  }

  async onStart(): Promise<void> {
    this.logger.info(`Ready to accept traffic at ${this.clock.now().toISOString()}`);
  }

  async searchByTenant(query: string): Promise<string[]> {
    const idempotencyKey = this.executionContext.step.idempotencyKey;
    this.logger.debug(`Searching for "${query}" (${idempotencyKey})`);
    return [`Senior TypeScript Engineer — ${query}`];
  }

  async onStop(): Promise<void> {
    this.logger.info("Draining in-flight index queries before lease release");
  }

  async onDestroy(): Promise<void> {
    this.logger.info("Closing underlying index file descriptors");
  }
}
```

```ts title="src/tools/search-jobs.tool.ts" no-check: reference example
import { Tool, type ToolHandler } from "agboss";
import { JobIndexService } from "../services/job-index.service.js";
import { JobSearchInputDto, JobSearchOutputDto } from "../dto/job-search.dto.js";

@Tool({
  name: "search_jobs",
  description: "Queries the warmed JobIndexService",
  input: JobSearchInputDto,
  output: JobSearchOutputDto,
  deps: [JobIndexService],
})
export class SearchJobsTool implements ToolHandler<JobSearchInputDto, JobSearchOutputDto> {
  constructor(private readonly index: JobIndexService) {}

  async run(input: JobSearchInputDto): Promise<JobSearchOutputDto> {
    return { jobs: await this.index.query(input.query) };
  }
}
```

## What related entities work with `@Injectable`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `OnInit`, `OnStart`, `OnStop`, `OnDestroy` | `"agboss"` | Four deterministic container lifecycle hooks executed during `createApp()` startup and `app.close()` shutdown on every container element. |
| `ExecutionContext`, `TenantContext`, `ApplicationContext` | `"agboss"` | Built-in context classes injectable into any service constructor (`ExecutionContext` reads current step metadata via `AsyncLocalStorage`). |
| `Clock` & `Logger` | `"agboss"` | Built-in time and PII-redacted structured logging singletons (`Clock` is replaced by `VirtualClock` in `testWith()`). |
| `InjectionToken<T>` & `provide(TOKEN, value)` | `"agboss"` | Binds non-class configuration values or factory tokens (`ROUTER_FACTORY`) in `@Workflow({ providers })`. |
| `override(BaseClass, SubClass)` & `mockOf(ServiceClass)` | `"agboss/testing"` | Replaces a service with a subclass or spy in `testWith()`, `testTool()`, `testAction()`, or `testRouter()`. |

### Overriding and spying on an `@Injectable` service in tests

```ts title="test/job-index.service.test.ts" no-check: reference example
import { expect } from "vitest";
import { override, testWith } from "agboss/testing";
import { JobScoutApplication } from "../job-scout.application.js";
import { JobIndexService } from "./job-index.service.js";
import { ChatWorkflowStart } from "../workflow-starts/chat.workflow-start.js";

class FakeJobIndexService extends JobIndexService {
  override async searchByTenant(): Promise<string[]> {
    return ["Stubbed Staff Engineer Role"];
  }
}

const test = testWith(JobScoutApplication, {
  overrides: [override(JobIndexService, FakeJobIndexService)],
});

test("uses FakeJobIndexService and spies on calls via mockOf", async ({ app, mockOf }) => {
  await app.execute(ChatWorkflowStart, { text: "Find TypeScript roles" });
  expect(mockOf(JobIndexService).searchByTenant).toHaveBeenCalledOnce();
});
```

```ts title="src/job-scout.application.ts" no-check: reference example
import { Application } from "agboss";
import { JobScoutWorkflow } from "./workflows/job-scout.workflow.js";

@Application({
  name: "job-scout-application",
  version: "1.0.0",
  workflows: [JobScoutWorkflow],
})
export class JobScoutApplication {}
```
