---
title: Component Decorators
description: "Overview of AGBoss and HarnessDSL decorators for applications, workflows, agents, routers, tools, actions, guardrails, interceptors, and A2A mesh endpoints."
---

In **AGBoss** (*Agent Graph Builder Open Source System*) and its declarative specification grammar **HarnessDSL**, every part of a multi-agent harness is organized as a decorated TypeScript class with a single, clear computational role ([Principle 1: Computational Role Segregation](/concepts/architecture/#1-computational-role-segregation)). Instead of mixing prompt templates, HTTP calls, branching logic, and safety filters inside monolithic functions, you declare dedicated classes and let `@Workflow` (`HarnessDSL`) and `@Application` wire and verify them at compile time via `agboss check`.

## What decorators does AGBoss provide?

| Decorator | Public Entry & File Convention | Role in the Application |
| :--- | :--- | :--- |
| [`@Application`](/reference/application/) | `agboss` (`*.application.ts`) | Single assembly root binding workflows, environment, providers, budgets, PII, guardrails, health checks, and observers |
| [`@Workflow`](/reference/workflow/) | `agboss` (`*.workflow.ts`) | Typed state graph declaring `flow` paths, `defaults`, `compaction`, and `maxSteps` |
| [`@WorkflowStart`](/reference/workflow-start/) / [`@WorkflowFinish`](/reference/workflow-finish/) | `agboss` (`*.workflow-start.ts` / `*.workflow-finish.ts`) | Entry (`input: Dto`) and exit (`output: Dto` / `FinishHandler`) boundaries of a workflow |
| [`@Agent`](/reference/agent/) | `agboss` (`*.agent.ts` + `*.prompt.md`) | LLM reasoning node with `model`, `prompt`/`promptUrls`, `tools`, `rag`, `judges`, `input`, and `output` |
| [`@Action`](/reference/action/) | `agboss` (`*.action.ts`) | Deterministic TypeScript step (`ActionHandler`, `execute(input)`) for code-only workflow nodes |
| [`@Router`](/reference/router/) | `agboss` (`*.router.ts`) | Branching component (`DecidedBy.Model` or `DecidedBy.Code`) selecting one or more `routes` |
| [`@Arbiter`](/reference/arbiter/) / [`@OnAnswer`](/reference/on-answer/) | `agboss` (`*.arbiter.ts`) | Quorum consensus voter attached with `.acceptedBy()` before `.joinQuorum()` |
| [`@Tool`](/reference/tool/) / [`@BindTool`](/reference/bind-tool/) | `agboss` (`*.tool.ts`) | Agent-callable capability (`ToolHandler<In, Out>`, `run(input)`) with DTO schema validation |
| [`@ToolInterceptor`](/reference/tool-interceptor/) | `agboss` (`*.tool-interceptor.ts`) | Cross-cutting pre-call (`BeforeToolCall` $\to$ `ToolCallDecision`) and post-call (`AfterToolCall`) interceptor for `@Tool` and `@McpTool` |
| [`@Judge`](/reference/judge/) | `agboss` (`*.judge.ts`) | Quality gate (`JudgeHandler<TReply>`, `DecidedBy.Model` or `DecidedBy.Code`) inspecting reply DTOs and `toolCalls` |
| [`@Compaction`](/reference/compaction/) | `agboss` (`*.compaction.ts`) | Conversation history compaction strategy (`SummaryQueue`, `SingleSummary`, `Custom` with `CompactionHandler`, or `None`) |
| [`@Injectable`](/reference/injectable/) | `agboss` (`*.service.ts`) | Injectable service or `ExecutionObserver` with `OnInit`, `OnStart`, `OnStop`, `OnDestroy` hooks |
| [`@HealthCheck`](/reference/health-check/) | `agboss` (`*.health-check.ts`) | Liveness and readiness probe component (`HealthCheckHandler`, `checkLiveness()`, `checkReadiness()`) |
| [`@ModelProvider`](/reference/model-provider/) | `@agboss/core/models` (`*.model-provider.ts`) | Model vendor pool (`-model-provider` suffix) with HTTP or custom `ModelProviderHandler` transport, `serves`, `promptCaching`, `rateLimitPolicy`, and `circuitBreakerPolicy` |
| [`@Budget`](/reference/budget/) | `agboss` (`*.config.ts`) | Spend ceiling (`BudgetHandler`, `maxSpend(): Usd`) for `Application`, `Tenant`, or `Execution` scope |
| [`@PiiPolicy`](/reference/pii-policy/) | `agboss` (`*.pii-policy.ts`) | Declarative `rules: [pii(...)]` or custom `PiiPolicyHandler.findMatches(text)` with deterministic HMAC `replaceWithToken()` |
| [`@InputGuardrail` & `@OutputGuardrail`](/reference/guardrail/) | `agboss` (`*.guardrail.ts`) | Input/output guardrails (`DecidedBy.Model` with `threshold` or `DecidedBy.Code` with `GuardrailHandler`) across `Application`, `Workflow`, and `Agent` scopes |
| [`@ChannelRole`](/reference/channel-role/) / [`@Channel`](/reference/channel/) / [`@ReplyInterpreter`](/reference/reply-interpreter/) | `agboss` (`*.channel.ts`) | Out-of-process pause role (`approves`), free-text `@ReplyInterpreter`, and transport implementation (`send(ask)`, `withdraw(info)`) |
| [`@Rag`](/reference/rag/) | `agboss` / `@agboss/core/rag` (`*.rag.ts`) | Knowledge base (`RagConnector`, `SqliteFtsConnector`) |
| [`@McpServer`](/reference/mcp/) / [`@McpTool`](/reference/mcp-tool/) / [`@McpExpose`](/reference/mcp-expose/) | `agboss` / `@agboss/core/mcp` (`*.mcp.ts`) | Model Context Protocol client servers, typed tools, and server exposure |
| [`@A2AAgent` & `a2aHttpListener`](/reference/a2a-agent/) | `agboss` / `@agboss/core/a2a` (`*.a2a.ts`) | Remote Agent-to-Agent protocol client (`A2AClient`), `@Injectable()` `A2ACallerResolver`, and multi-tenant `a2aHttpListener` |
| [`@Text`, `@ListOf`, `@Nested`, …](/reference/dto/) | `@agboss/core/dto` (`*.dto.ts`) | Field decorators on plain DTO classes compiled to JSON Schema and checked by `agboss check` |

## Naming & suffix invariant (`[name.kind-suffix]`)

Every component decorator enforces a dual naming rule (`[name.kind-suffix]`):
1. Its kebab-case `name` option must end with the component kind's suffix (for example, `"scout-agent"`, `"daily-budget"`, `"tenant-order-tool-interceptor"`, `"support-workflow-start"`).
2. Its PascalCase TypeScript class identifier must end with the corresponding suffix (`ScoutAgent`, `DailyBudget`, `TenantOrderToolInterceptor`, `SupportWorkflowStart`).

This guarantees that both humans and AI coding agents can tell a class's computational role at a glance in every import and `flow` chain.

## How DTO classes and explicit units work

In AGBoss, DTOs are plain TypeScript classes decorated with field decorators from `@agboss/core/dto` (`@Text`, `@ListOf`, `@Integer`, `@Decimal`, `@Flag`). Runtime values returned from tools and actions are plain object literals `{ ... }` (never `new MyDto()`), and all currency and duration values use factory functions from `@agboss/core/units` (`usd()`, `seconds()`, `minutes()`, `hours()`):

```ts title="src/tools/lookup-order.tool.ts" file=src/tools/lookup-order.tool.ts
import { Budget, BudgetScope, ExecutionContext, Tool, type BudgetHandler, type ToolHandler } from "@agboss/core";
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
export class LookupOrderTool
  implements ToolHandler<OrderLookupInput, OrderSummaryOutput>
{
  constructor(private readonly executionContext: ExecutionContext) {}

  run({ orderId }: OrderLookupInput): Promise<OrderSummaryOutput> {
    this.executionContext.signal.throwIfAborted();
    return Promise.resolve({
      status: `shipped:${orderId}`,
      itemCount: 2,
    });
  }
}
```

```ts title="src/agents/order-assistant.agent.ts" file=src/agents/order-assistant.agent.ts
import { Agent } from "@agboss/core";
import { LookupOrderTool } from "../tools/lookup-order.tool.js";

@Agent({
  name: "order-assistant-agent",
  description: "Looks up customer order status using LookupOrderTool",
  model: "moonshotai/kimi-k2.6",
  prompt: "Look up the order status before answering.",
  tools: [LookupOrderTool],
})
export class OrderAssistantAgent {}
```

```ts title="test/lookup-order.tool.test.ts" file=test/lookup-order.tool.test.ts
import { expect, it } from "vitest";
import { testTool } from "@agboss/core/testing";
import { LookupOrderTool } from "../src/tools/lookup-order.tool.js";

it("executes LookupOrderTool in isolation without booting the workflow", async () => {
  const run = testTool(LookupOrderTool);
  const res = await run({ orderId: "ord_104" });
  expect(res.output.status).toBe("shipped:ord_104");
});
```

## Where to explore individual decorators

- [Workflow HDSL (`@Workflow`)](/concepts/workflow/) for `HarnessDSL` path chains, `.switch(caseOf())`, `.chooseOne(route())`, parallel launches, and quorums.
- [Dependency Injection (`@Injectable`)](/concepts/dependency-injection/) for constructor injection, `ExecutionContext`, `Clock`, `Logger`, and lifecycle hooks.
- [Agent Reference](/reference/agent/), [Router Reference](/reference/router/), and [Tool Reference](/reference/tool/) for full decorator options.
