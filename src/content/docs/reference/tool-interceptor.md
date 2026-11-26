---
title: "@ToolInterceptor"
description: Complete API reference for @ToolInterceptor, @BeforeTool, @AfterTool, ToolCallDecision, and testUnit() for @Tool calls in AGBoss.
---

`@ToolInterceptor` (`"@agboss/core"`) declares a reusable pre-call and/or post-call interceptor around [`@Tool`](/reference/tool/) invocations. While [`@InputGuardrail` and `@OutputGuardrail`](/reference/guardrail/) guard the outer text boundary of an `@Agent` or `@Router`, `@ToolInterceptor` guards every individual tool call inside the agent's tool loop.

A `@ToolInterceptor` class decides **per tool**: it has `@BeforeTool(Tool)` and `@AfterTool(Tool)` methods (one tool, or several in one decorator: `@BeforeTool(A, B)`), and/or the plain `beforeAnyTool(call)` and `afterAnyTool(call)` methods for every tool (`[tool-interceptor.missing-handler]` if it has none). The 0.1.0 `BeforeToolCall` / `AfterToolCall` interfaces with `beforeToolCall` / `afterToolCall` are gone (a misspelt or 0.1.0 hook name is `[tool-interceptor.unknown-hook]`). It cascades across `@Application` $\to$ `@Workflow` $\to$ `@Agent` $\to$ `@Tool` via `toolInterceptors: [...]` and `excludeToolInterceptors: [...]`, and **fails closed**: a call of a tool that resolves to no `@Tool` class still meets the catch-all `beforeAnyTool` / `afterAnyTool`.

## Complete `@ToolInterceptor` example

```ts title="src/interceptors/tenant-order.tool-interceptor.ts" file=src/interceptors/tenant-order.tool-interceptor.ts
import {
  AfterTool,
  BeforeTool,
  Injectable,
  TenantContext,
  Tool,
  ToolCallDecision,
  ToolInterceptor,
} from "@agboss/core";
import { Integer, Text } from "@agboss/core/dto";

export class OrderInputDto {
  @Text({ prompt: "Order ID to inspect or refund" })
  orderId!: string;
}

export class OrderRecordDto {
  @Text({ prompt: "Order ID" })
  orderId!: string;

  @Integer({ prompt: "Total in cents" })
  amountCents!: number;

  @Text({ prompt: "Internal merchant notes" })
  internalNote!: string;
}

@Injectable()
export class OrderAclService {
  belongsToTenant(tenantId: string, orderId: string): Promise<boolean> {
    return Promise.resolve(orderId.startsWith(`${tenantId.toUpperCase()}-`));
  }
}

@Tool({
  name: "get-order-tool",
  description: "Loads an order record by ID",
  input: OrderInputDto,
  output: OrderRecordDto,
})
export class GetOrderTool {
  execute(input: OrderInputDto): OrderRecordDto {
    return {
      orderId: input.orderId,
      amountCents: 12_500,
      internalNote: "VIP margin tier A",
    };
  }
}

@ToolInterceptor({
  name: "tenant-order-tool-interceptor", // optional: the class name in kebab-case by default
  description: "Verifies order ownership before running a tool and strips internal notes after",
  deps: [TenantContext, OrderAclService],
})
export class TenantOrderToolInterceptor {
  constructor(
    private readonly tenantContext: TenantContext,
    private readonly orderAcl: OrderAclService,
  ) {}

  // takes the validated input DTO of the tool it names
  @BeforeTool(GetOrderTool)
  async checkOwnership(input: OrderInputDto): Promise<ToolCallDecision> {
    const allowed = await this.orderAcl.belongsToTenant(this.tenantContext.tenantId, input.orderId);
    if (!allowed) {
      return ToolCallDecision.reply(
        `Order ${input.orderId} does not belong to tenant ${this.tenantContext.tenantId}. Ask the user to confirm their order ID.`,
      );
    }
    return ToolCallDecision.allow();
  }

  // takes the output and the input; what it returns replaces the result the model reads
  @AfterTool(GetOrderTool)
  stripNotes(output: OrderRecordDto): OrderRecordDto {
    return {
      ...output,
      internalNote: "[REDACTED]",
    };
  }
}
```

```ts title="test/tenant-order.tool-interceptor.test.ts" file=test/tenant-order.tool-interceptor.test.ts
import { expect, it } from "vitest";
import { ToolCallDecision } from "@agboss/core";
import { testUnit } from "@agboss/core/testing";
import {
  GetOrderTool,
  TenantOrderToolInterceptor,
} from "../src/interceptors/tenant-order.tool-interceptor.js";

it("replies to the model when an order belongs to another tenant and scrubs internalNote on allow", async () => {
  const interceptor = testUnit(TenantOrderToolInterceptor, {
    tenant: { tenantId: "acme" },
  });

  const { output: denied } = await interceptor.beforeToolCall(GetOrderTool, {
    orderId: "OTHER-99",
  });
  expect(denied).toEqual(
    ToolCallDecision.reply(
      "Order OTHER-99 does not belong to tenant acme. Ask the user to confirm their order ID.",
    ),
  );

  const { output: allowed } = await interceptor.beforeToolCall(GetOrderTool, {
    orderId: "ACME-42",
  });
  expect(allowed).toEqual(ToolCallDecision.allow());

  const { output: redacted } = await interceptor.afterToolCall(
    GetOrderTool,
    { orderId: "ACME-42" },
    { orderId: "ACME-42", amountCents: 12_500, internalNote: "VIP margin tier A" },
  );
  expect(redacted.internalNote).toBe("[REDACTED]");
});
```

## `@ToolInterceptor` options & hooks

| Option / Hook | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | No | Kebab-case identifier; the class name in kebab-case by default (`[name.kind-suffix]` is no longer raised for it). `@ToolInterceptor()` with no options is allowed. |
| `description` | `string` | No | Summary of the interceptor's responsibility. |
| `deps` | `readonly Token[]` | No | Constructor dependencies (`TenantContext`, `ExecutionContext`, `@Injectable()` services). |
| `@BeforeTool(Tool, …)` | method decorator | At least one hook (`[tool-interceptor.missing-handler]`) | The method takes the validated input DTO of the named tool (the union of the inputs for several) and returns a `ToolCallDecision`. A target that is no tool is `[tool-interceptor.target-not-a-tool]`, two methods for one tool and phase `[tool-interceptor.duplicate-hook]`. |
| `@AfterTool(Tool, …)` | method decorator | At least one hook | The method takes the tool's output (and its input) after a successful call and returns the output the model reads, validated against the tool's `output` DTO before `maxResultSize` truncation and PII masking. |
| `beforeAnyTool(call)` | method | At least one hook | Runs before every tool call, before the tool's own `@BeforeTool`; `call` is a `ToolCallContext` (`tool`, `agent`, `callId`, `input`); `ToolCall.typeOf(call)` gives the tool class. |
| `afterAnyTool(call)` | method | At least one hook | Runs after every successful call, after the tool's own `@AfterTool`; `call` is a `ToolCallResultContext` with the `output`. |

## `ToolCallDecision` outcomes

| Factory Method | Runtime Behavior |
| :--- | :--- |
| `ToolCallDecision.allow()` | Proceeds to the next before hook (or the tool once all interceptors allow). |
| `ToolCallDecision.allow({ input })` | The same, with those arguments (validated against the tool's input DTO again) for the next hooks, the approval and the tool; a rewrite that is no input of the tool or holds a blocked value never runs. |
| `ToolCallDecision.reply(message)` | **Self-correcting tool feedback:** the tool and its `@ToolApproval` do **not** run; `message` is returned to the model as the tool call's observation so the agent can self-correct its arguments (`replyToModel({ message })` of 0.1.0). |
| `ToolCallDecision.block(reason)` | **Hard abort:** the tool does **not** run and the agent's step fails immediately with `StepError.ToolBlocked` (`step.tool-blocked`, a subclass of `StepError`, catchable by `.onError(StepError.ToolBlocked, …)` after the agent). |

## How the cascading interceptor hierarchy works

Interceptors attach via `toolInterceptors: [...]` on [`@Application`](/reference/application/), [`@Workflow`](/reference/workflow/), [`@Agent`](/reference/agent/) and [`@Tool`](/reference/tool/), and can be opted out at any inner scope via `excludeToolInterceptors: [...]`:

1. **Before hooks run outer-to-inner:** `@Application` $\to$ `@Workflow` $\to$ `@Agent` $\to$ `@Tool`, and **before any human approval** on the tool: a call is checked against the tool's input, then searched by the PII policies, then given to the hooks — all before the `@ToolApproval` pause, so unauthorized or malformed calls never wake a human reviewer. The approver sees the arguments as the hooks left them, masked.
2. **After hooks run inner-to-outer (onion order):** `@Tool` $\to$ `@Agent` $\to$ `@Workflow` $\to$ `@Application`, the tool's `@AfterTool` before `afterAnyTool`, before output DTO re-validation, `maxResultSize` truncation, and `@PiiPolicy` masking.
3. **An interceptor that throws,** returns no `ToolCallDecision`, or returns an output its tool does not give fails the step with `StepError.Agent` (the error as its `cause`).
4. **Only the project's own `@Tool` calls are intercepted** — never an answer tool or a knowledge base's search tool.
