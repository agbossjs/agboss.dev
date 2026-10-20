---
title: "@Budget"
description: Complete API reference for the @Budget decorator in AGBoss — Application, Tenant, and Execution spend scopes, BudgetPeriod, BudgetHandler, and CostLedgerRepository.
---

The `@Budget` decorator (`config/budget.config.ts`) defines a FinOps spend ceiling registered in `@Application({ budgets })`. Budgets are checked before the first step of an execution and reconciled after every model call and `SpendRecorder.record()` entry across three hierarchical scopes: **`BudgetScope.Application`**, **`BudgetScope.Tenant`**, and **`BudgetScope.Execution`**.

## What options does `@Budget` accept?

Every `@Budget` class implements `BudgetHandler` (`maxSpend(): Usd | Promise<Usd>`) and its `name` ends with `-budget`:

| Option | Applies To | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | All scopes | `string` | Yes | Unique kebab-case identifier ending with `-budget` (e.g., `"tenant-daily-budget"`). |
| `scope` | All scopes | `BudgetScope` | Yes | `BudgetScope.Application`, `BudgetScope.Tenant`, or `BudgetScope.Execution`. |
| `period` | `Application` & `Tenant` | `BudgetPeriod` | Yes | UTC accounting window: `BudgetPeriod.Day`, `BudgetPeriod.Week`, or `BudgetPeriod.Month`. Forbidden on `BudgetScope.Execution`. |
| `workflow` | `Execution` | `Class` | No | Optional `@Workflow` class this execution cap applies to; omit to set the default cap for all root executions. |
| `deps` | All scopes | `readonly Token[]` | No | Constructor dependencies (`AppEnvironment`, `TenantContext`, `ExecutionContext`, or `@Injectable` billing services). |

## Complete `@Budget` example across all 3 scopes

```ts title="src/budgets/support.budgets.ts" no-check: reference example
import { Budget, BudgetPeriod, BudgetScope, ExecutionContext, type BudgetHandler } from "agboss";
import { usd, type Usd } from "agboss/units";
import { AppEnvironment } from "../environments/app.environment.js";
import { SupportTenantContext } from "../config/context.config.js";
import { DeepResearchWorkflow } from "../workflows/deep-research.workflow.js";

// 1. Application-wide daily cap:
@Budget({
  name: "application-daily-budget",
  scope: BudgetScope.Application,
  period: BudgetPeriod.Day,
  deps: [AppEnvironment],
})
export class ApplicationDailyBudget implements BudgetHandler {
  constructor(private readonly env: AppEnvironment) {}

  maxSpend(): Usd {
    return usd(100);
  }
}

// 2. Per-tenant daily cap (reads dynamic limit from TenantContext or a billing service):
@Budget({
  name: "tenant-daily-budget",
  scope: BudgetScope.Tenant,
  period: BudgetPeriod.Day,
  deps: [SupportTenantContext],
})
export class TenantDailyBudget implements BudgetHandler {
  constructor(private readonly tenant: SupportTenantContext) {}

  maxSpend(): Usd {
    return this.tenant.weight > 1 ? usd(25) : usd(5);
  }
}

// 3. Default per-execution cap (plus a higher cap for a specific heavy workflow):
@Budget({
  name: "default-execution-budget",
  scope: BudgetScope.Execution,
  deps: [ExecutionContext],
})
export class DefaultExecutionBudget implements BudgetHandler {
  constructor(private readonly executionContext: ExecutionContext) {}

  maxSpend(): Usd {
    return usd(0.15);
  }
}

@Budget({
  name: "deep-research-execution-budget",
  scope: BudgetScope.Execution,
  workflow: DeepResearchWorkflow,
})
export class DeepResearchExecutionBudget implements BudgetHandler {
  maxSpend(): Usd {
    return usd(1.5);
  }
}
```

```ts title="src/support.application.ts" no-check: reference example
import { Application, SqliteCostLedgerRepository } from "agboss";
import { AppDailyBudget, TenantMonthlyBudget, ExecutionRunBudget } from "./budgets/support.budgets.js";
import { SupportWorkflow } from "./workflows/support.workflow.js";

@Application({
  name: "support-application",
  version: "1.0.0",
  workflows: [SupportWorkflow],
  providers: [SqliteCostLedgerRepository],
  budgets: [AppDailyBudget, TenantMonthlyBudget, ExecutionRunBudget],
})
export class SupportApplication {}
```

```ts title="test/budget-cap.test.ts" no-check: reference example
import { expect } from "vitest";
import { replyWith, testWith } from "agboss/testing";
import { usd } from "agboss/units";
import { SupportApplication } from "../src/support.application.js";

const test = testWith(SupportApplication);

test("halts execution when simulated spend exceeds ExecutionRunBudget", async ({ app, mockLlm }) => {
  mockLlm(SupportAgent).thenReturn(
    replyWith(SupportReplyDto, { text: "Expensive turn" }, { cost: usd(1.25) }),
  );
  const res = await app.execute(SupportStart, { text: "Analyze all logs" });
  expect(res.isFailed()).toBe(true);
});
```

## What related entities work with `@Budget`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `BudgetHandler` | `"agboss"` | Interface implemented by every `@Budget` class (`maxSpend(): Usd \| Promise<Usd>`). |
| `BudgetScope` & `BudgetPeriod` | `"agboss"` | Enums specifying what is capped (`Application`, `Tenant`, `Execution`) and over which UTC period (`Day`, `Week`, `Month`). |
| `usd(amount)` & `Usd` | `"agboss/units"` | Exact monetary unit factory required for all budget caps and spend reporting. |
| `SpendRecorder` | `"agboss"` | Injected into `@Tool` and `@Action` classes via `deps: [SpendRecorder]` to count paid external API calls toward `@Budget` caps. |
| `CostLedgerRepository` & `SqliteCostLedgerRepository` | `"agboss"` | Atomic multi-instance ledger storing period and execution spend counters; required in production (`agboss check --strict`). |
| `BudgetExceededError` | `"agboss"` | Thrown when a pre-call reservation or post-call spend exceeds any active `@Budget` ceiling. |
