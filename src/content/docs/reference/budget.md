---
title: "@Budget"
description: Complete API reference for the @Budget decorator in AGBoss — Application, Tenant, and Execution spend scopes, BudgetPeriod, and CostLedgerRepository.
---

The `@Budget` decorator (`config/budget.config.ts`) defines a FinOps spend ceiling registered in `@Application({ budgets })`. Budgets are checked before the first step of an execution and reconciled after every model call and `SpendRecorder.record()` entry across three hierarchical scopes: **`BudgetScope.Application`**, **`BudgetScope.Tenant`**, and **`BudgetScope.Execution`**.

## Complete `@Budget` example across all 3 scopes

```ts title="src/budgets/support.budgets.ts" file=src/budgets/support.budgets.ts
import {
  Budget,
  BudgetPeriod,
  BudgetScope,
  EmptyEnvironment,
  ExecutionContext,
  TenantContext,
  type BudgetHandler,
} from "agboss";
import { Text } from "agboss/dto";
import { usd, type Usd } from "agboss/units";
import { DeepResearchWorkflow } from "../workflows/support.workflow.js";

export class SupportTenantContext extends TenantContext {
  @Text()
  planTier!: string;
}

// 1. Application-wide daily cap:
@Budget({
  name: "application-daily-budget",
  scope: BudgetScope.Application,
  period: BudgetPeriod.Day,
  deps: [EmptyEnvironment],
})
export class ApplicationDailyBudget implements BudgetHandler {
  constructor(private readonly _env: EmptyEnvironment) {}

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
    void this.executionContext.executionId;
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

```ts title="src/support.application.ts" file=src/support.application.ts
import { Application, EmptyEnvironment, SqliteCostLedgerRepository } from "agboss";
import {
  ApplicationDailyBudget,
  DeepResearchExecutionBudget,
  DefaultExecutionBudget,
  SupportTenantContext,
  TenantDailyBudget,
} from "./budgets/support.budgets.js";
import { DeepResearchWorkflow, SupportWorkflow } from "./workflows/support.workflow.js";

@Application({
  name: "support-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  tenantContext: SupportTenantContext,
  workflows: [SupportWorkflow, DeepResearchWorkflow],
  providers: [SqliteCostLedgerRepository],
  budgets: [
    ApplicationDailyBudget,
    TenantDailyBudget,
    DefaultExecutionBudget,
    DeepResearchExecutionBudget,
  ],
})
export class SupportApplication {}
```

<!--
```ts file=src/workflows/support.workflow.ts
import { Agent, Workflow, WorkflowFinish, WorkflowStart, start } from "agboss";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "agboss/dto";

@WorkflowStart({ name: "support-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class SupportStart {}

@WorkflowStart({ name: "research-workflow-start", description: "Research start", input: WorkflowStartTextDto })
export class ResearchStart {}

@WorkflowFinish({ name: "support-workflow-finish", description: "Finish", output: WorkflowFinishTextDto })
export class SupportFinish {}

@Agent({ name: "support-agent", description: "Support", model: "moonshotai/kimi-k2.6", prompt: "Help." })
export class SupportAgent {}

@Workflow({
  name: "support-workflow",
  version: "1.0.0",
  flow: [
    start(SupportStart)
      .returns(WorkflowStartTextDto)
      .toAgent(SupportAgent)
      .toFinish(SupportFinish),
  ],
})
export class SupportWorkflow {}

@Workflow({
  name: "deep-research-workflow",
  version: "1.0.0",
  flow: [
    start(ResearchStart)
      .returns(WorkflowStartTextDto)
      .toAgent(SupportAgent)
      .toFinish(SupportFinish),
  ],
})
export class DeepResearchWorkflow {}
```
-->

```ts title="test/budget-cap.test.ts" file=test/budget-cap.test.ts
import { expect } from "vitest";
import { BudgetExceededError } from "agboss";
import { replyWith, testWith } from "agboss/testing";
import { usd } from "agboss/units";
import { SupportApplication } from "../src/support.application.js";
import { SupportAgent, SupportStart } from "../src/workflows/support.workflow.js";

const test = testWith(SupportApplication);

test("halts execution when simulated spend exceeds DefaultExecutionBudget", async ({ app, mockLlm }) => {
  mockLlm(SupportAgent).thenReturn(
    replyWith("Expensive turn", { cost: usd(1.25) }),
  );
  await expect(
    app.execute(
      SupportStart,
      { text: "Analyze all logs" },
      { tenant: { tenantId: "acme", weight: 1, planTier: "pro" } },
    ),
  ).rejects.toThrow(BudgetExceededError);
});
```

## What options does `@Budget` accept?

Every `@Budget` class implements `BudgetHandler` (`maxSpend(): Usd | Promise<Usd>`) and its `name` ends with `-budget`:

| Option | Applies To | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | All scopes | `string` | Yes | Unique kebab-case identifier ending with `-budget` (e.g., `"tenant-daily-budget"`). |
| `scope` | All scopes | `BudgetScope` | Yes | `BudgetScope.Application`, `BudgetScope.Tenant`, or `BudgetScope.Execution`. |
| `period` | `Application` & `Tenant` | `BudgetPeriod` | Yes | UTC accounting window: `BudgetPeriod.Day`, `BudgetPeriod.Week`, or `BudgetPeriod.Month`. Forbidden on `BudgetScope.Execution`. |
| `workflow` | `Execution` | `Class` | No | Optional `@Workflow` class this execution cap applies to; omit to set the default cap for all root executions. |
| `deps` | All scopes | `readonly Token[]` | No | Constructor dependencies (`AppEnvironment`, `TenantContext`, `ExecutionContext`, or `@Injectable` billing services). |

## What related entities work with `@Budget`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `BudgetHandler` | `"agboss"` | Interface implemented by every `@Budget` class (`maxSpend(): Usd \| Promise<Usd>`). |
| `BudgetScope` & `BudgetPeriod` | `"agboss"` | Enums specifying what is capped (`Application`, `Tenant`, `Execution`) and over which UTC period (`Day`, `Week`, `Month`). |
| `usd(amount)` & `Usd` | `"agboss/units"` | Exact monetary unit factory required for all budget caps and spend reporting. |
| `SpendRecorder` | `"agboss"` | Injected into `@Tool` and `@Action` classes via `deps: [SpendRecorder]` to count paid external API calls toward `@Budget` caps. |
| `CostLedgerRepository` & `SqliteCostLedgerRepository` | `"agboss"` | Atomic multi-instance ledger storing period and execution spend counters; required in production (`agboss check --strict`). |
| `BudgetExceededError` | `"agboss"` | Thrown when a pre-call reservation or post-call spend exceeds any active `@Budget` ceiling. |
