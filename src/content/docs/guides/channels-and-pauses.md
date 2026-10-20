---
title: Channels & Human-in-the-Loop Pauses
description: Pause workflows for human approval without blocking Node.js threads using @ChannelRole, @Channel, ChannelOutcome, and two-phase app.resume().
---

Production workflows often require human sign-off before executing high-stakes tool calls — such as refunding a card payment, modifying production infrastructure, or sending external messages. AGBoss handles human-in-the-loop pauses **out-of-process**: when a tool's `@Channel` returns `ChannelOutcome.awaitReply()`, the branch pauses while sibling parallel branches continue until nothing else can move, persisting a `PendingPause` record and releasing the worker's execution lease.

## How to declare a `@ChannelRole` and `@Channel` implementation

A channel contract is split into a `@ChannelRole` (declaring what DTO it `approves` and who is allowed to answer via `answeredBy: PauseAnswerer.Channel | PauseAnswerer.ThreadOwner`) and a `@Channel` implementation class listed in `@Application({ providers })`:

<!-- snippet-context
import {
  Agent,
  Application,
  Budget,
  BudgetPeriod,
  BudgetScope,
  EmptyEnvironment,
  Injectable,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  start,
  type BudgetHandler,
} from "agboss";
import { Integer, Text, WorkflowFinishTextDto, WorkflowStartTextDto } from "agboss/dto";
import { usd, type Usd } from "agboss/units";

export class RefundCardInputDto {
  @Text({ prompt: "the order id" })
  orderId!: string;
  @Integer({ prompt: "amount in cents" })
  amountCents!: number;
}
export class RefundCardOutputDto {
  @Text({ prompt: "refund status" })
  status!: string;
}
@Injectable()
export class SlackService {
  post(_channel: string, _text: string, _pauseId: string): Promise<void> {
    return Promise.resolve();
  }
}
// @snippet
@Agent({ name: "refund-agent", description: "Refunds", prompt: "Refund.", model: "moonshotai/kimi-k2.6", tools: [RefundCardTool] })
export class RefundAgent {}
@WorkflowStart({ name: "refund-workflow-start", description: "A request", input: WorkflowStartTextDto })
export class RefundWorkflowStart {}
@WorkflowFinish({ name: "refund-workflow-finish", description: "The answer", output: WorkflowFinishTextDto })
export class RefundWorkflowFinish {}
@Workflow({
  name: "refund-workflow",
  version: "1.0.0",
  flow: [
    start(RefundWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toAgent(RefundAgent)
      .toFinish(RefundWorkflowFinish),
  ],
  providers: [SlackService],
})
export class RefundWorkflow {}
@Budget({ name: "refund-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class RefundAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "refund-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class RefundTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(1); } }
@Budget({ name: "refund-exec-budget", scope: BudgetScope.Execution })
export class RefundExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.1); } }
@Application({
  name: "refund-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [RefundWorkflow],
  providers: [SlackRefundApprovalChannel],
  budgets: [RefundAppBudget, RefundTenantBudget, RefundExecBudget],
})
export class RefundApplication {}
-->
```ts title="src/channels/slack-refund-approval.channel.ts" file=src/refunds.ts
import { Channel, ChannelOf, ChannelOutcome, ChannelRole, ExecutionContext, PauseAnswerer, Tool, type ChannelAsk, type ToolHandler } from "agboss";

// 1. Role contract: what it approves and who may answer
@ChannelRole({
  name: "refund-approval-channel",
  description: "Approves card refunds",
  approves: RefundCardInputDto,
  answeredBy: PauseAnswerer.Channel,
})
export abstract class RefundApprovalChannel
  extends ChannelOf<RefundApprovalChannel> {}

// 2. Transport implementation registered in @Application({ providers })
@Channel({
  name: "slack-refund-approval-channel",
  description: "Asks a finance manager in Slack",
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
    const cents: number = ask.value.arguments.amountCents;
    const tenant = this.executionContext.tenant.tenantId;
    await this.slackService.post(
      "#finance",
      `Refund ${String(cents)}¢ (${tenant})?`,
      ask.pauseId,
    );
    return ChannelOutcome.awaitReply();
  }
}

// 3. Tool naming the approval channel role
@Tool({
  name: "refund_card",
  description: "Refunds a card payment",
  input: RefundCardInputDto,
  output: RefundCardOutputDto,
  channel: RefundApprovalChannel,
})
export class RefundCardTool
  implements ToolHandler<RefundCardInputDto, RefundCardOutputDto>
{
  run({ orderId }: RefundCardInputDto): Promise<RefundCardOutputDto> {
    return Promise.resolve({ status: `refunded ${orderId}` });
  }
}
```

```ts title="src/workflows/refund.workflow.ts" no-check: context tab
import { Agent, Application, Workflow, start } from "agboss";
import { RefundCardTool, SlackRefundApprovalChannel } from "../channels/slack-refund-approval.channel.js";

@Agent({
  name: "refund-agent",
  description: "Processes customer refunds with Slack approval",
  model: "moonshotai/kimi-k2.6",
  prompt: "Call refund_card when the customer asks for a refund.",
  tools: [RefundCardTool],
})
export class RefundAgent {}

@Workflow({
  name: "refund-workflow",
  version: "1.0.0",
  flow: [
    start(RefundStart)
      .toAgent(RefundAgent)
      .toFinish(RefundFinish),
  ],
})
export class RefundWorkflow {}
```

## How two-phase `app.resume({ pauseId, decision })` works

When a reviewer approves or rejects a paused tool call from Slack or an admin webhook, call `app.resume` with the `pauseId`:

<!-- snippet-context
import type { App } from "agboss";
declare const app: App;
declare const replyKey: string;
-->
```ts title="src/webhooks/slack-actions.route.ts"
const result = await app.resume(
  {
    pauseId: replyKey,
    decision: { approved: true },
  },
  {
    tenantId: "acme",
    answeredBy: "manager-17",
  },
);
```

```ts title="test/refund-pause.test.ts" no-check: context tab
import { expect } from "vitest";
import { callTool, testWith } from "agboss/testing";
import { RefundApplication, RefundAgent, RefundCardTool, RefundStart } from "../src/refunds.js";

const test = testWith(RefundApplication);

test("pauses on RefundCardTool and resumes with Slack approval", async ({ app, mockLlm }) => {
  mockLlm(RefundAgent).thenReturn(
    callTool(RefundCardTool, { chargeId: "ch_99", amountCents: 15_000 }),
  );
  const paused = await app.execute(RefundStart, { text: "Refund ch_99" });
  expect(paused.isPaused()).toBe(true);
});
```

- **Two-phase atomic resolution:** Phase 1 atomically flips the pause record from `Pending` to `Resolved` in `PausedExecutionRepository` (a second click or duplicate webhook receives `NotPausedError`). Phase 2 acquires the execution tree's 30-second lease and continues execution with all resolved decisions.
- **Capability security (`PauseAnswerer`):** A `PauseAnswerer.Channel` pause omits `pauseId` from `result.pending` so only the external channel (`ask.pauseId`) holds the token to answer it, requiring `{ answeredBy: "manager-17" }` on resume. A `PauseAnswerer.ThreadOwner` pause lists `pauseId` in `result.pending` and must be resumed by the thread's `ownerId`.
