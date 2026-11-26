---
title: Component Decorators
description: "Overview of AGBoss and HarnessDSL decorators for applications, workflows, agents, routers, tools, actions, guardrails, interceptors, and A2A mesh endpoints."
---

In **AGBoss** (*Agent Graph Builder Open Source System*) and its declarative specification grammar **HarnessDSL**, every part of a multi-agent harness is organized as a decorated TypeScript class with a single, clear computational role ([Principle 1: Computational Role Segregation](/concepts/architecture/#1-computational-role-segregation)). Instead of mixing prompt templates, HTTP calls, branching logic, and safety filters inside monolithic functions, you declare dedicated classes and let `@Workflow` (`HarnessDSL`) and `@Application` wire and verify them at compile time via `agboss check`.

## What decorators does AGBoss provide?

| Decorator | Public Entry & File Convention | Role in the Application |
| :--- | :--- | :--- |
| [`@Application`](/reference/application/) | `agboss` (`*.application.ts`) | Single assembly root binding workflows, environment, `modelProvider` and `providers`, `storage`, budgets, PII, guardrails, health checks, and observers |
| [`@Workflow`](/reference/workflow/) | `agboss` (`*.workflow.ts`) | Typed state graph declaring `flow` paths, `historyTtl` (required), `executionLimits`, `memory`, and `defaults` |
| [`@WorkflowStart`](/reference/workflow-start/) / [`@WorkflowFinish`](/reference/workflow-finish/) | `agboss` (`*.workflow-start.ts` / `*.workflow-finish.ts`) | Entry (`input: Dto`) and exit (`output: Dto`, a pure boundary port) of a workflow |
| [`@Agent`](/reference/agent/) | `agboss` (`*.agent.ts` + `*.prompt.md`) | LLM reasoning node with `model`, `prompt` (a `PromptSource`: a file path, `inline(…)` or a list), `tools`, `rag`, `judges`, `input`, and `output` |
| [`@Action`](/reference/action/) | `agboss` (`*.action.ts`) | Deterministic TypeScript step (`ActionHandler`, `execute(input)` sync or async) for code-only workflow nodes |
| [`@Router`](/reference/router/) | `agboss` (`*.router.ts`) | Branching component (`DecidedBy.Model` or `DecidedBy.Code`) selecting one or more `routes`, continued with `.onRoute(…)` |
| [`@Arbiter`](/reference/arbiter/) / [`@Arbitrate`](/reference/arbiter/) | `agboss` (`*.arbiter.ts`) | Quorum consensus voter attached with `.arbitratedBy()` before `.joinQuorum()` |
| [`@Tool`](/reference/tool/) | `agboss` (`*.tool.ts`) | Agent-callable capability (`execute(input)`) with DTO schema validation; a tool that needs a person names a [`@ToolApproval`](/reference/pause-target/) |
| [`@ToolInterceptor`](/reference/tool-interceptor/) | `agboss` (`*.tool-interceptor.ts`) | Cross-cutting pre-call (`@BeforeTool` $\to$ `ToolCallDecision`) and post-call (`@AfterTool`) hooks, per tool or for every tool |
| [`@Judge`](/reference/judge/) | `agboss` (`*.judge.ts`) | Quality gate: a declarative model judge (`prompt` + `threshold`) or a code judge (`JudgeHandler<TReply>`) inspecting reply DTOs and `toolCalls` |
| [`@Memory`](/reference/memory/) | `agboss` (`*.memory.ts`) | What a workflow, an agent or a model router remembers of its thread: its window, its summaries and its `ttl` (replaces `@Compaction`) |
| [`@Injectable`](/reference/injectable/) | `agboss` (`*.service.ts`) | Injectable service with `OnInit`, `OnStart`, `OnStop`, `OnDestroy` hooks; `@Observer` for execution observers |
| [`@HealthCheck`](/reference/health-check/) | `agboss` (`*.health-check.ts`) | Liveness and readiness probe component (`checkLiveness()`, `checkReadiness()`) |
| [`@ModelProvider`](/reference/model-provider/) | `@agboss/core/models` (`*.model-provider.ts`) | One explicit provider: a `driver` (`OpenRouterDriver`, `OpenAiCompatibleDriver`, `DecisionsDriver`) or a transport class with `complete(request)`, plus `promptCaching`, `rateLimitPolicy`, `circuitBreakerPolicy`, `fallback` |
| [`@DatabaseStorage`](/concepts/application/) | `agboss` (`*.database-storage.ts`) | Where the rows go: a driver (`SqliteDriver`, the store packages'), `auditLogTtl`, `ledgerEntriesTtl`, and the keys; `@ClusterStorage` and `@ObjectStorage` beside it |
| [`@Budget`](/reference/budget/) | `agboss` (`*.budget.ts`) | Spend and token ceiling (`maxSpend`, `maxTokens`, or `BudgetHandler`) for `Application`, `Tenant`, or `Execution` scope |
| [`@PiiPolicy`](/reference/pii-policy/) | `agboss` (`*.pii-policy.ts`) | Declarative rules written on a kind or group (`PiiKind.Email.mask()`, `PiiKind.Phone.tokenize()`, `PiiGroup.….block(refusal)`) or a custom `findMatches(text)`, with a `secret` for the deterministic HMAC token |
| [`@InputGuardrail` & `@OutputGuardrail`](/reference/guardrail/) | `agboss` (`*.guardrail.ts`) | Input/output guardrails (a model guardrail with `prompt` and `threshold`, or a code guardrail with one `check(content)`) across `Application`, `Workflow`, and `Agent` scopes |
| [`@ToolApproval` / `@ExternalTask`](/reference/pause-target/) / [`@Channel`](/reference/channel/) / [`@ChannelInterpreter`](/reference/channel-interpreter/) | `agboss` (`*.tool-approval.ts`, `*.external-task.ts`, `*.channel.ts`) | A pause **target** (who may answer, what is asked, when it expires) and the **channel** that carries it (`send(ask)`, `onPauseClosed(event)`), with `@ChannelSelector` and `@ChannelListener` beside them |
| [`@Rag`](/reference/rag/) | `agboss` / `@agboss/core/rag` (`*.rag.ts`) | Knowledge base: a class extending `RagSource` (`SqliteFtsRagSource`) |
| [`@McpServer`](/reference/mcp/) / [`@McpEndpoint`](/reference/mcp-endpoint/) | `agboss` / `@agboss/core/mcp` (`*.mcp-server.ts`, `*.mcp-endpoint.ts`) | Model Context Protocol client servers (a `@Tool` lists one in `deps`) and the server contract your application exposes |
| [`@A2AAgent`](/reference/a2a-agent/) / `@A2AEndpoint` & `a2aHttpListener` | `agboss` / `@agboss/core/a2a` (`*.a2a-agent.ts`, `*.a2a-endpoint.ts`) | Remote Agent-to-Agent client (`A2AClient`), the typed A2A contract you serve (`skills`, `ttl`), an `@HttpAuthenticator` and the `a2aHttpListener` |
| [`@Text`, `@List`, `@Nested`, …](/reference/dto/) | `@agboss/core/dto` (`*.dto.ts`) | Field decorators on plain DTO classes compiled to JSON Schema and checked by `agboss check` |

## Naming & suffix invariant (`[name.kind-suffix]`)

Every component decorator enforces a dual naming rule (`[name.kind-suffix]`):
1. Its kebab-case `name` option must end with the component kind's suffix (for example, `"scout-agent"`, `"daily-budget"`, `"tenant-order-tool-interceptor"`, `"support-workflow-start"`).
2. Its PascalCase TypeScript class identifier must end with the corresponding suffix (`ScoutAgent`, `DailyBudget`, `TenantOrderToolInterceptor`, `SupportWorkflowStart`).

This guarantees that both humans and AI coding agents can tell a class's computational role at a glance in every import and `flow` chain.

## How DTO classes and explicit units work

In AGBoss, DTOs are plain TypeScript classes decorated with field decorators from `@agboss/core/dto` (`@Text`, `@Integer`, `@Float`, `@Bool`, `@Enum`, `@List`, `@Nested`). Runtime values returned from tools and actions are plain object literals `{ ... }` (never `new MyDto()`), and all currency and duration values use factory functions from `@agboss/core/units` (`usd()`, `seconds()`, `minutes()`, `hours()`):

```ts title="src/tools/lookup-order.tool.ts" file=src/tools/lookup-order.tool.ts
import { Budget, BudgetScope, ExecutionContext, Tool, type BudgetHandler, inline } from "@agboss/core";
import { Integer, Text } from "@agboss/core/dto";
import { usd, type Usd } from "@agboss/core/units";

export class OrderLookupInput {
  @Text({ prompt: "the order identifier to look up" })
  orderId!: string;
}

export class OrderSummaryOutput {
  @Text({ prompt: "current fulfillment status" })
  status!: string;

  @Integer({ prompt: "number of line items" })
  itemCount!: number;
}

@Budget({
  name: "order-execution-budget",
  scope: BudgetScope.Execution,
})
export class OrderExecutionBudget implements BudgetHandler {
  maxSpend(): Usd {
    return usd(0.1);
  }
}

@Tool({
  name: "lookup_order",
  description: "Looks up an order summary by ID",
  input: OrderLookupInput,
  output: OrderSummaryOutput,
  deps: [ExecutionContext],
})
export class LookupOrderTool {
  constructor(private readonly executionContext: ExecutionContext) {}

  execute({ orderId }: OrderLookupInput): Promise<OrderSummaryOutput> {
    this.executionContext.signal.throwIfAborted();
    return Promise.resolve({
      status: `shipped:${orderId}`,
      itemCount: 2,
    });
  }
}
```

```ts title="src/agents/order-assistant.agent.ts" file=src/agents/order-assistant.agent.ts
import { Agent, inline } from "@agboss/core";
import { LookupOrderTool } from "../tools/lookup-order.tool.js";

@Agent({
  name: "order-assistant-agent",
  description: "Looks up customer order status using LookupOrderTool",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Look up the order status before answering."),
  tools: [LookupOrderTool],
})
export class OrderAssistantAgent {}
```

```ts title="test/lookup-order.tool.test.ts" file=test/lookup-order.tool.test.ts
import { expect, it } from "vitest";
import { testUnit } from "@agboss/core/testing";
import { LookupOrderTool } from "../src/tools/lookup-order.tool.js";

it("executes LookupOrderTool in isolation without booting the workflow", async () => {
  const run = testUnit(LookupOrderTool);
  const res = await run({ orderId: "ord_104" });
  expect(res.output.status).toBe("shipped:ord_104");
});
```

## Where to explore individual decorators

- [Workflow HDSL (`@Workflow`)](/concepts/workflow/) for `HarnessDSL` path chains, `.onRoute(…)`, `.toOneOf([…])`, `.inParallel([…])`, and quorums.
- [Dependency Injection (`@Injectable`)](/concepts/dependency-injection/) for constructor injection, `ExecutionContext`, `Clock`, `Logger`, and lifecycle hooks.
- [Agent Reference](/reference/agent/), [Router Reference](/reference/router/), and [Tool Reference](/reference/tool/) for full decorator options.
