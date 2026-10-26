---
title: "@ChannelRole"
description: "Complete API reference for the @ChannelRole decorator in AGBoss — declaring tool-approval and question/answer pause contracts with PauseAnswerer."
---

The `@ChannelRole` decorator (`"@agboss/core"`) defines a transport-independent **human-in-the-loop pause contract**. Tools (`@Tool({ channel: RefundApprovalChannel })`) reference the abstract `@ChannelRole` class, while [`@Application({ providers })`](/reference/application/) binds the concrete [`@Channel`](/reference/channel/) implementation (such as Slack, webhook, or `AutoApproveChannel` in tests) by class inheritance.

## Complete `@ChannelRole` example

```ts title="src/channels/refund-approval.channel-role.ts" file=src/channels/refund-approval.channel-role.ts
import {
  Channel,
  ChannelOf,
  ChannelOutcome,
  ChannelRole,
  Injectable,
  PauseAnswerer,
  Tool,
  type ChannelAsk,
  type ToolHandler,
} from "@agboss/core";
import { Flag, Integer, Text } from "@agboss/core/dto";

export class RefundCardInputDto {
  @Text({ prompt: "charge id" })
  chargeId!: string;

  @Integer({ prompt: "refund amount in cents" })
  amountCents!: number;
}

export class RefundCardOutputDto {
  @Text({ prompt: "refund status" })
  status!: string;
}

// 1. Tool approval role (approves: RefundCardInputDto):
@ChannelRole({
  name: "refund-approval-channel",
  description: "Finance approval required before executing card refunds",
  approves: RefundCardInputDto,
  answeredBy: PauseAnswerer.Channel,
})
export abstract class RefundApprovalChannel
  extends ChannelOf<RefundApprovalChannel> {}

// 2. Custom question/answer role (ask + answer DTOs):
export class LegalSignOffQuestionDto {
  @Text({ prompt: "contract id" })
  contractId!: string;

  @Integer({ prompt: "liability cap in USD" })
  liabilityCapUsd!: number;
}

export class LegalSignOffDecisionDto {
  @Flag({ prompt: "whether approved" })
  approved!: boolean;

  @Text({ prompt: "counsel notes" })
  counselNotes!: string;
}

@ChannelRole({
  name: "legal-signoff-channel",
  description: "Requests legal counsel sign-off on non-standard liability caps",
  ask: LegalSignOffQuestionDto,
  answer: LegalSignOffDecisionDto,
  answeredBy: PauseAnswerer.Channel,
})
export abstract class LegalSignOffChannel
  extends ChannelOf<LegalSignOffChannel> {}

@Injectable()
export class SlackWebhookClient {
  postApproval(_pauseId: string, _chargeId: string): Promise<void> {
    return Promise.resolve();
  }
}

// 3. Concrete @Channel implementation extending the @ChannelRole class:
@Channel({
  name: "slack-refund-approval-channel",
  description: "Delivers RefundApprovalChannel requests to #finance-approvals in Slack",
  deps: [SlackWebhookClient],
})
export class SlackRefundApprovalChannel extends RefundApprovalChannel {
  constructor(private readonly slack: SlackWebhookClient) {
    super();
  }

  async send(
    ask: ChannelAsk<RefundApprovalChannel>,
  ): Promise<ChannelOutcome<RefundApprovalChannel>> {
    await this.slack.postApproval(ask.pauseId, ask.value.arguments.chargeId);
    return ChannelOutcome.awaitReply();
  }
}

// 4. @Tool referencing the abstract @ChannelRole:
@Tool({
  name: "refund_card_payment",
  description: "Refunds a card payment after finance approval",
  input: RefundCardInputDto,
  output: RefundCardOutputDto,
  channel: RefundApprovalChannel,
})
export class RefundCardPaymentTool
  implements ToolHandler<RefundCardInputDto, RefundCardOutputDto>
{
  run({ chargeId }: RefundCardInputDto): Promise<RefundCardOutputDto> {
    return Promise.resolve({ status: `refunded:${chargeId}` });
  }
}
```

<!--
```ts file=src/refund-support.application.ts
import {
  Agent,
  Application,
  Budget,
  BudgetPeriod,
  BudgetScope,
  EmptyEnvironment,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  start,
  type BudgetHandler,
} from "@agboss/core";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "@agboss/core/dto";
import { usd, type Usd } from "@agboss/core/units";
import {
  RefundCardPaymentTool,
  SlackRefundApprovalChannel,
  SlackWebhookClient,
} from "./channels/refund-approval.channel-role.js";

@WorkflowStart({ name: "refund-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class RefundWorkflowStart {}

@WorkflowFinish({ name: "refund-workflow-finish", description: "Finish", output: WorkflowFinishTextDto })
export class RefundWorkflowFinish {}

@Agent({
  name: "refund-support-agent",
  description: "Handles refund requests",
  model: "moonshotai/kimi-k2.6",
  prompt: "Process refund requests using refund_card_payment.",
  tools: [RefundCardPaymentTool],
})
export class RefundSupportAgent {}

@Workflow({
  name: "refund-support-workflow",
  version: "1.0.0",
  providers: [SlackRefundApprovalChannel, SlackWebhookClient],
  flow: [
    start(RefundWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toAgent(RefundSupportAgent)
      .toFinish(RefundWorkflowFinish),
  ],
})
export class RefundSupportWorkflow {}

@Budget({ name: "ref-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class RefAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(50); } }
@Budget({ name: "ref-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class RefTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "ref-exec-budget", scope: BudgetScope.Execution })
export class RefExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "refund-support-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [RefundSupportWorkflow],
  budgets: [RefAppBudget, RefTenantBudget, RefExecBudget],
})
export class RefundSupportApplication {}
```
-->

```ts title="test/refund-approval.channel-role.test.ts" file=test/refund-approval.channel-role.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "@agboss/core";
import { callTool, testWith } from "@agboss/core/testing";
import { RefundCardPaymentTool } from "../src/channels/refund-approval.channel-role.js";
import {
  RefundSupportAgent,
  RefundSupportApplication,
  RefundWorkflowStart,
} from "../src/refund-support.application.js";

const test = testWith(RefundSupportApplication);

test("pauses tool execution when RefundApprovalChannel returns awaitReply()", async ({
  app,
  mockLlm,
}) => {
  mockLlm(RefundSupportAgent).thenReturn(
    callTool(RefundCardPaymentTool, { chargeId: "ch_901", amountCents: 15_000 }),
  );
  const res = await app.execute(RefundWorkflowStart, { text: "Refund ch_901" });
  expect(res.status).toBe(ExecutionStatus.Paused);
});
```

## What options does `@ChannelRole` accept?

Every `@ChannelRole` class extends `ChannelOf<Self>`, has a `name` ending with `-channel`, requires `answeredBy` (`PauseAnswerer.Channel` or `PauseAnswerer.ThreadOwner`), and uses one of two forms — **tool approval** (`approves`) or **custom question/answer** (`ask` + `answer`):

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | **Yes** | Unique kebab-case identifier ending with `-channel` (`"refund-approval-channel"`). |
| `description` | `string` | **Yes** | Explains what human decision this pause role requests. |
| `answeredBy` | `PauseAnswerer.Channel \| PauseAnswerer.ThreadOwner` | **Yes** | Who may call `app.resume()`: the external channel (`PauseAnswerer.Channel`, requiring `{ answeredBy }`) or the thread's owner (`PauseAnswerer.ThreadOwner`, checked against `ownerId`). |
| `approves` | `DtoClass` | Form 1* | Input DTO class of the `@Tool`s this role approves (`[channel.wrong-tool]` if a tool with another input DTO names this role). *Mutually exclusive with `ask`/`answer`. |
| `ask` & `answer` | `DtoClass` | Form 2* | Custom question and answer DTO classes (*mutually exclusive with `approves`). |
| `replyInterpreter` | `Class` | No | Optional [`@ReplyInterpreter`](/reference/reply-interpreter/) class that turns free-text `app.resume({ pauseId, reply })` messages into the role's typed decision. |

## What related entities work with `@ChannelRole`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| [`@Channel`](/reference/channel/) & `ChannelOf<Role>` | `"@agboss/core"` | Concrete transport implementation bound in `@Application({ providers })` by extending the `@ChannelRole` class. |
| [`@ReplyInterpreter`](/reference/reply-interpreter/) | `"@agboss/core"` | Parses free-text human replies (`app.resume({ pauseId, reply })`) into the role's typed decision. |
| `AutoApproveChannel` & `AutoRejectChannel` | `"@agboss/core"` | Built-in test channels for automated approval or rejection. |
| `ToolCallApprovalAskDto` & `ToolCallApprovalDecisionDto` | `"@agboss/core/dto"` | Standard DTOs used by `@ChannelRole({ approves })`. |
