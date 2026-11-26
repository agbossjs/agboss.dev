---
title: "@ChannelInterpreter"
description: "Complete API reference for the @ChannelInterpreter decorator (code or model), ChannelInterpretation and testUnit() — reading a free-text reply into a pause's typed answer. Replaces @ReplyInterpreter."
---

`@ChannelInterpreter` (`"@agboss/core"`, `channels/*.channel-interpreter.ts`) declares the component that converts a free-text human reply (`app.resume({ pauseId, reply })`) into the typed answer a pause target requires. It replaces 0.1.0's `@ReplyInterpreter` (and `DecidedBy` on interpreters, `ReplyInterpretation`, `ReplyInterpreterHandler`): an interpreter is **code** (a class with `interpret(input)`) or a **model** (an empty class with a `prompt`), told apart by what the decorator sets. It belongs to a single pause target — `@ToolApproval({ channelInterpreter })` or `@ExternalTask({ channelInterpreter })` (`[channel.shared-interpreter]` when one serves two). Downstream code always consumes validated types — never raw reply strings.

## How to declare a `@ChannelInterpreter` (code and model)

```ts title="src/channels/refund-reply.interpreter.ts" file=src/refund-reply.ts
import {
  ChannelInterpretation,
  ChannelInterpreter,
  PauseRespondent,
  ToolApproval,
  type ChannelInterpreterHandler,
  type InputOf,
  type OutputOf,
} from "@agboss/core";
import { Integer, Text } from "@agboss/core/dto";
import { hours } from "@agboss/core/units";

export class RefundInputDto {
  @Text({ prompt: "order id" })
  orderId!: string;
  @Integer({ prompt: "amount in cents" })
  amountCents!: number;
}

// 1. Deterministic code interpreter: an `interpret` method, no model
@ChannelInterpreter({
  name: "refund-code-channel-interpreter",
  description: "Parses short keyword replies ('approve', 'lgtm', 'reject: <reason>') in code",
})
export class RefundCodeChannelInterpreter
  implements ChannelInterpreterHandler<RefundCodeChannelInterpreter>
{
  interpret(
    input: InputOf<RefundCodeChannelInterpreter>, // { ask: the approval's input, reply: the text }
  ): ChannelInterpretation<OutputOf<RefundCodeChannelInterpreter>> {
    const text = input.reply.trim().toLowerCase();
    if (text === "approve" || text === "lgtm" || text === "yes") {
      return ChannelInterpretation.understood({ approved: true });
    }
    if (text.startsWith("reject:")) {
      return ChannelInterpretation.understood({
        approved: false,
        reason: input.reply.slice("reject:".length).trim(),
      });
    }
    return ChannelInterpretation.notUnderstood("Reply with 'approve' or 'reject: <reason>'.");
  }
}

// 2. Attach the interpreter to its target: @ToolApproval({ channelInterpreter })
@ToolApproval({
  name: "refund-tool-approval",
  description: "Approves card refunds from Slack buttons or thread replies",
  input: RefundInputDto,
  respondent: PauseRespondent.Delegate,
  timeout: hours(24),
  channelInterpreter: RefundCodeChannelInterpreter,
})
export class RefundToolApproval {}
```

```ts title="src/channels/model-reply.interpreter.ts" file=src/model-reply.ts
import { ChannelInterpreter, inline } from "@agboss/core";

// a model interpreter: an empty class with a prompt (and model, modelProvider)
@ChannelInterpreter({
  name: "refund-model-channel-interpreter",
  description: "Extracts approval and optional argument overrides from natural-language Slack replies",
  model: "moonshotai/kimi-k2.6",
  prompt:
    inline("Read the original refund request and the reviewer's reply. Approve only when the reviewer clearly agrees."),
})
export class RefundModelChannelInterpreter {}
```

<!--
```ts file=src/refund-app.ts
import {
  Agent,
  Application,
  Budget,
  BudgetPeriod,
  BudgetScope,
  Channel,
  ChannelOutcome,
  EmptyEnvironment,
  Tool,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  onStart,
  secret,
  type BudgetHandler,
  type ChannelAsk,
  inline,
  Ttl,
} from "@agboss/core";
import { Text, WorkflowFinishTextDto, WorkflowStartTextDto } from "@agboss/core/dto";
import { ModelCost, ModelProvider, OpenRouterDriver } from "@agboss/core/models";
import { days, minutes, usd, type Usd } from "@agboss/core/units";
import { RefundInputDto, RefundToolApproval } from "./refund-reply.js";

export class RefundOutputDto {
  @Text({ prompt: "status" })
  status!: string;
}

@ModelProvider({
  name: "refund-model-provider",
  description: "OpenRouter",
  driver: OpenRouterDriver({ apiKey: secret("OPENROUTER_API_KEY") }),
  timeout: minutes(2),
  cost: ModelCost.fromResponse(),
})
export class RefundModelProvider {}

@Channel({
  name: "slack-refund-channel",
  description: "Posts refund approvals to Slack",
  target: RefundToolApproval,
  ttl: days(7),
})
export class SlackRefundChannel {
  send(_ask: ChannelAsk<RefundToolApproval>): Promise<ChannelOutcome<RefundToolApproval>> {
    return Promise.resolve(ChannelOutcome.awaitReply());
  }
}

@Tool({
  name: "issue_refund",
  description: "Issues a refund after approval",
  input: RefundInputDto,
  output: RefundOutputDto,
  approval: RefundToolApproval,
})
export class IssueRefundTool {
  execute({ orderId }: RefundInputDto): RefundOutputDto {
    return { status: `refunded:${orderId}` };
  }
}

@Agent({
  name: "refund-support-agent",
  description: "Processes refunds",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Process the refund."),
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
  historyTtl: Ttl.Forever,
  flow: [
    onStart(RefundReqStart)
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
  modelProvider: RefundModelProvider,
  providers: [RefundModelProvider],
  channels: [SlackRefundChannel],
  budgets: [RefAppBudget, RefTenantBudget, RefExecBudget],
})
export class RefundReqApplication {}
```
-->

```ts title="test/refund-reply.interpreter.test.ts" file=test/refund-reply.interpreter.test.ts
import { expect, it } from "vitest";
import { ChannelInterpretation } from "@agboss/core";
import { RefundCodeChannelInterpreter } from "../src/refund-reply.js";

it("interprets free-text approval and rejection replies deterministically", () => {
  const interpreter = new RefundCodeChannelInterpreter(); // a code interpreter is a plain class: no container needed

  const approved = interpreter.interpret({
    ask: { orderId: "ORD-12", amountCents: 4000 },
    reply: "LGTM",
  });
  expect(approved).toEqual(ChannelInterpretation.understood({ approved: true }));

  const unclear = interpreter.interpret({
    ask: { orderId: "ORD-12", amountCents: 4000 },
    reply: "maybe tomorrow",
  });
  expect(unclear).toEqual(
    ChannelInterpretation.notUnderstood("Reply with 'approve' or 'reject: <reason>'."),
  );
});
```

## `@ChannelInterpreter` options & `ChannelInterpretation` reference

| Option / Helper | Applies To | Description |
| :--- | :--- | :--- |
| `name` / `description` | Both | Optional (the class name in kebab-case by default; the `-reply-interpreter` suffix is gone). |
| `model` / `modelProvider` | Model | Chat model (uses a single structured answer tool, `answer-<output dto>`, and the not-understood tool) or — for an approval target only — a decision model; a decision model on an external task is `[reply-interpreter.decision-model]`. The provider follows the cascade (the interpreter's, its workflow's, its application's). Model-use keys of a profile are `channelInterpreters.<name>` (were `replyInterpreters`). |
| `prompt` / `promptVariables` | Model | Static instructions (a `PromptSource`) for interpreting the reply; the pause's `ask` and the `reply` arrive in the user message. |
| `deps` | Code | Constructor dependency tokens injected into the class. |
| `interpret(input)` | Code | `input` is `{ ask, reply }`: the approval's input (or the task's) and the text. Returns `ChannelInterpretation.understood(answer)`, validated against the target's answer DTO, or `notUnderstood(reason)`. |
| `ChannelInterpretation.notUnderstood(reason)` | Code | Rejects `app.resume({ pauseId, reply })` with `PauseError.UninterpretableReply` (`pause.uninterpretable-reply`, `.reason`) while keeping the pause `Pending`. A target without an interpreter gets `PauseError.ChannelInterpreterMissing`. |

A model interpreter on an **approval** reads the decision by name — `approve` / `approve-with-changes` / `refuse` — and may correct the call: "ok but only up to $500" is `{ approved: true, overrideInput: { amountUsd: 500 } }`, laid over the call's own arguments; an unknown decision, `approve-with-changes` without a correction, or a correction that changes the call's shape is not understood, and the corrected call passes the tool's own input strictly. A reply that does not answer ("🤷") is `replyWith(ReplyInterpreterNotUnderstoodDto, { reason })`, never a refusal. **A reply interpreter reads intent; it is not a guardrail:** put money limits where they hold whoever approved — a tool interceptor's `@BeforeTool` or the tool's or action's own code.
