---
title: "@ChannelRole & @Channel"
description: Complete API reference for @ChannelRole and @Channel in AGBoss — out-of-process pauses, ChannelOutcome, withdraw(), and two-phase app.resume().
---

The `@ChannelRole` and `@Channel` decorators (`channels/*.channel.ts`) power human-in-the-loop approvals and external questions in AGBoss. A `@Tool` declares which abstract `@ChannelRole` gates its execution (`@Tool({ channel: RefundApprovalChannel })`), while `@Application({ providers })` binds the concrete `@Channel` implementation (such as Slack, PagerDuty, or email) by class inheritance — and tests can swap in `AutoApproveChannel` or `AutoRejectChannel` without touching tool code.

## What options do `@ChannelRole` and `@Channel` accept?

| Decorator | Option | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `@ChannelRole` | `name` | `string` | Yes | Unique kebab-case identifier ending with `-channel` (`"refund-approval-channel"`). |
| `@ChannelRole` | `description` | `string` | Yes | Describes what this channel role approves or asks. |
| `@ChannelRole` | `answeredBy` | `PauseAnswerer.Channel \| PauseAnswerer.ThreadOwner` | Yes | Who is authorized to call `app.resume()`: the external channel (`Channel`) or the thread's original `ownerId` (`ThreadOwner`). |
| `@ChannelRole` | `approves` | `DtoClass` | Yes* | Input DTO class of the `@Tool`s this role approves (*mutually exclusive with `ask` / `answer`). |
| `@ChannelRole` | `ask` & `answer` | `DtoClass` | Yes* | Question and answer DTO classes for workflow-level questions (*mutually exclusive with `approves`). |
| `@ChannelRole` | `replyInterpreter` | `Class` | No | Optional interpreter class that parses free-text user replies into the typed `answer` DTO. |
| `@Channel` | `name` | `string` | Yes | Unique kebab-case identifier for the concrete channel implementation (`"slack-refund-approval-channel"`). |
| `@Channel` | `description` | `string` | Yes | Describes how this implementation delivers the prompt (e.g., Slack webhook, CLI terminal). |
| `@Channel` | `deps` | `readonly Token[]` | No | Constructor dependencies (`ExecutionContext`, `@Injectable` services) injected into the channel. |

## Complete `@ChannelRole` and `@Channel` example with two-phase `app.resume()`

```ts title="src/channels/slack-refund-approval.channel.ts" no-check: reference example
import { Channel, ChannelOf, ChannelOutcome, ChannelRole, ExecutionContext, PauseAnswerer, PauseResolution, type ChannelAsk, type ChannelWithdrawInfo } from "agboss";
import { RefundInputDto } from "../tools/refund-card-payment.tool.js";
import { SlackService } from "../services/slack.service.js";

// 1. Abstract @ChannelRole (referenced by @Tool({ channel: RefundApprovalChannel })):
@ChannelRole({
  name: "refund-approval-channel",
  description: "Approves customer card refunds over $100",
  approves: RefundInputDto,
  answeredBy: PauseAnswerer.Channel,
})
export abstract class RefundApprovalChannel extends ChannelOf<RefundApprovalChannel> {}

// 2. Concrete @Channel implementation (registered in @Application({ providers: [SlackRefundApprovalChannel] })):
@Channel({
  name: "slack-refund-approval-channel",
  description: "Posts an interactive approval button to #finance-approvals in Slack",
  deps: [ExecutionContext, SlackService],
})
export class SlackRefundApprovalChannel extends RefundApprovalChannel {
  constructor(
    private readonly executionContext: ExecutionContext,
    private readonly slackService: SlackService,
  ) {}

  async send(
    ask: ChannelAsk<RefundApprovalChannel>,
  ): Promise<ChannelOutcome<RefundApprovalChannel>> {
    // Immediate auto-approval for tiny amounts without pausing the workflow:
    if (ask.value.arguments.amountCents <= 5_00) {
      return ChannelOutcome.decided({ approved: true, reason: "Auto-approved under $5" });
    }

    // Otherwise persist PendingPause, release worker lease, and await external webhook:
    await this.slackService.postApprovalButtons({
      channel: "#finance-approvals",
      pauseId: ask.pauseId,
      executionId: this.executionContext.executionId,
      orderId: ask.value.arguments.orderId,
      amountCents: ask.value.arguments.amountCents,
    });
    return ChannelOutcome.awaitReply();
  }

  async withdraw(info: ChannelWithdrawInfo<ChannelAsk<RefundApprovalChannel>>): Promise<void> {
    // Called automatically when a paused branch is cancelled by FailFast, quorum Surplus, or app.cancel(threadId):
    await this.slackService.disableApprovalButtons({
      pauseId: info.pauseId,
      reason: info.resolution === PauseResolution.Withdrawn ? "Quorum reached / branch withdrawn" : "Cancelled",
    });
  }
}
```

```ts title="src/tools/refund-card-payment.tool.ts" no-check: reference example
import { Tool, type ToolHandler } from "agboss";
import { SlackRefundApprovalChannel } from "../channels/slack-refund-approval.channel.js";
import { RefundInputDto, RefundReceiptDto } from "../dto/refund.dto.js";

@Tool({
  name: "refund_card_payment",
  description: "Issues a customer card refund after Slack approval",
  input: RefundInputDto,
  output: RefundReceiptDto,
  approvalChannel: SlackRefundApprovalChannel,
})
export class RefundCardPaymentTool implements ToolHandler<RefundInputDto, RefundReceiptDto> {
  async run(input: RefundInputDto): Promise<RefundReceiptDto> {
    return { refundId: `re_${input.chargeId}`, status: "succeeded" };
  }
}
```

```ts title="test/slack-refund-approval.test.ts" no-check: reference example
import { expect } from "vitest";
import { callTool, replyWith, testWith } from "agboss/testing";
import { SupportApplication } from "../src/support.application.js";
import { RefundCardPaymentTool } from "../src/tools/refund-card-payment.tool.js";

const test = testWith(SupportApplication);

test("pauses on RefundCardPaymentTool and resumes with human approval", async ({ app, mockLlm }) => {
  mockLlm(RefundAgent).thenReturn(
    callTool(RefundCardPaymentTool, { chargeId: "ch_42", amountCents: 25_000 }),
  );
  const paused = await app.execute(SupportStart, { text: "Refund ch_42" });
  expect(paused.isPaused()).toBe(true);
  const resumed = await app.resume({
    pauseId: paused.pending[0].pauseId,
    decision: { approved: true, note: "Approved by finance" },
  });
  expect(resumed.isFinished()).toBe(true);
});
```

## What related entities work with `@ChannelRole` and `@Channel`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `ChannelOf<Role>` & `ChannelAsk<Role>` | `"agboss"` | Base class extended by `@ChannelRole` and typed payload passed to `send(ask)` (`ask.pauseId`, `ask.value.arguments`). |
| `ChannelWithdrawInfo<Role>` & `PauseResolution` | `"agboss"` | Payload passed to optional `withdraw(info)` when a paused branch is cancelled due to `FailFast` / quorum `Surplus` (`PauseResolution.Withdrawn`) or `app.cancel` (`PauseResolution.Cancelled`). |
| `ChannelOutcome` (`awaitReply()`, `decided(...)`) | `"agboss"` | Return value of `send(ask)`: either suspends the branch out-of-process (`awaitReply()`) or resolves inline (`decided({ approved })`). |
| `PauseAnswerer` (`Channel`, `ThreadOwner`) | `"agboss"` | Enforces who is allowed to resume the pause (`answeredBy` vs `ownerId`). |
| `app.resume({ pauseId, decision }, options)` | `"agboss"` | Two-phase atomic resume: transitions `Pending → Resolved` via CAS in `PausedExecutionRepository` before acquiring the execution-tree lease. |
| `AutoApproveChannel`, `AutoRejectChannel`, `TerminalUserChannel` | `"agboss"` | Built-in channel implementations for automated tests and interactive CLI sessions. |
| `PausedExecutionRepository` & `SqlitePausedExecutionRepository` | `"agboss"` | Durable store persisting `PendingPause` records across restarts and worker pods. |
