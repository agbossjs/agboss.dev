---
title: Observability, Observers & Langfuse Tracing
description: Monitor AGBoss workflows in production with typed ExecutionObserver hooks, PII-masked structured logs, revision snapshots, and self-hosted Langfuse.
---

Operating multi-agent systems in production requires visibility into every workflow execution, agent visit, tool call, FinOps spend entry, and human-in-the-loop pause. AGBoss provides two complementary observability layers: compile-checked `ExecutionObserver` classes registered in `@Application({ observers })` for in-process metrics and alerts, and built-in [Langfuse](https://langfuse.com/) tracing for full execution tree inspection.

## How to subscribe to lifecycle events with `ExecutionObserver`

Any class decorated `@Observer({ name?, description?, workflows?, agents?, deps? })` and listed in `@Application({ observers: [...] })` has a method per hook it wants (`onExecutionStart`, `onExecutionEnd`, `onExecutionError`, `onExecutionRejected`, `onExecutionPause`, `onExecutionResume`, `onExecutionCancel`, `onExecutionStop`, `onAgentStart`, `onAgentEnd`, `onAgentRetry`, `onToolStart`, `onToolEnd`, `onInterruptCleanupError`, `onValuesOutdated`, and more — every hook optional). The 0.1.0 single-hook interfaces (`OnExecutionEnd`, `OnAgentStart`, …) and `@Injectable` + `implements On…` are removed; a listed class without `@Observer` is `[observer.not-an-observer]`, a misspelt `on…` method `[observer.unknown-hook]`. `workflows` and `agents` pass only the events of those workflows or agents to the observer, so a hook needs no `if (event.workflow.name !== …) return`. A cancel and a stop are outcomes: `onExecutionCancel` and `onExecutionStop` (a root's cancel no longer reaches `onExecutionError`). Event fields follow the output vocabulary: `ToolStartEvent` has `tool`, `agent?` and `input`; every end event has `output`. All event payloads are pre-masked by the application and workflow `@PiiPolicy` rules before reaching your observer:

```ts title="src/observers/audit.observer.ts" file=src/observers/audit.observer.ts
import { Application, Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, Observer, Workflow, WorkflowFinish, WorkflowStart, onStart, type AgentStartEvent, type BudgetHandler, type ExecutionEndEvent, type ExecutionRejectedEvent, Ttl } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
import { usd, type Usd } from "@agboss/core/units";

@Observer()
export class MetricsObserver {
  onExecutionEnd(event: ExecutionEndEvent): void {
    console.log(
      `${event.workflow.name} ${event.executionId} cost $${String(event.spend.totalUsd)}`,
    );
  }

  onAgentStart(event: AgentStartEvent): void {
    console.log(
      `${event.step.component.name} visit ${String(event.step.visitNumber)}`,
    );
  }

  onExecutionRejected(event: ExecutionRejectedEvent): void {
    console.log(
      `${event.operation} refused for ${event.tenantId}: ${event.code}`,
    );
  }
}

@WorkflowStart({
  name: "ping-workflow-start",
  description: "Ping input",
  input: WorkflowStartTextDto,
})
export class PingWorkflowStart {}

@WorkflowFinish({
  name: "ping-workflow-finish",
  description: "Ping output",
  output: WorkflowStartTextDto,
})
export class PingWorkflowFinish {}

@Workflow({
  name: "ping-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [
    onStart(PingWorkflowStart)
      .toFinish(PingWorkflowFinish),
  ],
})
export class PingWorkflow {}

@Budget({
  name: "ping-app-budget",
  scope: BudgetScope.Application,
  period: BudgetPeriod.Day,
})
export class PingAppBudget implements BudgetHandler {
  maxSpend(): Usd {
    return usd(5);
  }
}

@Budget({
  name: "ping-tenant-budget",
  scope: BudgetScope.Tenant,
  period: BudgetPeriod.Day,
})
export class PingTenantBudget implements BudgetHandler {
  maxSpend(): Usd {
    return usd(1);
  }
}

@Budget({
  name: "ping-exec-budget",
  scope: BudgetScope.Execution,
})
export class PingExecBudget implements BudgetHandler {
  maxSpend(): Usd {
    return usd(0.1);
  }
}

@Application({
  name: "ping-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [PingWorkflow],
  budgets: [PingAppBudget, PingTenantBudget, PingExecBudget],
  observers: [MetricsObserver],
})
export class PingApplication {}
```

```ts title="test/audit.observer.test.ts" file=test/audit.observer.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "@agboss/core";
import { testWith } from "@agboss/core/testing";
import { PingApplication, MetricsObserver, PingWorkflowStart } from "../src/observers/audit.observer.js";

const test = testWith(PingApplication);

test("records execution and agent lifecycle events in MetricsObserver", async ({ app, mockOf }) => {
  const res = await app.execute(PingWorkflowStart, { text: "Check invoice #102" });
  expect(res.status).toBe(ExecutionStatus.Finished);
  expect(mockOf(MetricsObserver).onExecutionEnd).toHaveBeenCalledTimes(1);
});
```

## What events and spans are captured in traces and observers?

Every element of the workflow graph has its own typed `on…Start` / `on…End` hook on an `@Observer` class (every hook optional; the event types such as `ExecutionEndEvent` and `AgentStartEvent` are exported from `"@agboss/core"`):

| Hook(s) | Emitted When | Key Payload Fields |
| :--- | :--- | :--- |
| `onExecutionStart` / `onExecutionEnd` | Root or child workflow starts or finishes | `executionId`, `parentExecutionId`, `rootExecutionId`, `workflow`, `tenantId`, `spend`, `output` (what the finish produced) |
| `onExecutionPause` / `onExecutionResume` | Execution pauses on a target or externally (`isExternallyPaused`, `reason`), or resumes / recovers | `pending`, `reason` (`ResumeReason.Answered`, `Recovered`, `Unpaused`, `Expired`), `decision`, the answering `actor` |
| `onExecutionCancel` / `onExecutionStop` | A cancel (after its undo) or a stop ends an execution — outcomes, not errors | `reason`, `compensations`, `spend` |
| `onExecutionError` / `onExecutionRejected` | Unhandled failure or pre-flight refusal before execution starts | `error`, `operation` (`Execute`, `Resume`, `Cancel`, `Stop`, `Pause`, `Unpause`), `code`, `tenantId` |
| `onAgentStart` / `onAgentEnd` / `onAgentRetry` | `@Agent` visit begins or completes; its own retry loop corrects itself (`AgentRetryReason`: `InvalidAnswer`, `InvalidToolInput`, `JudgeRejected`) | `step` (`component`, `nodeId`, `visitNumber`, `copyNumber`, `idempotencyKey`), `output`, `attempt`, `feedback` |
| `onRouterStart` / `onRouterEnd` | `@Router` decision begins or completes | `step`, chosen route target(s) |
| `onToolStart` / `onToolEnd` | `@Tool` invocation begins or completes | `step`, `callId`, `tool`, `agent?`, `input`, `output` |
| `onModelStart` / `onModelEnd` | Model provider call begins or completes | `callerName`, `model`, `provider`, `messages` (plain role/content), `usage` (prompt, completion, cache read and write tokens), `cost` |
| `onRagStart` / `onRagEnd` | `@Rag` retrieval begins or completes | `step`, retrieved chunk count and query |
| `onActionStart` / `onActionEnd` | `@Action` step begins or completes | `step`, input and `output` |
| `onGuardrailStart` / `onGuardrailEnd` | A guardrail check begins or completes | `step`, side (`Input` / `Output`), pass or block verdict |
| `onChannelStart` / `onChannelEnd` | A channel's outbound ask begins or completes | `step`, target, `pauseId` |
| `onJudgeStart` / `onJudgeEnd` | `@Judge` verification begins or completes | `step`, `judge`, `agent`, verdict (`passed`, `reason`), `output` |
| `onCompactionStart` / `onCompactionEnd` | A `@Memory` compaction runs | `memory`, `turns`, `costUsd`, `summaries` |
| `onInterruptCleanupError` | A step's `onInterrupted` cleanup threw (it never fails the execution) | the cleanup's error |
| `onValuesOutdated` | Loop or branch write cascades stale dependents | `step`, `trigger` (`valueId`, `slot`, `producer`), `outdated` (`OutdatedReason`: `Replaced`, `BuiltFromReplaced`) |
| `onLaunchItemsTruncated` | A per-item launch with `takeFirst` drops the rest | `step`, `launch`, `items`, `taken` |
| `onQuorumDecided` | `.joinQuorum` / `.joinQuorumGroups` reaches a decision | `step`, `isReached`, `branches`, winning `group` |

## How to run self-hosted Langfuse locally and correlate traces with `agboss describe --json`

Start the local Langfuse stack (`./scripts/langfuse.sh up`) and set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` in your environment. Every workflow execution, child workflow, parallel branch, and RAG retrieval is exported automatically without sending data to a third-party SaaS.

To analyze real production coverage of your graph branches, tools, prompts, and DTO fields, export the declarative revision snapshot (`{ application, workflows[], schemas }`) in CI with `agboss describe --json --application <path>`:

- **Revision & prompt fingerprinting (`configHash`, `promptHash`, `schemaHash`):** Runtime traces and `ExecutionRecord` entries carry `WorkflowRecord.configHash`, `ComponentRecord` (`{ name, kind, promptHash, schemaHash }`), and `StepRecord` (`{ toolLoopIteration, validationAttempts, branch: { verdict, status } }`) so observability pipelines can join live Langfuse / OpenTelemetry spans directly against the `agboss describe --json` snapshot to see which `@Router` branches, `@Tool` definitions, and `@Action` `compensateWith` saga edges were exercised in production.
- **Versioned child workflow pause compatibility (`[ChildWorkflowV1, ChildWorkflowV2]`):** When a parent workflow registers multiple versions of a child workflow for rolling upgrades, the revision snapshot records each version's `configHash` so long-sleeping pauses (`PendingPause`) always resume on their matching workflow definition.
