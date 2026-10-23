---
title: Dependency Injection, Custom Implementations & Overrides
description: How @Injectable constructor injection, custom @Rag / @ModelProvider / @Channel / Store implementations, class-inheritance overrides, and lifecycle hooks work in AGBoss.
---

AGBoss includes a deterministic dependency injection container modeled on Angular and NestJS. Every component (`@Injectable`, `@Tool`, `@ToolInterceptor`, `@Action`, `@Router`, `@Arbiter`, `@Judge`, `@Compaction`, `@InputGuardrail`, `@OutputGuardrail`, `@PiiPolicy`, `@ModelProvider`, `@Channel`, `@ReplyInterpreter`, `@Rag`, `@Budget`, `@HealthCheck`) declares its constructor dependencies in `deps: [...]`, and the container resolves them at application startup.

Because AGBoss resolves infrastructure contracts by **class inheritance** or typed handler interfaces rather than hardcoding vendor SDKs, you can plug in your own custom `@Rag` vector databases, custom `@ModelProvider` gateways (OpenRouter, vLLM, Ollama, LiteLLM, or custom SDK transports via `ModelProviderHandler`), custom `@Compaction` knowledge-graph handlers (`CompactionStrategy.Custom`), custom `@Channel` transports, and custom Postgres/Redis stores — and swap any dependency in tests with `override(Base, Fake)`.

---

## Complete example: DI, custom `@Rag`, custom `@ModelProvider` & `override()` test

<!-- snippet-context
import { Budget, BudgetPeriod, BudgetScope, Workflow, WorkflowFinish, WorkflowStart, start, type BudgetHandler } from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";
import type { Usd } from "agboss/units";
// @snippet
@WorkflowStart({ name: "di-audit-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class DiAuditStart {}
@WorkflowFinish({ name: "di-audit-workflow-finish", description: "Finish", output: WorkflowStartTextDto })
export class DiAuditFinish {}
@Workflow({
  name: "di-audit-workflow",
  version: "1.0.0",
  flow: [start(DiAuditStart).returns(WorkflowStartTextDto).toFinish(DiAuditFinish)],
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
  type ToolHandler,
} from "agboss";
import { Rag, type RagConnector, type RagRetrieval } from "agboss/rag";
import { Text } from "agboss/dto";
import { minutes, seconds, usd } from "agboss/units";
import {
  DecisionsModelProvider,
  ModelCost,
  ModelProvider,
  OpenAiCompatibleProvider,
  PromptCaching,
  Reasoning,
  RetryPolicy,
} from "agboss/models";

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

// Custom @Rag implementation backed by your own vector/hybrid store:
@Rag({
  name: "custom_vector_docs",
  description: "Custom vector search over architecture runbooks",
  topK: 3,
  deps: [ConnectionPool, ExecutionContext],
})
export class CustomVectorDocsRag implements RagConnector {
  constructor(
    private readonly pool: ConnectionPool,
    private readonly executionContext: ExecutionContext,
  ) {}

  async retrieve(
    query: string,
    options: { readonly topK: number; readonly signal: AbortSignal },
  ): Promise<RagRetrieval> {
    void this.executionContext.tenant.tenantId;
    const rows = await this.pool.queryJobs(query);
    return {
      results: rows.slice(0, options.topK).map((text, idx) => ({
        text,
        source: `doc-${String(idx + 1)}`,
        score: 0.95,
      })),
      costUsd: 0.0002,
    };
  }
}

// Custom @ModelProvider for a local/self-hosted vLLM or LiteLLM server:
@ModelProvider({
  name: "local-vllm-model-provider",
  description: "Self-hosted vLLM OpenAI-compatible inference cluster",
  serves: [/^local\//, /^moonshotai\//],
  baseUrl: "http://localhost:8000/v1",
  timeout: seconds(60),
  cost: ModelCost.fromPrices({
    "local/qwen-32b": {
      inputPerMillion: usd(0.1),
      outputPerMillion: usd(0.2),
    },
    "moonshotai/kimi-k2.6": {
      inputPerMillion: usd(0.5),
      outputPerMillion: usd(1.5),
    },
  }),
  reasoning: Reasoning.off(),
  promptCaching: PromptCaching.off(),
  retryPolicy: RetryPolicy.none(),
  circuitBreakerPolicy: {
    failureThreshold: 5,
    window: minutes(1),
    openFor: seconds(30),
  },
})
export class LocalVllmModelProvider extends OpenAiCompatibleProvider {
  override readonly requestFields = {};
}

export const modelProviders = [LocalVllmModelProvider, DecisionsModelProvider];

@Tool({
  name: "search_jobs",
  description: "Searches indexed jobs using a warmed connection pool",
  input: JobQueryDto,
  output: JobQueryDto,
  deps: [ConnectionPool],
})
export class SearchJobsTool
  implements ToolHandler<JobQueryDto, JobQueryDto>, OnInit, OnDestroy
{
  constructor(private readonly pool: ConnectionPool) {}

  async onInit(): Promise<void> {
    await this.pool.ping();
  }

  async onDestroy(): Promise<void> {
    await this.pool.drain();
  }

  async run(input: JobQueryDto): Promise<JobQueryDto> {
    const hits = await this.pool.queryJobs(input.query);
    return { query: hits[0] ?? input.query };
  }
}
```

```ts title="src/audit.application.ts" file=src/audit.application.ts
import { Application, EmptyEnvironment } from "agboss";
import {
  AuditWorkflow,
  DiAppBudget,
  DiExecBudget,
  DiTenantBudget,
} from "./services/audit-trail.service.js";

@Application({
  name: "audit-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [AuditWorkflow],
  budgets: [DiAppBudget, DiTenantBudget, DiExecBudget],
})
export class AuditApplication {}
```

```ts title="test/custom-overrides.test.ts" file=test/custom-overrides.test.ts
import { expect, it } from "vitest";
import { override, testRag, testTool } from "agboss/testing";
import {
  ConnectionPool,
  CustomVectorDocsRag,
  SearchJobsTool,
} from "../src/services/audit-trail.service.js";

class FakeConnectionPool extends ConnectionPool {
  override queryJobs(q: string): Promise<string[]> {
    return Promise.resolve([`fake-hit:${q}`]);
  }
}

it("overrides ConnectionPool in both @Tool and custom @Rag unit runners", async () => {
  const runTool = testTool(SearchJobsTool, {
    overrides: [override(ConnectionPool, FakeConnectionPool)],
  });
  const toolRes = await runTool({ query: "staff-ts" });
  expect(toolRes.output).toEqual({ query: "fake-hit:staff-ts" });

  const runRag = testRag(CustomVectorDocsRag, {
    overrides: [override(ConnectionPool, FakeConnectionPool)],
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
| **Knowledge Base ([`@Rag`](/reference/rag/))** | Decorate with `@Rag({ name, description, topK, deps })` and either `implements RagConnector` (`retrieve(query, { topK, signal })` for Pinecone, Qdrant, pgvector, Elasticsearch) or `extends SqliteFtsConnector` (built-in BM25). | Referenced in `@Agent({ rag: [{ use: MyRag, mode: RagMode.Tool \| RagMode.Context }] })`; its `deps` go in `@Workflow({ providers })`. | `testRag(MyRag, { overrides: [override(VectorClient, FakeVectorClient)] })` or `mockRag(MyRag)` in `testWith(App)`. |
| **Model Gateway ([`@ModelProvider`](/reference/model-provider/))** | Decorate with `@ModelProvider({ name: "...-model-provider", serves, cost, reasoning, promptCaching, retryPolicy, rateLimitPolicy, circuitBreakerPolicy })` and extend `OpenRouterProvider`, `OpenAiCompatibleProvider` (vLLM, Ollama, LiteLLM, Azure), or `implements ModelProviderHandler` (`complete(request)` with `deps: [...]` for AWS Bedrock / Vertex AI / mTLS gateways). | Listed in `@Application({ providers: [MyModelProvider, DecisionsModelProvider] })`. | `testWith(App)` automatically intercepts model calls above the transport so unit tests never hit live endpoints. |
| **Custom Compaction ([`@Compaction`](/reference/compaction/))** | Decorate with `@Compaction({ name: "...-compaction", strategy: CompactionStrategy.Custom, turnsBetweenCompactions, deps })` and implement `CompactionHandler` (`compact(input)`). | Bound on `@Application`, `@Workflow`, `@Agent`, or `@Router` via `compaction: MyCompaction`. | `testCompaction(MyCompaction, { overrides })` or `mockOf(Service)` in `testWith(App)`. |
| **Tool Interceptor ([`@ToolInterceptor`](/reference/tool-interceptor/))** | Decorate with `@ToolInterceptor({ name: "...-tool-interceptor", description, deps })` and implement `BeforeToolCall` and/or `AfterToolCall`. | Bound via `toolInterceptors: [MyToolInterceptor]` on `@Application`, `@Workflow`, `@Agent`, `@Tool`, or `@McpTool`. | `testToolInterceptor(MyToolInterceptor, { overrides })`. |
| **Approval Channel ([`@Channel`](/reference/channel/))** | Declare `@ChannelRole({ approves, answeredBy, replyInterpreter }) export abstract class MyRole extends ChannelOf<MyRole> {}`, then implement `@Channel({ name, deps }) export class SlackChannel extends MyRole` (`send()` and optional `withdraw()`). | Listed in `@Application({ providers: [SlackChannel] })` (matched to `MyRole` by class inheritance). | In `testWith(App)`, pass `overrides: [override(MyRole, AutoApproveChannel)]` or override `SlackService` via `override(SlackService, FakeSlackService)`. |
| **7 Durable Stores ([Persistence](/guides/persistence-and-recovery/))** | Subclass any of the 7 contracts (`extends BaseCheckpointSaver`, `PausedExecutionRepository`, `ExecutionRecordRepository`, `CostLedgerRepository`, `ExecutionLeaseRepository`, `ExecutionTreeRepository`, `RateLimitRepository`) or subclass a `Sqlite*` class (`extends SqliteExecutionLeaseRepository`). | Listed in `@Application({ providers: [PostgresLeaseRepository, ...] })`. | Default `InMemory*` stores run automatically when omitted; or pass `overrides: [override(ExecutionLeaseRepository, FaultyLeaseRepo)]` in `testWith`. |
| **Domain Services ([`@Injectable`](/reference/injectable/))** | Decorate with `@Injectable({ deps: [...] })` (and optional `OnInit`, `OnStart`, `OnStop`, `OnDestroy` hooks). | Listed in `@Workflow({ providers: [MyService] })` (or `@Application({ providers })` when shared by app-level guards/observers). | `override(MyService, FakeMyService)` or `mockOf(MyService, { method: vi.fn() })` in `testWith` and all 10 unit runners. |
| **Value Tokens (`InjectionToken<T>`)** | Create `const CONFIG = new InjectionToken<MyConfig>("CONFIG")` and bind with `provide(CONFIG, { ... })`. (Note: passing a class to `provide(Class, instance)` is rejected by `[di.instance-provider]`). | Listed in `@Workflow({ providers: [provide(CONFIG, value)] })`. | Pass `provide(CONFIG, testValue)` in `overrides`. |

---

## Built-in injectable framework contexts

Instead of calling `Date.now()`, `process.env`, or global singletons, AGBoss components inject framework contracts through `deps`:

- **`Clock` (`deps: [Clock]`):** Every timestamp and sleep (`this.clock.now()`, `await this.clock.sleep(seconds(30))`) goes through the application's `Clock`. Under `testWith`, the container provides a `VirtualClock` that advances instantly with `await clock.advance(seconds(30))`.
- **`ApplicationContext` (`deps: [ApplicationContext]`):** Provides `this.applicationContext.environment` (typed by your `AppEnvironment` contract), `environmentName`, and `instanceId`. Components always inject `ApplicationContext` rather than `AppEnvironment` directly.
- **`ExecutionContext` (`deps: [ExecutionContext]`):** Provides read-only access to the current step's frame (`executionId`, `rootExecutionId`, `parentExecutionId`, `depth`, `threadId`, `ownerId`, `tenant.tenantId`, `signal`, and `step.idempotencyKey`), isolated via `AsyncLocalStorage` across concurrent runs and parallel branches.
- **`TenantContext` (`deps: [MyTenantContext]`):** Subclass `TenantContext` to pass typed per-request tenant metadata (`plan`, `region`, `dailyBudgetUsd`) into tools, actions, and budgets.

---

## When the 4 container lifecycle hooks run

Every component the container creates can implement any combination of `OnInit`, `OnStart`, `OnStop`, and `OnDestroy`:

| Hook | When It Runs | Typical Use Case |
| :--- | :--- | :--- |
| `onInit()` | After the component's own `deps` have been created and completed their `onInit` | Opening database pools, preparing statements, warming caches (failing `onInit` aborts startup and runs `onDestroy` on already-initialized dependencies) |
| `onStart()` | After every component in the application has completed `onInit`, before `execute` | Starting background listeners, readiness checks, or startup audit logs |
| `onStop()` | When `app.close()` or `SIGTERM` arrives (new executions refused with `ApplicationStoppingError`, active ones draining up to `shutdownTimeout`) | Stopping intake queues and flushing pending operations |
| `onDestroy()` | After all running executions have finished, paused, or released their 30s leases to another instance | Closing database pools, sockets, and telemetry exporters |
