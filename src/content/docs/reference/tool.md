---
title: "@Tool & @BindTool"
description: Complete API reference for @Tool and @BindTool in AGBoss — ToolHandler<In, Out>, channel approvals, ExecutionContext, SpendRecorder, and testTool().
---

The `@Tool` class decorator (`tools/*.tool.ts`) defines a typed capability that an `@Agent` can invoke during its tool-calling loop, or that can be called directly via `app.tool(ToolClass).invoke(input)` or exposed over MCP via `@McpExpose`. Every `@Tool` declares its input and output DTO classes from `@agboss/core/dto` and implements `ToolHandler<In, Out>`. The companion `@BindTool` method decorator binds tool callbacks onto component methods.

## Complete `@Tool` example with all capabilities

```ts title="src/tools/refund-card-payment.tool.ts" file=src/tools/refund-card-payment.tool.ts
import { ExecutionContext, SpendRecorder, Tool, type ToolHandler } from "@agboss/core";
import { Integer, OneOf, Text } from "@agboss/core/dto";
import { kilobytes, seconds, usd } from "@agboss/core/units";
import { RefundApprovalChannel } from "../channels/refund-approval.channel.js";
import { PaymentsService } from "../services/payments.service.js";

export class RefundInputDto {
  @Text({ minLength: 1, prompt: "Order ID to refund, e.g. ORD-1042" })
  orderId!: string;

  @Integer({ min: 1, max: 500_000, prompt: "Refund amount in cents" })
  amountCents!: number;
}

export class RefundOutputDto {
  @OneOf({ values: ["refunded", "queued"], prompt: "Settlement status" })
  status!: "refunded" | "queued";

  @Text({ prompt: "Payment gateway refund reference ID" })
  refundId!: string;
}

@Tool({
  name: "refund_card_payment",
  description: "Issues a card refund for an order after channel approval",
  prompt: "Call this tool only after verifying the order ID and exact amount in cents.",
  input: RefundInputDto,
  output: RefundOutputDto,
  channel: RefundApprovalChannel,
  timeout: seconds(15),
  maxResultSize: kilobytes(64),
  deps: [ExecutionContext, SpendRecorder, PaymentsService],
})
export class RefundCardPaymentTool implements ToolHandler<RefundInputDto, RefundOutputDto> {
  constructor(
    private readonly executionContext: ExecutionContext,
    private readonly spendRecorder: SpendRecorder,
    private readonly paymentsService: PaymentsService,
  ) {}

  async run(input: RefundInputDto): Promise<RefundOutputDto> {
    const refundId = await this.paymentsService.refund({
      orderId: input.orderId,
      amountCents: input.amountCents,
      idempotencyKey: this.executionContext.step.idempotencyKey,
      signal: this.executionContext.signal,
    });
    this.spendRecorder.record({ service: "stripe-refund-fee", cost: usd(0.02) });
    return {
      status: "refunded",
      refundId,
    };
  }
}
```

```ts title="src/services/payments.service.ts" file=src/services/payments.service.ts
import { Injectable } from "@agboss/core";

@Injectable()
export class PaymentsService {
  refund(req: {
    orderId: string;
    amountCents: number;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<string> {
    return Promise.resolve(`re_${req.orderId}_${req.idempotencyKey.slice(0, 8)}`);
  }
}
```

```ts title="src/channels/refund-approval.channel.ts" file=src/channels/refund-approval.channel.ts
import { ChannelOf, ChannelRole, PauseAnswerer } from "@agboss/core";
import { RefundInputDto } from "../tools/refund-card-payment.tool.js";

@ChannelRole({
  name: "refund-approval-channel",
  description: "Requests human sign-off before executing high-value card refunds",
  approves: RefundInputDto,
  answeredBy: PauseAnswerer.Channel,
})
export abstract class RefundApprovalChannel
  extends ChannelOf<RefundApprovalChannel> {}
```

```ts title="src/agents/refund-specialist.agent.ts" file=src/agents/refund-specialist.agent.ts
import { Agent } from "@agboss/core";
import { RefundOutputDto, RefundCardPaymentTool } from "../tools/refund-card-payment.tool.js";

@Agent({
  name: "refund-specialist-agent",
  description: "Issues idempotent Stripe refunds via RefundCardPaymentTool",
  model: "moonshotai/kimi-k2.6",
  prompt: "Verify the order ID and call refund_card_payment when eligible.",
  tools: [RefundCardPaymentTool],
  output: RefundOutputDto,
  maxToolCalls: 2,
})
export class RefundSpecialistAgent {}
```

```ts title="test/refund-card-payment.tool.test.ts" file=test/refund-card-payment.tool.test.ts
import { expect, it } from "vitest";
import { override, testTool } from "@agboss/core/testing";
import { RefundCardPaymentTool } from "../src/tools/refund-card-payment.tool.js";
import { PaymentsService } from "../src/services/payments.service.js";

class FakePaymentsService extends PaymentsService {
  override refund(): Promise<string> {
    return Promise.resolve("re_test_1042");
  }
}

it("executes RefundCardPaymentTool with a fake PaymentsService", async () => {
  const runTool = testTool(RefundCardPaymentTool, {
    overrides: [override(PaymentsService, FakePaymentsService)],
  });

  const { output } = await runTool({
    orderId: "ORD-1042",
    amountCents: 49_00,
  });

  expect(output).toEqual({
    status: "refunded",
    refundId: "re_test_1042",
  });
});
```

## What options do `@Tool` and `@BindTool` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Snake_case or kebab-case tool name exposed to the model (`"refund_card"`). |
| `description` | `string` | Yes | Concise description telling the model what the tool does. |
| `input` | `DtoClass` | Yes | DTO class (`@agboss/core/dto`) validating the tool's input arguments and generating its JSON Schema. |
| `output` | `DtoClass` | Yes | DTO class validating the plain object returned by `run(input)`. |
| `deps` | `readonly Token[]` | No | Constructor dependencies (`ExecutionContext`, `SpendRecorder`, `@Injectable` services) verified against constructor parameters. |
| `prompt` / `promptUrls` | `string` / `readonly string[]` | No | Detailed usage instructions for the tool appended to the agent's tool guidance. |
| `channel` | `Class` | No | [`@ChannelRole`](/reference/channel-role/) or [`@Channel`](/reference/channel/) class that gates tool execution on human or external approval. |
| `toolInterceptors` | `readonly Class[]` | No | [`@ToolInterceptor`](/reference/tool-interceptor/) classes attached directly to this tool (`BeforeToolCall` / `AfterToolCall`). |
| `excludeToolInterceptors` | `readonly Class[]` | No | Inherited application, workflow, or agent `@ToolInterceptor` classes exempted for this tool. |
| `timeout` | `Milliseconds` | No | Per-call timeout (`seconds(15)`); defaults to `seconds(30)` and aborts `executionContext.signal` when exceeded. |
| `maxResultSize` | `Bytes` | No | Maximum UTF-8 result size (`kilobytes(256)`) shown to the model before truncation (`kilobytes(128)` by default). |

## What related entities work with `@Tool`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `ToolHandler<TInput, TOutput>` | `"@agboss/core"` | Contract implemented by `@Tool` and `@McpTool` classes (`run(input: TInput): Promise<TOutput>`). |
| `ExecutionContext` | `"@agboss/core"` | Injected via `deps: [ExecutionContext]`; provides `step.idempotencyKey`, `step.callId`, `signal`, `executionId`, and `ownerId`. |
| `SpendRecorder` | `"@agboss/core"` | Injected via `deps: [SpendRecorder]`; records external API spend (`spendRecorder.record({ service, cost })`) against `@Budget` limits. |
| `app.tool(ToolClass).invoke(input)` | `"@agboss/core"` | Executes a registered tool directly inside its own isolated execution context. |
| `testTool(ToolClass, options?)` | `"@agboss/core/testing"` | Isolated unit runner that executes `run(input)` with DI `overrides` and returns `{ output, spend }`. |
| `mockTool(ToolClass)` | `"@agboss/core/testing"` | Mocks or spies on a tool inside a `testWith(Application)` workflow test. |
