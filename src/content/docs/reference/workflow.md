---
title: "@Workflow"
description: Complete API reference for @Workflow in AGBoss — options, Path Scope Flow DSL methods, parallel waves, quorums, child workflows, and review loops.
---

The `@Workflow` decorator defines a typed state graph (`*.workflow.ts`) in AGBoss. Every workflow declares its `name`, `version`, and `flow` array of paths built with `start()`, `agent()`, `router()`, `action()`, `workflow()`, `route()`, and `caseOf()`, enforcing strictly one chained method call per line (`@stylistic/newline-per-chained-call`) and compile-time Path Scope verification.

## What options does `@Workflow` accept?

Every `@Workflow` class name ends with `Workflow` and its `name` option ends with `-workflow`:

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier ending with `-workflow` (e.g., `"offer-workflow"`). |
| `version` | `string` | Yes | Behavior version of the workflow (`"1.0.0"`), checked when resuming paused executions across deploys. |
| `flow` | `readonly FlowPath[]` | Yes | List of paths starting with `start()`, `agent()`, `router()`, `action()`, or `workflow()`. |
| `maxSteps` | `number` | No | Maximum agent and router visits per execution; defaults to `(agents + routers) * 3`. |
| `maxDepth` | `number` | No | Maximum nesting depth for child workflows and `ThisWorkflow` recursive calls (`RecursionDepthExceededError`). |
| `maxConcurrentExecutions` | `number` | No | Maximum concurrent executions across the root workflow and all child/recursive subtrees (`10` by default). |
| `defaults` | `WorkflowDefaults` | No | Workflow-level defaults for `models`, `router`, `guardrail`, `tools`, `history`, and `flow.maxPathDepth`. |
| `providers` | `readonly Provider[]` | No | Workflow-scoped `@Injectable` services, `@A2AAgent` clients, or `provide(TOKEN, value)` bindings. |
| `mcp` | `readonly Class[]` | No | `@McpServer` classes whose tools are used by agents in this workflow. |
| `piiPolicies` | `readonly Class[]` | No | Additional `@PiiPolicy` classes applied to all agents and routers in this workflow. |
| `guardrails` | `readonly Class<Guardrail>[]` | No | `@Guardrail` classes applied across all agents and tools in this workflow. |
| `compaction` | `CompactionOptions` | No | Conversation history compaction policy (`{ every, keep, model }`). |
| `compactionPrompt` | `string` | No | Custom summarization prompt used when compacting conversation turns. |
| `promptVariables` | `Readonly<Record<string, string>>` | No | Static `{{variable}}` substitutions available to every prompt in the workflow. |

## Complete `@Workflow` example with all capabilities

```ts title="src/workflows/offer-negotiation.workflow.ts" no-check: reference example
import { StepFailedError, ThisWorkflow, VisitsLimitExceededError, Workflow, action, agent, anyOf, caseOf, route, router, start } from "agboss";
import { Reasoning } from "agboss/models";
import { seconds } from "agboss/units";
import { OfferWorkflowStart } from "./workflow-starts/offer.workflow-start.js";
import { OfferWorkflowFinish, OfferFailedWorkflowFinish } from "./workflow-finishes/offer.workflow-finish.js";
import { TriageRouter } from "./routers/triage.router.js";
import { DrafterAgent, EditorAgent, ReviewerAgent, SecurityAuditAgent, LegalAuditAgent } from "./agents/offer.agents.js";
import { ComplianceCheckWorkflow } from "./workflows/compliance-check.workflow.js";
import { SendOfferAction, NotifyRecruiterAction } from "./actions/offer.actions.js";
import { AuditArbiter } from "./arbiters/audit.arbiter.js";
import { CandidateInputDto, OfferDraftDto, DraftApprovedDto, ChangesRequestedDto, AuditVerdictDto, ComplianceReportDto } from "./dto/offer.dto.js";
import { DirectoryMcpServer } from "./mcp/directory.server.js";
import { OfferPiiPolicy } from "./policies/offer.pii-policy.js";
import { AuditTrailGuardrail } from "./guardrails/audit-trail.guardrail.js";
import { OfferFormattingService } from "./services/offer-formatting.service.js";

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
  promptVariables: {
    companyName: "Acme Corp",
  },
  defaults: {
    models: {
      temperature: 0.2,
      reasoning: Reasoning.on({ effort: "low" }),
    },
    router: {
      model: "typesafe/jev-1.13",
    },
    tools: {
      maxToolCalls: 6,
    },
    history: {
      limit: 10,
      summaries: 2,
    },
  },
  compaction: {
    every: 6,
    keep: 4,
    model: {
      model: "moonshotai/kimi-k2.6",
      temperature: 0,
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
        toAction(NotifyRecruiterAction)
          .toFinish(OfferFailedWorkflowFinish),
      )
      .returns(DraftApprovedDto, { about: OfferDraftDto })
      .returns(ChangesRequestedDto, { about: OfferDraftDto })
      .switch(
        caseOf(DraftApprovedDto, { about: OfferDraftDto })
          .toWorkflow(ComplianceCheckWorkflow)
          .returns(ComplianceReportDto)
          .toParallelAgents(SecurityAuditAgent, LegalAuditAgent)
          .returns(AuditVerdictDto)
          .acceptedBy(AuditArbiter)
          .joinQuorum({ min: 2, deadline: seconds(15) })
          .onJoinError(
            StepFailedError,
            toAction(NotifyRecruiterAction)
              .toFinish(OfferFailedWorkflowFinish),
          )
          .toAction(SendOfferAction)
          .toFinish(OfferWorkflowFinish),
        caseOf(ChangesRequestedDto, { about: OfferDraftDto })
          .toAgent(EditorAgent)
          .returns(OfferDraftDto)
          .toAgent(ReviewerAgent),
      ),
  ],
})
export class OfferWorkflow {}
```

```ts title="src/dto/offer-negotiation.dto.ts" no-check: reference example
import { Integer, Text } from "agboss/dto";

export class CandidateBriefDto {
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
```

```ts title="test/offer-negotiation.workflow.test.ts" no-check: reference example
import { expect } from "vitest";
import { replyWith, testWith } from "agboss/testing";
import { OfferApplication } from "../src/offer.application.js";
import { OfferWriterAgent, OfferReviewerAgent } from "../src/agents/offer.agents.js";
import { OfferDraftDto, DraftApprovedDto } from "../src/dto/offer-negotiation.dto.js";

const test = testWith(OfferApplication);

test("runs OfferNegotiationWorkflow through review loop to approval", async ({ app, mockLlm }) => {
  mockLlm(OfferWriterAgent).thenReturn(
    replyWith(OfferDraftDto, { summary: "Staff TS Engineer", baseUsd: 215_000 }),
  );
  mockLlm(OfferReviewerAgent).thenReturn(
    replyWith(DraftApprovedDto, { signedBy: "comp-committee" }),
  );
  const res = await app.execute(OfferWorkflowStart, { role: "Staff TS", region: "EU" });
  expect(res.isFinished()).toBe(true);
});
```

## What Flow DSL functions and related entities work with `@Workflow`?

| Builder / Entity | Import Path | Description |
| :--- | :--- | :--- |
| `start(StartClass)` | `"agboss"` | Begins a root path from a `@WorkflowStart` class. |
| `agent(AgentClass)`, `router(RouterClass)`, `action(ActionClass)`, `workflow(ChildWorkflow)` | `"agboss"` | Begins a shared continuation path from a node reached by multiple upstream paths. |
| `.returns(Dto, { about? })` | Flow chain | Declares one output DTO added to Path Scope; `{ about: TargetDto }` binds review verdicts to the artifact they judge. |
| `.toAgent(A)`, `.toAction(A)`, `.toRouter(R)`, `.toWorkflow(W)`, `.toFinish(F)` | Flow chain | Transitions execution to the next node after verifying its `input` fields exist in Path Scope. |
| `.chooseOne(route(Target)...)` | Flow chain | Branches after `.toRouter(R)` to exactly one chosen route target. |
| `.switch(caseOf(Dto, { about? })...)` | Flow chain | Branches deterministically based on which union output variant (`oneOf(...)`) the preceding node produced. |
| `.toParallelAgents(...)`, `.toParallelWorkflows(...)` | Flow chain | Fans out across multiple agents, ` { agent, count } ` copies, or ` { agent, each: ListDto } ` items with `{ maxItems, maxConcurrency }`. |
| `.join()`, `.joinQuorum({ min, max?, deadline? })`, `.joinQuorumGroups(...)` | Flow chain | Joins all parallel branches or resolves early as soon as a quorum verified by `.acceptedBy(Arbiter)` is reached. |
| `.onError(ErrorClass, sidePath)`, `.onJoinError(ErrorClass, sidePath)` | Flow chain | Catches step or parallel-join failures (`StepFailedError`, `VisitsLimitExceededError`, `QuorumNotReachedError`) onto a typed recovery path. |
| `ThisWorkflow` | `"agboss"` | Sentinel target passed to `.toWorkflow(ThisWorkflow)` or `.toParallelWorkflows(ThisWorkflow)` for bounded self-recursion. |
| `oneOf(A, B)`, `listOf(Dto)`, `optional(Dto)`, `historyOf(Dto, { limit })` | `"agboss"` | Path Scope input/output shape wrappers used on component `input` and `output` declarations. |
