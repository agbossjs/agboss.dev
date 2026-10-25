---
title: Channels, Pauses & HTTP Webhook Execution
description: "Pause workflows for human approval without blocking Node.js threads and trigger active Channel.withdraw() compensation across @Agent, @Tool, and @Action."
---

Production workflows often start from incoming HTTP webhooks (Stripe events, GitHub webhooks, Slack slash commands, CRM triggers) and pause mid-run for human sign-off before executing high-stakes tool calls. AGBoss handles human-in-the-loop pauses **out-of-process**: when a tool's `@Channel` returns `ChannelOutcome.awaitReply()`, the branch pauses while sibling parallel branches continue until nothing else can move, persisting a `PendingPause` record and releasing the worker's 30-second execution lease.

---

## Complete example: `@ChannelRole`, `@Channel`, `@ReplyInterpreter`, HTTP webhooks & test

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
import { RefundReplyInterpreter } from "./refund-reply.interpreter.js";
// @snippet
export { WorkflowFinishTextDto, WorkflowStartTextDto };
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
import {
  Channel,
  ChannelOf,
  ChannelOutcome,
  ChannelRole,
  ExecutionContext,
  PauseAnswerer,
  PauseResolution,
  Tool,
  type ChannelAsk,
  type ChannelWithdrawal,
  type ToolHandler,
} from "agboss";

// 1. Role contract: what it approves and who may answer
@ChannelRole({
  name: "refund-approval-channel",
  description: "Approves card refunds",
  approves: RefundCardInputDto,
  answeredBy: PauseAnswerer.Channel,
  replyInterpreter: RefundReplyInterpreter,
})
export abstract class RefundApprovalChannel
  extends ChannelOf<RefundApprovalChannel> {}

// 2. Transport implementation registered in @Application({ providers })
@Channel({
  name: "slack-refund-approval-channel",
  description: "Asks a finance manager in Slack and withdraws stale buttons",
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

  override withdraw(
    withdrawal: ChannelWithdrawal<RefundApprovalChannel>,
  ): Promise<void> {
    const statusText =
      withdrawal.resolution === PauseResolution.Withdrawn
        ? "Withdrawn (quorum reached or sibling branch failed)"
        : "Cancelled by operator";
    void statusText;
    return Promise.resolve();
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

```ts title="src/channels/refund-reply.interpreter.ts" file=src/refund-reply.interpreter.ts
import {
  DecidedBy,
  ReplyInterpretation,
  ReplyInterpreter,
  type InputOf,
  type OutputOf,
  type ReplyInterpreterHandler,
} from "agboss";

@ReplyInterpreter({
  name: "refund-reply-interpreter",
  description: "Parses finance manager text replies into a typed refund approval decision",
  decidedBy: DecidedBy.Code,
})
export class RefundReplyInterpreter implements ReplyInterpreterHandler<RefundReplyInterpreter> {
  interpret({ reply }: InputOf<RefundReplyInterpreter>): ReplyInterpretation<OutputOf<RefundReplyInterpreter>> {
    const normalized = reply.trim().toLowerCase();
    if (normalized === "approve" || normalized === "lgtm") {
      return ReplyInterpretation.understood({ approved: true });
    }
    if (normalized.startsWith("reject:")) {
      return ReplyInterpretation.understood({
        approved: false,
        reason: reply.slice("reject:".length).trim(),
      });
    }
    return ReplyInterpretation.notUnderstood({
      reason: "Reply must be 'approve', 'lgtm', or 'reject: <reason>'.",
    });
  }
}
```

```ts title="src/webhooks/refund-webhooks.server.ts" file=src/webhooks/refund-webhooks.server.ts
import {
  ExecutionStatus,
  NotPausedError,
  UninterpretableReplyError,
  UnknownPauseError,
  type App,
} from "agboss";
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
      { tenantId: body.tenantId, answeredBy: body.slackUserId },
    );
    return { httpStatus: 200, status: resumed.status, output: resumed.output };
  } catch (err) {
    if (err instanceof UninterpretableReplyError) {
      // Pause remains Pending! Ask the reviewer in Slack to clarify:
      return { httpStatus: 422, clarify: err.reason };
    }
    if (err instanceof NotPausedError) {
      // Duplicate button click or webhook retry — idempotent 200 OK:
      return { httpStatus: 200, status: "already_resolved" };
    }
    if (err instanceof UnknownPauseError) {
      return { httpStatus: 404, status: "unknown_or_expired_pause" };
    }
    throw err;
  }
}
```

```ts title="test/refund-pause.test.ts" file=test/refund-pause.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "agboss";
import { callTool, replyWith, testWith } from "agboss/testing";
import {
  RefundAgent,
  RefundApplication,
  RefundCardTool,
  RefundWorkflowFinish,
  WorkflowFinishTextDto,
} from "../src/refunds.js";
import {
  handleRefundWebhook,
  handleSlackReplyWebhook,
} from "../src/webhooks/refund-webhooks.server.js";

const test = testWith(RefundApplication);

test("triggers workflow via webhook, pauses for Slack approval, and resumes via webhook reply", async ({
  app,
  mockLlm,
}) => {
  mockLlm(RefundAgent).thenReturn(
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
   Call `const app = await createApp(RefundApplication, { env: "prod" })` once when your HTTP server starts. `createApp` initializes your DI container (`onInit` -> `onStart`), opens the shared SQLite/Postgres connection pool, starts the 30-second orphan recovery sweep, and validates all `@ModelProvider` and environment contracts.
2. **Use deterministic `threadId` from the webhook's domain entity:**
   When starting a workflow from a webhook (`app.execute(Start, dto, { threadId: "order:ord_99", ownerId, tenantId })`), derive `threadId` from your business entity ID (or webhook event ID) so multi-turn follow-ups and `app.cancel(threadId)` address the exact conversation thread.
3. **Return `202 Accepted` immediately when `result.status === ExecutionStatus.Paused`:**
   When a tool requires approval, `app.execute` does **not** hold open a Promise or block a Node.js thread. It checkpoints the graph, writes a `PendingPause` row, calls your `@Channel.send(ask)` (which delivers `ask.pauseId` to Slack/email/webhook), releases the execution lease, and resolves `app.execute` with `result.status === ExecutionStatus.Paused`.
4. **Resume with two-phase `app.resume()` on the callback webhook:**
   Your callback endpoint (`POST /webhooks/slack-actions`) can hit *any* replica in your cluster. Calling `app.resume({ pauseId, decision: { approved: true } }, { tenantId, answeredBy })` (or `{ pauseId, reply: freeText }`) atomically flips the pause `Pending → Resolved` in Phase 1 and acquires the 30s execution-tree lease in Phase 2.
5. **Handle webhook retries & ambiguous replies explicitly:**
   - **`NotPausedError`:** External webhook providers (Slack, Stripe, GitHub) retry on network timeouts, and humans double-click buttons. Catch `NotPausedError` and return `200 OK` idempotently.
   - **`UninterpretableReplyError`:** When a human sends a free-text reply that `@ReplyInterpreter` cannot parse (`ReplyInterpretation.notUnderstood({ reason })`), `app.resume` throws `UninterpretableReplyError` and **keeps the pause `Pending`** so your webhook can reply in the Slack thread with `err.reason` and wait for a clearer answer.
   - **`UnknownPauseError`:** The `pauseId` does not exist, belongs to another tenant, or was pruned after `pauseRecordRetention` (`hours(24)` default); return `404 Not Found`.

---

## Capability security (`PauseAnswerer`) & audit trail (`result.record.pauses`)

- **`PauseAnswerer.Channel` (External Reviewer):** `result.pending` intentionally omits `pauseId` so the caller of `app.execute` (e.g., an end user in chat) cannot approve their own tool call. Only your `@Channel.send(ask)` receives `ask.pauseId`, and `app.resume` requires `{ answeredBy: "<reviewer-id>" }`.
- **`PauseAnswerer.ThreadOwner` (End-User Confirmation):** `result.pending` includes `pauseId` so the user's client UI can render an inline Confirm/Cancel prompt, and `app.resume` verifies `{ ownerId }` matches the thread owner.
- **Automatic button cleanup (`ChannelHandler.withdraw`):** If a parallel branch pause becomes obsolete (`FailurePolicy.FailFast`, quorum `BranchVerdict.Surplus`, or `app.cancel`), AGBoss calls `withdraw(withdrawal)` on your `@Channel` with `PauseResolution.Withdrawn` or `PauseResolution.Cancelled` so your Slack/UI integration can disable stale buttons immediately.
