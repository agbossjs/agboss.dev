---
title: "@Injectable"
description: Complete API reference for @Injectable in AGBoss — constructor dependency injection, OnInit/OnStart/OnStop/OnDestroy lifecycle hooks, and DI overrides.
---

The `@Injectable` decorator marks a TypeScript class (`services/*.service.ts` or `observers/*.observer.ts`) as a managed singleton in the AGBoss dependency injection container. Injectable classes receive their constructor dependencies via `deps: [...]`, participate in the four application lifecycle phases (`OnInit`, `OnStart`, `OnStop`, `OnDestroy`), can implement `ExecutionObserver` hooks (`OnExecutionEnd`, `OnToolEnd`, `OnModelEnd`, `OnValuesOutdated`), and are replaced in tests by class inheritance via `override(BaseService, FakeService)`.

## Complete `@Injectable` example with lifecycle hooks and DI

```ts title="src/services/job-index.service.ts" file=src/services/job-index.service.ts
import {
  ApplicationContext,
  Clock,
  EmptyEnvironment,
  ExecutionContext,
  Injectable,
  LogLevel,
  Logger,
  type OnDestroy,
  type OnInit,
  type OnStart,
  type OnStop,
} from "agboss";

@Injectable({
  deps: [EmptyEnvironment, ApplicationContext, ExecutionContext, Clock, Logger],
})
export class JobIndexService implements OnInit, OnStart, OnStop, OnDestroy {
  constructor(
    private readonly _env: EmptyEnvironment,
    private readonly appContext: ApplicationContext,
    private readonly executionContext: ExecutionContext,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async onInit(): Promise<void> {
    this.logger.write({
      level: LogLevel.Info,
      code: "job-index.init",
      message: `Initializing index on host ${this.appContext.host.hostname}`,
      time: this.clock.now(),
    });
  }

  async onStart(): Promise<void> {
    this.logger.write({
      level: LogLevel.Info,
      code: "job-index.ready",
      message: `Ready to accept traffic at ${this.clock.now().toISOString()}`,
      time: this.clock.now(),
    });
  }

  async searchByTenant(query: string): Promise<string[]> {
    const idempotencyKey = this.executionContext.step.idempotencyKey;
    return [`Senior TypeScript Engineer — ${query} (${idempotencyKey})`];
  }

  async onStop(): Promise<void> {
    this.logger.write({
      level: LogLevel.Info,
      code: "job-index.stop",
      message: "Draining in-flight index queries before lease release",
      time: this.clock.now(),
    });
  }

  async onDestroy(): Promise<void> {
    this.logger.write({
      level: LogLevel.Info,
      code: "job-index.destroy",
      message: "Closing underlying index file descriptors",
      time: this.clock.now(),
    });
  }
}
```

```ts title="src/tools/search-jobs.tool.ts" file=src/tools/search-jobs.tool.ts
import { Tool, type ToolHandler } from "agboss";
import { ListOf, Text } from "agboss/dto";
import { JobIndexService } from "../services/job-index.service.js";

export class JobSearchInputDto {
  @Text({ prompt: "Role search query" })
  query!: string;
}

export class JobSearchOutputDto {
  @ListOf(Text, { prompt: "Matching roles" })
  jobs!: string[];
}

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
    return { jobs: await this.index.searchByTenant(input.query) };
  }
}
```

```ts title="src/job-scout.application.ts" file=src/job-scout.application.ts
import {
  Application,
  Budget,
  BudgetPeriod,
  BudgetScope,
  EmptyEnvironment,
  type BudgetHandler,
} from "agboss";
import { usd, type Usd } from "agboss/units";
import { JobIndexService } from "./services/job-index.service.js";
import { JobScoutWorkflow } from "./workflows/job-scout.workflow.js";

@Budget({ name: "js-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class JsAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(20); } }
@Budget({ name: "js-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class JsTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "js-exec-budget", scope: BudgetScope.Execution })
export class JsExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "job-scout-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [JobScoutWorkflow],
  providers: [JobIndexService],
  budgets: [JsAppBudget, JsTenantBudget, JsExecBudget],
})
export class JobScoutApplication {}
```

```ts title="test/job-index.service.test.ts" file=test/job-index.service.test.ts
import { expect } from "vitest";
import { override, testWith } from "agboss/testing";
import { JobScoutApplication } from "../src/job-scout.application.js";
import { JobIndexService } from "../src/services/job-index.service.js";
import { ChatWorkflowStart } from "../src/workflows/job-scout.workflow.js";

class FakeJobIndexService extends JobIndexService {
  override searchByTenant(): Promise<string[]> {
    return Promise.resolve(["Stubbed Staff Engineer Role"]);
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

<!--
```ts file=src/workflows/job-scout.workflow.ts
import { Agent, Workflow, WorkflowFinish, WorkflowStart, start } from "agboss";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "agboss/dto";
import { SearchJobsTool } from "../tools/search-jobs.tool.js";

@WorkflowStart({ name: "chat-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class ChatWorkflowStart {}

@WorkflowFinish({ name: "chat-workflow-finish", description: "Finish", output: WorkflowFinishTextDto })
export class ChatWorkflowFinish {}

@Agent({
  name: "scout-agent",
  description: "Searches jobs",
  model: "moonshotai/kimi-k2.6",
  prompt: "Search jobs using search_jobs.",
  tools: [SearchJobsTool],
})
export class ScoutAgent {}

@Workflow({
  name: "job-scout-workflow",
  version: "1.0.0",
  flow: [
    start(ChatWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toAgent(ScoutAgent)
      .toFinish(ChatWorkflowFinish),
  ],
})
export class JobScoutWorkflow {}
```
-->

## What options does `@Injectable` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `deps` | `readonly Token[]` | No | Ordered list of constructor dependency tokens (`AppEnvironment`, `ExecutionContext`, `TenantContext`, `ApplicationContext`, `Clock`, `Logger`, `ROUTER_FACTORY`, or other `@Injectable` classes) verified against constructor parameters by TypeScript. |

## What related entities work with `@Injectable`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `OnInit`, `OnStart`, `OnStop`, `OnDestroy` | `"agboss"` | Four deterministic container lifecycle hooks executed during `createApp()` startup and `app.close()` shutdown on every container element. |
| `ExecutionContext`, `TenantContext`, `ApplicationContext` | `"agboss"` | Built-in context classes injectable into any service constructor (`ExecutionContext` reads current step metadata via `AsyncLocalStorage`). |
| `Clock` & `Logger` | `"agboss"` | Built-in time and PII-redacted structured logging singletons (`Clock` is replaced by `VirtualClock` in `testWith()`). |
| `InjectionToken<T>` & `provide(TOKEN, value)` | `"agboss"` | Binds non-class configuration values or factory tokens (`ROUTER_FACTORY`) in `@Workflow({ providers })`. |
| `override(BaseClass, SubClass)` & `mockOf(ServiceClass)` | `"agboss/testing"` | Replaces a service with a subclass or spy in `testWith()`, `testTool()`, `testAction()`, or `testRouter()`. |
