---
title: "@Application & Runtime"
description: Assemble workflows, typed environment contracts, model providers, budgets, PII policies, channels, persistence, and lifecycle hooks in a single @Application root.
---

Every AGBoss service has a single `@Application` assembly root that lists the workflows, typed environment contract, shared `@ModelProvider` classes, mandatory `@Budget` ceilings (application, tenant, and execution scopes), `@PiiPolicy` rules, `observers`, and storage repositories. Both `createApp(Application, options)` and `testWith(Application)` boot this container, validating every contract at startup before any workflow executes.

## How to declare an `@Application` and its environment contract

An application's environment contract is a plain class declaring fields only (`environments/app.environment.ts` next to the application file), while each environment (`dev.environment.ts`, `prod.environment.ts`, `test.environment.ts`) exports a typed `environment` object using `env()`, `env.optional()`, and `secret()`:

<!--
```ts file=src/audit/environments/app.environment.ts
import type { Secret } from "agboss";

export class AppEnvironment {
  auditUrl!: string;
  databaseUrl!: Secret;
  openRouterApiKey?: Secret;
}
```
-->

<!-- snippet-context
import { Application, Budget, BudgetPeriod, BudgetScope, Workflow, WorkflowFinish, WorkflowStart, start, type BudgetHandler } from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";
import { seconds, usd, type Usd } from "agboss/units";
@WorkflowStart({ name: "audit-workflow-start", description: "A request", input: WorkflowStartTextDto })
export class AuditWorkflowStart {}
@WorkflowFinish({ name: "audit-workflow-finish", description: "The answer", output: WorkflowStartTextDto })
export class AuditWorkflowFinish {}
@Workflow({
  name: "audit-workflow",
  version: "1.0.0",
  flow: [
    start(AuditWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toFinish(AuditWorkflowFinish),
  ],
})
export class AuditWorkflow {}
@Budget({ name: "audit-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class AuditAppBudget implements BudgetHandler {
  maxSpend(): Usd {
    return usd(10);
  }
}
@Budget({ name: "audit-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class AuditTenantBudget implements BudgetHandler {
  maxSpend(): Usd {
    return usd(2);
  }
}
@Budget({ name: "audit-exec-budget", scope: BudgetScope.Execution })
export class AuditExecBudget implements BudgetHandler {
  maxSpend(): Usd {
    return usd(0.1);
  }
}
// @snippet
-->
```ts title="src/audit/audit.application.ts" file=src/audit/audit.application.ts
import { AppEnvironment } from "./environments/app.environment.js";

@Application({
  name: "audit-application",
  version: "1.0.0",
  environment: AppEnvironment,
  workflows: [AuditWorkflow],
  budgets: [AuditAppBudget, AuditTenantBudget, AuditExecBudget],
  shutdownTimeout: seconds(25),
})
export class AuditApplication {}
```

```ts title="src/audit/environments/app.environment.ts" no-check: context tab
import type { Secret } from "agboss";

export class AppEnvironment {
  auditUrl!: string;
  databaseUrl!: Secret;
  openRouterApiKey?: Secret;
}
```

```ts title="src/audit/audit.workflow.ts" no-check: context tab
import { Budget, BudgetPeriod, BudgetScope, Workflow, WorkflowFinish, WorkflowStart, start, type BudgetHandler } from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";
import { usd, type Usd } from "agboss/units";

@WorkflowStart({ name: "audit-workflow-start", description: "A request", input: WorkflowStartTextDto })
export class AuditWorkflowStart {}

@WorkflowFinish({ name: "audit-workflow-finish", description: "The answer", output: WorkflowStartTextDto })
export class AuditWorkflowFinish {}

@Workflow({
  name: "audit-workflow",
  version: "1.0.0",
  flow: [
    start(AuditWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toFinish(AuditWorkflowFinish),
  ],
})
export class AuditWorkflow {}

@Budget({ name: "audit-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class AuditAppBudget implements BudgetHandler {
  maxSpend(): Usd { return usd(10); }
}
```

Each environment (`prod.environment.ts`, `dev.environment.ts`, `test.environment.ts`) is a plain object typed by the contract:

```ts title="src/audit/environments/prod.environment.ts" file=src/audit/environments/prod.environment.ts
import { env, secret } from "agboss";
import type { AppEnvironment } from "./app.environment.js";

export const environment: AppEnvironment = {
  auditUrl: env("AUDIT_URL"),
  databaseUrl: secret("DATABASE_URL"),
  openRouterApiKey: secret("OPENROUTER_API_KEY"),
};
```

```ts title="src/audit/environments/test.environment.ts" no-check: context tab
import type { AppEnvironment } from "./app.environment.js";

export const environment: AppEnvironment = {
  auditUrl: "http://127.0.0.1:4010/audit",
  databaseUrl: "sqlite://:memory:",
};
```

## What `@Application` configures

| Option | Purpose |
| :--- | :--- |
| `workflows` | `@Workflow` classes exposed by the application. Calling `app.execute(StartClass, input)` runs the workflow owning that `@WorkflowStart`. |
| `environment` | Environment contract class (or `EmptyEnvironment` when no environment variables are needed). `Secret` fields mask as `***` everywhere except `.reveal()`. |
| `providers` | Infrastructure and shared providers: `@ModelProvider` classes, `@Channel` implementations, custom `Logger` / `Clock`, and `Sqlite*Repository` stores. |
| `budgets` | `@Budget` classes covering `BudgetScope.Application`, `BudgetScope.Tenant`, and `BudgetScope.Execution` (checked at assembly). |
| `piiPolicies` | Application-wide `@PiiPolicy` classes masking personal data at model boundaries and across logs, traces, and records. |
| `observers` | `@Injectable()` observer classes implementing hooks like `OnExecutionEnd`, `OnAgentStart`, `OnExecutionRejected`, or `OnExecutionResume`. |
| `shutdownTimeout` | Graceful drain window on `app.close()` or `SIGTERM` / `SIGINT` (default `seconds(25)`), after which remaining runs release their leases for peer instances. |

## How `app.execute`, `app.resume`, `app.cancel`, and `app.close` work

- **`app.execute(StartClass, input, options?)`** — Starts or continues a workflow thread scoped by `{ threadId, ownerId, tenant: { tenantId, weight } }`, checking all budgets before the first step.
- **`app.resume({ pauseId, decision }, options?)`** — Atomically records a human-in-the-loop decision (`Pending → Resolved`), acquires the execution tree's 30-second lease, and continues from the checkpoint.
- **`app.cancel(threadId, { tenantId, ownerId })`** — Aborts a running execution before its next model or tool call (`ExecutionCancelledError`) or withdraws pending pauses on a paused thread.
- **`app.close({ timeout? })`** — Rejects new executions with `ApplicationStoppingError`, stops the recovery sweep, runs `onStop`, waits up to `timeout` for active passes to finish or pause, releases remaining leases so peer instances can recover them immediately, and runs `onDestroy`.
