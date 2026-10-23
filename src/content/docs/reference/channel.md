---
title: "@ChannelRole & @Channel"
description: Complete API reference for @ChannelRole and @Channel in AGBoss — out-of-process pauses, ChannelOutcome, withdraw(), and two-phase app.resume().
---

The `@ChannelRole` and `@Channel` decorators (`channels/*.channel.ts`) power human-in-the-loop approvals and external questions in AGBoss. A `@Tool` declares which abstract `@ChannelRole` gates its execution (`@Tool({ channel: RefundApprovalChannel })`), while `@Application({ providers })` binds the concrete `@Channel` implementation (such as Slack, PagerDuty, or email) by class inheritance — and tests can swap in `AutoApproveChannel` or `AutoRejectChannel` without touching tool code.

## Complete `@ChannelRole` and `@Channel` example with two-phase `app.resume()`

```ts title="src/channels/slack-refund-approval.channel.ts" file=src/channels/slack-refund-approval.channel.ts
import {
  Channel,
  ChannelOf,
  ChannelOutcome,
  ChannelRole,
  ExecutionContext,
  Injectable,
  PauseAnswerer,
  PauseResolution,
  type ChannelAsk,
  type ChannelWithdrawal,
} from "agboss";
import { Integer, Text } from "agboss/dto";

export class RefundInputDto {
  @Text({ prompt: "Order ID to refund" })
  orderId!: string;

  @Integer({ min: 1, prompt: "Refund amount in cents" })
  amountCents!: number;
}

export class RefundReceiptDto {
  @Text({ prompt: "Refund reference ID" })
  refundId!: string;

  @Text({ prompt: "Settlement status" })
  status!: string;
}

@Injectable()
export class SlackService {
  postApprovalButtons(req: {
    channel: string;
    pauseId: string;
    executionId: string;
    orderId: string;
    amountCents: number;
  }): Promise<void> {
    void req;
    return Promise.resolve();
  }

  disableApprovalButtons(req: { pauseId: string; reason: string }): Promise<void> {
    void req;
    return Promise.resolve();
  }
}

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
  ) {
    super();
  }

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

  override async withdraw(withdrawal: ChannelWithdrawal<RefundApprovalChannel>): Promise<void> {
    // Called automatically when a paused branch is cancelled by FailFast, quorum Surplus, or app.cancel(threadId):
    await this.slackService.disableApprovalButtons({
      pauseId: withdrawal.pauseId,
      reason:
        withdrawal.resolution === PauseResolution.Withdrawn
          ? "Quorum reached / branch withdrawn"
          : "Cancelled",
    });
  }
}
```

```ts title="src/tools/refund-card-payment.tool.ts" file=src/tools/refund-card-payment.tool.ts
import { Tool, type ToolHandler } from "agboss";
import {
  RefundApprovalChannel,
  RefundInputDto,
  RefundReceiptDto,
} from "../channels/slack-refund-approval.channel.js";

@Tool({
  name: "refund_card_payment",
  description: "Issues a customer card refund after Slack approval",
  input: RefundInputDto,
  output: RefundReceiptDto,
  channel: RefundApprovalChannel,
})
export class RefundCardPaymentTool implements ToolHandler<RefundInputDto, RefundReceiptDto> {
  run(input: RefundInputDto): Promise<RefundReceiptDto> {
    return Promise.resolve({ refundId: `re_${input.orderId}`, status: "succeeded" });
  }
}
```

<!--
```ts file=src/support.application.ts
import { Agent, Application, Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, Workflow, WorkflowFinish, WorkflowStart, start, type BudgetHandler } from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";
import { usd, type Usd } from "agboss/units";
import { RefundReceiptDto, SlackRefundApprovalChannel, SlackService } from "./channels/slack-refund-approval.channel.js";
import { RefundCardPaymentTool } from "./tools/refund-card-payment.tool.js";

@WorkflowStart({ name: "support-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class SupportStart {}

@Agent({
  name: "refund-agent",
  description: "Agent",
  model: "moonshotai/kimi-k2.6",
  prompt: "Refund",
  tools: [RefundCardPaymentTool],
  output: RefundReceiptDto,
})
export class RefundAgent {}

@WorkflowFinish({ name: "support-workflow-finish", description: "Finish", output: RefundReceiptDto })
export class SupportFinish {}

@Workflow({
  name: "support-workflow",
  version: "1.0.0",
  flow: [
    start(SupportStart)
      .returns(WorkflowStartTextDto)
      .toAgent(RefundAgent)
      .returns(RefundReceiptDto)
      .toFinish(SupportFinish),
  ],
})
export class SupportWorkflow {}

@Budget({ name: "support-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class SupportAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(50); } }
@Budget({ name: "support-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class SupportTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(10); } }
@Budget({ name: "support-exec-budget", scope: BudgetScope.Execution })
export class SupportExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "support-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [SupportWorkflow],
  providers: [SlackService, SlackRefundApprovalChannel],
  budgets: [SupportAppBudget, SupportTenantBudget, SupportExecBudget],
})
export class SupportApplication {}
```
-->

```ts title="test/slack-refund-approval.test.ts" file=test/slack-refund-approval.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "agboss";
import { callTool, testWith } from "agboss/testing";
import { SupportApplication, RefundAgent, SupportStart } from "../src/support.application.js";
import { RefundCardPaymentTool } from "../src/tools/refund-card-payment.tool.js";

const test = testWith(SupportApplication);

test("pauses on RefundCardPaymentTool and resumes with human approval", async ({ app, mockLlm }) => {
  mockLlm(RefundAgent).thenReturn(
    callTool(RefundCardPaymentTool, { orderId: "ORD-42", amountCents: 25_000 }),
  );
  const paused = await app.execute(SupportStart, { text: "Refund ORD-42" });
  expect(paused.status).toBe(ExecutionStatus.Paused);
});
```

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

## What related entities work with `@ChannelRole` and `@Channel`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `ChannelOf<Role>` & `ChannelAsk<Role>` | `"agboss"` | Base class extended by `@ChannelRole` and typed payload passed to `send(ask)` (`ask.pauseId`, `ask.value.arguments`). |
| `ChannelWithdrawal<Role>` & `PauseResolution` | `"agboss"` | Payload passed to optional `withdraw(withdrawal)` when a paused branch is cancelled due to `FailFast` / quorum `Surplus` (`PauseResolution.Withdrawn`) or `app.cancel` (`PauseResolution.Cancelled`). |
| `ChannelOutcome` (`awaitReply()`, `decided(...)`) | `"agboss"` | Return value of `send(ask)`: either suspends the branch out-of-process (`awaitReply()`) or resolves inline (`decided({ approved })`). |
| `PauseAnswerer` (`Channel`, `ThreadOwner`) | `"agboss"` | Enforces who is allowed to resume the pause (`answeredBy` vs `ownerId`). |
| `app.resume({ pauseId, decision }, options)` | `"agboss"` | Two-phase atomic resume: transitions `Pending → Resolved` via CAS in `PausedExecutionRepository` before acquiring the execution-tree lease. |
| `AutoApproveChannel`, `AutoRejectChannel`, `TerminalUserChannel` | `"agboss"` | Built-in channel implementations for automated tests and interactive CLI sessions. |
| `PausedExecutionRepository` & `SqlitePausedExecutionRepository` | `"agboss"` | Durable store persisting `PendingPause` records across restarts and worker pods. |
