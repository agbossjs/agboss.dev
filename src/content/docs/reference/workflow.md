---
title: "@Workflow"
description: Complete API reference for @Workflow in AGBoss — options, HarnessDSL (HDSL) Path Scope flow methods, parallel waves, quorums, child workflows, and review loops.
---

The `@Workflow` decorator defines a typed state graph (`*.workflow.ts`) in AGBoss using **HarnessDSL (`HDSL`)** — our declarative graph syntax. Every workflow declares its `name`, `version`, a `historyTtl` and a `flow` array of paths built with `onStart()`, `onAgent()`, `onRouter()`, `onAction()`, `onWorkflow()` and `onExternalTask()` and the steps `toAgent()`, `toAction()`, `toRouter()`, `toWorkflow()`, `toExternalTask()`, `toFinish()`, `toOneOf()`, `onRoute()`, `inParallel()` and `forEachItem()`, enforcing strictly one chained method call per line (`@stylistic/newline-per-chained-call`) and compile-time Path Scope verification.

## Complete `@Workflow` example with all capabilities

```ts title="src/workflows/offer-negotiation.workflow.ts" file=src/workflows/offer-negotiation.workflow.ts
import {
  StepError,
  LimitError,
  Workflow,
  onAction,
  onAgent,
  onStart,
  toAction,
  toAgent,
  toFinish,
  toRouter,
  toWorkflow,
  Ttl,
} from "@agboss/core";
import { Reasoning, ReasoningEffort } from "@agboss/core/models";
import { days, seconds } from "@agboss/core/units";
import {
  AuditArbiter,
  AuditTrailGuardrail,
  ComplianceCheckWorkflow,
  DrafterAgent,
  EditorAgent,
  LegalAuditAgent,
  NotifyRecruiterAction,
  OfferMemory,
  OfferFailedWorkflowFinish,
  OfferFormattingService,
  OfferPiiPolicy,
  OfferWorkflowFinish,
  OfferWorkflowStart,
  ReviewerAgent,
  SecurityAuditAgent,
  SendOfferAction,
  TriageRouter,
} from "../offer.components.js";

@Workflow({
  name: "offer-workflow",
  version: "1.0.0",
  historyTtl: days(90), // how long the history of finished executions is kept; Ttl.Forever, Ttl.None
  executionLimits: { maxSteps: 18, maxDepth: 3, maxConcurrency: 8 },
  providers: [OfferFormattingService],
  piiPolicies: [OfferPiiPolicy],
  guardrails: [AuditTrailGuardrail],
  memory: OfferMemory, // without one the workflow is stateless: no earlier turn is read
  promptVariables: {
    companyName: "Acme Corp",
  },
  defaults: {
    models: {
      temperature: 0.2,
      reasoning: Reasoning.on({ effort: ReasoningEffort.Low }),
    },
    router: {
      model: "typesafe/jev-1.13",
    },
    tools: {
      maxToolCalls: 6,
    },
  },
  flow: [
    onStart(OfferWorkflowStart)
      .toRouter(TriageRouter)
      .onRoute(
        toAgent(DrafterAgent)
          .toAgent(ReviewerAgent),
      )
      .onRoute(toFinish(OfferFailedWorkflowFinish)),

    onAgent(ReviewerAgent)
      .onError(
        LimitError.Visits,
        toAction(NotifyRecruiterAction),
      )
      .toOneOf([
        toWorkflow(ComplianceCheckWorkflow)
          .inParallel([toAgent(SecurityAuditAgent), toAgent(LegalAuditAgent)])
          .arbitratedBy(AuditArbiter)
          .joinQuorum({ min: 2, deadline: seconds(15) })
          .onError(
            StepError,
            toAction(NotifyRecruiterAction),
          )
          .toAction(SendOfferAction)
          .toFinish(OfferWorkflowFinish),
        toAgent(EditorAgent)
          .toAgent(ReviewerAgent),
      ]),

    onAction(NotifyRecruiterAction)
      .toFinish(OfferFailedWorkflowFinish),
  ],
})
export class OfferWorkflow {}
```

```ts title="src/dto/offer-negotiation.dto.ts" file=src/dto/offer-negotiation.dto.ts
import { Integer, Text } from "@agboss/core/dto";

export class CandidateInputDto {
  @Text() role!: string;
  @Text() region!: string;
}

export class OfferDraftDto {
  @Text() summary!: string;
  @Integer() baseUsd!: number;
}

export class DraftApprovedDto {
  @Text() signedBy!: string;
}

export class ChangesRequestedDto {
  @Text() critique!: string;
}

export class ComplianceReportDto {
  @Text() status!: string;
}

export class AuditVerdictDto {
  @Text() auditor!: string;
}
```

<!--
```ts file=src/offer.components.ts
import {
  Action,
  Agent,
  Arbiter,
  Arbitrate,
  DecidedBy,
  Injectable,
  Memory,
  OutputGuardrail,
  PiiKind,
  PiiPolicy,
  Router,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  CompactionStrategy,
  inline,
  listOf,
  oneOf,
  onStart,
  optional,
  toAgent,
  Ttl,
  type ActionHandler,
  type InputOf,
} from "@agboss/core";
import { days } from "@agboss/core/units";
import {
  AuditVerdictDto,
  CandidateInputDto,
  ChangesRequestedDto,
  ComplianceReportDto,
  DraftApprovedDto,
  OfferDraftDto,
} from "./dto/offer-negotiation.dto.js";

@Injectable()
export class OfferFormattingService {}

@PiiPolicy({
  name: "offer-pii-policy",
  description: "Masks emails in offer workflow",
  rules: [PiiKind.Email.mask()],
})
export class OfferPiiPolicy {}

@OutputGuardrail({
  name: "audit-trail-guardrail",
  description: "Checks audit trail compliance",
  prompt: inline("Does the reply omit required disclaimers?"),
  model: "typesafe/jev-1.13",
  threshold: 0.85,
  refusal: "Blocked by audit trail policy.",
})
export class AuditTrailGuardrail {}

@Memory({
  name: "offer-memory",
  description: "Remembers eight turns in full",
  ttl: days(30),
  uncompactedTurns: 8,
})
export class OfferMemory {}

@WorkflowStart({ name: "offer-workflow-start", description: "Start", input: CandidateInputDto })
export class OfferWorkflowStart {}

@WorkflowFinish({ name: "offer-workflow-finish", description: "Finish", output: OfferDraftDto })
export class OfferWorkflowFinish {}

@WorkflowFinish({ name: "offer-failed-workflow-finish", description: "Failed", output: CandidateInputDto })
export class OfferFailedWorkflowFinish {}

@Agent({
  name: "drafter-agent",
  description: "Drafts offer",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Draft the offer for {{companyName}}."),
  input: { candidate: CandidateInputDto },
  output: OfferDraftDto,
})
export class DrafterAgent {}

@Agent({
  name: "editor-agent",
  description: "Edits offer",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Revise the offer."),
  input: { draft: OfferDraftDto, critique: ChangesRequestedDto },
  output: OfferDraftDto,
})
export class EditorAgent {}

@Agent({
  name: "reviewer-agent",
  description: "Reviews offer",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Review the offer."),
  executionLimits: { maxVisits: 3 },
  input: { draft: OfferDraftDto },
  output: oneOf(DraftApprovedDto, ChangesRequestedDto),
})
export class ReviewerAgent {}

@Agent({
  name: "security-audit-agent",
  description: "Security audit",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Security audit."),
  input: { report: ComplianceReportDto },
  output: AuditVerdictDto,
})
export class SecurityAuditAgent {}

@Agent({
  name: "legal-audit-agent",
  description: "Legal audit",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Legal audit."),
  input: { report: ComplianceReportDto },
  output: AuditVerdictDto,
})
export class LegalAuditAgent {}

@Router({
  name: "triage-router",
  description: "Triages candidate input",
  decidedBy: DecidedBy.Model,
  input: { candidate: CandidateInputDto },
  prompt: inline("Triage the candidate request."),
  routes: [
    { target: DrafterAgent, prompt: "Valid candidate request" },
    { target: OfferFailedWorkflowFinish, prompt: "Stop and send the answer: Invalid candidate request" },
  ],
})
export class TriageRouter {}

@Arbiter({ name: "audit-arbiter" })
export class AuditArbiter {
  @Arbitrate(SecurityAuditAgent, LegalAuditAgent)
  hasAuditor(v: AuditVerdictDto): boolean { return v.auditor.length > 0; }
}

@Action({
  name: "send-offer-action",
  description: "Sends approved offer",
  input: { approval: DraftApprovedDto, verdicts: listOf(AuditVerdictDto) },
})
export class SendOfferAction implements ActionHandler<SendOfferAction> {
  execute(_input: InputOf<SendOfferAction>): void {}
}

@Action({
  name: "notify-recruiter-action",
  description: "Notifies recruiter on error",
  input: { draft: optional(OfferDraftDto) },
})
export class NotifyRecruiterAction implements ActionHandler<NotifyRecruiterAction> {
  execute(_input: InputOf<NotifyRecruiterAction>): void {}
}

@WorkflowStart({ name: "compliance-check-workflow-start", description: "Start", input: DraftApprovedDto })
export class ComplianceCheckStart {}
@WorkflowFinish({ name: "compliance-check-workflow-finish", description: "Finish", output: ComplianceReportDto })
export class ComplianceCheckFinish {}
@Agent({
  name: "compliance-agent",
  description: "Compliance check",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Check compliance."),
  input: { approval: DraftApprovedDto },
  output: ComplianceReportDto,
})
export class ComplianceAgent {}

@Workflow({
  name: "compliance-check-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [
    onStart(ComplianceCheckStart)
      .toAgent(ComplianceAgent)
      .toFinish(ComplianceCheckFinish),
  ],
})
export class ComplianceCheckWorkflow {}
```
-->

<!--
```ts file=src/offer.application.ts
import { Application, Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, type BudgetHandler } from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";
import { OfferWorkflow } from "./workflows/offer-negotiation.workflow.js";

@Budget({ name: "ow-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class OwAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(20); } }
@Budget({ name: "ow-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class OwTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "ow-exec-budget", scope: BudgetScope.Execution })
export class OwExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "offer-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [OfferWorkflow],
  budgets: [OwAppBudget, OwTenantBudget, OwExecBudget],
})
export class OfferApplication {}
```
-->

```ts title="test/offer-negotiation.workflow.test.ts" file=test/offer-negotiation.workflow.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "@agboss/core";
import { replyWith, routeTo, testWith } from "@agboss/core/testing";
import { OfferApplication } from "../src/offer.application.js";
import {
  ComplianceAgent,
  DrafterAgent,
  LegalAuditAgent,
  OfferWorkflowStart,
  ReviewerAgent,
  SecurityAuditAgent,
  TriageRouter,
} from "../src/offer.components.js";
import {
  AuditVerdictDto,
  ComplianceReportDto,
  DraftApprovedDto,
  OfferDraftDto,
} from "../src/dto/offer-negotiation.dto.js";

const test = testWith(OfferApplication);

test("runs OfferWorkflow through review loop and quorum to approval", async ({ app, mockModel }) => {
  mockModel(TriageRouter).thenReturn(routeTo(DrafterAgent));
  mockModel(DrafterAgent).thenReturn(
    replyWith(OfferDraftDto, { summary: "Staff TS Engineer", baseUsd: 215_000 }),
  );
  mockModel(ReviewerAgent).thenReturn(
    replyWith(DraftApprovedDto, { signedBy: "comp-committee" }),
  );
  mockModel(ComplianceAgent).thenReturn(
    replyWith(ComplianceReportDto, { status: "passed" }),
  );
  mockModel(SecurityAuditAgent).thenReturn(
    replyWith(AuditVerdictDto, { auditor: "sec-1" }),
  );
  mockModel(LegalAuditAgent).thenReturn(
    replyWith(AuditVerdictDto, { auditor: "legal-1" }),
  );
  const res = await app.execute(OfferWorkflowStart, { role: "Staff TS", region: "EU" });
  expect(res.status).toBe(ExecutionStatus.Finished);
});
```

## What options does `@Workflow` accept?

Every `@Workflow` class name ends with `Workflow` and its `name` option ends with `-workflow`. An option that is not on the list is `[decorator.unknown-option]` at assembly (the message says where a moved option went):

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier ending with `-workflow` (e.g., `"offer-workflow"`). |
| `version` | `string` | Yes | Behavior version of the workflow (`"1.0.0"`), checked when resuming paused executions across deploys. |
| `historyTtl` | `Milliseconds \| Ttl` | Yes | How long the history of the workflow's finished executions is kept: a duration (`days(90)`), `Ttl.Forever` (never swept) or `Ttl.None` (no history is kept). Left out: `[limits.history-ttl-required]`. |
| `flow` | `readonly FlowPath[]` | Yes | List of paths starting with `onStart()`, `onAgent()`, `onRouter()`, `onAction()`, `onWorkflow()` or `onExternalTask()`. |
| `executionLimits` | `WorkflowExecutionLimits` | No | `{ maxSteps, maxDepth, maxPathDepth, maxConcurrency }`. `maxSteps`: agent, router, action and external-task visits per execution; `maxDepth`: nesting depth of child workflows and `() => Self` recursion (soft stop omitting the recursion option at `depth === maxDepth` for model launches; throws `LimitError.Depth` for deterministic launches); `maxConcurrency`: concurrent executions across the root workflow and all child/recursive subtrees. The flat `maxSteps`, `maxDepth` and `maxConcurrentExecutions` of 0.1.0 are gone. |
| `defaults` | `WorkflowDefaults` | No | Workflow-level defaults for `models`, `router`, `guardrail`, `tools` and `files`. |
| `modelProvider` | `Class` | No | The `@ModelProvider` of every model of this workflow that names none (the application's is the next level of the cascade). |
| `memory` | `Class` | No | The [`@Memory`](/reference/memory/) of the workflow's agents and routers: its window, summaries and `ttl`. A workflow without one is stateless. |
| `budget` | `Class` | No | A `@Budget` attached to this workflow (found without listing it in the application); workflows sharing one budget share one cap. |
| `filePolicy` | `Class` | No | The `@FilePolicy` bounding the workflow's files: how many, how large, of which media types. |
| `placement` | `ChildPlacement` | No | Where this workflow runs when it is a child: `CurrentProcess`, `AnyWorker`, `OtherWorker` or `IsolatedWorker`. |
| `providers` | `readonly Provider[]` | No | Workflow-scoped `@Injectable` services, `@A2AAgent` clients, `@McpServer` classes or `provide(TOKEN, value)` bindings. Infrastructure (model providers, stores) belongs to the application: `[di.infrastructure-in-workflow]`. |
| `piiPolicies` | `readonly Class[]` | No | Additional `@PiiPolicy` classes applied to all agents and routers in this workflow, and, for a child, to its whole chain. |
| `excludePiiPolicies` | `readonly Class[]` | No | Inherited policies exempted at this workflow's models (observability stays masked). |
| `guardrails` | `readonly Class[]` | No | [`@InputGuardrail` and `@OutputGuardrail`](/reference/guardrail/) classes applied across all agents and model routers in this workflow. |
| `toolInterceptors` | `readonly Class[]` | No | [`@ToolInterceptor`](/reference/tool-interceptor/) classes applied across all `@Tool` invocations in this workflow. |
| `excludeToolInterceptors` | `readonly Class[]` | No | Inherited application `@ToolInterceptor` classes exempted for this workflow. |
| `promptVariables` | `Record<string, string \| EnvRef<string>>` | No | Static `{{variable}}` substitutions available to every prompt in the workflow. |

## What HarnessDSL (HDSL) flow functions and related entities work with `@Workflow`?

| Builder / Entity | Import Path | Description |
| :--- | :--- | :--- |
| `onStart(StartClass)` | `"@agboss/core"` | Begins a root path from a `@WorkflowStart` class: it gives its `input` (one value per field of a map). |
| `onAgent(A)`, `onRouter(R)`, `onAction(A)`, `onWorkflow(W)`, `onExternalTask(Q)` | `"@agboss/core"` | Begins the own path of a node reached from two or more places, written once. |
| `.toAgent(A)`, `.toAction(A)`, `.toRouter(R)`, `.toWorkflow(W)`, `.toExternalTask(Q)`, `.toFinish(F)` | Flow chain | Transitions execution to the next node after verifying its `input` fields exist in Path Scope. What a step gives is derived from its declaration; there is no `.returns`. |
| `.toRouter(R).onRoute(subPath)…` | Flow chain | The router's choice: exactly one `.onRoute(toAgent(X)…)` per route of the `@Router`. |
| `.toOneOf([…])` | Flow chain | One side path per variant of a step's `oneOf(…)` output, without naming a DTO. |
| `.toWorkflow(W).onFinish(WFinish, subPath)` | Flow chain | One path per finish of a child workflow that has two or more finishes. |
| `.inParallel([toAgent(A), toAction(X)…], { maxConcurrency })` | Flow chain | A launch of branches of any kind; `.onError(E, skip())` on a branch drops its failure from the join. |
| `.forEachItem(toAgent(A), { takeFirst \| maxItems, maxConcurrency })` | Flow chain | One run per item of the list the step before gives; also `toAction`, `toExternalTask`, `toWorkflow(W)`. |
| `.join()`, `.arbitratedBy(Arbiter)` + `.joinQuorum({ min, max?, deadline? })`, `.joinQuorumGroups({ deadline })` + `.onGroup([…], { priority }, subPath)` | Flow chain | Joins all parallel branches or resolves early as soon as a quorum verified by one `@Arbiter` is reached. |
| `.onError(ErrorClass, sidePath)` | Flow chain | Catches step or join failures (`StepError`, `LimitError.Visits`, `StepError.QuorumNotReached`) onto a typed recovery path. Also after a join. |
| `toWorkflow(() => Self)` | `"@agboss/core"` | A workflow launches itself with a thunk of its own class, bounded by `executionLimits.maxDepth`. `ThisWorkflow` is gone. |
| `oneOf(A, B)`, `listOf(A, B…)`, `optional(Dto)`, `historyOf(Dto, { maxPrevious })` | `"@agboss/core"` | Path Scope input/output shape wrappers used on component `input` and `output` declarations. |
| `Metadata`, `Tracked<T, P>` | `"@agboss/core"` | The provenance of a value: `Metadata.createdBy(value)`; an input field is the DTO itself. |

Removed with the 0.1.1 flow: `start`, `agent`, `router`, `action`, `workflow`, `route`, `caseOf`, `.returns`, `{ about }`, `.switch`, `.chooseOne`, `.toParallelAgents`, `.toParallelActions`, `.toParallelWorkflows`, `.acceptedBy`, `anyOf`, `.onJoinError`, `ThisWorkflow`, `SpawnPolicy` and `FailurePolicy`.
