---
title: "@Application"
description: Complete API reference for the @Application decorator in AGBoss — configuration options, createApp(), App runtime methods, contexts, and testWith().
---

The `@Application` decorator defines the single assembly root (`*.application.ts`) of an AGBoss service. It wires your top-level `@Workflow` classes, typed `environment` contract, `@ModelProvider` gateways, mandatory `@Budget` caps, `@PiiPolicy` rules, `ExecutionObserver` hooks, and multi-instance storage repositories into one container verified at startup by `createApp(Application)` and in tests by `testWith(Application)`.

## Complete `@Application` example with all capabilities

```ts title="src/support.application.ts" file=src/support.application.ts
import {
  Application,
  SqliteCheckpointSaver,
  SqliteCostLedgerRepository,
  SqliteExecutionLeaseRepository,
  SqliteExecutionRecordRepository,
  SqliteExecutionTreeRepository,
  SqlitePausedExecutionRepository,
  SqliteRateLimitRepository,
} from "agboss";
import { Reasoning, ReasoningEffort } from "agboss/models";
import { hours, seconds } from "agboss/units";
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
import {
  ContactPiiPolicy,
  DecisionsModelProvider,
  MetricsObserver,
  OpenRouterModelProvider,
  SlackRefundApprovalChannel,
  SupportWorkflow,
} from "./support.components.js";

@Application({
  name: "support-application",
  version: "0.1.0",
  workflows: [SupportWorkflow],
  environment: AppEnvironment,
  tenantContext: SupportTenantContext,
  executionContext: SupportExecutionContext,
  providers: [
    OpenRouterModelProvider,
    DecisionsModelProvider,
    SlackRefundApprovalChannel,
    SqliteCheckpointSaver,
    SqliteCostLedgerRepository,
    SqliteExecutionRecordRepository,
    SqlitePausedExecutionRepository,
    SqliteExecutionLeaseRepository,
    SqliteExecutionTreeRepository,
    SqliteRateLimitRepository,
  ],
  budgets: [
    AppDailyBudget,
    TenantMonthlyBudget,
    ExecutionRunBudget,
  ],
  piiPolicies: [ContactPiiPolicy],
  pseudonymKey: "piiPseudonymKey",
  observers: [MetricsObserver],
  uncompactedTurns: 6,
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
  pauseRecordRetention: hours(48),
  shutdownTimeout: seconds(25),
})
export class SupportApplication {}

export { SupportWorkflow };
```

```ts title="src/environments/prod.environment.ts" file=src/environments/prod.environment.ts
import { env, secret } from "agboss";
import type { AppEnvironment } from "../support.contracts.js";

export const environment: AppEnvironment = {
  openRouterApiKey: secret("OPENROUTER_API_KEY"),
  piiPseudonymKey: secret("PII_PSEUDONYM_KEY"),
  sqlitePath: env("AGBOSS_SQLITE_PATH", { default: ".agboss/state.sqlite" }),
  webhookBaseUrl: env.optional("WEBHOOK_BASE_URL"),
};
```

```ts title="src/budgets/support.budgets.ts" file=src/budgets/support.budgets.ts
import { Budget, BudgetPeriod, BudgetScope, type BudgetHandler } from "agboss";
import { usd, type Usd } from "agboss/units";

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
import { ExecutionStatus, createApp } from "agboss";
import { seconds } from "agboss/units";
import { SupportApplication } from "./support.application.js";
import { ChatWorkflowStart } from "./support.components.js";

export async function runSupportServer() {
  const app = await createApp(SupportApplication, { env: "prod" });

  const result = await app.execute(
    ChatWorkflowStart,
    { text: "Please refund order #A-1042" },
    {
      threadId: "thread-1042",
      ownerId: "user-42",
      tenant: { tenantId: "acme", weight: 3, planTier: "enterprise" },
      execution: { accountId: "acc-99" },
      record: true,
    },
  );

  if (result.status === ExecutionStatus.Paused) {
    const pause = result.pending[0];
    if (pause?.pauseId !== undefined) {
      await app.resume(
        { pauseId: pause.pauseId, decision: { approved: true } },
        { tenantId: "acme", answeredBy: "finance-lead" },
      );
    }
  }

  process.once("SIGTERM", () => {
    void app.close({ timeout: seconds(25) });
  });
}
```

```ts title="test/support.application.test.ts" file=test/support.application.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "agboss";
import { replyWith, testWith } from "agboss/testing";
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
import { ExecutionContext, TenantContext, type Secret } from "agboss";
import { Text } from "agboss/dto";

// Pure contract class (no default values on fields — enforced by [environment.contract-value]):
export class AppEnvironment {
  openRouterApiKey!: Secret;
  piiPseudonymKey!: Secret;
  sqlitePath!: string;
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
  ChannelOf,
  ChannelOutcome,
  ChannelRole,
  Injectable,
  PauseAnswerer,
  PiiAction,
  PiiKind,
  PiiPolicy,
  Tool,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  pii,
  start,
  type ChannelAsk,
  type ExecutionEndEvent,
  type OnExecutionEnd,
  type ToolHandler,
} from "agboss";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "agboss/dto";
import { DecisionsModelProvider, OpenRouterModelProvider } from "agboss/models";

export { DecisionsModelProvider, OpenRouterModelProvider };

@Injectable()
export class MetricsObserver implements OnExecutionEnd {
  onExecutionEnd(event: ExecutionEndEvent): void {
    console.log(event.workflow.name, event.executionId, event.spend.totalUsd);
  }
}

@PiiPolicy({
  name: "contact-pii-policy",
  description: "Pseudonymizes customer emails",
  rules: [pii(PiiKind.Email, PiiAction.replaceWithToken())],
})
export class ContactPiiPolicy {}

@ChannelRole({
  name: "refund-approval-channel",
  description: "Approves refunds",
  approves: WorkflowStartTextDto,
  answeredBy: PauseAnswerer.Channel,
})
export abstract class RefundApprovalChannel extends ChannelOf<RefundApprovalChannel> {}

@Channel({
  name: "slack-refund-approval-channel",
  description: "Slack refund approval channel",
})
export class SlackRefundApprovalChannel extends RefundApprovalChannel {
  send(_ask: ChannelAsk<RefundApprovalChannel>): Promise<ChannelOutcome<RefundApprovalChannel>> {
    return Promise.resolve(ChannelOutcome.awaitReply());
  }
}

@Tool({
  name: "refund_order",
  description: "Refunds an order after approval",
  input: WorkflowStartTextDto,
  output: WorkflowFinishTextDto,
  channel: RefundApprovalChannel,
})
export class RefundOrderTool implements ToolHandler<WorkflowStartTextDto, WorkflowFinishTextDto> {
  run({ text }: WorkflowStartTextDto): Promise<WorkflowFinishTextDto> {
    return Promise.resolve({ text: `Refunded: ${text}` });
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
  prompt: "Help the customer.",
  tools: [RefundOrderTool],
})
export class SupportAgent {}

@Workflow({
  name: "support-workflow",
  version: "1.0.0",
  flow: [
    start(ChatWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toAgent(SupportAgent)
      .toFinish(ChatWorkflowFinish),
  ],
})
export class SupportWorkflow {}
```
-->

## What options does `@Application` accept?

Every `@Application` class name ends with `Application` and its `name` option ends with `-application`:

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier ending with `-application` (e.g., `"job-scout-application"`). |
| `version` | `string` | Yes | Semantic release version of the application (`"0.1.0"`), recorded in logs and traces. |
| `workflows` | `readonly Class[]` | Yes | Top-level `@Workflow` classes registered in the application; child workflows are discovered automatically. |
| `environment` | `Class` | Yes | Environment contract class (`AppEnvironment` or `EmptyEnvironment`) validated at startup. |
| `providers` | `readonly Provider[]` | No | Infrastructure repository implementations (`Sqlite*Repository`), `@ModelProvider` classes, `@Channel` implementations, and shared `@Injectable` services. |
| `budgets` | `readonly Class[]` | No | `@Budget` classes enforcing spend caps across `Application`, `Tenant`, and `Execution` scopes. |
| `observers` | `readonly ObserverClass[]` | No | `@Injectable` classes implementing `OnExecutionEnd`, `OnToolEnd`, `OnModelEnd`, `OnValuesOutdated`, and other observer hooks. |
| `healthChecks` | `readonly Class[]` | No | `@HealthCheck` classes executed by `app.checkReadiness()` and `app.checkLiveness()` alongside built-in repository and concurrency checks. |
| `piiPolicies` | `readonly Class[]` | No | Application-wide `@PiiPolicy` classes applied to every agent, router, log entry, and trace. |
| `guardrails` | `readonly Class[]` | No | Application-wide `@InputGuardrail` and `@OutputGuardrail` classes applied to every agent and model router. |
| `toolInterceptors` | `readonly Class[]` | No | Application-wide [`@ToolInterceptor`](/reference/tool-interceptor/) classes applied to every `@Tool` and `@McpTool` call. |
| `maxMeshHops` | `number` | No | Maximum cross-service A2A/MCP federation hops allowed (`8` by default; throws `HopsLimitExceededError` when exceeded). |
| `mesh` | `MeshOptions` | No | Agent Mesh Envelope signing and verification settings (`{ signingKey, peers, idempotencyRetention }`) for multi-service A2A/MCP deployments. |
| `compaction` | `Class` | No | Default [`@Compaction`](/reference/compaction/) class summarizing turns older than `uncompactedTurns`. |
| `uncompactedTurns` | `number \| TurnLimit` | No | Default number of recent turns shown in full to every agent and model router (`5` by default, or `TurnLimit.ALL`). |
| `pseudonymKey` | `string` | No | Name of a `Secret` field on the `environment` class used for HMAC token pseudonymization across all pods. |
| `tenantContext` | `TenantContextClass` | No | Custom subclass of `TenantContext` whose decorated DTO fields (without `prompt`, `[context.prompt-unused]`) are required on `app.execute(..., { tenant })`. |
| `executionContext` | `ExecutionContextClass` | No | Custom subclass of `ExecutionContext` carrying per-execution identity fields passed via `app.execute(..., { execution })`. |
| `defaults` | `WorkflowDefaults` | No | Default `models`, `router`, `guardrail`, `tools`, and `flow` settings inherited by all workflows. |
| `exposes` | `readonly Class[]` | No | `@A2AExpose` and `@McpExpose` contract classes served over A2A/MCP and exported in `agboss describe --json`. |
| `maxConcurrentSteps` | `number` | No | Maximum `@Agent`, `@Router`, and `@Action` steps running concurrently in this process before queueing by priority and reporting `step-slots` as `HealthStatus.Degraded`. |
| `compensationTimeout` | `Milliseconds` | No | Dedicated cleanup window for automatic LIFO saga compensation when an execution is cancelled or hits a limit (`seconds(30)` by default). |
| `pauseRecordRetention` | `Milliseconds` | No | How long resolved or cancelled pause records remain stored (`hours(24)` by default). |
| `executionRecordRetention` | `Milliseconds` | No | How long completed `ExecutionRecord` snapshots remain in `ExecutionHistoryRepository` (`days(7)` by default). |
| `shutdownTimeout` | `Milliseconds` | No | Grace period for `app.close()` and `SIGTERM` / `SIGINT` drain before releasing active execution leases (`seconds(25)` by default). |

## What related entities work with `@Application`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `createApp(AppClass, options?)` | `"agboss"` | Boots the container, runs `onInit()` and `onStart()` on all components, starts recovery sweeps, and returns the `App` handle. |
| `App` (`execute`, `resume`, `cancel`, `checkReadiness`, `checkLiveness`, `close`, `tool`) | `"agboss"` | Runtime handle used to start workflows, resume pauses, cancel runs (`app.cancel(threadId)`), report pod health (`HealthStatus.Healthy` / `HealthStatus.Degraded` / `HealthStatus.Unhealthy`), invoke isolated tools, and drain gracefully on shutdown. |
| `EmptyEnvironment` | `"agboss"` | Built-in empty contract class for applications that do not read environment variables. |
| `env()`, `env.optional()`, `secret()` | `"agboss"` | Readers used in `environments/*.environment.ts` files to bind and validate `process.env` variables at startup. |
| `ApplicationContext`, `Clock`, `Logger` | `"agboss"` | Built-in container singletons injectable into any service, action, tool, or observer via `deps`. |
| `Sqlite*Repository` (10 classes) | `"agboss"` | Zero-dependency `node:sqlite` WAL implementations of the 10 multi-instance durability, child work-stealing (`SqliteChildExecutionQueueRepository`), history (`SqliteExecutionHistoryRepository`), and mesh deduplication (`SqliteMeshRequestRepository`) contracts. |
| `testWith(AppClass, options?)` | `"agboss/testing"` | Deterministic test harness that boots one or more application instances with DI `overrides` and a `VirtualClock`. |
