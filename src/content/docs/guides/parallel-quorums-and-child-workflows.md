---
title: Parallel, Quorums & Child Workflows
description: "Fan out parallel agents and child workflows, evaluate quorum consensus with @Arbiter, and distribute child workflows across workers with ChildPlacement.AnyWorker."
---

AGBoss provides first-class **HarnessDSL (`HDSL`)** flow primitives for deterministic fan-out/fan-in (`.inParallel([…])`, `.forEachItem(…)`), deadline-bounded quorum consensus (`.arbitratedBy()`, `.joinQuorum()`, `.joinQuorumGroups({ deadline })` with `.onGroup([…], { priority }, subPath)`, [`@Arbiter`](/reference/arbiter/)), modular child workflows (`.toWorkflow(Child)`), and depth-bounded recursion (`toWorkflow(() => Self)`).

## How parallel fan-out, `.join()`, and quorum consensus work

When a step fans out across several branches of any kind — `.inParallel([toAgent(A), toAction(X), toExternalTask(Q), toWorkflow(W)])` — or across a dynamic list of items — `.forEachItem(toAgent(A), { takeFirst: 5, maxConcurrency: 2 })` — every branch sees the Path Scope as it stood at the launch, and its siblings' values only after the join. You then merge results in one of three ways:
- **Wait for all (`.join()`):** Waits for every branch to complete; the join gives one value per class the branches give (`listOf(XDto)` for copies, `optional(XDto)` for a branch a router chooses or a `skip()` drops). `.onError(E, …)` right after the join catches a failed branch, and `.onError(E, skip())` on a branch drops its failure from the join.
- **Count-based quorum (`.arbitratedBy(Arbiter).joinQuorum({ min, max, deadline })`):** Evaluates each arriving branch output with **one** [`@Arbiter`](/reference/arbiter/) class (how a rule escalates from code to a model lives in the class; `anyOf` and several `.arbitratedBy(…)` are gone). As soon as `max` (default `min`) accepted answers arrive, the join proceeds immediately and aborts slower in-flight branches (`BranchVerdict.Surplus`). Unless `min` equals the total number of launched agents, single-agent outputs after `.joinQuorum()` are typed as `optional(Dto)`.
- **Priority group quorum (`.arbitratedBy(Arbiter).joinQuorumGroups({ deadline })` + `.onGroup([…], { priority }, subPath)`):** Defines prioritized combinations of agents (`priority: 1` is highest), where each `.onGroup` continues the first complete group on its own path:

<!-- snippet-context
import {
  Action,
  Agent,
  Application,
  Arbiter,
  Budget,
  BudgetPeriod,
  BudgetScope,
  EmptyEnvironment,
  Arbitrate,
  WorkflowFinish,
  WorkflowStart,
  secret,
  type ActionHandler,
  type BudgetHandler,
  type InputOf,
  type OutputOf,
  inline,
} from "@agboss/core";
import { Bool, Integer, Text } from "@agboss/core/dto";
import { ModelCost, ModelProvider, OpenRouterDriver } from "@agboss/core/models";
import { minutes, usd, type Usd } from "@agboss/core/units";

@ModelProvider({
  name: "review-model-provider",
  description: "OpenRouter",
  driver: OpenRouterDriver({ apiKey: secret("OPENROUTER_API_KEY") }),
  timeout: minutes(2),
  cost: ModelCost.fromResponse(),
})
export class ReviewModelProvider {}

export class ProposalDto {
  @Text({ prompt: "proposal title" })
  title!: string;
}

export class SecurityVerdictDto {
  @Bool({ prompt: "passed security review" })
  passed!: boolean;
  @Integer({ prompt: "confidence 0-100" })
  confidence!: number;
}

export class LegalVerdictDto {
  @Bool({ prompt: "passed legal review" })
  passed!: boolean;
}

export class BackupVerdictDto {
  @Bool({ prompt: "passed backup audit" })
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
  prompt: inline("Review security posture."),
  input: { proposal: ProposalDto },
  output: SecurityVerdictDto,
})
export class SecurityAgent {}

@Agent({
  name: "legal-review-agent",
  description: "Evaluates legal compliance",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Review legal compliance."),
  input: { proposal: ProposalDto },
  output: LegalVerdictDto,
})
export class LegalAgent {}

@Agent({
  name: "backup-audit-agent",
  description: "Fast fallback compliance check",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Run fast compliance check."),
  input: { proposal: ProposalDto },
  output: BackupVerdictDto,
})
export class BackupAuditAgent {}

@Arbiter({ name: "review-quorum-arbiter" })
export class ReviewQuorumArbiter {
  @Arbitrate(SecurityAgent)
  fromSecurity(v: SecurityVerdictDto): boolean {
    return v.passed && v.confidence >= 80;
  }

  // one method for several targets: the parameter is the union of their outputs
  @Arbitrate(LegalAgent, BackupAuditAgent)
  fromReviewers(v: LegalVerdictDto | BackupVerdictDto): boolean {
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
  execute(_input: InputOf<MergePrimaryVerdictsAction>): OutputOf<MergePrimaryVerdictsAction> {
    return { summary: "Approved by primary security + legal group" };
  }
}

@Action({
  name: "merge-fallback-verdicts-action",
  description: "Merges security and backup audit verdicts",
  input: { security: SecurityVerdictDto, backup: BackupVerdictDto },
  output: ApprovedProposalDto,
})
export class MergeFallbackVerdictsAction implements ActionHandler<MergeFallbackVerdictsAction> {
  execute(_input: InputOf<MergeFallbackVerdictsAction>): OutputOf<MergeFallbackVerdictsAction> {
    return { summary: "Approved by security + backup audit group" };
  }
}

@Action({
  name: "record-quorum-failure-action",
  description: "Records quorum failure",
  input: { proposal: ProposalDto },
})
export class RecordQuorumFailureAction implements ActionHandler<RecordQuorumFailureAction> {
  execute(_input: InputOf<RecordQuorumFailureAction>): void {}
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
  modelProvider: ReviewModelProvider,
  providers: [ReviewModelProvider],
  budgets: [ReviewAppBudget, ReviewTenantBudget, ReviewExecBudget],
})
export class ReviewApplication {}
-->
```ts title="src/workflows/parallel-review.workflow.ts" file=src/parallel-review.workflow.ts
import { StepError, Workflow, onStart, toAction, toAgent, toFinish, Ttl } from "@agboss/core";
import { seconds } from "@agboss/core/units";

@Workflow({
  name: "parallel-review-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [
    onStart(ProposalStart)
      .inParallel([toAgent(SecurityAgent), toAgent(LegalAgent), toAgent(BackupAuditAgent)])
      .arbitratedBy(ReviewQuorumArbiter)
      .joinQuorumGroups({ deadline: seconds(10) })
      .onError(
        StepError.QuorumNotReached,
        toAction(RecordQuorumFailureAction)
          .toFinish(ProposalRejectedFinish),
      )
      .onGroup(
        [SecurityAgent, LegalAgent],
        { priority: 1 },
        toAction(MergePrimaryVerdictsAction)
          .toFinish(ProposalApprovedFinish),
      )
      .onGroup(
        [SecurityAgent, BackupAuditAgent],
        { priority: 2 },
        toAction(MergeFallbackVerdictsAction)
          .toFinish(ProposalApprovedFinish),
      ),
  ],
})
export class ParallelReviewWorkflow {}
```

```ts title="test/parallel-review.workflow.test.ts" file=test/parallel-review.workflow.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "@agboss/core";
import { TestConcurrency, replyWith, step, testWith } from "@agboss/core/testing";
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

test("reaches priority-2 quorum when SecurityAgent and BackupAuditAgent finish first", async ({ app, mockModel }) => {
  mockModel(BackupAuditAgent).thenReturn(replyWith(BackupVerdictDto, { passed: true }));
  mockModel(SecurityAgent).thenReturn(replyWith(SecurityVerdictDto, { passed: true, confidence: 95 }));
  const res = await app.execute(ProposalStart, { title: "SOC2 Policy Update" });
  expect(res.status).toBe(ExecutionStatus.Finished);
});
```

## Recursive decomposition (`toWorkflow(() => Self)`), soft stop at `maxDepth`, and KV cache prefixes

A workflow can invoke a modular child workflow (`.toWorkflow(ChildWorkflow)`) or recursively invoke itself with a thunk of its own class (`toWorkflow(() => Self)`; `ThisWorkflow` is gone) either deterministically or as a model-driven option:

<!-- snippet-context
import { Action, Agent, WorkflowFinish, WorkflowStart, listOf, oneOf, onStart, type ActionHandler, type InputOf, type OutputOf, inline, Ttl, Workflow } from "@agboss/core";
import { List, Text } from "@agboss/core/dto";
export class TopicDto { @Text() topic!: string; }
export class SubTopicsDto { @List(TopicDto) items!: TopicDto[]; }
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
@Agent({ name: "fact-checker-agent", description: "Checks facts", model: "moonshotai/kimi-k2.6", prompt: inline("Verify facts."), input: { resolved: ResolvedDto }, output: VerifiedSummaryDto })
export class FactCheckerAgent {}
@Workflow({
  name: "fact-check-child-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [onStart(FactCheckStart).toAgent(FactCheckerAgent).toFinish(FactCheckFinish)],
})
export class FactCheckChildWorkflow {}
@Agent({
  name: "decompose-topic-agent",
  description: "Either resolves the topic or splits it into sub-topics",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Resolve or split into sub-topics."),
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
  execute(input: InputOf<ExtractSubTopicsAction>): OutputOf<ExtractSubTopicsAction> {
    return input.subTopics.items;
  }
}
@Action({
  name: "merge-findings-action",
  description: "Merges sub-topic summaries",
  input: { summaries: listOf(VerifiedSummaryDto) },
  output: VerifiedSummaryDto,
})
export class MergeFindingsAction implements ActionHandler<MergeFindingsAction> {
  execute(input: InputOf<MergeFindingsAction>): OutputOf<MergeFindingsAction> {
    const summaries = input.summaries.map((s) => s.summary);
    return { summary: summaries.join("\n") };
  }
}
// @snippet
-->
```ts title="src/workflows/recursive-research.workflow.ts" file=src/recursive-research.workflow.ts
import { ChildPlacement, toAction, toFinish, toWorkflow } from "@agboss/core";

@Workflow({
  name: "recursive-research-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  placement: ChildPlacement.AnyWorker, // where this workflow runs as a child: on the child, never on the flow
  flow: [
    onStart(ResearchStart)
      .toAgent(DecomposeTopicAgent)
      .toOneOf([
        toWorkflow(FactCheckChildWorkflow) // the branch of the ResolvedDto variant
          .toFinish(ResearchFinish),
        toAction(ExtractSubTopicsAction) // the branch of the SubTopicsDto variant
          .forEachItem(toWorkflow(() => RecursiveResearchWorkflow), { takeFirst: 5, maxConcurrency: 2 })
          .join()
          .toAction(MergeFindingsAction)
          .toFinish(ResearchFinish),
      ]),
  ],
  executionLimits: { maxDepth: 3, maxConcurrency: 6 },
})
export class RecursiveResearchWorkflow {}
```

```ts title="test/recursive-research.workflow.test.ts" file=test/recursive-research.workflow.test.ts
import { expect, it } from "vitest";
import { testUnit } from "@agboss/core/testing";
import {
  ExtractSubTopicsAction,
  RecursiveResearchWorkflow,
} from "../src/recursive-research.workflow.js";

it("extracts sub-topic items for recursive fan-out", async () => {
  expect(RecursiveResearchWorkflow).toBeDefined();
  const runExtract = testUnit(ExtractSubTopicsAction);
  const { output } = await runExtract({
    subTopics: { items: [{ topic: "Raft" }, { topic: "Paxos" }] }, // a plain DTO literal, tracked by default
  });
  expect(output).toEqual([{ topic: "Raft" }, { topic: "Paxos" }]);
});
```

### How `maxDepth` enforces a soft stop (and warms at most two KV cache prefixes)

Every recursive workflow requires `executionLimits: { maxDepth }` on `@Workflow` (`[graph.recursion-without-depth]`, `[graph.recursion-without-exit]` and `[graph.mutual-recursion]` are the other rules). How `maxDepth` behaves at runtime depends on whether the recursion is launched by the model or by deterministic code:
- **Model-chosen recursion (soft stop at `depth === maxDepth`):** When an `@Agent` or a model `@Router` can launch the workflow itself, reaching `depth === maxDepth` **does not crash** the execution. Instead, AGBoss simply omits the recursive option from the model's tool definitions (or the router's targets) on that step, forcing the model to synthesize a base-case answer instead of recursing further. Because the tool list is identical across all `depth < maxDepth` calls and differs only at `depth === maxDepth`, the recursive agent warms at most **two KV prefix cache entries** across the entire recursion tree.
- **Deterministic recursion (`.toWorkflow(() => Self)`):** If a deterministic flow path unconditionally launches the workflow past `maxDepth`, the runtime throws `LimitError.Depth` (catchable via `.onError(LimitError.Depth, ...)`).

## Key safeguards for parallel and recursive execution

| Safeguard | Option / Error | How it protects production |
| :--- | :--- | :--- |
| **Fan-out truncation** | `takeFirst` + `onLaunchItemsTruncated` | Runs the first N items of a dynamic list and emits a typed observer event for the rest (recorded in `result.launches`); `maxItems` instead throws `LimitError.Items` before any branch starts, handled by `.onError(LimitError.Items, …)` after the join. |
| **Bounded branch concurrency** | `maxConcurrency` | Limits how many parallel branches execute simultaneously within a fan-out step. |
| **Tree-wide execution throttle** | `executionLimits.maxConcurrency` | Caps how many executions across the root and all child workflow trees run a step simultaneously (default `10`; enforced across instances via `RateLimitRepository` when `ChildPlacement.AnyWorker` is used). |
| **Distributed child placement** | `@Workflow({ placement: ChildPlacement.AnyWorker })` on the child, or `@Application({ defaults: { workflows: { placement } } })` | Enqueues the child (from `.toWorkflow()`, `.forEachItem(toWorkflow(W))` or an `.onRoute(toWorkflow(W))`) into the application's child queue, yielding the parent's lease while waiting and recovering each child independently under its own 30s lease. The placements are `CurrentProcess` (default), `AnyWorker`, `OtherWorker` (never claimed by the instance that queued it; `StepError.ChildWorkerUnavailable` after `executionLimits.childClaimTimeout`) and `IsolatedWorker` (a forked process of its own). It is never written on the flow. |
| **Quorum cancellation** | `deadline: seconds(10)` | Automatically aborts slower losing branches (`BranchVerdict.Surplus`) via `AbortSignal` the instant quorum is decided. |
| **Recursion ceiling** | `executionLimits.maxDepth` | Required on every self-recursive graph (`[graph.recursion-without-depth]`); omits the recursion tool at `depth === maxDepth` for model launches (soft stop) and throws `LimitError.Depth` if exceeded by deterministic launches. |

---

## Standalone Executable Proofs

- **[Showcase: Distributed Agent Recovery (`agbossjs/distributed-agent-recovery`)](/examples/distributed-agent-recovery/):** Multi-process distributed release pipeline ([GitHub](https://github.com/agbossjs/distributed-agent-recovery)) demonstrating `.forEachItem(toWorkflow(ModuleWorkerWorkflow), …)` with `ChildPlacement.AnyWorker` across independent OS worker processes, sibling fairness load balancing, same-task checkpoint takeover after 30s lease expiration, two-layer zombie worker lease fencing, and LIFO saga compensation.
- **[`05-cluster-work-stealing`](https://github.com/agbossjs/agboss-examples/tree/main/05-cluster-work-stealing):** Multi-instance cluster harness in [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples) proving `ChildPlacement.AnyWorker` over the shared child queue and bounded recursive workflows (`maxDepth: 2`) (see [7 Verified Examples](/examples/verified-examples/)).
