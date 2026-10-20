---
title: Parallel, Quorums & Child Workflows
description: Fan out parallel agents and child workflows, evaluate quorum consensus with @Arbiter and group(), and run bounded recursive workflows with ThisWorkflow.
---

AGBoss provides first-class Flow DSL primitives for deterministic fan-out/fan-in (`.toParallelAgents()`, `.toParallelWorkflows()`), deadline-bounded quorum consensus (`.joinQuorum()`, `.joinQuorumGroups()`, `@Arbiter`), modular child workflows (`.toWorkflow(Child)`), and depth-bounded recursion (`ThisWorkflow`).

## How parallel fan-out, `.join()`, and `quorum` consensus work

When a step fans out across multiple specialists or a dynamic list of items (`maxItems`, `maxConcurrency`), every branch receives an isolated copy of the Path Scope. You then merge results either by waiting for all branches (`.join()`) or by racing branches until a quorum condition and `@Arbiter` accept the result (`.joinQuorum()` / `.joinQuorumGroups()`):

```ts title="src/workflows/parallel-review.workflow.ts" no-check: reference example
import { StepFailedError, Workflow, anyOf, group, start } from "agboss";
import { seconds } from "agboss/units";
import { SecurityArbiter, ComplianceArbiter, FallbackArbiter } from "../arbiters/review.arbiters.js";
import { SecurityAgent, LegalAgent, FastLegalAgent, FallbackAuditAction } from "../agents/review.agents.js";
import { ProposalDto, ApprovedProposalDto } from "../dto/proposal.dto.js";

@Workflow({
  name: "parallel-review-workflow",
  version: "1.0.0",
  flow: [
    start(ProposalStart)
      .returns(ProposalDto)
      .toParallelAgents(
        group("security", SecurityAgent),
        group("legal", LegalAgent, FastLegalAgent),
      )
      .joinQuorumGroups({
        deadline: seconds(10),
        arbiter: SecurityArbiter,
      })
      .acceptedBy("security")
      .acceptedBy("legal", anyOf(ComplianceArbiter, FallbackArbiter))
      .onJoinError(StepFailedError, (err) =>
        err
          .toAction(FallbackAuditAction)
          .toFinish(ProposalRejectedFinish),
      )
      .returns(ApprovedProposalDto)
      .toFinish(ProposalApprovedFinish),
  ],
})
export class ParallelReviewWorkflow {}
```

```ts title="src/workflows/recursive-research.workflow.ts" no-check: reference example
import { ThisWorkflow, Workflow, caseOf, listOf, start, workflow } from "agboss";
import { TopicDto, ResolvedDto, SubTopicsDto, VerifiedSummaryDto } from "../dto/research.dto.js";
import { DecomposeTopicAgent, MergeFindingsAction } from "../agents/research.agents.js";
import { FactCheckChildWorkflow } from "./fact-check.workflow.js";

@Workflow({
  name: "recursive-research-workflow",
  version: "1.0.0",
  flow: [
    start(ResearchStart)
      .returns(TopicDto)
      .toAgent(DecomposeTopicAgent)
      .switch(
        caseOf(ResolvedDto)
          .toWorkflow(FactCheckChildWorkflow),
        caseOf(SubTopicsDto)
          .toParallelWorkflows(ThisWorkflow, {
            maxItems: 5,
            maxConcurrency: 2,
          })
          .join()
          .returns(listOf(VerifiedSummaryDto))
          .toAction(MergeFindingsAction)
          .toFinish(ResearchFinish),
      ),

    workflow(FactCheckChildWorkflow)
      .returns(VerifiedSummaryDto)
      .toFinish(ResearchFinish),
  ],
  maxDepth: 3,
  maxConcurrentExecutions: 6,
})
export class RecursiveResearchWorkflow {}
```

```ts title="test/parallel-review.workflow.test.ts" no-check: reference example
import { expect } from "vitest";
import { TestConcurrency, replyWith, testWith } from "agboss/testing";
import { ReviewApplication } from "../src/review.application.js";
import { SecurityAgent, LegalAgent, FastLegalAgent } from "../src/agents/review.agents.js";

const test = testWith(ReviewApplication, {
  concurrency: TestConcurrency.inOrder(FastLegalAgent, SecurityAgent, LegalAgent),
});

test("reaches quorum as soon as FastLegalAgent and SecurityAgent finish", async ({ app, mockLlm }) => {
  mockLlm(FastLegalAgent).thenReturn(replyWith(LegalVerdictDto, { passed: true }));
  mockLlm(SecurityAgent).thenReturn(replyWith(SecurityVerdictDto, { passed: true }));
  const res = await app.execute(ProposalStart, { title: "SOC2 Policy Update" });
  expect(res.isFinished()).toBe(true);
});
```

## Key safeguards for parallel and recursive execution

| Safeguard | Option / Error | How it protects production |
| :--- | :--- | :--- |
| **Fan-out truncation** | `maxItems` + `OnLaunchItemsTruncated` | Caps dynamic list fan-out and emits a typed observer event when excess items are truncated. |
| **Bounded concurrency** | `maxConcurrency` | Limits how many parallel branches execute simultaneously within a fan-out step. |
| **Quorum cancellation** | `deadline: seconds(10)` | Automatically aborts slower losing branches via `AbortSignal` the instant quorum is decided. |
| **Recursion ceiling** | `maxDepth` & `maxConcurrentExecutions` | Required on every `ThisWorkflow` graph; throws `MaxDepthExceededError` if recursion exceeds `maxDepth`. |
