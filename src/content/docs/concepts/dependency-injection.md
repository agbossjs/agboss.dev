---
title: Dependency Injection, Custom Implementations & Overrides
description: "How @Injectable constructor injection, custom @Rag / @ModelProvider / @Channel / Store adapters, class overrides, and lifecycle hooks work in AGBoss."
---

AGBoss includes a deterministic dependency injection container modeled on Angular and NestJS. Every component (`@Injectable`, `@Tool`, `@ToolInterceptor`, `@Action`, `@Router`, `@Arbiter`, `@Judge`, `@Memory`, `@InputGuardrail`, `@OutputGuardrail`, `@PiiPolicy`, `@ModelProvider`, `@Channel`, `@ChannelInterpreter`, `@Rag`, `@Budget`, `@HealthCheck`) declares its constructor dependencies in `deps: [...]`, and the container resolves them at application startup.

Because AGBoss resolves infrastructure contracts by **class inheritance** or typed handler interfaces rather than hardcoding vendor SDKs, you can plug in your own custom `@Rag` vector databases, custom `@ModelProvider` gateways (a driver for OpenRouter, vLLM, Ollama and LiteLLM, or a class with `complete(request)` for a custom SDK transport), custom `@Channel` transports for the pause targets, and custom storage drivers — and swap any dependency in tests with a fake class that `extends` the real one (`testWith(App, { services: [Fake] })`).

---

## Complete example: DI, custom `@Rag`, custom `@ModelProvider` & test doubles

<!-- snippet-context
import { Budget, BudgetPeriod, BudgetScope, Workflow, WorkflowFinish, WorkflowStart, onStart, Ttl, type BudgetHandler } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
import { usd, type Usd } from "@agboss/core/units";
// @snippet
@WorkflowStart({ name: "di-audit-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class DiAuditStart {}
@WorkflowFinish({ name: "di-audit-workflow-finish", description: "Finish", output: WorkflowStartTextDto })
export class DiAuditFinish {}
@Workflow({
  name: "di-audit-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [onStart(DiAuditStart).toFinish(DiAuditFinish)],
})
export class AuditWorkflow {}
@Budget({ name: "di-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class DiAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(10); } }
@Budget({ name: "di-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class DiTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(2); } }
@Budget({ name: "di-exec-budget", scope: BudgetScope.Execution })
export class DiExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.1); } }
-->
```ts title="src/services/audit-trail.service.ts" file=src/services/audit-trail.service.ts
import {
  Clock,
  ExecutionContext,
  Injectable,
  Tool,
  type OnDestroy,
  type OnInit,
  type OnStart,
  type OnStop,
} from "@agboss/core";
import { Rag, RagScope, RagSource, type RagRetrieval, type RagRetrieveOptions } from "@agboss/core/rag";
import { Text } from "@agboss/core/dto";
import { ModelCost, ModelProvider, OpenAiCompatibleDriver } from "@agboss/core/models";
import { seconds } from "@agboss/core/units";

export class JobQueryDto {
  @Text({ prompt: "Search query for indexed jobs" })
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
  queryJobs(q: string): Promise<string[]> {
    return Promise.resolve([`prod:${q}`]);
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

// A custom @Rag backed by your own vector/hybrid store: extend RagSource, implement `retrieve`.
@Rag({
  name: "custom_vector_docs",
  description: "Custom vector search over architecture runbooks",
  scope: RagScope.Tenant,
  topK: 3,
  deps: [ConnectionPool],
})
export class CustomVectorDocsRag extends RagSource {
  constructor(private readonly pool: ConnectionPool) {
    super();
  }

  protected override async retrieve(query: string, options: RagRetrieveOptions): Promise<RagRetrieval> {
    const rows = (await this.pool.queryJobs(query)).slice(0, options.topK);
    const results = rows.map((text, idx) => ({ text, source: `doc-${String(idx + 1)}`, score: 0.95 }));
    return { results, costUsd: usd(0.0002) };
  }
}

// A model provider for a local/self-hosted vLLM or LiteLLM server: a driver, no base class to extend.
@ModelProvider({
  name: "local-vllm-model-provider",
  description: "Self-hosted vLLM OpenAI-compatible inference cluster",
  driver: OpenAiCompatibleDriver({ baseUrl: "http://localhost:8000/v1" }),
  model: "local/qwen-32b",
  timeout: seconds(60),
  cost: ModelCost.fromPrices({
    "local/qwen-32b": {
      inputPerMillion: usd(0.1),
      outputPerMillion: usd(0.2),
    },
  }),
})
export class LocalVllmModelProvider {}

@Tool({
  name: "search_jobs",
  description: "Searches indexed jobs using a warmed connection pool",
  input: JobQueryDto,
  output: JobQueryDto,
  deps: [ConnectionPool, ExecutionContext],
})
export class SearchJobsTool implements OnInit, OnDestroy {
  constructor(
    private readonly pool: ConnectionPool,
    private readonly executionContext: ExecutionContext,
  ) {}

  async onInit(): Promise<void> {
    await this.pool.ping();
  }

  async onDestroy(): Promise<void> {
    await this.pool.drain();
  }

  async execute(input: JobQueryDto): Promise<JobQueryDto> {
    this.executionContext.signal.throwIfAborted();
    const hits = await this.pool.queryJobs(input.query);
    return { query: hits[0] ?? input.query };
  }
}
```

```ts title="src/audit.application.ts" file=src/audit.application.ts
import { Application, EmptyEnvironment } from "@agboss/core";
import {
  AuditWorkflow,
  DiAppBudget,
  DiExecBudget,
  DiTenantBudget,
} from "./services/audit-trail.service.js";
import { LocalVllmModelProvider } from "./services/audit-trail.service.js";

@Application({
  name: "audit-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [AuditWorkflow],
  modelProvider: LocalVllmModelProvider, // there is no default provider: the application names one
  providers: [LocalVllmModelProvider],
  budgets: [DiAppBudget, DiTenantBudget, DiExecBudget],
})
export class AuditApplication {}
```

```ts title="test/custom-overrides.test.ts" file=test/custom-overrides.test.ts
import { expect, it } from "vitest";
import { Injectable } from "@agboss/core";
import { testUnit } from "@agboss/core/testing";
import {
  ConnectionPool,
  CustomVectorDocsRag,
  SearchJobsTool,
} from "../src/services/audit-trail.service.js";

@Injectable()
class FakeConnectionPool extends ConnectionPool {
  override queryJobs(q: string): Promise<string[]> {
    return Promise.resolve([`fake-hit:${q}`]);
  }
}

it("overrides ConnectionPool in both @Tool and custom @Rag unit runners", async () => {
  const runTool = testUnit(SearchJobsTool, {
    services: [FakeConnectionPool],
  });
  const toolRes = await runTool({ query: "staff-ts" });
  expect(toolRes.output).toEqual({ query: "fake-hit:staff-ts" });

  const runRag = testUnit(CustomVectorDocsRag, {
    services: [FakeConnectionPool],
  });
  const ragRes = await runRag("runbook", { topK: 2 });
  expect(ragRes.output[0]?.text).toBe("fake-hit:runbook");
  expect(ragRes.output[0]?.source).toBe("doc-1");
  expect(ragRes.spend.totalUsd).toBeCloseTo(0.0002);
});
```

---

## How custom implementations & overrides work for every contract

AGBoss never locks you into built-in adapters. Every external integration is defined as an abstract base class or TypeScript interface that you can implement in production and override in tests:

| Contract Type | How to Implement Your Own in Production | How to Register It | How to Override / Test It |
| :--- | :--- | :--- | :--- |
| **Knowledge Base ([`@Rag`](/reference/rag/))** | Decorate with `@Rag({ name, description, scope, topK, deps })` and `extends RagSource` (implement `protected retrieve(query, options)` for Pinecone, Qdrant, pgvector, Elasticsearch) or `extends SqliteFtsRagSource` (built-in BM25). | Referenced in `@Agent({ rag: [MyRag] })` (the core retrieves before the agent's first model call), or injected into a `@Tool` / `@Action` that calls `search(query)`; its `deps` go in `@Workflow({ providers })`. | `testUnit(MyRag, { services: [FakeVectorClient] })` or `mockRag(MyRag)` in `testWith(App)`. |
| **Model Gateway ([`@ModelProvider`](/reference/model-provider/))** | Decorate with `@ModelProvider({ name: "...-model-provider", driver, model, timeout, cost, … })` where `driver` is `OpenRouterDriver`, `OpenAiCompatibleDriver` (vLLM, Ollama, LiteLLM, Azure) or `DecisionsDriver`; or, for AWS Bedrock / Vertex AI / mTLS gateways, a class with `complete(request)` and `deps: [...]` instead of a `driver`. | Listed in `@Application({ providers: [MyModelProvider] })` and named by `modelProvider` (the application's, a workflow's or a component's). There are no built-in providers. | `testWith(App)` automatically intercepts model calls above the transport so unit tests never hit live endpoints. |
| **Memory ([`@Memory`](/reference/memory/))** | Decorate with `@Memory({ name: "...-memory", … })` — what a workflow, an agent or a model router remembers of its thread: the window, the summaries and the `ttl`. | Bound on `@Workflow`, `@Agent`, or `@Router` via `memory: MyMemory`. A workflow without `memory` is stateless. | `testUnit(MyMemory, { services })` or `mockOf(Service)` in `testWith(App)`. |
| **Tool Interceptor ([`@ToolInterceptor`](/reference/tool-interceptor/))** | Decorate with `@ToolInterceptor()` and mark methods `@BeforeTool(Tool)` / `@AfterTool(Tool)` (per tool) or `beforeAnyTool` / `afterAnyTool` (every tool); it fails closed. | Bound via `toolInterceptors: [MyToolInterceptor]` on `@Application`, `@Workflow`, `@Agent` or `@Tool`. | `testUnit(MyToolInterceptor, { services })`. |
| **Approval Channel ([`@Channel`](/reference/channel/))** | Declare the **target** — `@ToolApproval({ input, respondent, timeout })` or `@ExternalTask({ input, output, respondent, timeout })` — then implement `@Channel({ name, target, ttl, deps }) export class SlackChannel` (`send(ask)` and optional `onPauseClosed(event)`). | Listed in `@Application({ channels: [SlackChannel] })`; a `@Tool({ approval: MyApproval })` names the target, never the channel. | In `testWith(App)`, a channel is replaced by `AutoApproveChannel` / `AutoRejectChannel`, or override `SlackService` via a fake class in `services`. |
| **Durable Storage ([Persistence](/guides/persistence-and-recovery/))** | A `@DatabaseStorage({ driver, auditLogTtl, ledgerEntriesTtl })` class with `SqliteDriver`, or the store packages' `PostgresDriver` / `MongoDriver`; `@ClusterStorage` (Redis) for leases and the child queue. A driver of your own is built with `defineStorageDriver` from `@agboss/core/stores`. | `@Application({ storage: MyDatabaseStorage })` — a store class in `providers` beside it is `[storage.providers-conflict]`. | The in-memory database runs automatically when `storage` is omitted. |
| **Domain Services ([`@Injectable`](/reference/injectable/))** | Decorate with `@Injectable({ deps: [...] })` (and optional `OnInit`, `OnStart`, `OnStop`, `OnDestroy` hooks). | Listed in `@Workflow({ providers: [MyService] })` (or `@Application({ providers })` when shared by app-level guards/observers). | A fake class that `extends MyService` in `services: [FakeMyService]` of `testWith` and of `testUnit`, or `mockOf(MyService)` in `testWith`. |
| **Value Tokens (`InjectionToken<T>`)** | Create `const CONFIG = new InjectionToken<MyConfig>("CONFIG")` and bind with `provide(CONFIG, { ... })`. (Note: passing a class to `provide(Class, instance)` is rejected by `[di.instance-provider]`). | Listed in `@Workflow({ providers: [provide(CONFIG, value)] })`. | Pass `provide(CONFIG, testValue)` in `services`. |

---

## Built-in injectable framework contexts

Instead of calling `Date.now()`, `process.env`, or global singletons, AGBoss components inject framework contracts through `deps`:

- **`Clock` (`deps: [Clock]`):** Every timestamp and sleep (`this.clock.now()`, `await this.clock.sleep(seconds(30))`) goes through the application's `Clock`. Under `testWith`, the container provides a `VirtualClock` that advances instantly with `await clock.advance(seconds(30))`.
- **`ApplicationContext` (`deps: [ApplicationContext]`):** Provides `this.applicationContext.environment` (typed by your `AppEnvironment` contract), `environmentName`, and `instanceId`. Components always inject `ApplicationContext` rather than `AppEnvironment` directly.
- **`ExecutionContext` (`deps: [ExecutionContext]`):** Provides read-only access to the current step's frame (`executionId`, `rootExecutionId`, `parentExecutionId`, `depth`, `threadId`, `ownerId`, `tenant.tenantId`, `signal`, and `step.idempotencyKey`), isolated via `AsyncLocalStorage` across concurrent runs and parallel branches.
- **`TenantContext` (`deps: [MyTenantContext]`):** Subclass `TenantContext` and name it in `@Application({ tenantContext })` to pass typed per-request tenant metadata (`plan`, `region`, `dailyBudgetUsd`) into tools, actions, and budgets. Declaring it is also what switches on the tenant gate: the point calls of `App` then require `{ tenantId }`.

---

## When the 4 container lifecycle hooks run

Every component the container creates can implement any combination of `OnInit`, `OnStart`, `OnStop`, and `OnDestroy`:

| Hook | When It Runs | Typical Use Case |
| :--- | :--- | :--- |
| `onInit()` | After the component's own `deps` have been created and completed their `onInit` | Opening database pools, preparing statements, warming caches (failing `onInit` aborts startup and runs `onDestroy` on already-initialized dependencies) |
| `onStart()` | After every component in the application has completed `onInit`, before `execute` | Starting background listeners, readiness checks, or startup audit logs |
| `onStop()` | When `app.close()` or `SIGTERM` arrives (new executions refused with `ApplicationStoppingError`, active ones draining up to `executionLimits.shutdownTimeout`) | Stopping intake queues and flushing pending operations |
| `onDestroy()` | After all running executions have finished, paused, or released their 30s leases to another instance | Closing database pools, sockets, and telemetry exporters |
