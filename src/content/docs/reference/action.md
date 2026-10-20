---
title: "@Action"
description: Complete API reference for the @Action decorator in AGBoss — deterministic workflow graph nodes, ActionHandler<Self>, DI, idempotency, and testAction().
---

The `@Action` decorator defines a deterministic code node (`actions/*.action.ts`) in a `@Workflow` graph that runs without calling an LLM. Actions read typed DTOs from the workflow's Path Scope, inject `@Injectable` services and `ExecutionContext` through their constructor, and either return a new DTO to the path (`.returns(OutputDto)`) or perform a side effect (`Promise<void>`) before transitioning to the next node.

## What options does `@Action` accept?

Every `@Action` class name ends with `Action` and its `name` option ends with `-action`:

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier ending with `-action` (e.g., `"send-offer-action"`). |
| `description` | `string` | Yes | Human-readable summary of what the action does for Studio graphs and logs. |
| `input` | `InputFields` | No | Map of DTOs read from the workflow's Path Scope (`{ draft: OfferDraftDto, approval: optional(DraftApprovedDto) }`). |
| `output` | `OutputShape` | No | DTO class, `listOf(Dto)`, or `oneOf(A, B)` returned by `execute()`. Omit `output` for side-effect-only actions returning `Promise<void>`. |
| `compensateWith` | `Type<ActionHandler>` | No | Deterministic `@Action` class that reverses this action's external side effect on error paths (verified by `agboss check` via `[flow.uncompensated-action]`) and automatically in LIFO order on `app.cancel`, `FailFast`, quorum `Surplus`, or `@Budget` abort. |
| `committedBy` | `Type<ActionHandler>` | No | Optional downstream `@Action` class that finalizes the side effect so subsequent errors or cancellations no longer trigger `compensateWith`. |
| `deps` | `readonly Token[]` | No | Constructor dependencies (`ExecutionContext`, `SpendRecorder`, `Clock`, `@Injectable` services) verified against constructor parameters at compile time. |

## Complete `@Action` examples (value-producing and side-effect-only)

```ts title="src/actions/send-offer.action.ts" no-check: reference example
import { Action, ExecutionContext, SpendRecorder, optional, type ActionHandler, type InputOf, type OutputOf } from "agboss";
import { Text } from "agboss/dto";
import { usd } from "agboss/units";
import { MailerService } from "../services/mailer.service.js";
import { OfferDraftDto, DraftApprovedDto } from "../dto/offer.dto.js";

export class DeliveryReceiptDto {
  @Text({ prompt: "External message provider receipt ID" })
  receiptId!: string;
}

// 1. Value-producing @Action (declares output -> wired with .toAction(SendOfferAction).returns(DeliveryReceiptDto)):
@Action({
  name: "send-offer-action",
  description: "Sends the approved offer letter via the mailer service with an idempotency key",
  input: {
    draft: OfferDraftDto,
    approval: DraftApprovedDto,
  },
  output: DeliveryReceiptDto,
  deps: [ExecutionContext, SpendRecorder, MailerService],
})
export class SendOfferAction implements ActionHandler<SendOfferAction> {
  constructor(
    private readonly executionContext: ExecutionContext,
    private readonly spendRecorder: SpendRecorder,
    private readonly mailerService: MailerService,
  ) {}

  async execute(input: InputOf<SendOfferAction>): Promise<OutputOf<SendOfferAction>> {
    const receiptId = await this.mailerService.sendDocument({
      body: input.draft.letterText,
      idempotencyKey: this.executionContext.step.idempotencyKey,
      signal: this.executionContext.signal,
    });
    this.spendRecorder.record({ service: "docusign-api", cost: usd(0.05) });
    return { receiptId };
  }
}

// 2. Side-effect-only @Action (no output -> wired directly with .toAction(NotifyRecruiterAction).toFinish(...)):
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
    await this.mailerService.notifySlack(`Manual review needed for draft: ${input.draft?.letterText ?? "none"}`);
  }
}
```

```ts title="src/services/mailer.service.ts" no-check: reference example
import { Injectable } from "agboss";

@Injectable()
export class MailerService {
  async send(
    opts: { to: string; body: string },
    meta?: { idempotencyKey?: string; signal?: AbortSignal },
  ): Promise<{ messageId: string }> {
    return { messageId: `msg_${meta?.idempotencyKey ?? "local"}` };
  }
}
```

```ts title="src/workflows/offer-delivery.workflow.ts" no-check: reference example
import { Workflow, start } from "agboss";
import { SendOfferAction, OfferLetterDto, OfferSentReceiptDto } from "../actions/send-offer.action.js";

@Workflow({
  name: "offer-delivery-workflow",
  version: "1.0.0",
  flow: [
    start(OfferDeliveryStart)
      .returns(OfferLetterDto)
      .toAction(SendOfferAction)
      .returns(OfferSentReceiptDto)
      .toFinish(OfferDeliveryFinish),
  ],
})
export class OfferDeliveryWorkflow {}
```

## What related entities work with `@Action`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `ActionHandler<Self>` | `"agboss"` | Interface implemented by every `@Action` class (`execute(input: InputOf<Self>): Promise<OutputOf<Self>>`). |
| `InputOf<Self>` & `OutputOf<Self>` | `"agboss"` | Type helpers generated by `agboss check` (`.agboss/types.d.ts`) that type `execute(input)` from the decorator's `input` and `output`. |
| `.toAction(ActionClass)` & `action(ActionClass)` | `"agboss"` | Flow DSL methods for chaining an action on a path or starting a shared continuation path from an action. |
| `testAction(ActionClass, options?)` | `"agboss/testing"` | Isolated unit runner that executes an `@Action` directly with mocked `overrides` and custom `executionContext` without booting the workflow. |
| `mockAction(ActionClass)` | `"agboss/testing"` | Spies on or overrides an `@Action` inside a `testWith(Application)` workflow test. |

### Unit-testing an `@Action` in isolation with `testAction`

```ts title="test/send-offer.action.test.ts" no-check: reference example
import { expect, it } from "vitest";
import { override, testAction } from "agboss/testing";
import { SendOfferAction } from "./send-offer.action.js";
import { MailerService } from "../services/mailer.service.js";

class FakeMailerService extends MailerService {
  override async sendDocument(): Promise<string> {
    return "msg-9001";
  }
}

it("sends the approved draft and returns the receipt DTO", async () => {
  const runAction = testAction(SendOfferAction, {
    overrides: [override(MailerService, FakeMailerService)],
  });

  const { output, spend } = await runAction({
    draft: { letterText: "Welcome to Acme!" },
    approval: { summary: "Approved by VP" },
  });

  expect(output).toEqual({ receiptId: "msg-9001" });
  expect(spend.totalUsd).toBeCloseTo(0.05);
});
```

```ts title="src/dto/offer-letter.dto.ts" no-check: reference example
import { Text } from "agboss/dto";

export class OfferLetterDto {
  @Text() candidateEmail!: string;
  @Text() roleTitle!: string;
  @Text() markdownBody!: string;
}

export class OfferSentReceiptDto {
  @Text() messageId!: string;
  @Text() idempotencyKey!: string;
}
```
