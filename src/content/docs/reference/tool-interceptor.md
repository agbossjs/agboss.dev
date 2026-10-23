---
title: "@ToolInterceptor"
description: Complete API reference for @ToolInterceptor, BeforeToolCall, AfterToolCall, ToolCallDecision, and testToolInterceptor() in AGBoss — cross-cutting authorization, self-correcting model feedback, and post-call redaction for @Tool and @McpTool.
---

`@ToolInterceptor` (`"agboss"`) declares a reusable pre-call and/or post-call interceptor around [`@Tool`](/reference/tool/) and [`@McpTool`](/reference/mcp-tool/) invocations. While [`@InputGuardrail` and `@OutputGuardrail`](/reference/guardrail/) guard the outer text boundary of an `@Agent` or `@Router`, `@ToolInterceptor` guards every individual tool call inside the agent's tool loop (`app.execute` / `app.stream`) as well as direct `app.tool(ToolClass).invoke(input)` calls.

A `@ToolInterceptor` class implements `BeforeToolCall`, `AfterToolCall`, or both (`[tool-interceptor.missing-handler]` if neither is implemented), and cascades across `@Application` $\to$ `@Workflow` $\to$ `@Agent` $\to$ `@Tool` / `@McpTool` via `toolInterceptors: [...]` and `excludeToolInterceptors: [...]`.

## Complete `@ToolInterceptor` example

<!--
```ts file=src/interceptors/tool-interceptor-ambient.d.ts
import type { Class } from "agboss";

declare module "agboss" {
  export interface ToolCallContext<TInput = unknown> {
    readonly tool: Class;
    readonly toolName: string;
    readonly callId: string;
    readonly input: Readonly<TInput>;
  }

  export interface ToolCallResultContext<TInput = unknown, TOutput = unknown>
    extends ToolCallContext<TInput> {
    readonly output: TOutput;
  }

  export class ToolCallDecision {
    readonly kind!: "allow" | "replyToModel" | "block";
    readonly message?: string;
    readonly reason?: string;
    static allow(): ToolCallDecision;
    static replyToModel(options: { message: string }): ToolCallDecision;
    static block(options: { reason: string }): ToolCallDecision;
  }

  export interface BeforeToolCall<TInput = unknown> {
    beforeToolCall(call: ToolCallContext<TInput>): Promise<ToolCallDecision> | ToolCallDecision;
  }

  export interface AfterToolCall<TInput = unknown, TOutput = unknown> {
    afterToolCall(call: ToolCallResultContext<TInput, TOutput>): Promise<TOutput> | TOutput;
  }

  export interface ToolInterceptorOptions {
    readonly name: string;
    readonly description: string;
    readonly deps?: readonly unknown[];
  }

  export function ToolInterceptor(options: ToolInterceptorOptions): ClassDecorator;
}

declare module "agboss/testing" {
  import type { ToolCallDecision } from "agboss";
  export interface TestToolInterceptorRunner {
    before(call: { tool: unknown; input: unknown; callId?: string }): Promise<ToolCallDecision>;
    after<TOutput = unknown>(call: {
      tool: unknown;
      input: unknown;
      output: TOutput;
      callId?: string;
    }): Promise<TOutput>;
  }
  export function testToolInterceptor(
    interceptor: unknown,
    options?: {
      tenantContext?: readonly [unknown, Record<string, unknown>];
      executionContext?: readonly [unknown, Record<string, unknown>];
      providers?: readonly unknown[];
      overrides?: readonly unknown[];
    },
  ): TestToolInterceptorRunner;
}
```
-->
```ts title="src/interceptors/tenant-order.tool-interceptor.ts" file=src/interceptors/tenant-order.tool-interceptor.ts
import {
  Injectable,
  TenantContext,
  Tool,
  ToolCallDecision,
  ToolInterceptor,
  type AfterToolCall,
  type BeforeToolCall,
  type ToolCallContext,
  type ToolCallResultContext,
  type ToolHandler,
} from "agboss";
import { Integer, Text } from "agboss/dto";

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
  name: "get_order",
  description: "Loads an order record by ID",
  input: OrderInputDto,
  output: OrderRecordDto,
})
export class GetOrderTool implements ToolHandler<OrderInputDto, OrderRecordDto> {
  run(input: OrderInputDto): Promise<OrderRecordDto> {
    return Promise.resolve({
      orderId: input.orderId,
      amountCents: 12_500,
      internalNote: "VIP margin tier A",
    });
  }
}

@ToolInterceptor({
  name: "tenant-order-tool-interceptor",
  description: "Verifies order ownership before running a tool and strips internal notes after",
  deps: [TenantContext, OrderAclService],
})
export class TenantOrderToolInterceptor
  implements BeforeToolCall<OrderInputDto>, AfterToolCall<OrderInputDto, OrderRecordDto>
{
  constructor(
    private readonly tenantContext: TenantContext,
    private readonly orderAcl: OrderAclService,
  ) {}

  async beforeToolCall(call: ToolCallContext<OrderInputDto>): Promise<ToolCallDecision> {
    const allowed = await this.orderAcl.belongsToTenant(
      this.tenantContext.tenantId,
      call.input.orderId,
    );
    if (!allowed) {
      return ToolCallDecision.replyToModel({
        message: `Order ${call.input.orderId} does not belong to tenant ${this.tenantContext.tenantId}. Ask the user to confirm their order ID.`,
      });
    }
    return ToolCallDecision.allow();
  }

  afterToolCall(call: ToolCallResultContext<OrderInputDto, OrderRecordDto>): OrderRecordDto {
    return {
      ...call.output,
      internalNote: "[REDACTED]",
    };
  }
}
```

```ts title="test/tenant-order.tool-interceptor.test.ts" file=test/tenant-order.tool-interceptor.test.ts
import { expect, it } from "vitest";
import { TenantContext } from "agboss";
import { testToolInterceptor } from "agboss/testing";
import {
  GetOrderTool,
  OrderAclService,
  TenantOrderToolInterceptor,
} from "../src/interceptors/tenant-order.tool-interceptor.js";

it("replies to the model when an order belongs to another tenant and scrubs internalNote on allow", async () => {
  const interceptor = testToolInterceptor(TenantOrderToolInterceptor, {
    tenantContext: [TenantContext, { id: "acme" }],
    providers: [OrderAclService],
  });

  const denied = await interceptor.before({
    tool: GetOrderTool,
    input: { orderId: "OTHER-99" },
  });
  expect(denied.kind).toBe("replyToModel");
  expect(denied.message).toContain("does not belong to tenant acme");

  const allowed = await interceptor.before({
    tool: GetOrderTool,
    input: { orderId: "ACME-42" },
  });
  expect(allowed.kind).toBe("allow");

  const redacted = await interceptor.after({
    tool: GetOrderTool,
    input: { orderId: "ACME-42" },
    output: { orderId: "ACME-42", amountCents: 12_500, internalNote: "VIP margin tier A" },
  });
  expect(redacted.internalNote).toBe("[REDACTED]");
});
```

## `@ToolInterceptor` options & handler interfaces

| Option / Interface | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | **Yes** | Unique kebab-case identifier ending with `-tool-interceptor`; the class name must end with `ToolInterceptor` (`[name.kind-suffix]`). |
| `description` | `string` | **Yes** | Non-empty summary of the interceptor's responsibility. |
| `deps` | `readonly Token[]` | No | Constructor dependencies (`TenantContext`, `ExecutionContext`, `@Injectable()` services) injected per invocation. |
| `BeforeToolCall` | `beforeToolCall(call: ToolCallContext)` | At least one of `BeforeToolCall` or `AfterToolCall` (`[tool-interceptor.missing-handler]`) | Inspects `{ tool, toolName, callId, input }` after DTO validation and returns a `ToolCallDecision`. |
| `AfterToolCall` | `afterToolCall(call: ToolCallResultContext)` | At least one of `BeforeToolCall` or `AfterToolCall` | Inspects `{ tool, toolName, callId, input, output }` after `tool.run(input)` and returns the (optionally transformed) output validated against the tool's `output` DTO before `maxResultSize` truncation and PII masking. |

## `ToolCallDecision` outcomes

| Factory Method | Runtime Behavior |
| :--- | :--- |
| `ToolCallDecision.allow()` | Proceeds to the next `BeforeToolCall` interceptor (or `tool.run(input)` once all interceptors allow). |
| `ToolCallDecision.replyToModel({ message })` | **Self-correcting tool feedback:** `tool.run()` and `channel` approval do **not** execute; inside an `@Agent` loop, `message` is returned to the model as the tool call's observation so the agent can self-correct its arguments. On direct `app.tool(T).invoke()`, throws `ToolBlockedError`. |
| `ToolCallDecision.block({ reason })` | **Hard abort:** `tool.run()` does **not** execute and the step fails immediately with `ToolBlockedError` (a subclass of `StepFailedError`, catchable by `.onError()` in workflow flows). |

## Cascading hierarchy & execution order

Interceptors attach via `toolInterceptors: [...]` on [`@Application`](/reference/application/), [`@Workflow`](/reference/workflow/), [`@Agent`](/reference/agent/), [`@Tool`](/reference/tool/), and [`@McpTool`](/reference/mcp-tool/), and can be opted out at any inner scope via `excludeToolInterceptors: [...]`:

1. **`beforeToolCall` runs outer-to-inner:** `@Application` $\to$ `@Workflow` $\to$ `@Agent` $\to$ `@Tool` / `@McpTool`, **before** any human approval `@Channel` on the tool is triggered (so unauthorized or malformed calls never wake a human reviewer).
2. **`afterToolCall` runs inner-to-outer (onion order):** `@Tool` / `@McpTool` $\to$ `@Agent` $\to$ `@Workflow` $\to$ `@Application`, before output DTO re-validation, `maxResultSize` truncation, and `@PiiPolicy` masking.
