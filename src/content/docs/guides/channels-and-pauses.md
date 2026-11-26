---
title: Channels, Pauses & HTTP Webhook Execution
description: "Pause workflows for human approval without blocking Node.js threads: pause targets (@ToolApproval, @ExternalTask), their @Channel, deadlines, app.resume, app.pause and app.stop, and onPauseClosed()."
---

Production workflows often start from incoming HTTP webhooks (Stripe events, GitHub webhooks, Slack slash commands, CRM triggers) and pause mid-run for human sign-off before executing high-stakes tool calls. AGBoss handles human-in-the-loop pauses **out-of-process**. A pause waits under a **target** — what is asked, who may answer, for how long — and the **channel** is only the transport that tells the people: when a tool's approval target has a `@Channel` whose `send` returns `ChannelOutcome.awaitReply()`, the branch pauses while sibling parallel branches continue until nothing else can move, persisting a `PendingPause` record and releasing the worker's 30-second execution lease.

---

## Complete example: `@ToolApproval`, `@Channel`, `@ChannelInterpreter`, HTTP webhooks & test

```ts title="src/refunds.ts" file=src/refunds.ts
import {
  Agent,
  Application,
  Budget,
  BudgetPeriod,
  BudgetScope,
  Channel,
  ChannelInterpretation,
  ChannelInterpreter,
  ChannelOutcome,
  EmptyEnvironment,
  PauseRespondent,
  Tool,
  ToolApproval,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  inline,
  onStart,
  secret,
  Ttl,
  type BudgetHandler,
  type ChannelAsk,
  type ChannelInterpreterHandler,
  type InputOf,
  type OutputOf,
} from "@agboss/core";
import { Integer, Text, WorkflowFinishTextDto, WorkflowStartTextDto } from "@agboss/core/dto";
import { ModelCost, ModelProvider, OpenRouterDriver } from "@agboss/core/models";
import { days, hours, minutes, usd, type Usd } from "@agboss/core/units";

export { WorkflowFinishTextDto };

export class RefundCardInputDto {
  @Text({ prompt: "order id" })
  orderId!: string;

  @Integer({ prompt: "refund amount in cents" })
  amountCents!: number;
}

export class RefundCardOutputDto {
  @Text({ prompt: "refund status" })
  status!: string;
}

// 1. A code interpreter: free text -> a typed decision (a model interpreter is an empty class with a prompt)
@ChannelInterpreter({
  name: "refund-channel-interpreter",
  description: "Parses finance manager text replies into a typed refund approval decision",
})
export class RefundChannelInterpreter implements ChannelInterpreterHandler<RefundChannelInterpreter> {
  interpret({ reply }: InputOf<RefundChannelInterpreter>): ChannelInterpretation<OutputOf<RefundChannelInterpreter>> {
    const trimmed = reply.trim();
    const normalized = trimmed.toLowerCase();
    const reason = trimmed.slice("reject:".length);
    if (normalized === "approve" || normalized === "lgtm") {
      return ChannelInterpretation.understood({ approved: true });
    }
    if (normalized.startsWith("reject:")) {
      return ChannelInterpretation.understood({
        approved: false,
        reason: reason.trim(),
      });
    }
    return ChannelInterpretation.notUnderstood("Reply must be 'approve', 'lgtm', or 'reject: <reason>'.");
  }
}

// 2. The target: what is approved, who may answer, until when (no transport here)
@ToolApproval({
  name: "refund-tool-approval",
  description: "Finance approves card refunds",
  input: RefundCardInputDto,
  respondent: PauseRespondent.Delegate, // Slack authenticates who answers
  timeout: hours(24), // a hard deadline, fixed when the pause is made
  remindBefore: hours(2), // the channel hears onPauseExpiring
  channelInterpreter: RefundChannelInterpreter,
})
export class RefundToolApproval {}

// 3. Its channel: infrastructure only, listed in @Application({ channels })
@Channel({
  name: "slack-refund-channel",
  description: "Posts the approval buttons to #finance-approvals",
  target: RefundToolApproval,
  ttl: days(7),
})
export class SlackRefundChannel {
  send(_ask: ChannelAsk<RefundToolApproval>): Promise<ChannelOutcome<RefundToolApproval>> {
    return Promise.resolve(ChannelOutcome.awaitReply()); // ask.pauseId is the reply key
  }

  // at least once, whenever a pause this channel sent closes: take the buttons down
  onPauseClosed(): void {}
}

// 4. The tool names the target, never the channel
@Tool({
  name: "refund_card",
  description: "Refunds a card payment",
  input: RefundCardInputDto,
  output: RefundCardOutputDto,
  approval: RefundToolApproval,
})
export class RefundCardTool {
  execute({ orderId }: RefundCardInputDto): RefundCardOutputDto {
    return { status: `refunded ${orderId}` };
  }
}

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
  name: "refund-agent",
  description: "Processes refunds",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Process the refund with refund_card."),
  tools: [RefundCardTool],
})
export class RefundAgent {}

@Workflow({
  name: "refund-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [
    onStart(RefundWorkflowStart)
      .toAgent(RefundAgent)
      .toFinish(RefundWorkflowFinish),
  ],
})
export class RefundWorkflow {}

@Budget({ name: "refund-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class RefundAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(10); } }
@Budget({ name: "refund-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class RefundTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(2); } }
@Budget({ name: "refund-exec-budget", scope: BudgetScope.Execution })
export class RefundExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "refund-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [RefundWorkflow],
  modelProvider: RefundModelProvider,
  providers: [RefundModelProvider],
  channels: [SlackRefundChannel], // a target's channel is listed here, never in a workflow
  budgets: [RefundAppBudget, RefundTenantBudget, RefundExecBudget],
})
export class RefundApplication {}
```

```ts title="src/webhooks/refund-webhooks.server.ts" file=src/webhooks/refund-webhooks.server.ts
import {
  ExecutionStatus,
  PauseError,
  type App,
} from "@agboss/core";
import { RefundWorkflowStart } from "../refunds.js";

// 1. Trigger a workflow from an incoming HTTP webhook (e.g. POST /webhooks/refund-request)
export async function handleRefundWebhook(
  app: Pick<App, "execute">,
  body: { orderId: string; tenantId: string; userId: string },
) {
  const result = await app.execute(
    RefundWorkflowStart,
    { text: `Refund ${body.orderId}` },
    {
      threadId: `order:${body.orderId}`,
      ownerId: body.userId,
      tenant: { tenantId: body.tenantId },
    },
  );

  if (result.status === ExecutionStatus.Paused) {
    return {
      httpStatus: 202,
      state: "awaiting_approval",
      threadId: result.threadId,
    };
  }

  return {
    httpStatus: 200,
    state: "completed",
    output: result.output,
  };
}

// 2. Resume a paused workflow from a Slack button or reply webhook (POST /webhooks/slack-reply)
export async function handleSlackReplyWebhook(
  app: Pick<App, "resume">,
  body: { pauseId: string; replyText: string; tenantId: string; slackUserId: string },
) {
  try {
    const resumed = await app.resume(
      { pauseId: body.pauseId, reply: body.replyText },
      { tenantId: body.tenantId, actor: { id: body.slackUserId } }, // a Delegate target: who answered
    );
    return { httpStatus: 200, status: resumed.status, output: resumed.output };
  } catch (err) {
    if (err instanceof PauseError.UninterpretableReply) {
      // Pause remains Pending! Ask the reviewer in Slack to clarify:
      return { httpStatus: 422, clarify: err.reason };
    }
    if (err instanceof PauseError.Closed) {
      // Duplicate button click, webhook retry or a late answer (err.reason) — idempotent 200 OK:
      return { httpStatus: 200, status: "already_resolved" };
    }
    if (err instanceof PauseError.UnknownPause) {
      return { httpStatus: 404, status: "unknown_or_expired_pause" };
    }
    throw err;
  }
}
```

```ts title="test/refund-pause.test.ts" file=test/refund-pause.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "@agboss/core";
import { callTool, replyWith, testWith } from "@agboss/core/testing";
import {
  RefundAgent,
  RefundApplication,
  RefundCardTool,
  RefundWorkflowFinish,
} from "../src/refunds.js";
import {
  handleRefundWebhook,
  handleSlackReplyWebhook,
} from "../src/webhooks/refund-webhooks.server.js";

const test = testWith(RefundApplication);

test("triggers workflow via webhook, pauses for Slack approval, and resumes via webhook reply", async ({
  app,
  mockModel,
}) => {
  mockModel(RefundAgent).thenReturn(
    callTool(RefundCardTool, { orderId: "ord_99", amountCents: 15_000 }),
    replyWith("Refunded ord_99"),
  );

  const triggered = await handleRefundWebhook(app, {
    orderId: "ord_99",
    tenantId: "acme",
    userId: "customer-1",
  });
  expect(triggered.httpStatus).toBe(202);
  expect(triggered.state).toBe("awaiting_approval");

  const missingPause = await handleSlackReplyWebhook(app, {
    pauseId: "non-existent-pause",
    replyText: "lgtm",
    tenantId: "acme",
    slackUserId: "manager-17",
  });
  expect(missingPause.httpStatus).toBe(404);
  expect(ExecutionStatus.Paused).toBeDefined();
  expect(RefundWorkflowFinish).toBeDefined();
});
```

---

## How to run & resume workflows via HTTP webhooks in production

When embedding AGBoss inside an HTTP server (Fastify, Express, Hono, Next.js route handlers, or NestJS), follow these five architectural rules:

1. **Boot `createApp` once at process startup — never per request:**
   Call `const app = await createApp(RefundApplication, { env: "prod", handleSignals: true })` once when your HTTP server starts. `createApp` initializes your DI container (`onInit` -> `onStart`), opens the storage's connection pool, starts the 30-second orphan recovery sweep, and validates all `@ModelProvider` and environment contracts. It listens for `SIGTERM` / `SIGINT` only with `handleSignals: true`.
2. **Use deterministic `threadId` from the webhook's domain entity:**
   When starting a workflow from a webhook (`app.execute(Start, dto, { threadId: "order:ord_99", ownerId, tenant: { tenantId } })`), derive `threadId` from your business entity ID (or webhook event ID) so multi-turn follow-ups and `app.cancel(threadId, { tenantId })` address the exact conversation thread.
3. **Return `202 Accepted` immediately when `result.status === ExecutionStatus.Paused`:**
   When a tool requires approval, `app.execute` does **not** hold open a Promise or block a Node.js thread. It checkpoints the graph, writes a `PendingPause` row, calls your `@Channel.send(ask)` (which delivers `ask.pauseId` to Slack/email/webhook), releases the execution lease, and resolves `app.execute` with `result.status === ExecutionStatus.Paused`.
4. **Resume with two-phase `app.resume()` on the callback webhook:**
   Your callback endpoint (`POST /webhooks/slack-actions`) can hit *any* replica in your cluster. Calling `app.resume({ pauseId, decision: { approved: true } }, { tenantId, actor: { id } })` (or `{ pauseId, reply: freeText }`) atomically flips the pause `Pending → Resolved` in Phase 1 and acquires the 30s execution-tree lease in Phase 2. With a `tenantContext` the `{ tenantId }` is required by the tenant gate.
5. **Handle webhook retries & ambiguous replies explicitly:**
   - **`PauseError.Closed`:** External webhook providers (Slack, Stripe, GitHub) retry on network timeouts, and humans double-click buttons. The pause is closed and `err.reason` says why (`answered`, `expired`, `cancelled`, `withdrawn`, `tree-ended`, `reassigned`): catch it and return `200 OK` idempotently.
   - **`PauseError.UninterpretableReply`:** When a human sends a free-text reply that the target's `@ChannelInterpreter` cannot parse (`ChannelInterpretation.notUnderstood(reason)`), `app.resume` throws `PauseError.UninterpretableReply` and **keeps the pause `Pending`** so your webhook can reply in the Slack thread with `err.reason` and wait for a clearer answer.
   - **`PauseError.UnknownPause`:** The `pauseId` does not exist, belongs to another tenant, or was pruned after `retention.pauseRecords` (`hours(24)` default); return `404 Not Found`.

---

## Who may answer (`PauseRespondent`), deadlines & the audit trail (`result.record.pauses`)

- **`PauseRespondent.Delegate` (an external reviewer):** `result.pending` intentionally omits `pauseId` so the caller of `app.execute` (e.g., an end user in chat) cannot approve their own tool call. Only your `@Channel.send(ask)` receives `ask.pauseId`, and `app.resume` requires `{ actor: { id } }`, recorded as who answered.
- **`PauseRespondent.Owner` (end-user confirmation):** `result.pending` includes `pauseId` so the user's client UI can render an inline Confirm/Cancel prompt, and `app.resume` verifies `{ ownerId }` matches the thread owner. An owner's pause needs no channel at all.
- **`respondent` is who may answer, `actor` is who did.** The wrong credential is `PauseError.PermissionDenied`; the target's `permitAnswer(ctx)` is enforced before an answer is recorded.
- **A hard deadline:** the target's `timeout` (`hours(24)`, or `workHours(8)` with a `@WorkingCalendar`) gives every pause an absolute deadline, fixed when the pause is made; an answer at or after it is `PauseError.Closed` (`reason: expired`), and the target's `onExpired` says what the expiry means — `PauseExpiration.fail()`, `.decide(answer)` or `.reassign(…)` (an escalation). `remindBefore` makes the channel's `onPauseExpiring` hear "expiring at …" once.
- **Move a pause:** `app.extendPause({ pauseId, expiresIn: hours(24) }, { actor })` moves an open pause's deadline; `app.reassignPause({ pauseId, assignees: ["deputy-3"] }, { actor })` moves it to another addressee, or to a target of `escalatesTo`; `app.listPauses({ tenantId, target, status, expiringBefore })` pages the pauses of one target.
- **Automatic button cleanup (`onPauseClosed`):** Whenever a pause your `@Channel` sent closes — a parallel branch became obsolete (a failed branch, quorum `BranchVerdict.Surplus`), `app.cancel`, an expiry, a reassignment, or an answer given elsewhere — AGBoss tells it, at least once, through `onPauseClosed(event)` with `event.reason` (`PauseClosedReason`), so your Slack/UI integration can disable stale buttons. Deduplicate by `event.deliveryId`. `@ChannelListener` hears the same events for every pause of the application.

## Operator commands: `app.cancel`, `app.stop`, `app.pause` and `app.unpause`

An operator can act on a running or resting thread from any instance:

| Command | What it does | Result |
| :--- | :--- | :--- |
| `app.cancel(threadId, { tenantId, reason? })` | Stops it and **undoes** what it did (`compensateWith`); a hard fence: nothing of the tree is written after it. Its pauses close (`Cancelled`). | `app.execute` / `app.resume` resolve `ExecutionStatus.Cancelled` (an undo that fails still rejects) |
| `app.stop(threadId, { tenantId, reason?, mode? })` | Halts it where it stands: what it did is kept and **nothing is undone**. `mode: InterruptMode.AfterStep` (default) lets the step in flight finish; `Immediate` aborts it. Its pauses close as `TreeEnded`. | `ExecutionStatus.Stopped`; `{ state: StopRequestState }` |
| `app.pause(threadId, { tenantId, reason, mode })` | Freezes it at its checkpoint — an operator's freeze, apart from a business pause. | `ExecutionStatus.Paused` with `isExternallyPaused: true` |
| `app.unpause(threadId, { tenantId, reason })` | Continues it from the checkpoint; at a business pause it lifts only the freeze and takes what was decided meanwhile. | the execution's output |

`Cancel > Stop > Pause`: a stop or cancel ends a parked tree, and a pause of a tree being cancelled or stopped is refused. A step or tool call registers `executionContext.onInterrupted(cleanup)` for a cleanup that runs only if it is interrupted (`InterruptReason`: `Paused`, `Stopped`, `Cancelled`, `TimedOut`, `HandedOver`), bounded together by `executionLimits.shutdownTimeout`. The thread's history reads `running`, `stopping`, `stopped`, `pausing`, `externally-paused`, `dual-paused` (`app.getStatusHistory`).
