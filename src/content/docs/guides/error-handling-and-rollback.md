---
title: Error Handling & Rollback (.onError)
description: Handle step failures, review-loop visit limits, quorum deadlines, and transactional rollbacks in AGBoss using .onError(), .onJoinError(), and LIFO sagas.
---

Production workflows interact with unreliable external systems, rate-limited APIs, and bounded review loops that can fail mid-flight. AGBoss makes failure recovery explicit in `@Workflow({ flow })` via `.onError(ErrorClass, sidePath)` on individual steps and `.onJoinError(ErrorClass, sidePath)` on parallel joins, keeping compensation logic type-checked and unit-tested alongside the happy path.

## How `.onError()` chains compensation steps in a workflow path

Instead of hidden automatic rollbacks that guess how to undo a side effect, you attach `.onError(ErrorClass, sidePath)` directly after the `@Action`, `@Agent`, or `@Router` that can throw. The compensation side path has full Path Scope access to DTOs produced by earlier steps (such as a `StockReservationDto` needed to release reserved inventory):

<!-- snippet-context
import {
  CarrierError,
  NotifyFinanceTeamAction,
  OrderFailedWorkflowFinish,
  OrderRequestDto,
  OrderShippedDto,
  OrderWorkflowFinish,
  OrderWorkflowStart,
  PaymentProviderError,
  RefundCardAction,
  ReleaseStockAction,
  ReserveStockAction,
  ShipOrderAction,
  StockReservationDto,
} from "./order.components.js";
-->
```ts title="src/order.workflow.ts" file=order.workflow.ts
import { Workflow, start, toAction } from "agboss";

@Workflow({
  name: "order-workflow",
  version: "1.0.0",
  flow: [
    start(OrderWorkflowStart)
      .returns(OrderRequestDto)
      .toAction(ReserveStockAction)
      .returns(StockReservationDto)
      .toAction(ShipOrderAction)
      .onError(
        CarrierError,
        toAction(RefundCardAction)
          .onError(
            PaymentProviderError,
            toAction(NotifyFinanceTeamAction)
              .toFinish(OrderFailedWorkflowFinish),
          )
          .toAction(ReleaseStockAction)
          .toFinish(OrderFailedWorkflowFinish),
      )
      .returns(OrderShippedDto)
      .toFinish(OrderWorkflowFinish),
  ],
})
export class OrderWorkflow {}
```

```ts title="src/order.components.ts" file=order.components.ts
import { Action, WorkflowFinish, WorkflowStart, type ActionHandler, type InputOf, type OutputOf } from "agboss";
import { Text } from "agboss/dto";

export class OrderRequestDto {
  @Text({ prompt: "order id" })
  orderId!: string;
}
export class StockReservationDto {
  @Text({ prompt: "reservation id" })
  reservationId!: string;
}
export class OrderShippedDto {
  @Text({ prompt: "tracking number" })
  trackingNumber!: string;
}
export class CarrierError extends Error {}
export class PaymentProviderError extends Error {}

@WorkflowStart({ name: "order-workflow-start", description: "Order request", input: OrderRequestDto })
export class OrderWorkflowStart {}

@WorkflowFinish({ name: "order-workflow-finish", description: "Order shipped", output: OrderShippedDto })
export class OrderWorkflowFinish {}

@WorkflowFinish({ name: "order-failed-workflow-finish", description: "Order failed", output: OrderRequestDto })
export class OrderFailedWorkflowFinish {}

@Action({
  name: "reserve-stock-action",
  description: "Reserves stock",
  input: { order: OrderRequestDto },
  output: StockReservationDto,
})
export class ReserveStockAction implements ActionHandler<ReserveStockAction> {
  execute(input: InputOf<ReserveStockAction>): Promise<OutputOf<ReserveStockAction>> {
    return Promise.resolve({ reservationId: `res-${input.order.value.orderId}` });
  }
}

@Action({
  name: "ship-order-action",
  description: "Books carrier shipment",
  input: { reservation: StockReservationDto },
  output: OrderShippedDto,
})
export class ShipOrderAction implements ActionHandler<ShipOrderAction> {
  execute(input: InputOf<ShipOrderAction>): Promise<OutputOf<ShipOrderAction>> {
    return Promise.resolve({ trackingNumber: `trk-${input.reservation.value.reservationId}` });
  }
}

@Action({
  name: "refund-card-action",
  description: "Refunds card charge",
  input: { order: OrderRequestDto },
})
export class RefundCardAction implements ActionHandler<RefundCardAction> {
  execute(_input: InputOf<RefundCardAction>): Promise<void> {
    return Promise.resolve();
  }
}

@Action({
  name: "release-stock-action",
  description: "Releases reserved stock",
  input: { reservation: StockReservationDto },
})
export class ReleaseStockAction implements ActionHandler<ReleaseStockAction> {
  execute(_input: InputOf<ReleaseStockAction>): Promise<void> {
    return Promise.resolve();
  }
}

@Action({
  name: "notify-finance-team-action",
  description: "Alerts finance when refund fails",
  input: { order: OrderRequestDto },
})
export class NotifyFinanceTeamAction implements ActionHandler<NotifyFinanceTeamAction> {
  execute(_input: InputOf<NotifyFinanceTeamAction>): Promise<void> {
    return Promise.resolve();
  }
}
```

<!-- snippet-context
import { Budget, BudgetPeriod, BudgetScope, type BudgetHandler } from "agboss";
import { usd, type Usd } from "agboss/units";
@Budget({ name: "order-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class OrderAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(50); } }
@Budget({ name: "order-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class OrderTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "order-exec-budget", scope: BudgetScope.Execution })
export class OrderExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }
// @snippet
-->
```ts title="test/order.workflow.test.ts" file=order.workflow.test.ts
import { Application, EmptyEnvironment } from "agboss";
import { expect } from "vitest";
import { testWith } from "agboss/testing";
import { OrderWorkflow } from "./order.workflow.js";
import { OrderWorkflowFinish, OrderWorkflowStart } from "./order.components.js";

@Application({
  name: "order-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [OrderWorkflow],
  budgets: [OrderAppBudget, OrderTenantBudget, OrderExecBudget],
})
export class OrderApplication {}

const test = testWith(OrderApplication);

test("reserves stock and ships order on the happy path", async ({ app }) => {
  const result = await app.execute(OrderWorkflowStart, { orderId: "ORD-42" });
  expect(result.finish).toBe(OrderWorkflowFinish);
  expect(result.output).toEqual({ trackingNumber: "trk-res-ORD-42" });
});
```

## What error classes can `.onError()` and `.onJoinError()` catch?

| Error Class | Where It Attaches | When It Fires |
| :--- | :--- | :--- |
| Custom `Error` subclass (e.g. `CarrierError`) | `.onError(CarrierError, ...)` after `@Action` / `@Router` | When the step throws `CarrierError` (or an `ActionFailedError` wrapping it in `cause`) |
| `ChildExecutionFailedError` | `.onError(ChildExecutionFailedError, ...)` after `.toWorkflow(Child)` | When a child workflow execution fails without reaching one of its `@WorkflowFinish` nodes |
| `VisitsLimitExceededError` | `.onError(VisitsLimitExceededError, ...)` | When an `@Agent` or `@Router` in a review loop exceeds its `maxVisits` ceiling |
| `BudgetExceededError` / `StepsLimitExceededError` / `DepthLimitExceededError` / `LimitExceededError` | `.onError(LimitExceededError, ...)` | When an execution or step limit is exceeded. **Note (`[graph.limit-handler-uses-model]`):** side paths catching limit errors may only run deterministic `@Action` and `DecidedBy.Code` `@Router` steps — invoking an `@Agent` or `DecidedBy.Model` `@Router` inside a limit handler is rejected at assembly time. |
| `StepFailedError` | `.onJoinError(StepFailedError, ...)` after `.join()` | When one or more parallel branches fail during `.toParallelAgents()` or `.toParallelWorkflows()` |
| `QuorumNotReachedError` | `.onJoinError(QuorumNotReachedError, ...)` after `.joinQuorum()` / `.joinQuorumGroups()` | When too many branches fail or the quorum `deadline` expires before the quorum is satisfied |

## How error matching and checkpoint recovery work

- **Most-specific class matching:** A step may declare multiple `.onError(...)` handlers; the framework matches the thrown error (and its `.cause` chain) against the most specific subclass in the prototype hierarchy. Duplicate handlers for the same error class on one step fail assembly (`[flow.duplicate-error-handler]`).
- **Durable across checkpoints:** The failure record (`lastError` with error code, message, and failed node name) is persisted in workflow state so a side path that pauses for human intervention resumes cleanly.

## How do declarative transactional sagas (`compensateWith` & `committedBy`) and automatic LIFO unwinding work?

Manual `.onError(...)` chains only catch step failures along normal graph edges — they do not run when an execution or parallel branch is externally aborted by `app.cancel(threadId)`, sibling `FailurePolicy.FailFast`, quorum `BranchVerdict.Surplus`, or a limit error (`BudgetExceededError`, `StepsLimitExceededError`, `DepthLimitExceededError`).

AGBoss solves both static rollback completeness and runtime external aborts with declarative compensation contracts on `@Action`:

1. **Declarative `@Action` saga options:**
   - `compensateWith: WithdrawOfferAction` declares the deterministic `@Action` that reverses this action's external side effect. Its `input` must be satisfiable from the Path Scope immediately after the compensated action completes (verified at assembly; otherwise fails with `[action.invalid-compensator-input]`).
   - `committedBy: ConfirmOfferAction` (optional) marks the commit boundary: once `ConfirmOfferAction` completes, the earlier action is finalized and will no longer be rolled back on subsequent errors or cancellations.
2. **Static saga verification in `agboss check` (`[flow.uncompensated-action]`):**
   - Every error path (`.onError` / `.onJoinError`) after an uncommitted compensatable `@Action` that reaches a `@WorkflowFinish` before passing through `committedBy` must execute `compensateWith` on that path. If any error branch bypasses the compensator, `agboss check` fails assembly with `[flow.uncompensated-action]`.
   - `agboss describe` and `agboss describe --json` include `compensateWith` and `committedBy` metadata on action nodes.
3. **Automatic runtime LIFO unwinding on external abort:**
   - Whenever an `@Action` with `compensateWith` completes, the runtime checkpoints an uncommitted compensation entry `(stepId, action, outputDto, compensator)`.
   - If the execution or branch is aborted before `committedBy` (via `app.cancel(threadId)`, `FailurePolicy.FailFast`, quorum `Surplus`, or `BudgetExceededError`), the runtime automatically executes all uncommitted compensators in **reverse completion order (LIFO)** using a live cleanup signal bounded by `@Application({ compensationTimeout: seconds(15) })`.
   - If a worker pod crashes mid-rollback, the recovering instance resumes the remaining uncompensated entries idempotently using deterministic `step.idempotencyKey` values.

<!--
```ts file=src/actions/offer.contracts.ts
import { Action, type ActionHandler, type InputOf } from "agboss";
import { Text } from "agboss/dto";

export class OfferDraftDto {
  @Text()
  role!: string;
}

export class RegisteredOfferDto {
  @Text()
  offerId!: string;
  @Text()
  role!: string;
}

@Action({
  name: "confirm-offer-action",
  description: "Commits the provisional ATS offer",
  input: { offer: RegisteredOfferDto },
})
export class ConfirmOfferAction implements ActionHandler<ConfirmOfferAction> {
  execute(_input: InputOf<ConfirmOfferAction>): Promise<void> {
    return Promise.resolve();
  }
}
```
-->
<!-- snippet-context
import { ActionFailedError, Workflow, WorkflowFinish, WorkflowStart, start, toAction } from "agboss";
import { ConfirmOfferAction, OfferDraftDto, RegisteredOfferDto } from "./offer.contracts.js";
// @snippet
@WorkflowStart({ name: "offer-saga-workflow-start", description: "Start", input: OfferDraftDto })
export class OfferSagaStart {}
@WorkflowFinish({ name: "offer-saga-workflow-finish", description: "Finish", output: RegisteredOfferDto })
export class OfferSagaFinish {}
@Workflow({
  name: "offer-saga-workflow",
  version: "1.0.0",
  flow: [
    start(OfferSagaStart)
      .returns(OfferDraftDto)
      .toAction(RegisterOfferAction)
      .returns(RegisteredOfferDto)
      .toAction(ConfirmOfferAction)
      .onError(
        ActionFailedError,
        toAction(WithdrawOfferAction)
          .toFinish(OfferSagaFinish),
      )
      .toFinish(OfferSagaFinish),
  ],
})
export class OfferSagaWorkflow {}
-->
```ts title="src/actions/register-offer.action.ts" file=src/actions/register-offer.action.ts
import { Action, ExecutionContext, type ActionHandler, type InputOf, type OutputOf } from "agboss";
import { WithdrawOfferAction } from "./withdraw-offer.action.js";

@Action({
  name: "register-offer-action",
  description: "Creates a provisional offer in the external ATS; rolled back by WithdrawOfferAction",
  input: { draft: OfferDraftDto },
  output: RegisteredOfferDto,
  compensateWith: WithdrawOfferAction,
  committedBy: ConfirmOfferAction,
  deps: [ExecutionContext],
})
export class RegisterOfferAction implements ActionHandler<RegisterOfferAction> {
  constructor(private readonly executionContext: ExecutionContext) {}

  async execute(input: InputOf<RegisterOfferAction>): Promise<OutputOf<RegisterOfferAction>> {
    return {
      offerId: `ats_${this.executionContext.step.idempotencyKey}`,
      role: input.draft.value.role,
    };
  }
}
```

<!-- snippet-context
import { RegisteredOfferDto } from "./offer.contracts.js";
// @snippet
-->
```ts title="src/actions/withdraw-offer.action.ts" file=src/actions/withdraw-offer.action.ts
import { Action, ExecutionContext, type ActionHandler, type InputOf } from "agboss";

@Action({
  name: "withdraw-offer-action",
  description: "Revokes the provisional ATS offer under a live compensationTimeout cleanup signal",
  input: { offer: RegisteredOfferDto },
  deps: [ExecutionContext],
})
export class WithdrawOfferAction implements ActionHandler<WithdrawOfferAction> {
  constructor(private readonly executionContext: ExecutionContext) {}

  async execute(input: InputOf<WithdrawOfferAction>): Promise<void> {
    void input.offer.value.offerId;
    void this.executionContext.signal;
  }
}
```

```ts title="test/offer-saga.test.ts" file=test/offer-saga.test.ts
import { expect, it } from "vitest";
import { testAction } from "agboss/testing";
import {
  OfferSagaStart,
  RegisterOfferAction,
} from "../src/actions/register-offer.action.js";
import { WithdrawOfferAction } from "../src/actions/withdraw-offer.action.js";

it("executes RegisterOfferAction and compensates with WithdrawOfferAction", async () => {
  const runRegister = testAction(RegisterOfferAction);
  const { output } = await runRegister({
    draft: {
      value: { role: "Principal Distributed Systems Engineer" },
      producer: OfferSagaStart,
    },
  });
  expect(output.role).toBe("Principal Distributed Systems Engineer");

  const runWithdraw = testAction(WithdrawOfferAction);
  await runWithdraw({
    offer: {
      value: output,
      producer: RegisterOfferAction,
    },
  });
});
```
