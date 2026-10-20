---
title: "@ChannelRole"
description: Complete API reference for the @ChannelRole decorator in AGBoss — declaring approval and question/answer pause contracts decoupled from transport channels.
---

The `@ChannelRole` decorator defines a transport-independent **human-in-the-loop pause contract** (`channels/*.channel-role.ts`). Workflows, tools (`approvalChannel`), and actions reference the `@ChannelRole` class, while `@Application({ providers })` binds a concrete `@Channel({ role })` implementation (such as Slack, webhook, or `AutoApproveChannel` in tests).

## What options does `@ChannelRole` accept?

Every `@ChannelRole` class name ends with `ChannelRole` (or `Channel`) and supports two modes — **tool approval** (`approves`) or **custom question/answer** (`ask` + `answer`):

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier ending with `-channel` or `-channel-role`. |
| `description` | `string` | Yes | Explains what human decision this pause role requests. |
| `approves` | `readonly Class[]` | No* | List of `@Tool` classes whose calls require approval through this role (*mutually exclusive with `ask`/`answer`). |
| `ask` | `DtoClass` | No* | Question DTO sent to the human responder (*used together with `answer`). |
| `answer` | `DtoClass` | No* | Decision DTO validated when `app.resume({ pauseId, decision })` is called. |

## Complete `@ChannelRole` example with tool approval and custom Q&A roles

```ts title="src/channels/refund-approval.channel-role.ts" no-check: reference example
import { ChannelRole } from "agboss";
import { Boolean, Integer, Text } from "agboss/dto";
import { RefundCardPaymentTool } from "../tools/refund-card-payment.tool.js";

// 1. Tool approval role (uses ToolCallApprovalAskDto / ToolCallApprovalDecisionDto automatically):
@ChannelRole({
  name: "refund-approval-channel",
  description: "Finance approval required before executing high-value card refunds",
  approves: [RefundCardPaymentTool],
})
export class RefundApprovalChannelRole {}

// 2. Custom question/answer role with project-defined DTOs:
export class LegalSignOffQuestionDto {
  @Text() contractId!: string;
  @Integer() liabilityCapUsd!: number;
}

export class LegalSignOffDecisionDto {
  @Boolean() approved!: boolean;
  @Text() counselNotes!: string;
}

@ChannelRole({
  name: "legal-signoff-channel",
  description: "Requests legal counsel sign-off on non-standard liability caps",
  ask: LegalSignOffQuestionDto,
  answer: LegalSignOffDecisionDto,
})
export class LegalSignOffChannelRole {}
```

```ts title="src/channels/slack-refund.channel.ts" no-check: reference example
import { Channel, ChannelOf, ChannelOutcome, type ChannelAsk } from "agboss";
import { RefundApprovalChannelRole } from "./refund-approval.channel-role.js";
import { SlackService } from "../services/slack.service.js";

@Channel({
  name: "slack-refund-channel",
  description: "Delivers RefundApprovalChannelRole requests to #finance-approvals in Slack",
  role: RefundApprovalChannelRole,
  deps: [SlackService],
})
export class SlackRefundChannel extends ChannelOf(RefundApprovalChannelRole) {
  constructor(private readonly slack: SlackService) {
    super();
  }

  async send(ask: ChannelAsk<RefundApprovalChannelRole>): Promise<ChannelOutcome<RefundApprovalChannelRole>> {
    await this.slack.postApprovalButtons({
      pauseId: ask.pauseId,
      toolName: ask.question.toolName,
    });
    return ChannelOutcome.awaitReply();
  }
}
```

```ts title="test/refund-approval.channel-role.test.ts" no-check: reference example
import { expect } from "vitest";
import { callTool, testWith } from "agboss/testing";
import { SupportApplication } from "../src/support.application.js";
import { RefundCardPaymentTool } from "../src/tools/refund-card-payment.tool.js";

const test = testWith(SupportApplication);

test("binds RefundApprovalChannelRole to Slack or AutoApproveChannel without changing tools", async ({ app, mockLlm }) => {
  mockLlm(RefundAgent).thenReturn(
    callTool(RefundCardPaymentTool, { chargeId: "ch_9", amountCents: 40 }),
  );
  const paused = await app.execute(SupportStart, { text: "Refund ch_9" });
  expect(paused.isPaused()).toBe(true);
});
```

## What related entities work with `@ChannelRole`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| [`@Channel`](/reference/channel/) & `ChannelOf(Role)` | `"agboss"` | Concrete transport implementation bound in `@Application({ providers })`. |
| `AutoApproveChannel` & `AutoRejectChannel` | `"agboss"` | Built-in test channels for automated approval or rejection in `testWith()`. |
| `ToolCallApprovalAskDto` & `ToolCallApprovalDecisionDto` | `"agboss/dto"` | Standard DTOs used by `@ChannelRole({ approves })`. |
