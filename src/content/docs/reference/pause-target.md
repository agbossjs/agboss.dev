---
title: "@ToolApproval & @ExternalTask"
description: "Complete API reference for pause targets in AGBoss — @ToolApproval and @ExternalTask, PauseRespondent, deadlines, reminders and escalation. A pause waits under a target; a @Channel only carries it. Replaces @ChannelRole."
---

A pause waits under a **pause target** — what is asked, who may answer, for how long. The **channel** is only the transport that tells the people ([`@Channel`](/reference/channel/)). A target is an **empty class** with one of two decorators (`"@agboss/core"`, `channels/*.tool-approval.ts`, `channels/*.external-task.ts`), and it replaces 0.1.0's `@ChannelRole` and its two forms:

- **`@ToolApproval({ name, description, input, respondent, timeout })`** — an approval before a `@Tool` runs: `@Tool({ approval: RefundToolApproval })` names the target, never the channel. Its `input` is the input of every tool that names it (`[channel.wrong-tool]` otherwise); its answer is a `ToolCallApprovalDecisionDto` (`{ approved, reason?, overrideInput? }`).
- **`@ExternalTask({ name, description, input, output, respondent, timeout })`** — a question the workflow asks and the answer goes on the path: `.toExternalTask(Task)` reads one `input` value from the path, pauses on the task's channel, and puts the typed `output` on the path for the steps after it. It is also a branch of a parallel launch and a tool of an agent.

`respondent` is required: `PauseRespondent.Owner` (the thread's owner answers, by the `pauseId` in `result.pending`) or `PauseRespondent.Delegate` (someone the channel authenticates answers, by the `pauseId` only the channel knows). It replaces `PauseAnswerer.Channel` / `ThreadOwner`. An approval the thread's owner answers needs **no channel** at all: a `@ToolApproval` with `PauseRespondent.Owner` and no `@Channel`, answered in the terminal by `npx agboss chat` / `run` or by `app.resume`.

## Complete example: refunds approved in Slack, and a spending-limit question

```ts title="src/refunds/dto/refund.dto.ts" file=src/refunds/dto/refund.dto.ts
import { Integer, Text } from "@agboss/core/dto";

export class RefundRequestDto {
  @Text({ prompt: "the order to refund" })
  orderId!: string;

  @Integer({ prompt: "the amount in cents", min: 1 })
  amountCents!: number;
}

export class RefundDoneDto {
  @Text({ prompt: "the refund's id" })
  refundId!: string;
}
```

```ts title="src/refunds/tool-approvals/refund.tool-approval.ts" file=src/refunds/tool-approvals/refund.tool-approval.ts
// the target: what is approved, who may answer, for how long — no transport here
import { PauseRespondent, ToolApproval } from "@agboss/core";
import { hours } from "@agboss/core/units";
import { RefundRequestDto } from "../dto/refund.dto.js";

@ToolApproval({
  name: "refund-tool-approval",
  description: "A manager approves refunds",
  input: RefundRequestDto, // the input of every tool naming it
  respondent: PauseRespondent.Delegate, // Slack authenticates who answers
  timeout: hours(24), // a hard deadline, fixed when the pause is made
  remindBefore: hours(2), // the channel hears onPauseExpiring two hours before it
})
export class RefundToolApproval {}
```

```ts title="src/refunds/tools/refund.tool.ts" file=src/refunds/tools/refund.tool.ts
// names the target; runs only once a call is approved
import { ExecutionContext, Tool } from "@agboss/core";
import { RefundDoneDto, RefundRequestDto } from "../dto/refund.dto.js";
import { RefundToolApproval } from "../tool-approvals/refund.tool-approval.js";

@Tool({
  name: "refund-tool",
  description: "Refunds an order",
  input: RefundRequestDto,
  output: RefundDoneDto,
  approval: RefundToolApproval, // the target, never the channel
  deps: [ExecutionContext],
})
export class RefundTool {
  constructor(private readonly executionContext: ExecutionContext) {}

  execute({ orderId }: RefundRequestDto): RefundDoneDto {
    return { refundId: `${orderId}:${this.executionContext.step.idempotencyKey}` };
  }
}
```

```ts title="src/purchases/spending-limit.external-task.ts" file=src/purchases/spending-limit.external-task.ts
// a question the workflow asks: what is asked, what answers it, who may answer, for how long
import { ExternalTask, PauseRespondent } from "@agboss/core";
import { Bool, Integer, Text } from "@agboss/core/dto";
import { days } from "@agboss/core/units";

export class PurchaseDto {
  @Text({ prompt: "what is bought" })
  item!: string;

  @Integer({ prompt: "its price in dollars", min: 0 })
  priceUsd!: number;
}

export class SpendingLimitDto {
  @Bool({ prompt: "whether the purchase may go on" })
  approved!: boolean;

  @Integer({ prompt: "the most it may cost, in dollars", min: 0 })
  limitUsd!: number;
}

@ExternalTask({
  name: "spending-limit-external-task", // a task's name ends with -external-task
  description: "Asks the budget owner for this purchase's limit",
  input: PurchaseDto,
  output: SpendingLimitDto,
  respondent: PauseRespondent.Owner, // the thread's owner answers, by the listed pauseId
  timeout: days(3),
  maxVisits: 3, // the step's limit when it is asked again on a cycle
})
export class SpendingLimitExternalTask {}
```

<!--
```ts file=src/refunds/channels/slack-refund.channel.ts
import { Channel, ChannelOutcome, type ChannelAsk } from "@agboss/core";
import { days } from "@agboss/core/units";
import { RefundToolApproval } from "../tool-approvals/refund.tool-approval.js";

@Channel({
  name: "slack-refund-channel",
  description: "Asks a manager in Slack",
  target: RefundToolApproval,
  ttl: days(7),
})
export class SlackRefundChannel {
  send(_ask: ChannelAsk<RefundToolApproval>): Promise<ChannelOutcome<RefundToolApproval>> {
    return Promise.resolve(ChannelOutcome.awaitReply());
  }
}
```

```ts file=src/refunds/refund.application.ts
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
  onStart,
  secret,
  type BudgetHandler,
  inline,
  Ttl,
} from "@agboss/core";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "@agboss/core/dto";
import { ModelCost, ModelProvider, OpenRouterDriver } from "@agboss/core/models";
import { minutes, usd, type Usd } from "@agboss/core/units";
import { SlackRefundChannel } from "./channels/slack-refund.channel.js";
import { RefundTool } from "./tools/refund.tool.js";

@ModelProvider({
  name: "refund-model-provider",
  description: "OpenRouter for the refund agent",
  driver: OpenRouterDriver({ apiKey: secret("OPENROUTER_API_KEY") }),
  timeout: minutes(2),
  cost: ModelCost.fromResponse(),
})
export class RefundModelProvider {}

@WorkflowStart({ name: "refund-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class RefundWorkflowStart {}

@WorkflowFinish({ name: "refund-workflow-finish", description: "Finish", output: WorkflowFinishTextDto })
export class RefundWorkflowFinish {}

@Agent({
  name: "refund-support-agent",
  description: "Handles refund requests",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Process refund requests using refund-tool."),
  tools: [RefundTool],
})
export class RefundSupportAgent {}

@Workflow({
  name: "refund-support-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [
    onStart(RefundWorkflowStart)
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
  modelProvider: RefundModelProvider,
  providers: [RefundModelProvider],
  channels: [SlackRefundChannel], // a target's channel is listed here, never in a workflow
  budgets: [RefAppBudget, RefTenantBudget, RefExecBudget],
})
export class RefundSupportApplication {}
```
-->

```ts title="test/refund.tool-approval.test.ts" file=test/refund.tool-approval.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "@agboss/core";
import { callTool, testWith } from "@agboss/core/testing";
import { RefundTool } from "../src/refunds/tools/refund.tool.js";
import {
  RefundSupportAgent,
  RefundSupportApplication,
  RefundWorkflowStart,
} from "../src/refunds/refund.application.js";

const test = testWith(RefundSupportApplication);

test("pauses the tool call under RefundToolApproval until a manager answers", async ({
  app,
  mockModel,
}) => {
  mockModel(RefundSupportAgent).thenReturn(
    callTool(RefundTool, { orderId: "ch_901", amountCents: 15_000 }),
  );
  const res = await app.execute(RefundWorkflowStart, { text: "Refund ch_901" });
  expect(res.status).toBe(ExecutionStatus.Paused);
});
```

## What options do `@ToolApproval` and `@ExternalTask` accept?

| Option | Applies To | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | Both | `string` | Yes | Kebab-case identifier ending with `-tool-approval` or `-external-task` (the class ends with `ToolApproval` / `ExternalTask`); it keys the target's pauses (`app.listPauses({ target })`). |
| `description` | Both | `string` | Yes | Explains what human decision this pause requests. |
| `input` | Both | `DtoClass` | Approval: no, Task: yes | What is asked. An approval's is the input of every tool naming it; a task's is read from the path. |
| `output` | `@ExternalTask` | `DtoClass` | Yes | What answers it, validated before it is recorded, and put on the path. |
| `respondent` | Both | `PauseRespondent.Owner \| PauseRespondent.Delegate` | Yes | Who may answer: the thread's owner (`ownerId`) or a delegate the channel authenticates (`actor`). The wrong credential is `PauseError.PermissionDenied`. |
| `timeout` | Both | `Milliseconds \| WorkingDuration` | Yes | A hard deadline for every pause of the target, fixed when the pause is made — `hours(24)`, at least `seconds(1)`, or `workHours(8)` with a `calendar`. A deploy that changes it never moves an open pause; `resolveTimeout(ctx)` on the class chooses one per pause. There is no per-step override: a second target has the other `timeout`. |
| `remindBefore` | Both | `Milliseconds \| WorkingDuration` | No | A positive duration shorter than `timeout` (`[pause.remind-before-invalid]`): the channel's `onPauseExpiring` hears "expiring at …" once per deadline. |
| `calendar` | Both | `Class` | For working durations | A `@WorkingCalendar` class (`WorkingWeek.of({ timeZone, days, hours, breaks?, holidays? })`) that counts `workHours`, `workMin` and `workDays` (`[calendar.required-for-working-duration]`). The deadline is computed once, when the pause opens. |
| `channelInterpreter` | Both | `Class` | No | The [`@ChannelInterpreter`](/reference/channel-interpreter/) that reads a free-text `app.resume({ pauseId, reply })` into the typed answer. One interpreter on two targets is `[channel.shared-interpreter]`. |
| `escalatesTo` / `escalationLimits` | Both | `readonly Class[]` / `PauseEscalationLimits` | No | Targets of the same kind and DTOs a pause may be reassigned to, and a bound on extensions, reassignments and total time. |
| `maxVisits` | `@ExternalTask` | `number` | No | The step's limit when it is asked again on a cycle. |
| `deps` | Both | `readonly Token[]` | No | Constructor dependencies for the optional hooks. |

Optional hooks on the class: `assign(ctx)` picks the assignees of a new pause, `resolveTimeout(ctx)` its deadline, `permitAnswer(ctx)` whether an answer is taken (a refusal is `PauseError.PermissionDenied`; enforced by `app.resume` after the answer is read and validated and before it is recorded), `permitTimeoutChange(ctx)` and `permitReassign(ctx)` for `extendPause` and `reassignPause`, and `onExpired(ctx)` for what an expiry means: `PauseExpiration.fail()` (the step fails with `StepError.PauseExpired`, the default), `PauseExpiration.decide(answer)` (the step goes on with that answer, recorded as answered by the framework) or `PauseExpiration.reassign({ target?, channel?, assignees?, timeout?, reason? })` (the escalation: "the manager did not answer, ask the director").

## How a pause lives

1. Before every call of the tool (or at the task's step) the framework creates a pause record and calls the target's channel; an `Owner` target with no channel asks nobody and waits for `app.resume`.
2. The channel's `send(ask)` returns `ChannelOutcome.decided(answer)` (go on at once) or `ChannelOutcome.awaitReply()` (the execution rests: `result.status === ExecutionStatus.Paused`, `result.pending`).
3. Later `app.resume({ pauseId, decision }, { tenantId, actor | ownerId })` — or `{ pauseId, reply }`, read by the interpreter — answers it. Exactly one answer wins (`PauseError.Closed` for the second); another instance continues it; `app.cancel` withdraws it.
4. A pause answers one of: `Pending → Resolved → Taken`, or `Cancelled`. The deadline is hard: an answer at or after it is `PauseError.Closed` (`reason: expired`).

`result.pending[i]` is a `PendingPause`: `kind` (`PauseKind.Approval` or `PauseKind.ExternalTask`), `pauseId?` (`Owner` targets only), `respondent`, `step`, `target`, `channel?`, `input` (masked), `toolCall` for an approval, `expiresAt`, `assignees?`. A parallel launch's branches pause on their own; an expired branch in a quorum did not vote.

## What related entities work with a pause target?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| [`@Channel`](/reference/channel/) | `"@agboss/core"` | The transport of a target (`@Channel({ target, ttl })`), listed in `@Application({ channels })`. |
| `@ChannelSelector({ target })` | `"@agboss/core"` | Picks one of several channels of a target when a pause is made (`selectChannel(ctx)`, listed in `@Application({ channelSelectors })`; `[channel.ambiguous-for-target]` without it). |
| `@ChannelListener` | `"@agboss/core"` | An application-wide class told of every pause (`onPauseOpened`, `onPauseClosed`, `onPauseExpiring`, …), listed in `@Application({ channelListeners })`. |
| [`@ChannelInterpreter`](/reference/channel-interpreter/) | `"@agboss/core"` | Reads a free-text reply into the target's typed answer. |
| `app.resume`, `app.extendPause`, `app.reassignPause`, `app.listPauses` | `"@agboss/core"` | Answer a pause, move its deadline, move it to another addressee, list the pauses of a target. |
| `AutoApproveChannel.for(Target)` & `AutoRejectChannel.for(Target)` | `"@agboss/core/testing"` | Replace a target's channel in `testWith(App, { services: [...] })`. |
| `ToolCallApprovalAskDto` & `ToolCallApprovalDecisionDto` | `"@agboss/core/dto"` | Standard DTOs of a `@ToolApproval`. |

Removed from 0.1.0: `@ChannelRole`, `ChannelOf`, `PauseAnswerer`, `PauseKind.Question`, `@Tool({ channel })`, `TerminalUserChannel`, `answeredBy` (`answerer`, then `respondent`), `ChannelWithdrawal` and `withdraw` (`onPauseClosed`).
