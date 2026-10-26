---
title: Quick start
description: Build, statically verify with agboss check, run, and unit-test your first multi-agent workflow and @Application container in TypeScript.
---

Building an AGBoss application takes four small building blocks: `@WorkflowStart` and `@WorkflowFinish` endpoints typed with DTOs from `@agboss/core/dto`, an `@Agent` (or `@Action` / `@Router`) component, a `@Workflow` module whose **HarnessDSL (`HDSL`)** `flow` chains steps one call per line, and an `@Application` entry point with `@Budget` ceilings booted via `createApp`.

> **Current Release (`v0.1.0`):** `@agboss/core@0.1.0` and `@agboss/cli@0.1.0` are published on `registry.npmjs.org`. Run `npx --yes --package=@agboss/cli agboss create my-app` to scaffold a new project or clone [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples) (`cd 01-hello-agboss && npm install`) to run the verified starter.

### Progressive Learning Path

| Milestone | Time | What You Will Accomplish |
| :--- | :---: | :--- |
| **1. First 5 Minutes** | `5 min` | Install `@agboss/core` + `@agboss/cli` (or run `01-hello-agboss`), verify the graph with `npx agboss check`, and run your first deterministic workflow test (`npm test`). |
| **2. Next 15 Minutes** | `15 min` | Add constructor dependency injection (`@Injectable`), narrow `@Dto` contracts (`@Text`, `@Integer`), and compose a `@Router` + `@Agent` + `@Tool` workflow inside `@Application`. |
| **3. At 30 Minutes** | `30 min` | Understand **Path Scope** (`Produced<Dto, Producer>`) and trigger intentional build-time graph failures (`[input.missing-on-path]`, `[input.outdated-on-path]`, `[flow.uncompensated-action]`) in [`02-path-scope-proof`](https://github.com/agbossjs/agboss-examples/tree/main/02-path-scope-proof). |
| **4. Advanced Guides** | `30+ min` | Scale to LIFO sagas ([`04-travel-booking-saga`](https://github.com/agbossjs/agboss-examples/tree/main/04-travel-booking-saga)), distributed `ChildPlacement.AnyInstance` work-stealing ([`05-cluster-work-stealing`](https://github.com/agbossjs/agboss-examples/tree/main/05-cluster-work-stealing)), multi-run `@EvalSuite` ([`03-support-refund-desk`](https://github.com/agbossjs/agboss-examples/tree/main/03-support-refund-desk)), and A2A + MCP federation ([`06-enterprise-agent-mesh`](https://github.com/agbossjs/agboss-examples/tree/main/06-enterprise-agent-mesh)). |

## 5 Minutes: Install, check, and run

### Option 1 — Create a new project from scratch

```bash
npx --yes --package=@agboss/cli agboss create my-app
cd my-app
npm install
```

`npx --yes --package=@agboss/cli agboss create my-app` (also available via `npm exec --yes --package=@agboss/cli -- agboss create my-app`) creates a project with `@agboss/core` in `dependencies`, `@agboss/cli` in `devDependencies`, `AGENTS.md`, and `CLAUDE.md` (`@AGENTS.md`). Running `npm install` runs `"postinstall": "npm run types"` (`agboss check`), which generates `.agboss/types.d.ts` and unpacks 13 AI coding skill references into `.claude/skills/agboss/` (`SKILL.md` + `references/01..13`).

### Option 2 — Add to an existing project

```bash
npm install @agboss/core
npm install -D @agboss/cli
npx agboss check
```

- **`@agboss/core` (`dependencies`)** is the lightweight production runtime (decorators, graph engine, DI, repository contracts, subpaths `@agboss/core/dto`, `@agboss/core/testing`, `@agboss/core/eval`, `@agboss/core/eslint`, and bundled AI skills) deployed in Docker / Kubernetes.
- **`@agboss/cli` (`devDependencies`)** is the static compiler (`agboss check`), generator (`agboss generate`), dev watcher (`agboss dev`), Studio bridge (`agboss studio`), and local UI toolkit (`agboss eval ui`, `agboss hub ui`) kept out of production images.

## 15 Minutes: Dependency injection, typed DTOs, and workflow composition

The example below defines a customer support workflow and its enclosing `@Application`, then executes a turn via `app.execute`:

```ts title="src/support.workflow.ts" file=src/support.workflow.ts
import { Agent, Application, Budget, BudgetPeriod, BudgetScope, createApp, EmptyEnvironment, start, Workflow, WorkflowFinish, WorkflowStart, type BudgetHandler } from "@agboss/core";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "@agboss/core/dto";
import { usd, type Usd } from "@agboss/core/units";

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
import { ExecutionStatus } from "@agboss/core";
import { replyWith, testWith } from "@agboss/core/testing";
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

## 30 Minutes: Path Scope and intentional graph failures

Once your workflow and application are defined, use the `agboss` CLI to validate the graph, inspect resolved providers and budgets, or test how `agboss check` catches structural graph bugs before runtime:

1. **Generate flow types and validate assembly:** Run `npx agboss check --application src/support.workflow.ts` to write `.agboss/types.d.ts` and verify every path, DTO transition, and budget rule without an API key.
2. **Inspect the assembled topology:** Run `npx agboss describe --application src/support.workflow.ts` to print every path, node producer, model provider resolution, and worst-case step count.
3. **Trigger an intentional Path Scope failure:** In [`02-path-scope-proof`](https://github.com/agbossjs/agboss-examples/tree/main/02-path-scope-proof), inspect how `agboss check` catches four classes of graph defects that pass `tsc --noEmit` in raw shared-state graphs:
   - `[input.missing-on-path]` — a router branch skips an upstream producer required by a downstream step.
   - `[input.outdated-on-path]` — a revision loop modifies an artifact (`{ about }`) without re-running downstream verification.
   - `[launch.branch-outdates-sibling]` — a parallel branch overwrites a DTO slot while a sibling branch concurrently reads it.
   - `[flow.uncompensated-action]` — an error path exits a workflow after a side-effecting `@Action({ compensateWith })` without running its compensation handler.
4. **Run interactively in the terminal:** Run `npx agboss chat --application src/support.workflow.ts` to chat with the workflow and inspect per-turn spend.

## Next Steps & Advanced Guides

- **Core Concepts:** [`@Application` & Lifecycle](/concepts/application/), [Component Decorators](/concepts/decorators/), [Workflow HDSL (`HarnessDSL`)](/concepts/workflow/), and [Path Scope & Provenance](/concepts/path-scope/).
- **Production Operations:** [Transactional Sagas & Rollback](/guides/error-handling-and-rollback/), [Channels, Pauses & Webhooks](/guides/channels-and-pauses/), [Multi-Instance, Leases & SQLite](/guides/persistence-and-recovery/), [Evals, `pass^k` & Calibration](/guides/evaluation-and-profiles/), and [MCP, RAG & A2A Protocols](/guides/mcp-rag-and-a2a/).
