---
title: Quick start
description: Build, statically verify with agboss check, run, and unit-test your first multi-agent workflow and @Application container in TypeScript.
---

Building an AGBoss application takes four small building blocks: `@WorkflowStart` and `@WorkflowFinish` endpoints typed with DTOs from `agboss/dto`, an `@Agent` (or `@Action` / `@Router`) component, a `@Workflow` module whose `flow` chains steps one call per line, and an `@Application` entry point with `@Budget` ceilings booted via `createApp`.

## How to build and run your first workflow

The example below defines a customer support workflow and its enclosing `@Application`, then executes a turn via `app.execute`:

```ts title="src/support.workflow.ts" file=src/support.workflow.ts
import { Agent, Application, Budget, BudgetPeriod, BudgetScope, createApp, EmptyEnvironment, start, Workflow, WorkflowFinish, WorkflowStart, type BudgetHandler } from "agboss";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "agboss/dto";
import { usd, type Usd } from "agboss/units";

@WorkflowStart({
  name: "support-workflow-start",
  description: "Incoming customer question",
  input: WorkflowStartTextDto,
})
export class SupportWorkflowStart {}

@WorkflowFinish({
  name: "support-workflow-finish",
  description: "Support answer returned to the caller",
  output: WorkflowFinishTextDto,
})
export class SupportWorkflowFinish {}

@Agent({
  name: "support-agent",
  description: "Answers customer questions concisely",
  prompt: "Answer customer questions concisely and accurately.",
  model: "moonshotai/kimi-k2.6",
})
export class SupportAgent {}

@Workflow({
  name: "support-workflow",
  version: "1.0.0",
  flow: [
    start(SupportWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toAgent(SupportAgent)
      .toFinish(SupportWorkflowFinish),
  ],
})
export class SupportWorkflow {}

@Budget({
  name: "support-application-budget",
  scope: BudgetScope.Application,
  period: BudgetPeriod.Day,
})
export class SupportAppBudget implements BudgetHandler {
  maxSpend(): Usd {
    return usd(10);
  }
}

@Budget({
  name: "support-tenant-budget",
  scope: BudgetScope.Tenant,
  period: BudgetPeriod.Day,
})
export class SupportTenantBudget implements BudgetHandler {
  maxSpend(): Usd {
    return usd(2);
  }
}

@Budget({
  name: "support-execution-budget",
  scope: BudgetScope.Execution,
})
export class SupportExecutionBudget implements BudgetHandler {
  maxSpend(): Usd {
    return usd(0.1);
  }
}

@Application({
  name: "support-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [SupportWorkflow],
  budgets: [
    SupportAppBudget,
    SupportTenantBudget,
    SupportExecutionBudget,
  ],
})
export class SupportApplication {}

export async function runOnce() {
  const app = await createApp(SupportApplication);
  try {
    return await app.execute(SupportWorkflowStart, {
      text: "How do I rotate my API token?",
    });
  } finally {
    await app.close();
  }
}
```

```ts title="test/support.workflow.test.ts" file=test/support.workflow.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "agboss";
import { replyWith, testWith } from "agboss/testing";
import { SupportAgent, SupportApplication, SupportWorkflowStart } from "../src/support.workflow.js";

const test = testWith(SupportApplication);

test("executes SupportWorkflow deterministically without an API key", async ({ app, mockLlm }) => {
  mockLlm(SupportAgent).thenReturn(
    replyWith("Open Settings > API Keys > Rotate."),
  );
  const res = await app.execute(SupportWorkflowStart, { text: "How do I rotate my API token?" });
  expect(res.status).toBe(ExecutionStatus.Finished);
});
```

## How to inspect, typecheck, and chat from the CLI

Once your workflow and application are defined, use the `agboss` CLI to validate the graph, inspect resolved providers and budgets, or start an interactive session:

1. **Generate flow types and validate assembly:** Run `npx agboss check --application src/support.workflow.ts` to write `.agboss/types.d.ts` and verify every path, DTO transition, and budget rule without an API key.
2. **Inspect the assembled topology:** Run `npx agboss describe --application src/support.workflow.ts` to print every path, node producer, model provider resolution, and worst-case step count.
3. **Run interactively in the terminal:** Run `npx agboss chat --application src/support.workflow.ts` to chat with the workflow and inspect per-turn spend.

Next, learn how the [`@Application` root](/concepts/application/), [Component Decorators](/concepts/decorators/), and [Workflow DSL](/concepts/workflow/) work in detail.
