---
title: "@Tool & @BindTool"
description: Complete API reference for @Tool and @BindTool in AGBoss — ToolHandler<In, Out>, channel approvals, ExecutionContext, SpendRecorder, and testTool().
---

The `@Tool` class decorator (`tools/*.tool.ts`) defines a typed capability that an `@Agent` can invoke during its tool-calling loop, or that can be called directly via `app.tool(ToolClass).invoke(input)` or exposed over MCP via `@McpExpose`. Every `@Tool` declares its input and output DTO classes from `agboss/dto` and implements `ToolHandler<In, Out>`. The companion `@BindTool` method decorator binds tool callbacks onto component methods.

## What options do `@Tool` and `@BindTool` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Snake_case or kebab-case tool name exposed to the model (`"refund_card"`). |
| `description` | `string` | Yes | Concise description telling the model what the tool does. |
| `input` | `DtoClass` | Yes | DTO class (`agboss/dto`) validating the tool's input arguments and generating its JSON Schema. |
| `output` | `DtoClass` | Yes | DTO class validating the plain object returned by `run(input)`. |
| `deps` | `readonly Token[]` | No | Constructor dependencies (`ExecutionContext`, `SpendRecorder`, `@Injectable` services) verified against constructor parameters. |
| `prompt` / `promptUrls` | `string` / `readonly string[]` | No | Detailed usage instructions for the tool appended to the agent's tool guidance. |
| `channel` | `Class` | No | `@ChannelRole` or `@Channel` class that gates tool execution on human or external approval. |
| `timeoutMs` | `number` | No | Per-call timeout in milliseconds (`30_000` by default); aborts `executionContext.signal` when exceeded. |
| `guardrails` | `readonly Class<Guardrail>[]` | No | `@Guardrail` classes running `beforeToolCall` and `afterToolCall` on this tool. |
| `overrideGuardrails` | `readonly Class<Guardrail>[]` | No | Replaces inherited workflow/agent guardrails for this specific tool. |
| `disableGuardrails` | `readonly Class<Guardrail>[]` | No | Exempts this tool from specific inherited `@Guardrail` classes. |

## Complete `@Tool` example with all capabilities

```ts title="src/tools/refund-card-payment.tool.ts" no-check: reference example
import { ExecutionContext, SpendRecorder, Tool, type ToolHandler } from "agboss";
import { Integer, OneOf, Text } from "agboss/dto";
import { seconds, usd } from "agboss/units";
import { RefundApprovalChannel } from "../channels/refund-approval.channel.js";
import { HighValueRefundGuardrail } from "../guardrails/high-value-refund.guardrail.js";
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
  timeoutMs: seconds(15),
  guardrails: [HighValueRefundGuardrail],
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

```ts title="src/services/payments.service.ts" no-check: reference example
import { Injectable } from "agboss";

@Injectable()
export class PaymentsService {
  async refund(
    req: { chargeId: string; amountCents: number; reason: string },
    opts: { idempotencyKey: string; signal: AbortSignal },
  ): Promise<{ refundId: string }> {
    return { refundId: `re_${req.chargeId}_${opts.idempotencyKey.slice(0, 8)}` };
  }
}
```

```ts title="src/agents/refund-specialist.agent.ts" no-check: reference example
import { Agent } from "agboss";
import { RefundCardPaymentTool } from "../tools/refund-card-payment.tool.js";

@Agent({
  name: "refund-specialist-agent",
  description: "Issues idempotent Stripe refunds via RefundCardPaymentTool",
  model: "moonshotai/kimi-k2.6",
  prompt: "Verify the charge ID and call refund_card_payment when eligible.",
  tools: [RefundCardPaymentTool],
  maxToolCalls: 2,
})
export class RefundSpecialistAgent {}
```

## What related entities work with `@Tool`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `ToolHandler<TInput, TOutput>` | `"agboss"` | Contract implemented by `@Tool` and `@McpTool` classes (`run(input: TInput): Promise<TOutput>`). |
| `ExecutionContext` | `"agboss"` | Injected via `deps: [ExecutionContext]`; provides `step.idempotencyKey`, `step.callId`, `signal`, `executionId`, and `ownerId`. |
| `SpendRecorder` | `"agboss"` | Injected via `deps: [SpendRecorder]`; records external API spend (`spendRecorder.record({ service, cost })`) against `@Budget` limits. |
| `app.tool(ToolClass).invoke(input)` | `"agboss"` | Executes a registered tool directly inside its own isolated execution context. |
| `testTool(ToolClass, options?)` | `"agboss/testing"` | Isolated unit runner that executes `run(input)` with DI `overrides` and returns `{ output, spend }`. |
| `mockTool(ToolClass)` | `"agboss/testing"` | Mocks or spies on a tool inside a `testWith(Application)` workflow test. |

### Unit-testing a `@Tool` in isolation with `testTool`

```ts title="test/refund-card-payment.tool.test.ts" no-check: reference example
import { expect, it } from "vitest";
import { override, testTool } from "agboss/testing";
import { RefundCardPaymentTool } from "./refund-card-payment.tool.js";
import { PaymentsService } from "../services/payments.service.js";

class FakePaymentsService extends PaymentsService {
  override async refund(): Promise<string> {
    return "re_test_1042";
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

```ts title="src/channels/refund-approval.channel.ts" no-check: reference example
import { Channel, ChannelOutcome, ChannelRole, type ChannelAsk, type ChannelHandler } from "agboss";

@Channel({
  name: "refund-approval-channel",
  description: "Requests human sign-off before executing high-value card refunds",
  role: ChannelRole.Approval,
})
export class RefundApprovalChannel implements ChannelHandler {
  async send(_ask: ChannelAsk): Promise<ChannelOutcome> {
    return ChannelOutcome.awaitReply();
  }
}
```
