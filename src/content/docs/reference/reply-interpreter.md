---
title: "@ReplyInterpreter"
description: API reference for the @ReplyInterpreter decorator, ReplyInterpreterHandler, and ReplyInterpretation in AGBoss — parsing free-text human pause replies into typed decisions.
---

`@ReplyInterpreter` (`"agboss"`) declares the component that converts a free-text human reply (`app.resume({ pauseId, reply })`) into the typed decision required by a [`@ChannelRole`](/reference/channel-role/). Each `@ReplyInterpreter` belongs to a single `@ChannelRole({ replyInterpreter })` and can be driven either by a model (`DecidedBy.Model`) or by deterministic TypeScript (`DecidedBy.Code`).

## How to declare a `@ReplyInterpreter` (`DecidedBy.Model` & `DecidedBy.Code`)

A `@ReplyInterpreter` `name` must end with `-reply-interpreter`. Downstream code always consumes validated types — never raw reply strings:

<!-- snippet-context
import {
  Agent,
  Application,
  Budget,
  BudgetPeriod,
  BudgetScope,
  Channel,
  ChannelOf,
  ChannelOutcome,
  EmptyEnvironment,
  Tool,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  start,
  type BudgetHandler,
  type ChannelAsk,
  type ToolHandler,
} from "agboss";
import { Integer, Text, WorkflowFinishTextDto, WorkflowStartTextDto } from "agboss/dto";
import { usd, type Usd } from "agboss/units";

export class RefundInputDto {
  @Text({ prompt: "order id" })
  orderId!: string;
  @Integer({ prompt: "amount in cents" })
  amountCents!: number;
}
export class RefundOutputDto {
  @Text({ prompt: "status" })
  status!: string;
}

// @snippet

@Channel({
  name: "slack-refund-channel",
  description: "Posts refund approvals to Slack",
})
export class SlackRefundChannel extends RefundApprovalChannel {
  send(_ask: ChannelAsk<RefundApprovalChannel>): Promise<ChannelOutcome<RefundApprovalChannel>> {
    return Promise.resolve(ChannelOutcome.awaitReply());
  }
}

@Tool({
  name: "issue_refund",
  description: "Issues a refund after approval",
  input: RefundInputDto,
  output: RefundOutputDto,
  channel: RefundApprovalChannel,
})
export class IssueRefundTool implements ToolHandler<RefundInputDto, RefundOutputDto> {
  run({ orderId }: RefundInputDto): Promise<RefundOutputDto> {
    return Promise.resolve({ status: `refunded:${orderId}` });
  }
}

@Agent({
  name: "refund-support-agent",
  description: "Processes refunds",
  model: "moonshotai/kimi-k2.6",
  prompt: "Process the refund.",
  tools: [IssueRefundTool],
})
export class RefundSupportAgent {}

@WorkflowStart({ name: "refund-req-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class RefundReqStart {}
@WorkflowFinish({ name: "refund-req-workflow-finish", description: "Finish", output: WorkflowFinishTextDto })
export class RefundReqFinish {}

@Workflow({
  name: "refund-req-workflow",
  version: "1.0.0",
  flow: [
    start(RefundReqStart)
      .returns(WorkflowStartTextDto)
      .toAgent(RefundSupportAgent)
      .toFinish(RefundReqFinish),
  ],
})
export class RefundReqWorkflow {}

@Budget({ name: "ref-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class RefAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(10); } }
@Budget({ name: "ref-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class RefTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(2); } }
@Budget({ name: "ref-exec-budget", scope: BudgetScope.Execution })
export class RefExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "refund-req-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [RefundReqWorkflow],
  providers: [SlackRefundChannel],
  budgets: [RefAppBudget, RefTenantBudget, RefExecBudget],
})
export class RefundReqApplication {}
-->
```ts title="src/channels/refund-reply.interpreter.ts" file=src/refund-reply.ts
import {
  ChannelRole,
  DecidedBy,
  PauseAnswerer,
  ReplyInterpretation,
  ReplyInterpreter,
  type InputOf,
  type OutputOf,
  type ReplyInterpreterHandler,
} from "agboss";

// 1. Deterministic code interpreter (implements ReplyInterpreterHandler<Self>)
@ReplyInterpreter({
  name: "refund-code-reply-interpreter",
  description: "Parses short keyword replies ('approve', 'lgtm', 'reject: <reason>') in code",
  decidedBy: DecidedBy.Code,
})
export class RefundCodeReplyInterpreter
  implements ReplyInterpreterHandler<RefundCodeReplyInterpreter>
{
  interpret(
    input: InputOf<RefundCodeReplyInterpreter>,
  ): ReplyInterpretation<OutputOf<RefundCodeReplyInterpreter>> {
    const text = input.reply.trim().toLowerCase();
    if (text === "approve" || text === "lgtm" || text === "yes") {
      return ReplyInterpretation.understood({ approved: true });
    }
    if (text.startsWith("reject:")) {
      return ReplyInterpretation.understood({
        approved: false,
        reason: input.reply.slice("reject:".length).trim(),
      });
    }
    return ReplyInterpretation.notUnderstood({
      reason: "Reply with 'approve' or 'reject: <reason>'.",
    });
  }
}

// 2. Attach the interpreter to @ChannelRole({ replyInterpreter })
@ChannelRole({
  name: "refund-approval-channel",
  description: "Approves card refunds from Slack buttons or thread replies",
  approves: RefundInputDto,
  answeredBy: PauseAnswerer.Channel,
  replyInterpreter: RefundCodeReplyInterpreter,
})
export abstract class RefundApprovalChannel
  extends ChannelOf<RefundApprovalChannel> {}
```

```ts title="src/channels/model-reply.interpreter.ts" file=src/model-reply.ts
import { DecidedBy, ReplyInterpreter } from "agboss";

@ReplyInterpreter({
  name: "refund-model-reply-interpreter",
  description: "Extracts approval and optional argument overrides from natural-language Slack replies",
  decidedBy: DecidedBy.Model,
  model: "moonshotai/kimi-k2.6",
  prompt:
    "Read the original refund request and the reviewer's reply. Approve only when the reviewer clearly agrees.",
})
export class RefundModelReplyInterpreter {}
```

```ts title="test/refund-reply.interpreter.test.ts" file=test/refund-reply.interpreter.test.ts
import { expect, it } from "vitest";
import { ReplyInterpretation } from "agboss";
import { RefundCodeReplyInterpreter } from "../src/refund-reply.js";

it("interprets free-text approval and rejection replies deterministically", () => {
  const interpreter = new RefundCodeReplyInterpreter();

  const approved = interpreter.interpret({
    ask: {
      callId: "call_1",
      tool: "issue_refund",
      summary: "Refund $40.00 to ORD-12",
      arguments: { orderId: "ORD-12", amountCents: 4000 },
    },
    reply: "LGTM",
  });
  expect(approved).toEqual(ReplyInterpretation.understood({ approved: true }));

  const unclear = interpreter.interpret({
    ask: {
      callId: "call_2",
      tool: "issue_refund",
      summary: "Refund $40.00 to ORD-12",
      arguments: { orderId: "ORD-12", amountCents: 4000 },
    },
    reply: "maybe tomorrow",
  });
  expect(unclear).toEqual(
    ReplyInterpretation.notUnderstood({
      reason:
        "Reply must be 'approve', 'lgtm', 'reject: <reason>', or 'approve amount=<cents>'.",
    }),
  );
});
```

## `@ReplyInterpreter` options & `ReplyInterpretation` reference

| Option / Helper | Applies To | Description |
| :--- | :--- | :--- |
| `name` | Both | Kebab-case identifier ending with `-reply-interpreter`. |
| `description` | Both | Non-empty description of how the reply is interpreted. |
| `decidedBy` | Both | `DecidedBy.Model` or `DecidedBy.Code`. |
| `model` | `DecidedBy.Model` | Chat model (uses a single structured answer tool) or — for an approval role only — a decision model (`Decision.noul("approved")`; using a decision model on a question role fails with `[reply-interpreter.decision-model]`). |
| `prompt` / `promptUrls` | `DecidedBy.Model` | Static instructions for interpreting the reply (the pause's `ask` and `reply` arrive in the user message). |
| `deps` | `DecidedBy.Code` | Optional constructor dependency tokens injected into the `ReplyInterpreterHandler` class. |
| `ReplyInterpretation.understood(decision)` | `DecidedBy.Code` | Returns a parsed decision to be validated against the channel role's answer DTO. |
| `ReplyInterpretation.notUnderstood({ reason })` | `DecidedBy.Code` | Rejects `app.resume({ pauseId, reply })` with `UninterpretableReplyError` (carrying `.reason`) while keeping the pause `Pending`. |
