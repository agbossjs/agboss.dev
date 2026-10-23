---
title: Parallel, Quorums & Child Workflows
description: Fan out parallel agents and child workflows, evaluate quorum consensus with @Arbiter, joinQuorum(), and joinQuorumGroups(group().priority()), and run bounded recursive workflows with ThisWorkflow.
---

AGBoss provides first-class Flow DSL primitives for deterministic fan-out/fan-in (`.toParallelAgents()`, `.toParallelWorkflows()`), deadline-bounded quorum consensus (`.acceptedBy()`, `.joinQuorum()`, `.joinQuorumGroups(group(...).priority(1))`, [`@Arbiter`](/reference/arbiter/)), modular child workflows (`.toWorkflow(Child)`), and depth-bounded recursion (`ThisWorkflow`).

## How parallel fan-out, `.join()`, and quorum consensus work

When a step fans out across multiple specialists or a dynamic list of items (`maxItems`, `maxConcurrency`), every branch receives an isolated copy of the Path Scope. You then merge results in one of three ways:
- **Wait for all (`.join()`):** Waits for every branch to complete and binds all outputs via `.returns(...)`.
- **Count-based quorum (`.acceptedBy(Arbiter).joinQuorum({ min, max, deadline })`):** Evaluates each arriving branch output with one or more [`@Arbiter`](/reference/arbiter/) classes (`anyOf(A, B)` accepts if either passes; chaining `.acceptedBy(A).acceptedBy(B)` requires both). As soon as `max` (default `min`) accepted answers arrive, the join proceeds immediately and aborts slower in-flight branches (`BranchVerdict.Surplus`). Unless `min` equals the total number of launched agents, single-agent outputs after `.joinQuorum()` are typed as `optional(Dto)` in `.returns(...)`.
- **Priority group quorum (`.acceptedBy(Arbiter).joinQuorumGroups(group(...).priority(1)..., { deadline })`):** Defines prioritized combinations of agents (`priority(1)` is highest), where each `group(...)` declares its own `.returns(...)` and continuation path:

<!-- snippet-context
import {
  Action,
  Agent,
  Application,
  Arbiter,
  Budget,
  BudgetPeriod,
  BudgetScope,
  DecidedBy,
  EmptyEnvironment,
  OnAnswer,
  WorkflowFinish,
  WorkflowStart,
  type ActionHandler,
  type BudgetHandler,
  type InputOf,
  type OutputOf,
} from "agboss";
import { Flag, Integer, Text } from "agboss/dto";
import { usd, type Usd } from "agboss/units";

export class ProposalDto {
  @Text({ prompt: "proposal title" })
  title!: string;
}

export class SecurityVerdictDto {
  @Flag({ prompt: "passed security review" })
  passed!: boolean;
  @Integer({ prompt: "confidence 0-100" })
  confidence!: number;
}

export class LegalVerdictDto {
  @Flag({ prompt: "passed legal review" })
  passed!: boolean;
}

export class BackupVerdictDto {
  @Flag({ prompt: "passed backup audit" })
  passed!: boolean;
}

export class ApprovedProposalDto {
  @Text({ prompt: "approval summary" })
  summary!: string;
}

@WorkflowStart({ name: "proposal-workflow-start", description: "Proposal submission", input: ProposalDto })
export class ProposalStart {}

@WorkflowFinish({ name: "proposal-approved-workflow-finish", description: "Proposal approved", output: ApprovedProposalDto })
export class ProposalApprovedFinish {}

@WorkflowFinish({ name: "proposal-rejected-workflow-finish", description: "Proposal rejected", output: ProposalDto })
export class ProposalRejectedFinish {}

@Agent({
  name: "security-review-agent",
  description: "Evaluates security posture",
  model: "moonshotai/kimi-k2.6",
  prompt: "Review security posture.",
  input: { proposal: ProposalDto },
  output: SecurityVerdictDto,
})
export class SecurityAgent {}

@Agent({
  name: "legal-review-agent",
  description: "Evaluates legal compliance",
  model: "moonshotai/kimi-k2.6",
  prompt: "Review legal compliance.",
  input: { proposal: ProposalDto },
  output: LegalVerdictDto,
})
export class LegalAgent {}

@Agent({
  name: "backup-audit-agent",
  description: "Fast fallback compliance check",
  model: "moonshotai/kimi-k2.6",
  prompt: "Run fast compliance check.",
  input: { proposal: ProposalDto },
  output: BackupVerdictDto,
})
export class BackupAuditAgent {}

@Arbiter({ name: "review-quorum-arbiter", decidedBy: DecidedBy.Code })
export class ReviewQuorumArbiter {
  @OnAnswer(SecurityAgent)
  fromSecurity(v: SecurityVerdictDto): boolean {
    return v.passed && v.confidence >= 80;
  }

  @OnAnswer(LegalAgent)
  fromLegal(v: LegalVerdictDto): boolean {
    return v.passed;
  }

  @OnAnswer(BackupAuditAgent)
  fromBackupAudit(v: BackupVerdictDto): boolean {
    return v.passed;
  }
}

@Action({
  name: "merge-primary-verdicts-action",
  description: "Merges primary security and legal verdicts",
  input: { security: SecurityVerdictDto, legal: LegalVerdictDto },
  output: ApprovedProposalDto,
})
export class MergePrimaryVerdictsAction implements ActionHandler<MergePrimaryVerdictsAction> {
  execute(_input: InputOf<MergePrimaryVerdictsAction>): Promise<OutputOf<MergePrimaryVerdictsAction>> {
    return Promise.resolve({ summary: "Approved by primary security + legal group" });
  }
}

@Action({
  name: "merge-fallback-verdicts-action",
  description: "Merges security and backup audit verdicts",
  input: { security: SecurityVerdictDto, backup: BackupVerdictDto },
  output: ApprovedProposalDto,
})
export class MergeFallbackVerdictsAction implements ActionHandler<MergeFallbackVerdictsAction> {
  execute(_input: InputOf<MergeFallbackVerdictsAction>): Promise<OutputOf<MergeFallbackVerdictsAction>> {
    return Promise.resolve({ summary: "Approved by security + backup audit group" });
  }
}

@Action({
  name: "record-quorum-failure-action",
  description: "Records quorum failure",
  input: { proposal: ProposalDto },
})
export class RecordQuorumFailureAction implements ActionHandler<RecordQuorumFailureAction> {
  execute(_input: InputOf<RecordQuorumFailureAction>): Promise<void> {
    return Promise.resolve();
  }
}

// @snippet

@Budget({ name: "review-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class ReviewAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(50); } }
@Budget({ name: "review-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class ReviewTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "review-exec-budget", scope: BudgetScope.Execution })
export class ReviewExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "review-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [ParallelReviewWorkflow],
  budgets: [ReviewAppBudget, ReviewTenantBudget, ReviewExecBudget],
})
export class ReviewApplication {}
-->
```ts title="src/workflows/parallel-review.workflow.ts" file=src/parallel-review.workflow.ts
import { QuorumNotReachedError, Workflow, group, start, toAction } from "agboss";
import { seconds } from "agboss/units";

@Workflow({
  name: "parallel-review-workflow",
  version: "1.0.0",
  flow: [
    start(ProposalStart)
      .returns(ProposalDto)
      .toParallelAgents(SecurityAgent, LegalAgent, BackupAuditAgent)
      .acceptedBy(ReviewQuorumArbiter)
      .joinQuorumGroups(
        group(SecurityAgent, LegalAgent)
          .priority(1)
          .returns(SecurityVerdictDto)
          .returns(LegalVerdictDto)
          .toAction(MergePrimaryVerdictsAction)
          .returns(ApprovedProposalDto)
          .toFinish(ProposalApprovedFinish),
        group(SecurityAgent, BackupAuditAgent)
          .priority(2)
          .returns(SecurityVerdictDto)
          .returns(BackupVerdictDto)
          .toAction(MergeFallbackVerdictsAction)
          .returns(ApprovedProposalDto)
          .toFinish(ProposalApprovedFinish),
        { deadline: seconds(10) },
      )
      .onJoinError(
        QuorumNotReachedError,
        toAction(RecordQuorumFailureAction)
          .toFinish(ProposalRejectedFinish),
      ),
  ],
})
export class ParallelReviewWorkflow {}
```

```ts title="test/parallel-review.workflow.test.ts" file=test/parallel-review.workflow.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "agboss";
import { TestConcurrency, replyWith, step, testWith } from "agboss/testing";
import {
  ReviewApplication,
  ProposalStart,
  SecurityAgent,
  BackupAuditAgent,
  LegalAgent,
  SecurityVerdictDto,
  BackupVerdictDto,
} from "../src/parallel-review.workflow.js";

const test = testWith(ReviewApplication, {
  concurrency: TestConcurrency.inOrder([
    step(BackupAuditAgent),
    step(SecurityAgent),
    step(LegalAgent),
  ]),
});

test("reaches priority-2 quorum when SecurityAgent and BackupAuditAgent finish first", async ({ app, mockLlm }) => {
  mockLlm(BackupAuditAgent).thenReturn(replyWith(BackupVerdictDto, { passed: true }));
  mockLlm(SecurityAgent).thenReturn(replyWith(SecurityVerdictDto, { passed: true, confidence: 95 }));
  const res = await app.execute(ProposalStart, { title: "SOC2 Policy Update" });
  expect(res.status).toBe(ExecutionStatus.Finished);
});
```

## Recursive `ThisWorkflow` decomposition, soft stop at `maxDepth`, and KV cache prefixes

A workflow can invoke a modular child workflow (`.toWorkflow(ChildWorkflow)`) or recursively invoke itself (`ThisWorkflow`) either deterministically or as a model-driven tool call:

<!-- snippet-context
import { Action, Agent, WorkflowFinish, WorkflowStart, oneOf, type ActionHandler, type InputOf, type OutputOf } from "agboss";
import { ListOf, Text } from "agboss/dto";
export class TopicDto { @Text() topic!: string; }
export class SubTopicsDto { @ListOf(TopicDto) items!: TopicDto[]; }
export class ResolvedDto { @Text() draft!: string; }
export class VerifiedSummaryDto { @Text() summary!: string; }
@WorkflowStart({ name: "research-workflow-start", description: "Start", input: TopicDto })
export class ResearchStart {}
@WorkflowFinish({ name: "research-workflow-finish", description: "Finish", output: VerifiedSummaryDto })
export class ResearchFinish {}
@WorkflowStart({ name: "fact-check-workflow-start", description: "Child start", input: ResolvedDto })
export class FactCheckStart {}
@WorkflowFinish({ name: "fact-check-workflow-finish", description: "Child finish", output: VerifiedSummaryDto })
export class FactCheckFinish {}
@Agent({ name: "fact-checker-agent", description: "Checks facts", model: "moonshotai/kimi-k2.6", prompt: "Verify facts.", input: { resolved: ResolvedDto }, output: VerifiedSummaryDto })
export class FactCheckerAgent {}
@Workflow({
  name: "fact-check-child-workflow",
  version: "1.0.0",
  flow: [start(FactCheckStart).returns(ResolvedDto).toAgent(FactCheckerAgent).returns(VerifiedSummaryDto).toFinish(FactCheckFinish)],
})
export class FactCheckChildWorkflow {}
@Agent({
  name: "decompose-topic-agent",
  description: "Either resolves the topic or splits it into sub-topics",
  model: "moonshotai/kimi-k2.6",
  prompt: "Resolve or split into sub-topics.",
  input: { topic: TopicDto },
  output: oneOf(ResolvedDto, SubTopicsDto),
})
export class DecomposeTopicAgent {}
@Action({
  name: "extract-sub-topics-action",
  description: "Extracts sub-topic list for parallel fan-out",
  input: { subTopics: SubTopicsDto },
  output: listOf(TopicDto),
})
export class ExtractSubTopicsAction implements ActionHandler<ExtractSubTopicsAction> {
  execute(input: InputOf<ExtractSubTopicsAction>): Promise<OutputOf<ExtractSubTopicsAction>> {
    return Promise.resolve(input.subTopics.value.items);
  }
}
@Action({
  name: "merge-findings-action",
  description: "Merges sub-topic summaries",
  input: { summaries: listOf(VerifiedSummaryDto) },
  output: VerifiedSummaryDto,
})
export class MergeFindingsAction implements ActionHandler<MergeFindingsAction> {
  execute(input: InputOf<MergeFindingsAction>): Promise<OutputOf<MergeFindingsAction>> {
    return Promise.resolve({ summary: input.summaries.map((s) => s.value.summary).join("\n") });
  }
}
// @snippet
-->
```ts title="src/workflows/recursive-research.workflow.ts" file=src/recursive-research.workflow.ts
import { ThisWorkflow, Workflow, caseOf, listOf, start } from "agboss";

@Workflow({
  name: "recursive-research-workflow",
  version: "1.0.0",
  flow: [
    start(ResearchStart)
      .returns(TopicDto)
      .toAgent(DecomposeTopicAgent)
      .returns(oneOf(ResolvedDto, SubTopicsDto))
      .switch(
        caseOf(ResolvedDto)
          .toWorkflow(FactCheckChildWorkflow)
          .returns(VerifiedSummaryDto)
          .toFinish(ResearchFinish),
        caseOf(SubTopicsDto)
          .toAction(ExtractSubTopicsAction)
          .returns(listOf(TopicDto))
          .toParallelWorkflows(ThisWorkflow, {
            maxItems: 5,
            maxConcurrency: 2,
          })
          .join()
          .returns(listOf(VerifiedSummaryDto))
          .toAction(MergeFindingsAction)
          .returns(VerifiedSummaryDto)
          .toFinish(ResearchFinish),
      ),
  ],
  maxDepth: 3,
  maxConcurrentExecutions: 6,
})
export class RecursiveResearchWorkflow {}
```

```ts title="test/recursive-research.workflow.test.ts" file=test/recursive-research.workflow.test.ts
import { expect, it } from "vitest";
import { testAction } from "agboss/testing";
import {
  DecomposeTopicAgent,
  ExtractSubTopicsAction,
  RecursiveResearchWorkflow,
} from "../src/recursive-research.workflow.js";

it("extracts sub-topic items for recursive ThisWorkflow fan-out", async () => {
  expect(RecursiveResearchWorkflow).toBeDefined();
  const runExtract = testAction(ExtractSubTopicsAction);
  const { output } = await runExtract({
    subTopics: {
      value: { items: [{ topic: "Raft" }, { topic: "Paxos" }] },
      producer: DecomposeTopicAgent,
    },
  });
  expect(output).toEqual([{ topic: "Raft" }, { topic: "Paxos" }]);
});
```

### How `maxDepth` enforces a soft stop (and warms at most two KV cache prefixes)

Every recursive workflow requires `maxDepth` on `@Workflow` (`[graph.missing-max-depth]`). How `maxDepth` behaves at runtime depends on whether `ThisWorkflow` is launched by the model or by deterministic code:
- **Model-chosen recursion (soft stop at `depth === maxDepth`):** When an `@Agent` or `DecidedBy.Model` `@Router` can launch `ThisWorkflow`, reaching `depth === maxDepth` **does not crash** the execution. Instead, AGBoss simply omits the `ThisWorkflow` tool from the model's tool definitions on that step, forcing the model to synthesize a base-case answer instead of recursing further. Because the tool list is identical across all `depth < maxDepth` calls and differs only at `depth === maxDepth`, the recursive agent warms at most **two KV prefix cache entries** across the entire recursion tree.
- **Deterministic recursion (`.toWorkflow(ThisWorkflow)`):** If a deterministic flow path unconditionally launches `ThisWorkflow` past `maxDepth`, the runtime throws `DepthLimitExceededError` (catchable via `.onError(DepthLimitExceededError, ...)`).

## Key safeguards for parallel and recursive execution

| Safeguard | Option / Error | How it protects production |
| :--- | :--- | :--- |
| **Fan-out truncation** | `maxItems` + `OnLaunchItemsTruncated` | Caps dynamic list fan-out and emits a typed observer event when excess items are truncated. |
| **Bounded branch concurrency** | `maxConcurrency` | Limits how many parallel branches execute simultaneously within a fan-out step. |
| **Tree-wide execution throttle** | `maxConcurrentExecutions` | Caps how many executions across the root and all child workflow trees run a step simultaneously (default `10`; waiting at a join or pause holds no slot). |
| **Quorum cancellation** | `deadline: seconds(10)` | Automatically aborts slower losing branches (`BranchVerdict.Surplus`) via `AbortSignal` the instant quorum is decided. |
| **Recursion ceiling** | `maxDepth` | Required on every `ThisWorkflow` graph (`[graph.missing-max-depth]`); omits the recursion tool at `depth === maxDepth` for model launches (soft stop) and throws `DepthLimitExceededError` if exceeded by deterministic launches. |
