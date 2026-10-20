---
title: Observability, Observers & Langfuse Tracing
description: Monitor AGBoss workflows in production using typed ExecutionObserver hooks, PII-masked structured logs, pause audit records, and self-hosted Langfuse tracing.
---

Operating multi-agent systems in production requires visibility into every workflow execution, agent visit, tool call, FinOps spend entry, and human-in-the-loop pause. AGBoss provides two complementary observability layers: compile-checked `ExecutionObserver` classes registered in `@Application({ observers })` for in-process metrics and alerts, and built-in [Langfuse](https://langfuse.com/) tracing for full execution tree inspection.

## How to subscribe to lifecycle events with `ExecutionObserver`

Any `@Injectable()` class listed in `@Application({ observers: [...] })` can implement one or more observer hook interfaces (`OnExecutionStart`, `OnExecutionEnd`, `OnExecutionError`, `OnExecutionRejected`, `OnExecutionPause`, `OnExecutionResume`, `OnAgentStart`, `OnAgentEnd`, `OnValuesOutdated`). All event payloads are pre-masked by the application and workflow `@PiiPolicy` rules before reaching your observer:

```ts title="src/observers/audit.observer.ts"
import { Application, Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, Injectable, Workflow, WorkflowFinish, WorkflowStart, start, type AgentStartEvent, type BudgetHandler, type ExecutionEndEvent, type ExecutionRejectedEvent, type OnAgentStart, type OnExecutionEnd, type OnExecutionRejected } from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";
import { usd, type Usd } from "agboss/units";

@Injectable()
export class MetricsObserver
  implements OnExecutionEnd, OnAgentStart, OnExecutionRejected
{
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
  flow: [
    start(PingWorkflowStart)
      .returns(WorkflowStartTextDto)
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

```ts title="test/audit.observer.test.ts" no-check: context tab
import { expect } from "vitest";
import { testWith } from "agboss/testing";
import { AuditApplication, AuditObserver, AuditWorkflowStart } from "../src/observers/audit.observer.js";

const test = testWith(AuditApplication);

test("records execution and agent lifecycle events in AuditObserver", async ({ app, mockOf }) => {
  const res = await app.execute(AuditWorkflowStart, { text: "Check invoice #102" });
  expect(res.isFinished()).toBe(true);
  expect(mockOf(AuditObserver).events.length).toBeGreaterThan(0);
});
```

## What events and spans are captured in traces and observers?

Every element of the workflow graph has its own typed `On*Start` / `On*End` callback interface exported from `"agboss"`:

| Hook Interface(s) | Emitted When | Key Payload Fields |
| :--- | :--- | :--- |
| `OnExecutionStart` / `OnExecutionEnd` | Root or child workflow starts or finishes | `executionId`, `parentExecutionId`, `rootExecutionId`, `workflow`, `tenantId`, `spend` |
| `OnExecutionPause` / `OnExecutionResume` | Execution pauses on a `@Channel` or resumes / recovers | `pending`, `reason` (`ResumeReason.Answered` or `ResumeReason.Recovered`), `decision`, `answeredBy` |
| `OnExecutionError` / `OnExecutionRejected` | Unhandled failure or pre-flight refusal before execution starts | `error`, `operation` (`Execute`, `Resume`, `Cancel`), `code`, `tenantId` |
| `OnAgentStart` / `OnAgentEnd` | `@Agent` visit begins or completes | `step` (`component`, `nodeId`, `visitNumber`, `copyNumber`, `idempotencyKey`) |
| `OnRouterStart` / `OnRouterEnd` | `@Router` decision begins or completes | `step`, chosen route target(s) |
| `OnToolStart` / `OnToolEnd` | `@Tool` invocation begins or completes | `step`, `callId`, tool name, validated arguments / output |
| `OnModelStart` / `OnModelEnd` | Model provider call begins or completes | `callerName`, `model`, `usage` (prompt, completion, cached tokens), `cost` |
| `OnRagStart` / `OnRagEnd` | `@Rag` retrieval begins or completes | `step`, retrieved chunk count and query |
| `OnActionStart` / `OnActionEnd` | `@Action` step begins or completes | `step`, input and output metadata |
| `OnGuardrailStart` / `OnGuardrailEnd` | `@Guardrail` check begins or completes | `step`, stage (`Input` / `Output`), pass or block verdict |
| `OnChannelStart` / `OnChannelEnd` | `@Channel` outbound ask begins or completes | `step`, channel role, `pauseId` |
| `OnJudgeStart` / `OnJudgeEnd` | `@Judge` verification begins or completes | `step`, verdict (`passed`, `reason`) |
| `OnValuesOutdated` | Loop or branch write cascades stale dependents | `step`, `trigger` (`valueId`, `slot`, `producer`), `outdated` (`OutdatedReason`) |
| `OnLaunchItemsTruncated` | Parallel launch trims input list to `maxItems` | `step`, `launch`, `items`, `maxItems` |
| `OnQuorumDecided` | `.joinQuorum` / `.joinQuorumGroups` reaches a decision | `step`, `isReached`, `branches`, winning `group` |

## How to run self-hosted Langfuse locally and correlate traces with `agboss describe --json`

Start the local Langfuse stack (`./scripts/langfuse.sh up`) and set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` in your environment. Every workflow execution, child workflow, parallel branch, and RAG retrieval is exported automatically without sending data to a third-party SaaS.

To analyze real production coverage of your graph branches, tools, prompts, and DTO fields, export the declarative revision snapshot (`{ application, workflows[], schemas }`) in CI with `agboss describe --json --workflow <path>`:

- **Revision & prompt fingerprinting (`configHash`, `promptHash`, `schemaHash`):** Runtime traces and `ExecutionRecord` entries carry `WorkflowRecord.configHash`, `ComponentRecord` (`{ name, kind, promptHash, schemaHash }`), and `StepRecord` (`{ toolLoopIteration, validationAttempts, branch: { verdict, status } }`) so observability pipelines can join live Langfuse / OpenTelemetry spans directly against the `agboss describe --json` snapshot to see which `@Router` branches, `@Tool` definitions, and `@Action` `compensateWith` saga edges were exercised in production.
- **Versioned child workflow pause compatibility (`[ChildWorkflowV1, ChildWorkflowV2]`):** When a parent workflow registers multiple versions of a child workflow for rolling upgrades, the revision snapshot records each version's `configHash` so long-sleeping pauses (`PendingPause`) always resume on their matching workflow definition.
