---
title: "@Action"
description: Complete API reference for the @Action decorator in AGBoss — deterministic workflow graph nodes, ActionHandler<Self>, DI, idempotency, and testUnit().
---

The `@Action` decorator defines a deterministic code node (`actions/*.action.ts`) in a `@Workflow` graph that runs without calling an LLM. Actions read typed DTOs from the workflow's Path Scope, inject `@Injectable` services and `ExecutionContext` through their constructor, and either return a new DTO to the path (its declared `output`) or perform a side effect (`void`) before transitioning to the next node. `execute` is sync or async: a pure data mapping returns its value.

## Complete `@Action` examples (value-producing and side-effect-only)

```ts title="src/actions/send-offer.action.ts" file=src/actions/send-offer.action.ts
import {
  Action,
  ExecutionContext,
  SpendRecorder,
  optional,
  type ActionHandler,
  type InputOf,
  type OutputOf,
} from "@agboss/core";
import { Text } from "@agboss/core/dto";
import { seconds, usd } from "@agboss/core/units";
import { MailerService } from "../services/mailer.service.js";
import { DraftApprovedDto, OfferDraftDto } from "../dto/offer.dto.js";

export class DeliveryReceiptDto {
  @Text({ prompt: "External message provider receipt ID" })
  receiptId!: string;
}

// 1. Value-producing @Action (declares output: the next step reads it from the path):
@Action({
  name: "send-offer-action",
  description: "Sends the approved offer letter via the mailer service with an idempotency key",
  input: {
    draft: OfferDraftDto,
    approval: DraftApprovedDto,
  },
  output: DeliveryReceiptDto,
  timeout: seconds(20), // optional: a step past it fails with StepError.ActionOutcomeUnknown, and its signal aborts
  deps: [ExecutionContext, SpendRecorder, MailerService],
})
export class SendOfferAction implements ActionHandler<SendOfferAction> {
  constructor(
    private readonly executionContext: ExecutionContext,
    private readonly spendRecorder: SpendRecorder,
    private readonly mailerService: MailerService,
  ) {}

  async execute(input: InputOf<SendOfferAction>): Promise<OutputOf<SendOfferAction>> {
    // each input field is the DTO itself (Tracked<Dto, Producer>): input.draft.letterText
    const receiptId = await this.mailerService.sendDocument({
      body: input.draft.letterText,
      idempotencyKey: this.executionContext.step.idempotencyKey,
      signal: this.executionContext.signal,
    });
    this.spendRecorder.record({ service: "docusign-api", cost: usd(0.05) });
    return { receiptId };
  }
}

// 2. Side-effect-only @Action (no output: it gives the path nothing):
@Action({
  name: "notify-recruiter-action",
  description: "Alerts the recruiting channel when an offer loop fails",
  input: {
    draft: optional(OfferDraftDto),
  },
  deps: [MailerService],
})
export class NotifyRecruiterAction implements ActionHandler<NotifyRecruiterAction> {
  constructor(private readonly mailerService: MailerService) {}

  async execute(input: InputOf<NotifyRecruiterAction>): Promise<void> {
    await this.mailerService.notifySlack(
      `Manual review needed for draft: ${input.draft?.letterText ?? "none"}`,
    );
  }
}
```

```ts title="src/services/mailer.service.ts" file=src/services/mailer.service.ts
import { Injectable } from "@agboss/core";

@Injectable()
export class MailerService {
  sendDocument(opts: {
    body: string;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<string> {
    return Promise.resolve(`msg_${opts.idempotencyKey}`);
  }

  notifySlack(_message: string): Promise<void> {
    return Promise.resolve();
  }
}
```

```ts title="src/dto/offer.dto.ts" file=src/dto/offer.dto.ts
import { Text } from "@agboss/core/dto";

export class OfferDraftDto {
  @Text({ prompt: "Offer letter text" })
  letterText!: string;
}

export class DraftApprovedDto {
  @Text({ prompt: "Approval summary" })
  summary!: string;
}
```

```ts title="src/workflows/offer-delivery.workflow.ts" file=src/workflows/offer-delivery.workflow.ts
import {
  StepError,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  onStart,
  toAction,
  Ttl,
} from "@agboss/core";
import {
  DeliveryReceiptDto,
  NotifyRecruiterAction,
  SendOfferAction,
} from "../actions/send-offer.action.js";
import { DraftApprovedDto, OfferDraftDto } from "../dto/offer.dto.js";
import { MailerService } from "../services/mailer.service.js";

@WorkflowStart({
  name: "offer-delivery-workflow-start",
  description: "Starts offer delivery",
  input: {
    draft: OfferDraftDto,
    approval: DraftApprovedDto,
  },
})
export class OfferDeliveryStart {}

@WorkflowFinish({
  name: "offer-delivery-workflow-finish",
  description: "Returns delivery receipt",
  output: DeliveryReceiptDto,
})
export class OfferDeliveryFinish {}

@WorkflowFinish({
  name: "offer-alerted-workflow-finish",
  description: "Finishes after recruiter alert",
  output: OfferDraftDto,
})
export class OfferAlertedFinish {}

@Workflow({
  name: "offer-delivery-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  providers: [MailerService],
  flow: [
    onStart(OfferDeliveryStart)
      .toAction(SendOfferAction)
      .onError(
        StepError,
        toAction(NotifyRecruiterAction)
          .toFinish(OfferAlertedFinish),
      )
      .toFinish(OfferDeliveryFinish),
  ],
})
export class OfferDeliveryWorkflow {}
```

<!--
```ts file=src/offer.application.ts
import { Application, Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, type BudgetHandler } from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";
import { OfferDeliveryWorkflow } from "./workflows/offer-delivery.workflow.js";

@Budget({ name: "act-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class ActAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(20); } }
@Budget({ name: "act-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class ActTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "act-exec-budget", scope: BudgetScope.Execution })
export class ActExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "offer-delivery-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [OfferDeliveryWorkflow],
  budgets: [ActAppBudget, ActTenantBudget, ActExecBudget],
})
export class OfferDeliveryApplication {}
```
-->

```ts title="test/send-offer.action.test.ts" file=test/send-offer.action.test.ts
import { expect, it } from "vitest";
import { Injectable } from "@agboss/core";
import { testUnit } from "@agboss/core/testing";
import { SendOfferAction } from "../src/actions/send-offer.action.js";
import { MailerService } from "../src/services/mailer.service.js";

@Injectable()
class FakeMailerService extends MailerService {
  override sendDocument(): Promise<string> {
    return Promise.resolve("msg-9001");
  }
}

it("sends the approved draft and returns the receipt DTO", async () => {
  const runAction = testUnit(SendOfferAction, { services: [FakeMailerService] });

  const { output, spend } = await runAction({
    draft: { letterText: "Welcome to Acme!" }, // plain DTO literals, tracked by default
    approval: { summary: "Approved by VP" },
  });

  expect(output).toEqual({ receiptId: "msg-9001" });
  expect(spend.totalUsd).toBeCloseTo(0.05);
});
```

## What options does `@Action` accept?

Every `@Action` class name ends with `Action` and its `name` option ends with `-action`:

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier ending with `-action` (e.g., `"send-offer-action"`). |
| `description` | `string` | Yes | Human-readable summary of what the action does for Studio graphs and logs. |
| `input` | `InputFields` | No | Map of DTOs read from the workflow's Path Scope (`{ draft: OfferDraftDto, approval: optional(DraftApprovedDto) }`). An action that declares no `input` has `execute()`. |
| `output` | `OutputShape` | No | DTO class, `listOf(Dto)`, or `oneOf(A, B)` returned by `execute()` (a plain object; a `oneOf` result is told apart by its strict schema). Omit `output` for side-effect-only actions. |
| `compensateWith` | `Class` | No | Deterministic `@Action` class that reverses this action's external side effect on error paths (verified by `agboss check` via `[flow.uncompensated-action]`) and automatically in LIFO order on `app.cancel`, a failed branch, quorum `Surplus`, or `@Budget` abort. A child workflow's undoable actions bubble up to its parent. |
| `committedBy` | `Class` | No | Optional downstream `@Action` class that finalizes the side effect so subsequent errors or cancellations no longer trigger `compensateWith`. |
| `timeout` | `Milliseconds` | No | A bound on `execute`. An action has **no** timeout by default (a tool's is 30 s). A step past it fails with `StepError.ActionOutcomeUnknown` (`step.action.outcome-unknown`): `executionContext.signal` aborts at the timeout, a late write through `Idempotency` is refused, and nothing retries or undoes it — a retry is the flow's explicit choice. |
| `deps` | `readonly Token[]` | No | Constructor dependencies (`ExecutionContext`, `SpendRecorder`, `Clock`, `Idempotency`, `@Injectable` services) verified against constructor parameters at compile time. |

## What related entities work with `@Action`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `ActionHandler<Self>` | `"@agboss/core"` | Optional signature check for an `@Action` class (`execute(input: InputOf<Self>): OutputOf<Self> \| Promise<OutputOf<Self>>`, sync or async). |
| `InputOf<Self>` & `OutputOf<Self>` | `"@agboss/core"` | Type helpers generated by `agboss check` (`.agboss/types.d.ts`) that type `execute(input)` from the decorator's `input` and `output`. |
| `Idempotency` | `"@agboss/core"` | One injectable service for a side effect that must happen once: `runOnce({ name, ttl, execute })` for a write of your own database, `sendOnce({ name, target, request, send, recovery, timeout, ttl })` for a call that leaves the system. It replaces `FencedEffects` and `OutboundCalls`. |
| `.toAction(ActionClass)` & `onAction(ActionClass)` | `"@agboss/core"` | HarnessDSL (HDSL) flow methods for chaining an action on a path or starting the own path of an action reached from two places. |
| `testUnit(ActionClass, options?)` | `"@agboss/core/testing"` | Isolated unit runner that executes an `@Action` directly with fake `services` and a custom `executionContext` without booting the workflow. |
| `mockAction(ActionClass)` | `"@agboss/core/testing"` | Spies on or overrides an `@Action` inside a `testWith(Application)` workflow test. |
