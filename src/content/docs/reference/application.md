---
title: "@Application"
description: Complete API reference for the @Application decorator in AGBoss — configuration options, createApp(), App runtime methods, contexts, and testWith().
---

The `@Application` decorator defines the single assembly root (`*.application.ts`) of an AGBoss service. It wires your top-level `@Workflow` classes, typed `environment` contract, `@ModelProvider` gateways, mandatory `@Budget` caps, `@PiiPolicy` rules, `ExecutionObserver` hooks, and multi-instance storage repositories into one container verified at startup by `createApp(Application)` and in tests by `testWith(Application)`.

## Complete `@Application` example with all capabilities

```ts title="src/support.application.ts" file=src/support.application.ts
import { Application } from "@agboss/core";
import { Reasoning, ReasoningEffort } from "@agboss/core/models";
import { hours, seconds } from "@agboss/core/units";
import {
  AppDailyBudget,
  ExecutionRunBudget,
  TenantMonthlyBudget,
} from "./budgets/support.budgets.js";
import {
  AppEnvironment,
  SupportExecutionContext,
  SupportTenantContext,
} from "./support.contracts.js";
import { SupportDatabaseStorage } from "./support.storage.js";
import {
  ContactPiiPolicy,
  DecisionsModelProvider,
  MetricsObserver,
  OpenRouterModelProvider,
  SlackRefundChannel,
  SupportWorkflow,
} from "./support.components.js";

@Application({
  name: "support-application",
  version: "0.1.0",
  workflows: [SupportWorkflow],
  environment: AppEnvironment,
  tenantContext: SupportTenantContext, // declared: the point calls of App need { tenantId }
  executionContext: SupportExecutionContext,
  storage: SupportDatabaseStorage, // where the rows go; unset: the in-memory database
  modelProvider: OpenRouterModelProvider, // there are no built-in providers
  providers: [OpenRouterModelProvider, DecisionsModelProvider],
  channels: [SlackRefundChannel],
  budgets: [
    AppDailyBudget,
    TenantMonthlyBudget,
    ExecutionRunBudget,
  ],
  piiPolicies: [ContactPiiPolicy],
  observers: [MetricsObserver],
  defaults: {
    models: {
      temperature: 0,
      reasoning: Reasoning.on({ effort: ReasoningEffort.Low }),
    },
    router: {
      model: "typesafe/jev-1.13",
    },
    tools: {
      maxToolCalls: 8,
    },
  },
  retention: { pauseRecords: hours(48) },
  executionLimits: { shutdownTimeout: seconds(25), maxConcurrentSteps: 16 },
})
export class SupportApplication {}

export { SupportWorkflow };
```

```ts title="src/environments/prod.environment.ts" file=src/environments/prod.environment.ts
import { env, secret } from "@agboss/core";
import type { AppEnvironment } from "../support.contracts.js";

export const environment: AppEnvironment = {
  webhookBaseUrl: env.optional("WEBHOOK_BASE_URL"),
};
```

```ts title="src/support.storage.ts" file=src/support.storage.ts
import { DatabaseStorage, SqliteDriver, defineEnv, env, secret } from "@agboss/core";
import { hours } from "@agboss/core/units";

const databaseEnv = defineEnv({
  path: env("AGBOSS_SQLITE_PATH", { default: ".agboss/state.sqlite" }),
  piiSecret: secret("PII_PSEUDONYM_KEY"),
  idempotencySecret: secret("AGBOSS_IDEMPOTENCY_SECRET"),
});

@DatabaseStorage({
  name: "support-database-storage",
  driver: SqliteDriver({ path: databaseEnv.path }),
  auditLogTtl: hours(24 * 30),
  ledgerEntriesTtl: hours(24),
  piiSecret: databaseEnv.piiSecret, // the key of the application's PII tokens, the same on every pod
  idempotencySecret: databaseEnv.idempotencySecret,
})
export class SupportDatabaseStorage {}
```

```ts title="src/budgets/support.budgets.ts" file=src/budgets/support.budgets.ts
import { Budget, BudgetPeriod, BudgetScope, type BudgetHandler } from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";

@Budget({ name: "app-daily-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class AppDailyBudget implements BudgetHandler {
  maxSpend(): Usd { return usd(200); }
}

@Budget({ name: "tenant-monthly-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Month })
export class TenantMonthlyBudget implements BudgetHandler {
  maxSpend(): Usd { return usd(50); }
}

@Budget({ name: "execution-run-budget", scope: BudgetScope.Execution })
export class ExecutionRunBudget implements BudgetHandler {
  maxSpend(): Usd { return usd(0.5); }
}
```

```ts title="src/main.ts" file=src/main.ts
import { ExecutionStatus, createApp } from "@agboss/core";
import { seconds } from "@agboss/core/units";
import { SupportApplication } from "./support.application.js";
import { ChatWorkflowStart } from "./support.components.js";

export async function runSupportServer() {
  const app = await createApp(SupportApplication, { env: "prod", handleSignals: true });

  const result = await app.execute(
    ChatWorkflowStart,
    { text: "Please refund order #A-1042" },
    {
      threadId: "thread-1042",
      ownerId: "user-42",
      tenant: { tenantId: "acme", weight: 3, planTier: "enterprise" },
      execution: { accountId: "acc-99" },
      includeRecord: true,
    },
  );

  if (result.status === ExecutionStatus.Paused) {
    const pause = result.pending[0];
    if (pause?.pauseId !== undefined) {
      await app.resume(
        { pauseId: pause.pauseId, decision: { approved: true } },
        { tenantId: "acme", actor: { id: "finance-lead" } }, // the tenant gate: { tenantId } is required
      );
    }
  }

  // an operator's commands: stop where it stands, freeze and continue, or cancel and undo
  await app.pause("thread-1042", { tenantId: "acme", reason: "maintenance" });
  await app.unpause("thread-1042", { tenantId: "acme" });
  await app.stop("thread-1042", { tenantId: "acme", reason: "no longer needed" });

  process.once("SIGTERM", () => {
    void app.close({ timeout: seconds(25) });
  });
}
```

```ts title="test/support.application.test.ts" file=test/support.application.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "@agboss/core";
import { replyWith, testWith } from "@agboss/core/testing";
import { SupportApplication } from "../src/support.application.js";
import { ChatWorkflowStart, SupportAgent } from "../src/support.components.js";

const test = testWith(SupportApplication, { instances: 2 });

test("boots the application container and executes ChatWorkflowStart", async ({ app, mockLlm }) => {
  mockLlm(SupportAgent).thenReturn(replyWith("Refund processed."));
  const res = await app.execute(
    ChatWorkflowStart,
    { text: "Refund order #194" },
    {
      tenant: { tenantId: "acme", weight: 2, planTier: "pro" },
      execution: { accountId: "acc-1" },
    },
  );
  expect(res.status).toBe(ExecutionStatus.Finished);
});
```

<!--
```ts file=src/support.contracts.ts
import { ExecutionContext, TenantContext } from "@agboss/core";
import { Text } from "@agboss/core/dto";

// Pure contract class (no default values on fields — enforced by [environment.contract-value]):
export class AppEnvironment {
  webhookBaseUrl?: string;
}

// Context fields omit `prompt` (enforced by [context.prompt-unused]):
export class SupportTenantContext extends TenantContext {
  @Text()
  planTier!: string;
}

export class SupportExecutionContext extends ExecutionContext {
  @Text()
  accountId!: string;
}
```

```ts file=src/support.components.ts
import {
  Agent,
  Channel,
  ChannelOutcome,
  Observer,
  PauseRespondent,
  PiiKind,
  PiiPolicy,
  Tool,
  ToolApproval,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  inline,
  onStart,
  secret,
  Ttl,
  type ChannelAsk,
  type ExecutionEndEvent,
} from "@agboss/core";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "@agboss/core/dto";
import { DecisionsDriver, ModelCost, ModelProvider, OpenRouterDriver } from "@agboss/core/models";
import { days, hours, minutes, seconds } from "@agboss/core/units";

@ModelProvider({
  name: "openrouter-model-provider",
  description: "OpenRouter — every chat model of the application",
  driver: OpenRouterDriver({ apiKey: secret("OPENROUTER_API_KEY") }),
  timeout: minutes(2),
  cost: ModelCost.fromResponse(),
})
export class OpenRouterModelProvider {}

@ModelProvider({
  name: "decisions-model-provider",
  description: "Decision models on OpenRouter's Decisions API",
  driver: DecisionsDriver({ baseUrl: "https://openrouter.ai/api/v1", apiKey: secret("OPENROUTER_API_KEY") }),
  timeout: seconds(30),
  cost: ModelCost.fromResponse(),
})
export class DecisionsModelProvider {}

@Observer()
export class MetricsObserver {
  onExecutionEnd(event: ExecutionEndEvent): void {
    console.log(event.workflow.name, event.executionId, event.spend.totalUsd);
  }
}

@PiiPolicy({
  name: "contact-pii-policy",
  description: "Pseudonymizes customer emails",
  secret: secret("PII_PSEUDONYM_KEY"),
  rules: [PiiKind.Email.tokenize()],
})
export class ContactPiiPolicy {}

@ToolApproval({
  name: "refund-tool-approval",
  description: "Approves refunds",
  input: WorkflowStartTextDto,
  respondent: PauseRespondent.Delegate,
  timeout: hours(24),
})
export class RefundToolApproval {}

@Channel({
  name: "slack-refund-channel",
  description: "Slack refund approval channel",
  target: RefundToolApproval,
  ttl: days(7),
})
export class SlackRefundChannel {
  send(_ask: ChannelAsk<RefundToolApproval>): Promise<ChannelOutcome<RefundToolApproval>> {
    return Promise.resolve(ChannelOutcome.awaitReply());
  }
}

@Tool({
  name: "refund_order",
  description: "Refunds an order after approval",
  input: WorkflowStartTextDto,
  output: WorkflowFinishTextDto,
  approval: RefundToolApproval,
})
export class RefundOrderTool {
  execute({ text }: WorkflowStartTextDto): WorkflowFinishTextDto {
    return { text: `Refunded: ${text}` };
  }
}

@WorkflowStart({ name: "chat-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class ChatWorkflowStart {}

@WorkflowFinish({ name: "chat-workflow-finish", description: "Finish", output: WorkflowFinishTextDto })
export class ChatWorkflowFinish {}

@Agent({
  name: "support-agent",
  description: "Support agent",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Help the customer."),
  tools: [RefundOrderTool],
})
export class SupportAgent {}

@Workflow({
  name: "support-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [
    onStart(ChatWorkflowStart)
      .toAgent(SupportAgent)
      .toFinish(ChatWorkflowFinish),
  ],
})
export class SupportWorkflow {}
```
-->

## What options does `@Application` accept?

Every `@Application` class name ends with `Application` and its `name` option ends with `-application`. An option that is not on the list is `[decorator.unknown-option]` at assembly:

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier ending with `-application` (e.g., `"job-scout-application"`). |
| `version` | `string` | Yes | Semantic release version of the application (`"0.1.0"`), recorded in logs and traces. |
| `workflows` | `readonly Class[]` | Yes | Top-level `@Workflow` classes registered in the application; child workflows are discovered automatically. |
| `environment` | `Class` | Yes | Environment contract class (`AppEnvironment` or `EmptyEnvironment`) validated at startup. |
| `modelProvider` | `Class` | No | The `@ModelProvider` that serves every model naming none; a workflow's and a component's own `modelProvider` win. A model use whose cascade names no provider is `[model.missing-provider]`. |
| `providers` | `readonly Provider[]` | No | Infrastructure: every `@ModelProvider`, a custom `Logger` / `Clock` / `IdGenerator`, `provide(TOKEN, value)` values, shared `@Injectable` services. Never a store class beside `storage` (`[storage.providers-conflict]`). |
| `storage` | `ApplicationStorage` | No | Where the rows go: a [`@DatabaseStorage`](/reference/database-storage/) class, or `{ database, cluster?, objects? }` with a `@ClusterStorage` and an `@ObjectStorage`. Unset: the in-memory database. |
| `channels` | `readonly Class[]` | No | `@Channel` classes, one per pause target (`@ToolApproval`, `@ExternalTask`) they carry; a target's channel is listed here, never in a workflow. |
| `channelSelectors` / `channelListeners` | `readonly Class[]` | No | `@ChannelSelector` classes that pick a channel for a pause, and `@ChannelListener` hooks told of every pause of the application. |
| `budgets` | `readonly Class[]` | No | `@Budget` classes enforcing dollar and token caps across `Application`, `Tenant`, and `Execution` scopes. |
| `observers` | `readonly Class[]` | No | `@Observer` classes — a method per hook (`onExecutionEnd`, `onExecutionCancel`, `onExecutionStop`, `onToolEnd`, `onInterruptCleanupError`, …); a listed class without `@Observer` is `[observer.not-an-observer]`. |
| `healthChecks` | `readonly Class[]` | No | `@HealthCheck` classes executed by `app.checkReadiness()` and `app.checkLiveness()` alongside built-in repository and concurrency checks. |
| `piiPolicies` | `readonly Class[]` | No | Application-wide `@PiiPolicy` classes applied to every agent, router, log entry, and trace. |
| `guardrails` | `readonly Class[]` | No | Application-wide `@InputGuardrail` and `@OutputGuardrail` classes applied to every agent and model router. |
| `toolInterceptors` | `readonly Class[]` | No | Application-wide [`@ToolInterceptor`](/reference/tool-interceptor/) classes applied to every `@Tool` call. |
| `endpoints` | `readonly Class[]` | No | `@A2AEndpoint` and `@McpEndpoint` contract classes served over A2A/MCP and exported in `agboss describe --json`. |
| `mesh` | `Class` | No | A [`@Mesh`](/reference/a2a-endpoint/#the-mesh) component: `{ signingKey, inboundMode, deduplicationTtl, maxHops, peers }` for multi-service A2A/MCP deployments (`HopsLimitExceededError` past `maxHops`). |
| `tenantContext` | `TenantContextClass` | No | Custom subclass of `TenantContext` whose decorated DTO fields (without `prompt`, `[context.prompt-unused]`) are required on `app.execute(..., { tenant })`. Declaring it switches on the tenant gate. |
| `executionContext` | `ExecutionContextClass` | No | Custom subclass of `ExecutionContext` carrying per-execution identity fields passed via `app.execute(..., { execution })`. |
| `defaults` | `ApplicationDefaults` | No | Default `models`, `router`, `guardrail`, `tools` and `workflows` (`{ placement }`) settings inherited by all workflows. |
| `promptVariables` | `Record<string, string \| EnvRef<string>>` | No | `{{variables}}` of every prompt; the nearest declaration wins. A `secret(…)` here is `[prompt.secret-in-instructions]`. |
| `executionLimits` | `ApplicationExecutionLimits` | No | The instance's limits: `maxConcurrentSteps` (agent, router and action steps running at once before queueing; `step-slots` reports `HealthStatus.Degraded` when full), `shutdownTimeout` (`app.close()` and `SIGTERM` / `SIGINT` drain, `seconds(25)` by default, also the bound of `onInterrupted` cleanups), `compensationTimeout` (cleanup window of automatic LIFO saga compensation, `seconds(15)` by default), `childClaimTimeout`. The flat 0.1.0 options of these names are gone. |
| `retention` | `RetentionOptions` | No | `pauseRecords` (how long resolved or cancelled pause records remain stored, `hours(24)` by default) and `executionRecords` (how long a root execution's history is kept; unset keeps nothing). The audit log and ledger entries are `@DatabaseStorage({ auditLogTtl, ledgerEntriesTtl })`. |
| `isolatedWorker` | `{ entry }` | No | The module a `ChildPlacement.IsolatedWorker` child's forked process runs. |

Gone from 0.1.0: `compaction` / `uncompactedTurns` (a workflow, an agent or a router names a [`@Memory`](/reference/memory/)), `piiKeyField` (the PII key is the storage's `piiSecret`), `maxMeshHops` and the `mesh` options object (the `@Mesh` component), `exposes` (`endpoints`), the flat `maxConcurrentSteps`, `compensationTimeout` and `shutdownTimeout`, `executionRecordRetention`, and every `Sqlite*` class in `providers`.

## What related entities work with `@Application`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `createApp(AppClass, options?)` | `"@agboss/core"` | Boots the container, runs `onInit()` and `onStart()` on all components, starts recovery sweeps, and returns the `App` handle. Options: `env`, `profile`, `processEnv`, `handleSignals` (listen for `SIGTERM` / `SIGINT`; off by default, the CLI passes `true`). |
| `App` (`execute`, `resume`, `cancel`, `stop`, `pause`, `unpause`, `extendPause`, `reassignPause`, `listPauses`, `getExecution`, `listExecutions`, `checkReadiness`, `checkLiveness`, `close`) | `"@agboss/core"` | Runtime handle used to start workflows, resume pauses, cancel (undo what it did), stop (keep what it did) or freeze runs, report pod health (`HealthStatus.Healthy` / `Degraded` / `Unhealthy`), and drain gracefully on shutdown. With a `tenantContext` its point calls take a required `{ tenantId }`. |
| `ExecutionOutput` | `"@agboss/core"` | A union on `status`: `Finished` (`output`, `finish`), `Paused` (`pending`, `isExternallyPaused`), `Stopped` and `Cancelled` — a cancel is an outcome, not a thrown error. |
| `EmptyEnvironment` | `"@agboss/core"` | Built-in empty contract class for applications that do not read environment variables. |
| `env()`, `env.optional()`, `secret()`, `defineEnv()` | `"@agboss/core"` | Readers used in environment files and in storage, provider and endpoint decorators: references read once when the application starts, never at import. |
| `ApplicationContext`, `Clock`, `Logger` | `"@agboss/core"` | Built-in container singletons injectable into any service, action, tool, or observer via `deps`. |
