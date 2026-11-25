---
title: "@Injectable"
description: Complete API reference for @Injectable in AGBoss — constructor dependency injection, OnInit/OnStart/OnStop/OnDestroy lifecycle hooks, and DI overrides.
---

The `@Injectable` decorator marks a TypeScript class (`services/*.service.ts`) as a managed singleton in the AGBoss dependency injection container. Injectable classes receive their constructor dependencies via `deps: [...]`, participate in the four application lifecycle phases (`OnInit`, `OnStart`, `OnStop`, `OnDestroy`), and are replaced in tests by a fake class that `extends` the real one (`testWith(App, { services: [FakeService] })`). An execution observer is not an `@Injectable` any more: it is an [`@Observer`](/reference/application/#what-options-does-application-accept) class with a method per hook, listed in `@Application({ observers })`.

## Complete `@Injectable` example with lifecycle hooks and DI

```ts title="src/services/job-index.service.ts" file=src/services/job-index.service.ts
import {
  ApplicationContext,
  Clock,
  ExecutionContext,
  Injectable,
  LogLevel,
  Logger,
  type OnDestroy,
  type OnInit,
  type OnStart,
  type OnStop,
} from "@agboss/core";

@Injectable({
  deps: [ApplicationContext, ExecutionContext, Clock, Logger],
})
export class JobIndexService implements OnInit, OnStart, OnStop, OnDestroy {
  constructor(
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
    const startedAt = this.clock.now();
    this.logger.write({
      level: LogLevel.Info,
      code: "job-index.ready",
      message: `Ready to accept traffic at ${String(startedAt.getTime())}`,
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
import { Tool } from "@agboss/core";
import { List, Text } from "@agboss/core/dto";
import { JobIndexService } from "../services/job-index.service.js";

export class JobSearchInputDto {
  @Text({ prompt: "Role search query" })
  query!: string;
}

export class JobSearchOutputDto {
  @List(Text, { prompt: "Matching roles" })
  jobs!: string[];
}

@Tool({
  name: "search_jobs",
  description: "Queries the warmed JobIndexService",
  input: JobSearchInputDto,
  output: JobSearchOutputDto,
  deps: [JobIndexService],
})
export class SearchJobsTool {
  constructor(private readonly index: JobIndexService) {}

  async execute(input: JobSearchInputDto): Promise<JobSearchOutputDto> {
    return { jobs: await this.index.searchByTenant(input.query) };
  }
}
```

```ts title="src/job-scout.model-provider.ts" file=src/job-scout.model-provider.ts
import { secret } from "@agboss/core";
import { ModelCost, ModelProvider, OpenRouterDriver } from "@agboss/core/models";
import { minutes } from "@agboss/core/units";

@ModelProvider({
  name: "job-scout-model-provider",
  description: "OpenRouter for the job scout",
  driver: OpenRouterDriver({ apiKey: secret("OPENROUTER_API_KEY") }),
  timeout: minutes(2),
  cost: ModelCost.fromResponse(),
})
export class JobScoutModelProvider {}
```

```ts title="src/job-scout.application.ts" file=src/job-scout.application.ts
import {
  Application,
  Budget,
  BudgetPeriod,
  BudgetScope,
  EmptyEnvironment,
  type BudgetHandler,
} from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";
import { JobIndexService } from "./services/job-index.service.js";
import { JobScoutWorkflow } from "./workflows/job-scout.workflow.js";
import { JobScoutModelProvider } from "./job-scout.model-provider.js";

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
  modelProvider: JobScoutModelProvider,
  providers: [JobScoutModelProvider, JobIndexService],
  budgets: [JsAppBudget, JsTenantBudget, JsExecBudget],
})
export class JobScoutApplication {}
```

```ts title="test/job-index.service.test.ts" file=test/job-index.service.test.ts
import { expect } from "vitest";
import { ApplicationContext, Clock, ExecutionContext, Injectable, Logger } from "@agboss/core";
import { testWith } from "@agboss/core/testing";
import { JobScoutApplication } from "../src/job-scout.application.js";
import { JobIndexService } from "../src/services/job-index.service.js";
import { ChatWorkflowStart } from "../src/workflows/job-scout.workflow.js";

@Injectable({ deps: [ApplicationContext, ExecutionContext, Clock, Logger] })
class FakeJobIndexService extends JobIndexService {
  override searchByTenant(): Promise<string[]> {
    return Promise.resolve(["Stubbed Staff Engineer Role"]);
  }
}

const test = testWith(JobScoutApplication, { services: [FakeJobIndexService] });

test("uses FakeJobIndexService and spies on calls via mockOf", async ({ app, mockOf }) => {
  await app.execute(ChatWorkflowStart, { text: "Find TypeScript roles" });
  expect(mockOf(JobIndexService).searchByTenant).toHaveBeenCalledOnce();
});
```

<!--
```ts file=src/workflows/job-scout.workflow.ts
import { Agent, Workflow, WorkflowFinish, WorkflowStart, onStart, inline, Ttl } from "@agboss/core";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "@agboss/core/dto";
import { SearchJobsTool } from "../tools/search-jobs.tool.js";

@WorkflowStart({ name: "chat-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class ChatWorkflowStart {}

@WorkflowFinish({ name: "chat-workflow-finish", description: "Finish", output: WorkflowFinishTextDto })
export class ChatWorkflowFinish {}

@Agent({
  name: "scout-agent",
  description: "Searches jobs",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Search jobs using search_jobs."),
  tools: [SearchJobsTool],
})
export class ScoutAgent {}

@Workflow({
  name: "job-scout-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [
    onStart(ChatWorkflowStart)
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
| `deps` | `readonly Token[]` | No | Ordered list of constructor dependency tokens (`ApplicationContext`, `ExecutionContext`, `TenantContext`, `Clock`, `Logger`, `Idempotency`, `DecisionModel`, a `defineEnv` dictionary, or other `@Injectable` classes) verified against constructor parameters by TypeScript. |
| `injectAs` | `readonly Class[]` | No | The port(s) this class serves: a dependant that asks for the port gets this class, and a test replaces it by another class naming the same port. |
| `environmentFields` | `EnvironmentFields` | No | Environment fields the service reads (for example `EnvironmentField.secret()`), checked against the environment contract. |

## What related entities work with `@Injectable`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `OnInit`, `OnStart`, `OnStop`, `OnDestroy` | `"@agboss/core"` | Four deterministic container lifecycle hooks executed during `createApp()` startup and `app.close()` shutdown on every container element. |
| `ExecutionContext`, `TenantContext`, `ApplicationContext` | `"@agboss/core"` | Built-in context classes injectable into any service constructor (`ExecutionContext` reads current step metadata via `AsyncLocalStorage`). |
| `Clock` & `Logger` | `"@agboss/core"` | Built-in time and PII-redacted structured logging singletons (`Clock` is replaced by `VirtualClock` in `testWith()`). |
| `InjectionToken<T>` & `provide(TOKEN, value)` | `"@agboss/core"` | Binds non-class configuration values in `@Workflow({ providers })` or `@Application({ providers })`. |
| `@Observer` | `"@agboss/core"` | A class with a method per execution hook (`onExecutionEnd`, `onToolEnd`, …), optionally limited to `workflows` and `agents`; listed in `@Application({ observers })`. |
| `services: [FakeClass]` & `mockOf(ServiceClass)` | `"@agboss/core/testing"` | Replaces a service with a fake class that `extends` it, or with a spy, in `testWith()` and `testUnit()`. |
