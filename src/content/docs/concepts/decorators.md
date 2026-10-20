---
title: Component Decorators
description: Overview of AGBoss decorators for applications, workflows, agents, actions, routers, arbiters, tools, DTOs, model providers, budgets, guardrails, and PII policies.
---

AGBoss organizes every part of a multi-agent system as a decorated TypeScript class with a single, clear responsibility. Instead of mixing prompt templates, HTTP calls, branching logic, and safety filters inside monolithic functions, you declare dedicated classes and let the `@Workflow` and `@Application` modules wire them together.

## What decorators does AGBoss provide?

| Decorator | Public Entry & File Convention | Role in the Application |
| :--- | :--- | :--- |
| [`@Application`](/reference/application/) | `agboss` (`*.application.ts`) | Single assembly root binding workflows, environment, providers, budgets, PII, and observers |
| [`@Workflow`](/reference/workflow/) | `agboss` (`*.workflow.ts`) | Typed state graph declaring `flow` paths, `defaults`, `guards`, and `providers` |
| [`@WorkflowStart`](/reference/workflow-start/) / [`@WorkflowFinish`](/reference/workflow-finish/) | `agboss` (`*.workflow-start.ts` / `*.workflow-finish.ts`) | Entry (`input: Dto`) and exit (`output: Dto` / `FinishHandler`) boundaries of a workflow |
| [`@Agent`](/reference/agent/) | `agboss` (`*.agent.ts` + `*.prompt.md`) | LLM reasoning node with `model`, `prompt`/`promptUrls`, `tools`, `rag`, `judges`, `input`, and `output` |
| [`@Action`](/reference/action/) | `agboss` (`*.action.ts`) | Deterministic TypeScript step (`ActionHandler`, `execute(input)`) for code-only workflow nodes |
| [`@Router`](/reference/router/) | `agboss` (`*.router.ts`) | Branching component (`DecidedBy.Model` or `DecidedBy.Code`) selecting one or more `routes` |
| [`@Arbiter`](/reference/arbiter/) / [`@OnAnswer`](/reference/on-answer/) | `agboss` (`*.arbiter.ts`) | Quorum consensus voter attached with `.acceptedBy()` before `.joinQuorum()` |
| [`@Tool`](/reference/tool/) / [`@BindTool`](/reference/bind-tool/) | `agboss` (`*.tool.ts`) | Agent-callable capability (`ToolHandler<In, Out>`, `run(input)`) with DTO schema validation |
| [`@Judge`](/reference/judge/) | `agboss` (`*.judge.ts`) | Quality gate (`JudgeHandler`, `judge({ reply, task, attempt })`) using `JudgeModel` (`decide` or `invoke`) |
| [`@Injectable`](/reference/injectable/) | `agboss` (`*.service.ts`) | Injectable service or `ExecutionObserver` with `OnInit`, `OnStart`, `OnStop`, `OnDestroy` hooks |
| [`@ModelProvider`](/reference/model-provider/) | `agboss/models` (`*.model-provider.ts`) | Model vendor pool (`-model-provider` suffix) with `serves`, `rateLimitPolicy`, and `circuitBreakerPolicy` |
| [`@Budget`](/reference/budget/) | `agboss` (`*.config.ts`) | Spend ceiling (`BudgetHandler`, `maxSpend(): Usd`) for `Application`, `Tenant`, or `Execution` scope |
| [`@PiiPolicy`](/reference/pii-policy/) | `agboss` (`*.pii-policy.ts`) | Declarative `rules: [pii(...)]` or custom `PiiPolicyHandler.findMatches(text)` (`-pii-policy` suffix) |
| [`@Guardrail`](/reference/guardrail/) | `agboss` (`*.guardrail.ts`) | Boundary hooks (`beforeToolCall`, `afterToolCall`, `onChannelDecision`, `beforeAgentAnswer`) |
| [`@ChannelRole`](/reference/channel-role/) / [`@Channel`](/reference/channel/) | `agboss` (`*.channel.ts`) | Out-of-process pause role (`approves` or `ask`/`answer`) and transport implementation (`send(ask)`) |
| [`@Rag`](/reference/rag/) | `agboss/rag` (`*.rag.ts`) | Knowledge base (`RagConnector`, `retrieve(query, { topK, signal })`) |
| [`@McpServer`](/reference/mcp/) / [`@McpTool`](/reference/mcp-tool/) / [`@McpExpose`](/reference/mcp-expose/) | `agboss/mcp` (`*.server.ts`, `*.mcp.ts`, `*.expose.ts`) | Model Context Protocol client servers, tools, and server exposure |
| [`@A2AAgent`](/reference/a2a-agent/) | `agboss/a2a` (`*.a2a.ts`) | Remote Agent-to-Agent protocol client (`extends A2AClient`) |
| [`@Text`, `@ListOf`, `@Nested`, …](/reference/dto/) | `agboss/dto` (`*.dto.ts`) | Field decorators on plain DTO classes compiled to JSON Schema and checked by `agboss check` |

## How DTO classes and explicit units work

In AGBoss, DTOs are plain TypeScript classes decorated with field decorators from `agboss/dto` (`@Text`, `@ListOf`, `@Integer`, `@Decimal`, `@Flag`). Runtime values returned from tools and actions are plain object literals `{ ... }` (never `new MyDto()`), and all currency and duration values use factory functions from `agboss/units` (`usd()`, `seconds()`, `minutes()`):

```ts title="src/tools/lookup-order.tool.ts"
import { Budget, BudgetScope, ExecutionContext, Tool, type BudgetHandler, type ToolHandler } from "agboss";
import { Integer, Text } from "agboss/dto";
import { usd, type Usd } from "agboss/units";

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

```ts title="src/agents/order-assistant.agent.ts" no-check: context tab
import { Agent } from "agboss";
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

```ts title="test/lookup-order.tool.test.ts" no-check: context tab
import { expect, it } from "vitest";
import { testTool } from "agboss/testing";
import { LookupOrderTool } from "../src/tools/lookup-order.tool.js";

it("executes LookupOrderTool in isolation without booting the workflow", async () => {
  const res = await testTool(LookupOrderTool, { orderId: "ord_104" });
  expect(res.output.status).toBe("shipped:ord_104");
});
```

## Where to explore individual decorators

- [Workflow DSL (`@Workflow`)](/concepts/workflow/) for path chains, `.switch(caseOf())`, `.chooseOne(route())`, parallel launches, and quorums.
- [Dependency Injection (`@Injectable`)](/concepts/dependency-injection/) for constructor injection, `ExecutionContext`, `Clock`, `Logger`, and lifecycle hooks.
- [Agent Reference](/reference/agent/), [Router Reference](/reference/router/), and [Tool Reference](/reference/tool/) for full decorator options.
