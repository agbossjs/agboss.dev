---
title: "@Tool"
description: Complete API reference for @Tool in AGBoss — execute(input), @ToolApproval pause targets, ExecutionContext, SpendRecorder, and testUnit().
---

The `@Tool` class decorator (`tools/*.tool.ts`) defines a typed capability that an `@Agent` can invoke during its tool-calling loop, or that your own code calls through its service. Every `@Tool` declares its input and output DTO classes from `@agboss/core/dto` and has an `execute(input)` method — sync or async, no `implements` needed: the decorator checks the method against the DTOs on its line. A tool that needs a person's approval names an approval target (`@Tool({ approval })`). `@BindTool` and the 0.1.0 `run(input)` method are gone, and so is `@McpTool`: a tool that reaches an MCP server lists the `@McpServer` class in its `deps` and calls it ([`@McpServer`](/reference/mcp/)).

## Complete `@Tool` example with all capabilities

```ts title="src/dto/refund.dto.ts" file=src/dto/refund.dto.ts
import { Enum, Integer, Text } from "@agboss/core/dto";

export class RefundInputDto {
  @Text({ minLength: 1, prompt: "Order ID to refund, e.g. ORD-1042" })
  orderId!: string;

  @Integer({ min: 1, max: 500_000, prompt: "Refund amount in cents" })
  amountCents!: number;
}

export class RefundOutputDto {
  @Enum(["refunded", "queued"], { prompt: "Settlement status" })
  status!: "refunded" | "queued";

  @Text({ prompt: "Payment gateway refund reference ID" })
  refundId!: string;
}
```

```ts title="src/tools/refund-card-payment.tool.ts" file=src/tools/refund-card-payment.tool.ts
import { ExecutionContext, SpendRecorder, Tool } from "@agboss/core";
import { kilobytes, seconds, usd } from "@agboss/core/units";
import { RefundToolApproval } from "../approvals/refund.tool-approval.js";
import { RefundInputDto, RefundOutputDto } from "../dto/refund.dto.js";
import { PaymentsService } from "../services/payments.service.js";

@Tool({
  name: "refund_card_payment",
  description: "Issues a card refund for an order after approval. Call it only after verifying the order ID and exact amount in cents.",
  input: RefundInputDto,
  output: RefundOutputDto,
  approval: RefundToolApproval, // the target, never the channel: a person answers before every call runs
  timeout: seconds(15),
  maxResultSize: kilobytes(64),
  deps: [ExecutionContext, SpendRecorder, PaymentsService],
})
export class RefundCardPaymentTool {
  constructor(
    private readonly executionContext: ExecutionContext,
    private readonly spendRecorder: SpendRecorder,
    private readonly paymentsService: PaymentsService,
  ) {}

  async execute(input: RefundInputDto): Promise<RefundOutputDto> {
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

```ts title="src/approvals/refund.tool-approval.ts" file=src/approvals/refund.tool-approval.ts
import { PauseRespondent, ToolApproval } from "@agboss/core";
import { hours } from "@agboss/core/units";
import { RefundInputDto } from "../dto/refund.dto.js";

// the target: what is approved, who may answer, for how long — its @Channel (listed in
// @Application({ channels })) only carries it
@ToolApproval({
  name: "refund-tool-approval",
  description: "Requests human sign-off before executing high-value card refunds",
  input: RefundInputDto, // the input of every tool naming it
  respondent: PauseRespondent.Delegate,
  timeout: hours(24),
})
export class RefundToolApproval {}
```

```ts title="src/agents/refund-specialist.agent.ts" file=src/agents/refund-specialist.agent.ts
import { Agent, inline } from "@agboss/core";
import { RefundOutputDto } from "../dto/refund.dto.js";
import { RefundCardPaymentTool } from "../tools/refund-card-payment.tool.js";

@Agent({
  name: "refund-specialist-agent",
  description: "Issues idempotent Stripe refunds via RefundCardPaymentTool",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Verify the order ID and call refund_card_payment when eligible."),
  tools: [RefundCardPaymentTool],
  output: RefundOutputDto,
  executionLimits: { maxToolCalls: 2 },
})
export class RefundSpecialistAgent {}
```

```ts title="test/refund-card-payment.tool.test.ts" file=test/refund-card-payment.tool.test.ts
import { expect, it } from "vitest";
import { Injectable } from "@agboss/core";
import { testUnit } from "@agboss/core/testing";
import { RefundCardPaymentTool } from "../src/tools/refund-card-payment.tool.js";
import { PaymentsService } from "../src/services/payments.service.js";

@Injectable()
class FakePaymentsService extends PaymentsService {
  override refund(): Promise<string> {
    return Promise.resolve("re_test_1042");
  }
}

it("executes RefundCardPaymentTool with a fake PaymentsService", async () => {
  const runTool = testUnit(RefundCardPaymentTool, { services: [FakePaymentsService] });

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

## What options does `@Tool` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Snake_case or kebab-case tool name exposed to the model (`"refund_card"`); it keeps the model API's character and length rules (`[tool.name-invalid]`, `[tool.name-too-long]`) and needs no `-tool` suffix. |
| `description` | `string` | Yes | Concise description telling the model what the tool does and when to call it. The 0.1.0 `prompt` / `promptUrls` of a tool are gone: put the usage instructions here. |
| `input` | `DtoClass` | Yes | DTO class (`@agboss/core/dto`) validating the tool's input arguments and generating its JSON Schema. |
| `output` | `DtoClass` | Yes | DTO class validating the plain object returned by `execute(input)`. |
| `deps` | `readonly Token[]` | No | Constructor dependencies (`ExecutionContext`, `SpendRecorder`, `Idempotency`, an `@McpServer`, `@Injectable` services) verified against constructor parameters. |
| `approval` | `Class` | No | A [`@ToolApproval`](/reference/pause-target/) target whose `input` is this tool's input: before every call a pause is opened and the call runs once it is approved (`channel` is gone; `[channel.wrong-tool]` for a target of another input). |
| `readOnly` | `boolean` | No | Declares that the tool has no side effects, so an A2A `message` skill may reach it. |
| `toolInterceptors` | `readonly Class[]` | No | [`@ToolInterceptor`](/reference/tool-interceptor/) classes attached directly to this tool. |
| `excludeToolInterceptors` | `readonly Class[]` | No | Inherited application, workflow, or agent `@ToolInterceptor` classes exempted for this tool. |
| `timeout` | `Milliseconds` | No | Per-call timeout (`seconds(15)`); defaults to `seconds(30)` and aborts `executionContext.signal` when exceeded. |
| `maxResultSize` | `Bytes` | No | Maximum UTF-8 result size (`kilobytes(256)`) shown to the model before truncation (`kilobytes(128)` by default). |

## What related entities work with `@Tool`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `ExecutionContext` | `"@agboss/core"` | Injected via `deps: [ExecutionContext]`; provides `step.idempotencyKey`, `step.callId`, `signal`, `executionId`, and `ownerId`. |
| `SpendRecorder` | `"@agboss/core"` | Injected via `deps: [SpendRecorder]`; records external API spend (`spendRecorder.record({ service, cost })`) against `@Budget` limits. |
| `@ToolApproval` & `@Channel` | `"@agboss/core"` | The pause target a tool names and the channel that carries its question — [Channels & pauses](/guides/channels-and-pauses/). |
| `@BeforeTool` / `@AfterTool` | `"@agboss/core"` | Hooks of a `@ToolInterceptor` that decide per tool; interceptors fail closed. |
| `testUnit(ToolClass, options?)` | `"@agboss/core/testing"` | Isolated unit runner that executes `execute(input)` with fake `services` (classes that `extends` the real ones) and returns `{ output, spend }`. |
| `mockTool(ToolClass)` | `"@agboss/core/testing"` | Mocks or spies on a tool inside a `testWith(Application)` workflow test. |
