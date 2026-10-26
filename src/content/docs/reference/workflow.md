---
title: "@Workflow"
description: Complete API reference for @Workflow in AGBoss — options, HarnessDSL (HDSL) Path Scope flow methods, parallel waves, quorums, child workflows, and review loops.
---

The `@Workflow` decorator defines a typed state graph (`*.workflow.ts`) in AGBoss using **HarnessDSL (`HDSL`)** — our declarative graph syntax. Every workflow declares its `name`, `version`, and `flow` array of paths built with `start()`, `agent()`, `router()`, `action()`, `workflow()`, `route()`, and `caseOf()`, enforcing strictly one chained method call per line (`@stylistic/newline-per-chained-call`) and compile-time Path Scope verification.

## Complete `@Workflow` example with all capabilities

```ts title="src/workflows/offer-negotiation.workflow.ts" file=src/workflows/offer-negotiation.workflow.ts
import {
  StepFailedError,
  VisitsLimitExceededError,
  Workflow,
  action,
  agent,
  caseOf,
  listOf,
  oneOf,
  route,
  start,
  toAction,
} from "@agboss/core";
import { Reasoning, ReasoningEffort } from "@agboss/core/models";
import { seconds } from "@agboss/core/units";
import {
  AuditArbiter,
  AuditTrailGuardrail,
  ComplianceCheckWorkflow,
  DirectoryMcpServer,
  DrafterAgent,
  EditorAgent,
  LegalAuditAgent,
  NotifyRecruiterAction,
  OfferCompaction,
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
import {
  AuditVerdictDto,
  CandidateInputDto,
  ChangesRequestedDto,
  ComplianceReportDto,
  DraftApprovedDto,
  OfferDraftDto,
} from "../dto/offer-negotiation.dto.js";

@Workflow({
  name: "offer-workflow",
  version: "1.0.0",
  maxSteps: 18,
  maxDepth: 3,
  maxConcurrentExecutions: 8,
  providers: [OfferFormattingService],
  mcp: [DirectoryMcpServer],
  piiPolicies: [OfferPiiPolicy],
  guardrails: [AuditTrailGuardrail],
  compaction: OfferCompaction,
  uncompactedTurns: 8,
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
    start(OfferWorkflowStart)
      .returns(CandidateInputDto)
      .toRouter(TriageRouter)
      .chooseOne(
        route(DrafterAgent)
          .returns(OfferDraftDto)
          .toAgent(ReviewerAgent),
        route(OfferFailedWorkflowFinish),
      ),

    agent(ReviewerAgent)
      .onError(
        VisitsLimitExceededError,
        toAction(NotifyRecruiterAction),
      )
      .returns(oneOf(DraftApprovedDto, ChangesRequestedDto))
      .switch(
        caseOf(DraftApprovedDto)
          .toWorkflow(ComplianceCheckWorkflow)
          .returns(ComplianceReportDto)
          .toParallelAgents(SecurityAuditAgent, LegalAuditAgent)
          .acceptedBy(AuditArbiter)
          .joinQuorum({ min: 2, deadline: seconds(15) })
          .onJoinError(
            StepFailedError,
            toAction(NotifyRecruiterAction),
          )
          .returns(listOf(AuditVerdictDto))
          .toAction(SendOfferAction)
          .toFinish(OfferWorkflowFinish),
        caseOf(ChangesRequestedDto, { about: OfferDraftDto })
          .toAgent(EditorAgent)
          .returns(OfferDraftDto)
          .toAgent(ReviewerAgent),
      ),

    action(NotifyRecruiterAction)
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
  Compaction,
  CompactionStrategy,
  DecidedBy,
  Injectable,
  OnAnswer,
  OutputGuardrail,
  PiiAction,
  PiiKind,
  PiiPolicy,
  Router,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  listOf,
  oneOf,
  optional,
  pii,
  start,
  type ActionHandler,
  type InputOf,
} from "@agboss/core";
import { McpServer, McpServerClient, type ServerTools } from "@agboss/core/mcp";
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

const serverTools = {
  lookup_dir: { input: CandidateInputDto, output: ComplianceReportDto },
} as const satisfies ServerTools;

@McpServer({
  name: "directory-mcp",
  transport: "stdio",
  command: "npx",
  args: ["dir-mcp"],
  tools: serverTools,
})
export class DirectoryMcpServer extends McpServerClient<typeof serverTools> {}

@PiiPolicy({
  name: "offer-pii-policy",
  description: "Masks emails in offer workflow",
  rules: [pii(PiiKind.Email, PiiAction.replaceWithKind())],
})
export class OfferPiiPolicy {}

@OutputGuardrail({
  name: "audit-trail-guardrail",
  description: "Checks audit trail compliance",
  prompt: "Does the reply omit required disclaimers?",
  model: "typesafe/jev-1.13",
  threshold: 0.85,
  refusal: "Blocked by audit trail policy.",
})
export class AuditTrailGuardrail {}

@Compaction({
  name: "offer-compaction",
  description: "Window-only compaction",
  strategy: CompactionStrategy.None,
})
export class OfferCompaction {}

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
  prompt: "Draft the offer for {{companyName}}.",
  input: { candidate: CandidateInputDto },
  output: OfferDraftDto,
})
export class DrafterAgent {}

@Agent({
  name: "editor-agent",
  description: "Edits offer",
  model: "moonshotai/kimi-k2.6",
  prompt: "Revise the offer.",
  input: { draft: OfferDraftDto, critique: ChangesRequestedDto },
  output: OfferDraftDto,
})
export class EditorAgent {}

@Agent({
  name: "reviewer-agent",
  description: "Reviews offer",
  model: "moonshotai/kimi-k2.6",
  prompt: "Review the offer.",
  maxVisits: 3,
  input: { draft: OfferDraftDto },
  output: oneOf(DraftApprovedDto, ChangesRequestedDto),
})
export class ReviewerAgent {}

@Agent({
  name: "security-audit-agent",
  description: "Security audit",
  model: "moonshotai/kimi-k2.6",
  prompt: "Security audit.",
  input: { report: ComplianceReportDto },
  output: AuditVerdictDto,
})
export class SecurityAuditAgent {}

@Agent({
  name: "legal-audit-agent",
  description: "Legal audit",
  model: "moonshotai/kimi-k2.6",
  prompt: "Legal audit.",
  input: { report: ComplianceReportDto },
  output: AuditVerdictDto,
})
export class LegalAuditAgent {}

@Router({
  name: "triage-router",
  description: "Triages candidate input",
  decidedBy: DecidedBy.Model,
  input: { candidate: CandidateInputDto },
  prompt: "Triage the candidate request.",
  routes: [
    { target: DrafterAgent, prompt: "Valid candidate request" },
    { target: OfferFailedWorkflowFinish, prompt: "Stop and send the answer: Invalid candidate request" },
  ],
})
export class TriageRouter {}

@Arbiter({
  name: "audit-arbiter",
  decidedBy: DecidedBy.Code,
})
export class AuditArbiter {
  @OnAnswer(SecurityAuditAgent)
  fromSecurityAudit(v: AuditVerdictDto): boolean { return v.auditor.length > 0; }
  @OnAnswer(LegalAuditAgent)
  fromLegalAudit(v: AuditVerdictDto): boolean { return v.auditor.length > 0; }
}

@Action({
  name: "send-offer-action",
  description: "Sends approved offer",
  input: { draft: OfferDraftDto, verdicts: listOf(AuditVerdictDto) },
})
export class SendOfferAction implements ActionHandler<SendOfferAction> {
  execute(_input: InputOf<SendOfferAction>): Promise<void> { return Promise.resolve(); }
}

@Action({
  name: "notify-recruiter-action",
  description: "Notifies recruiter on error",
  input: { draft: optional(OfferDraftDto) },
})
export class NotifyRecruiterAction implements ActionHandler<NotifyRecruiterAction> {
  execute(_input: InputOf<NotifyRecruiterAction>): Promise<void> { return Promise.resolve(); }
}

@WorkflowStart({ name: "compliance-check-workflow-start", description: "Start", input: OfferDraftDto })
export class ComplianceCheckStart {}
@WorkflowFinish({ name: "compliance-check-workflow-finish", description: "Finish", output: ComplianceReportDto })
export class ComplianceCheckFinish {}
@Agent({
  name: "compliance-agent",
  description: "Compliance check",
  model: "moonshotai/kimi-k2.6",
  prompt: "Check compliance.",
  input: { draft: OfferDraftDto },
  output: ComplianceReportDto,
})
export class ComplianceAgent {}

@Workflow({
  name: "compliance-check-workflow",
  version: "1.0.0",
  flow: [
    start(ComplianceCheckStart)
      .returns(OfferDraftDto)
      .toAgent(ComplianceAgent)
      .returns(ComplianceReportDto)
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

test("runs OfferWorkflow through review loop and quorum to approval", async ({ app, mockLlm }) => {
  mockLlm(TriageRouter).thenReturn(routeTo(DrafterAgent));
  mockLlm(DrafterAgent).thenReturn(
    replyWith(OfferDraftDto, { summary: "Staff TS Engineer", baseUsd: 215_000 }),
  );
  mockLlm(ReviewerAgent).thenReturn(
    replyWith(DraftApprovedDto, { signedBy: "comp-committee" }),
  );
  mockLlm(ComplianceAgent).thenReturn(
    replyWith(ComplianceReportDto, { status: "passed" }),
  );
  mockLlm(SecurityAuditAgent).thenReturn(
    replyWith(AuditVerdictDto, { auditor: "sec-1" }),
  );
  mockLlm(LegalAuditAgent).thenReturn(
    replyWith(AuditVerdictDto, { auditor: "legal-1" }),
  );
  const res = await app.execute(OfferWorkflowStart, { role: "Staff TS", region: "EU" });
  expect(res.status).toBe(ExecutionStatus.Finished);
});
```

## What options does `@Workflow` accept?

Every `@Workflow` class name ends with `Workflow` and its `name` option ends with `-workflow`:

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier ending with `-workflow` (e.g., `"offer-workflow"`). |
| `version` | `string` | Yes | Behavior version of the workflow (`"1.0.0"`), checked when resuming paused executions across deploys. |
| `flow` | `readonly FlowPath[]` | Yes | List of paths starting with `start()`, `agent()`, `router()`, `action()`, or `workflow()`. |
| `maxSteps` | `number` | No | Maximum agent and router visits per execution; defaults to `(agents + routers) * 3`. |
| `maxDepth` | `number` | No | Maximum nesting depth for child workflows and `ThisWorkflow` recursive calls (soft stop omitting the recursion tool at `depth === maxDepth` for model launches; throws `DepthLimitExceededError` for deterministic launches). |
| `maxConcurrentExecutions` | `number` | No | Maximum concurrent executions across the root workflow and all child/recursive subtrees (`10` by default). |
| `defaults` | `WorkflowDefaults` | No | Workflow-level defaults for `models`, `router`, `guardrail`, `tools`, and `flow.maxPathDepth`. |
| `providers` | `readonly Provider[]` | No | Workflow-scoped `@Injectable` services, `@A2AAgent` clients, or `provide(TOKEN, value)` bindings. |
| `mcp` | `readonly Class[]` | No | `@McpServer` classes whose tools are used by agents in this workflow. |
| `piiPolicies` | `readonly Class[]` | No | Additional `@PiiPolicy` classes applied to all agents and routers in this workflow. |
| `guardrails` | `readonly Class[]` | No | [`@InputGuardrail` and `@OutputGuardrail`](/reference/guardrail/) classes applied across all agents and model routers in this workflow. |
| `excludeGuardrails` | `readonly Class[]` | No | Inherited application guardrails exempted for this workflow. |
| `toolInterceptors` | `readonly Class[]` | No | [`@ToolInterceptor`](/reference/tool-interceptor/) classes applied across all `@Tool` and `@McpTool` invocations in this workflow. |
| `excludeToolInterceptors` | `readonly Class[]` | No | Inherited application `@ToolInterceptor` classes exempted for this workflow. |
| `compaction` | `Class` | No | [`@Compaction`](/reference/compaction/) class summarizing conversation turns older than `uncompactedTurns`. |
| `uncompactedTurns` | `number \| TurnLimit` | No | Number of recent finished turns shown in full to agents and model routers in this workflow (`5` by default, or `TurnLimit.ALL`). |
| `promptVariables` | `Readonly<Record<string, string>>` | No | Static `{{variable}}` substitutions available to every prompt in the workflow. |

## What HarnessDSL (HDSL) flow functions and related entities work with `@Workflow`?

| Builder / Entity | Import Path | Description |
| :--- | :--- | :--- |
| `start(StartClass)` | `"@agboss/core"` | Begins a root path from a `@WorkflowStart` class. |
| `agent(AgentClass)`, `router(RouterClass)`, `action(ActionClass)`, `workflow(ChildWorkflow)` | `"@agboss/core"` | Begins a shared continuation path from a node reached by multiple upstream paths. |
| `.returns(Dto, { about? })` | Flow chain | Declares one output DTO added to Path Scope; `{ about: TargetDto }` binds review verdicts to the artifact they judge. |
| `.toAgent(A)`, `.toAction(A)`, `.toRouter(R)`, `.toWorkflow(W, { placement? })`, `.toFinish(F)` | Flow chain | Transitions execution to the next node after verifying its `input` fields exist in Path Scope; `.toWorkflow` and `route(W, { placement? })` accept `placement: ChildPlacement.ParentInstance \| ChildPlacement.AnyInstance`. |
| `.chooseOne(route(Target, { placement? })...)` | Flow chain | Branches after `.toRouter(R)` to exactly one chosen route target. |
| `.switch(caseOf(Dto, { about? })...)` | Flow chain | Branches deterministically based on which union output variant (`oneOf(...)`) the preceding node produced. |
| `.toParallelAgents(...)`, `.toParallelWorkflows(W, { maxItems?, maxConcurrency?, placement? })` | Flow chain | Fans out across multiple agents, `{ agent, count }` copies, or `{ agent, each: ListDto }` items with `{ maxItems, maxConcurrency, placement: ChildPlacement.AnyInstance }`. |
| `.join()`, `.joinQuorum({ min, max?, deadline? })`, `.joinQuorumGroups(...)` | Flow chain | Joins all parallel branches or resolves early as soon as a quorum verified by `.acceptedBy(Arbiter)` is reached. |
| `.onError(ErrorClass, sidePath)`, `.onJoinError(ErrorClass, sidePath)` | Flow chain | Catches step or parallel-join failures (`StepFailedError`, `VisitsLimitExceededError`, `QuorumNotReachedError`) onto a typed recovery path. |
| `ThisWorkflow` | `"@agboss/core"` | Sentinel target passed to `.toWorkflow(ThisWorkflow)` or `.toParallelWorkflows(ThisWorkflow)` for bounded self-recursion. |
| `oneOf(A, B)`, `listOf(Dto)`, `optional(Dto)`, `historyOf(Dto, { limit })` | `"@agboss/core"` | Path Scope input/output shape wrappers used on component `input` and `output` declarations. |
