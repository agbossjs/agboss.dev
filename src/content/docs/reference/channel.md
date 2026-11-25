---
title: "@Channel"
description: Complete API reference for @Channel in AGBoss — the transport of a pause target, send(ask), ChannelOutcome, onPauseClosed(), and two-phase app.resume().
---

A `@Channel` (`channels/*.channel.ts`) is the **transport** of one pause target: it tells the people a pause is waiting (Slack, PagerDuty, email) and takes its answer back through `app.resume`. What is asked, who may answer and for how long belongs to the target ([`@ToolApproval` / `@ExternalTask`](/reference/pause-target/)); the channel is infrastructure only. A channel is a plain class with `send(ask)` — **no base class to extend**, no `ChannelOf`, no `ChannelRole` — decorated `@Channel({ name, target, ttl })` and listed in `@Application({ channels })`, never in a workflow. Tests swap a channel for `AutoApproveChannel.for(Target)` or `AutoRejectChannel.for(Target)` without touching tool code.

## Complete `@Channel` example with two-phase `app.resume()`

```ts title="src/channels/slack-refund.channel.ts" file=src/channels/slack-refund.channel.ts
import {
  Channel,
  ChannelOutcome,
  ExecutionContext,
  Injectable,
  PauseClosedReason,
  PauseRespondent,
  ToolApproval,
  type ChannelAsk,
  type ChannelPauseClosedEvent,
} from "@agboss/core";
import { Integer, Text } from "@agboss/core/dto";
import { days, hours } from "@agboss/core/units";

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

// 1. The target (referenced by @Tool({ approval: RefundToolApproval })): what is approved, by whom, until when
@ToolApproval({
  name: "refund-tool-approval",
  description: "Approves customer card refunds over $100",
  input: RefundInputDto,
  respondent: PauseRespondent.Delegate,
  timeout: hours(24),
})
export class RefundToolApproval {}

// 2. Its channel (listed in @Application({ channels: [SlackRefundChannel] })):
@Channel({
  name: "slack-refund-channel",
  description: "Posts an interactive approval button to #finance-approvals in Slack",
  target: RefundToolApproval,
  ttl: days(7), // how long a closed pause's record is kept for this channel's notices
  deps: [ExecutionContext, SlackService],
})
export class SlackRefundChannel {
  constructor(
    private readonly executionContext: ExecutionContext,
    private readonly slackService: SlackService,
  ) {}

  async send(ask: ChannelAsk<RefundToolApproval>): Promise<ChannelOutcome<RefundToolApproval>> {
    // Immediate auto-approval for tiny amounts without pausing the workflow:
    if (ask.input.amountCents <= 5_00) {
      return ChannelOutcome.decided({ approved: true, reason: "Auto-approved under $5" });
    }

    // Otherwise the pause is stored, the worker lease released, and the channel awaits the external webhook:
    await this.slackService.postApprovalButtons({
      channel: "#finance-approvals",
      pauseId: ask.pauseId, // the reply key — and the idempotency key: a retried send gets the same one
      executionId: this.executionContext.executionId,
      orderId: ask.input.orderId,
      amountCents: ask.input.amountCents,
    });
    return ChannelOutcome.awaitReply();
  }

  // At least once, whenever a pause this channel sent closes (a withdrawn branch, app.cancel, an expiry,
  // an answer elsewhere, its tree ended): deduplicate by event.deliveryId.
  async onPauseClosed(event: ChannelPauseClosedEvent<RefundToolApproval>): Promise<void> {
    await this.slackService.disableApprovalButtons({
      pauseId: event.pauseId,
      reason:
        event.reason === PauseClosedReason.Withdrawn
          ? "Quorum reached / branch withdrawn"
          : event.reason,
    });
  }
}
```

```ts title="src/tools/refund-card-payment.tool.ts" file=src/tools/refund-card-payment.tool.ts
import { Tool } from "@agboss/core";
import {
  RefundInputDto,
  RefundReceiptDto,
  RefundToolApproval,
} from "../channels/slack-refund.channel.js";

@Tool({
  name: "refund_card_payment",
  description: "Issues a customer card refund after Slack approval",
  input: RefundInputDto,
  output: RefundReceiptDto,
  approval: RefundToolApproval, // the target, never the channel
})
export class RefundCardPaymentTool {
  execute(input: RefundInputDto): RefundReceiptDto {
    return { refundId: `re_${input.orderId}`, status: "succeeded" };
  }
}
```

<!--
```ts file=src/support.application.ts
import { Agent, Application, Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, Workflow, WorkflowFinish, WorkflowStart, onStart, secret, type BudgetHandler, inline, Ttl } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
import { ModelCost, ModelProvider, OpenRouterDriver } from "@agboss/core/models";
import { minutes, usd, type Usd } from "@agboss/core/units";
import { RefundReceiptDto, SlackRefundChannel, SlackService } from "./channels/slack-refund.channel.js";
import { RefundCardPaymentTool } from "./tools/refund-card-payment.tool.js";

@ModelProvider({
  name: "support-model-provider",
  description: "OpenRouter",
  driver: OpenRouterDriver({ apiKey: secret("OPENROUTER_API_KEY") }),
  timeout: minutes(2),
  cost: ModelCost.fromResponse(),
})
export class SupportModelProvider {}

@WorkflowStart({ name: "support-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class SupportStart {}

@Agent({
  name: "refund-agent",
  description: "Agent",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Refund"),
  tools: [RefundCardPaymentTool],
  output: RefundReceiptDto,
})
export class RefundAgent {}

@WorkflowFinish({ name: "support-workflow-finish", description: "Finish", output: RefundReceiptDto })
export class SupportFinish {}

@Workflow({
  name: "support-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  providers: [SlackService],
  flow: [
    onStart(SupportStart)
      .toAgent(RefundAgent)
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
  modelProvider: SupportModelProvider,
  providers: [SupportModelProvider],
  channels: [SlackRefundChannel], // a target's channel is listed here, never in a workflow
  budgets: [SupportAppBudget, SupportTenantBudget, SupportExecBudget],
})
export class SupportApplication {}
```
-->

```ts title="test/slack-refund-channel.test.ts" file=test/slack-refund-channel.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "@agboss/core";
import { callTool, testWith } from "@agboss/core/testing";
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

## What options does `@Channel` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier for the channel (`"slack-refund-channel"`), ending with `-channel`. |
| `description` | `string` | No | Describes how this channel delivers the prompt (e.g., Slack webhook, CLI terminal). |
| `target` | `Class` | Yes | The `@ToolApproval` or `@ExternalTask` it carries (`[channel.target-invalid]` for any other class). A target with several channels names a `@ChannelSelector` (`[channel.ambiguous-for-target]` without it); a target with a delegate and no channel is `[channel.missing-for-target]`. |
| `ttl` | `Milliseconds` | Yes | How long a closed pause's record is kept for this channel's notices: a finite duration over the 30 s lease (`[channel.ttl-invalid]`), e.g. `days(7)`. |
| `timeout` | `Milliseconds` | No | A bound on the channel's own calls. |
| `deps` | `readonly Token[]` | No | Constructor dependencies (`ExecutionContext`, `@Injectable` services) injected into the channel. |

## The hooks of a channel

Every channel has `send(ask: ChannelAsk<Target>)`; the rest are optional, so it takes only the hooks it needs (`ChannelHandler<Target>` documents the shape): `onPauseClosed(event)`, `onPauseAnswerNotTaken(event)`, `onPauseTimeoutChanged(event)`, `onPauseExpiring(event)`, `onPauseJoinFailed(event)` and `onPauseReassigned(event)`. A channel that has none of the notice hooks has no mailbox. Notices are delivered **at least once**, written with the change they report, delivered after a crash by any instance, in order, in the pause's frame under the tool's `timeout`; a throw is retried with growing pauses (`pause.notice-failed`) and set aside after `retention.pauseRecords` (`pause.notice-dead`); it never fails a run, a resume or a cancel. `event.deliveryId` is the dedupe key.

## What related entities work with `@Channel`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `ChannelAsk<Target>` | `"@agboss/core"` | Typed payload of `send(ask)`: `pauseId`, `input` (typed by the target's `input`), `assignees?`, `replaces?`. |
| `ChannelOutcome` (`awaitReply({ externalRef? })`, `decided(...)`) | `"@agboss/core"` | Return value of `send(ask)`: suspends the branch out-of-process (`awaitReply()`) or answers inline (`decided(answer)`, typed by the target's answer). |
| `ChannelPauseClosedEvent<Target>` & `PauseClosedReason` | `"@agboss/core"` | Payload of `onPauseClosed(event)`: `reason` is `Answered`, `Expired`, `Cancelled`, `Withdrawn`, `TreeEnded` or `Reassigned`; plus `pauseId`, `input`, `closedAt`, `actor?`, the masked `answer?`, `deliveryId`. |
| `PauseRespondent` (`Owner`, `Delegate`) | `"@agboss/core"` | On the target: who may answer. `app.resume` takes `ownerId` for an `Owner` target and a non-empty `actor` for a `Delegate` target. |
| `app.resume({ pauseId, decision }, options)` | `"@agboss/core"` | Two-phase atomic resume: transitions `Pending → Resolved` via CAS in `PausedExecutionRepository` before acquiring the execution-tree lease. A free-text `{ pauseId, reply }` is read by the target's interpreter. |
| `@ChannelSelector`, `@ChannelListener` | `"@agboss/core"` | Picks a channel per pause; hears every pause of the application. |
| `AutoApproveChannel.for(Target)`, `AutoRejectChannel.for(Target)` | `"@agboss/core/testing"` | Built-in channels for automated tests. `TerminalUserChannel` is gone: `agboss chat` / `run` ask the thread's owner for each `Owner` pause. |
