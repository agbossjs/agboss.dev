---
title: "@Arbiter & @OnAnswer"
description: Complete API reference for the @Arbiter and @OnAnswer decorators in AGBoss — quorum voting, DecidedBy.Code vs DecidedBy.Model, and testArbiter().
---

The `@Arbiter` class decorator and `@OnAnswer(AgentClass)` method decorator (`arbiters/*.arbiter.ts`) evaluate individual answers arriving from a parallel agent launch (`.toParallelAgents(...)`) to decide whether each answer counts toward a `.joinQuorum()` or `.joinQuorumGroups()` consensus. Unlike a `@Router`, an `@Arbiter` never chooses where the graph goes next — it votes `true` (accept) or `false` (reject) as each parallel branch finishes so the quorum can resolve immediately and cancel slower branches.

## Complete `@Arbiter` and `@OnAnswer` examples (`DecidedBy.Code` and `DecidedBy.Model`)

```ts title="src/arbiters/risk-quorum.arbiter.ts" file=src/arbiters/risk-quorum.arbiter.ts
import { Arbiter, DecidedBy, ExecutionContext, OnAnswer } from "agboss";
import {
  BackupRiskAgent,
  FastRiskAgent,
  PrimaryRiskAgent,
  RiskThresholdService,
} from "../agents/risk.agents.js";
import { RiskScoreDto } from "../dto/risk.dto.js";

// 1. Code Arbiter (DecidedBy.Code — uses @OnAnswer(AgentClass) methods + constructor DI):
@Arbiter({
  name: "confidence-threshold-arbiter",
  decidedBy: DecidedBy.Code,
  deps: [ExecutionContext, RiskThresholdService],
})
export class ConfidenceThresholdArbiter {
  constructor(
    private readonly executionContext: ExecutionContext,
    private readonly thresholds: RiskThresholdService,
  ) {}

  @OnAnswer(PrimaryRiskAgent)
  fromPrimaryRisk(answer: RiskScoreDto): boolean {
    void this.executionContext.executionId;
    return answer.confidence >= this.thresholds.primaryMinConfidence();
  }

  @OnAnswer(FastRiskAgent)
  fromFastRisk(answer: RiskScoreDto): boolean {
    return answer.confidence >= 0.85 && answer.score >= 0;
  }

  @OnAnswer(BackupRiskAgent)
  fromBackupRisk(answer: RiskScoreDto): boolean {
    return answer.confidence >= 0.8;
  }
}

// 2. Model Arbiter (DecidedBy.Model — declarative per-agent criteria, no methods):
@Arbiter({
  name: "rationale-quality-arbiter",
  decidedBy: DecidedBy.Model,
  model: "typesafe/jev-1.13",
  prompt: "Accept the risk assessment only if its rationale cites specific financial metrics.",
  criteria: [
    {
      agent: PrimaryRiskAgent,
      prompt: "The rationale cites debt-to-income and cash-flow figures from the input",
    },
    {
      agent: FastRiskAgent,
      prompt: "The rationale names at least one concrete risk factor and a numeric score",
    },
    {
      agent: BackupRiskAgent,
      prompt: "The rationale is complete and non-contradictory",
    },
  ],
})
export class RationaleQualityArbiter {}
```

```ts title="src/dto/risk.dto.ts" file=src/dto/risk.dto.ts
import { Decimal, Integer, Text } from "agboss/dto";

export class RiskScoreDto {
  @Integer({ min: 0, max: 100 })
  score!: number;

  @Decimal({ min: 0, max: 1 })
  confidence!: number;

  @Text()
  rationale!: string;
}
```

```ts title="src/agents/risk.agents.ts" file=src/agents/risk.agents.ts
import { Agent, Injectable } from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";
import { RiskScoreDto } from "../dto/risk.dto.js";

@Injectable()
export class RiskThresholdService {
  primaryMinConfidence(): number {
    return 0.9;
  }
}

@Agent({
  name: "primary-risk-agent",
  description: "Deep credit risk evaluation",
  model: "moonshotai/kimi-k2.6",
  prompt: "Score credit risk from 0 to 100.",
  input: { req: WorkflowStartTextDto },
  output: RiskScoreDto,
})
export class PrimaryRiskAgent {}

@Agent({
  name: "fast-risk-agent",
  description: "Fast heuristic credit risk evaluation",
  model: "moonshotai/kimi-k2.6",
  prompt: "Score credit risk quickly from 0 to 100.",
  input: { req: WorkflowStartTextDto },
  output: RiskScoreDto,
})
export class FastRiskAgent {}

@Agent({
  name: "backup-risk-agent",
  description: "Backup credit risk evaluation",
  model: "moonshotai/kimi-k2.6",
  prompt: "Provide backup credit risk score from 0 to 100.",
  input: { req: WorkflowStartTextDto },
  output: RiskScoreDto,
})
export class BackupRiskAgent {}
```

```ts title="src/workflows/risk-quorum.workflow.ts" file=src/workflows/risk-quorum.workflow.ts
import {
  Action,
  QuorumNotReachedError,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  action,
  group,
  listOf,
  start,
  toAction,
  type ActionHandler,
  type InputOf,
} from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";
import { seconds } from "agboss/units";
import { ConfidenceThresholdArbiter } from "../arbiters/risk-quorum.arbiter.js";
import {
  BackupRiskAgent,
  FastRiskAgent,
  PrimaryRiskAgent,
  RiskThresholdService,
} from "../agents/risk.agents.js";
import { RiskScoreDto } from "../dto/risk.dto.js";

@WorkflowStart({ name: "risk-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class RiskStart {}

@WorkflowFinish({ name: "risk-workflow-finish", description: "Finish", output: RiskScoreDto })
export class RiskFinish {}

@Action({
  name: "merge-risk-scores-action",
  description: "Combines quorum risk scores",
  input: { scores: listOf(RiskScoreDto) },
  output: RiskScoreDto,
})
export class MergeRiskScoresAction implements ActionHandler<MergeRiskScoresAction> {
  execute(input: InputOf<MergeRiskScoresAction>): Promise<RiskScoreDto> {
    return Promise.resolve(input.scores[0]!.value);
  }
}

@Action({
  name: "fallback-risk-action",
  description: "Returns conservative fallback score when quorum fails",
  input: { req: WorkflowStartTextDto },
  output: RiskScoreDto,
})
export class FallbackRiskAction implements ActionHandler<FallbackRiskAction> {
  execute(_input: InputOf<FallbackRiskAction>): Promise<RiskScoreDto> {
    return Promise.resolve({ score: 50, confidence: 0.5, rationale: "Fallback assessment" });
  }
}

@Workflow({
  name: "risk-quorum-workflow",
  version: "1.0.0",
  providers: [RiskThresholdService],
  flow: [
    start(RiskStart)
      .returns(WorkflowStartTextDto)
      .toParallelAgents(PrimaryRiskAgent, FastRiskAgent, BackupRiskAgent)
      .acceptedBy(ConfidenceThresholdArbiter)
      .joinQuorumGroups(
        group(PrimaryRiskAgent, FastRiskAgent)
          .priority(1)
          .returns(listOf(RiskScoreDto))
          .toAction(MergeRiskScoresAction),
        group(PrimaryRiskAgent, BackupRiskAgent)
          .priority(2)
          .returns(listOf(RiskScoreDto))
          .toAction(MergeRiskScoresAction),
        { deadline: seconds(6) },
      )
      .onJoinError(
        QuorumNotReachedError,
        toAction(FallbackRiskAction)
          .returns(RiskScoreDto)
          .toFinish(RiskFinish),
      ),

    action(MergeRiskScoresAction)
      .returns(RiskScoreDto)
      .toFinish(RiskFinish),
  ],
})
export class RiskQuorumWorkflow {}
```

<!--
```ts file=src/risk.application.ts
import { Application, Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, type BudgetHandler } from "agboss";
import { usd, type Usd } from "agboss/units";
import { RiskQuorumWorkflow } from "./workflows/risk-quorum.workflow.js";

@Budget({ name: "rq-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class RqAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(20); } }
@Budget({ name: "rq-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class RqTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "rq-exec-budget", scope: BudgetScope.Execution })
export class RqExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "risk-quorum-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [RiskQuorumWorkflow],
  budgets: [RqAppBudget, RqTenantBudget, RqExecBudget],
})
export class RiskQuorumApplication {}
```
-->

```ts title="test/risk-quorum.arbiter.test.ts" file=test/risk-quorum.arbiter.test.ts
import { expect, it } from "vitest";
import { testArbiter } from "agboss/testing";
import { ConfidenceThresholdArbiter } from "../src/arbiters/risk-quorum.arbiter.js";
import { FastRiskAgent } from "../src/agents/risk.agents.js";

it("unit-tests @OnAnswer handlers on ConfidenceThresholdArbiter", async () => {
  const runArbiter = testArbiter(ConfidenceThresholdArbiter);

  const { output } = await runArbiter(FastRiskAgent, {
    score: 72,
    confidence: 0.91,
    rationale: "Healthy cash reserve",
  });
  expect(output).toBe(true);
});
```

## What options do `@Arbiter` and `@OnAnswer` accept?

Every `@Arbiter` class name ends with `Arbiter` and its `name` option ends with `-arbiter`:

| Option / Decorator | Applies To | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | Both | `string` | Yes | Unique kebab-case identifier ending with `-arbiter` (e.g., `"valid-score-arbiter"`). |
| `decidedBy` | Both | `DecidedBy.Code \| DecidedBy.Model` | Yes | Whether TypeScript `@OnAnswer` methods (`Code`) or a decision/chat model (`Model`) judges each arriving answer. |
| `deps` | `DecidedBy.Code` | `readonly Token[]` | No | Constructor dependencies (`ExecutionContext`, `@Injectable` services) for a code arbiter. |
| `@OnAnswer(AgentClass)` | `DecidedBy.Code` | `MethodDecorator` | Yes | Decorates one method per launched `@Agent` (`(answer: OutputDto) => boolean \| Promise<boolean>`); missing an agent fails compilation with `[arbiter.unhandled-agent]`. |
| `model` | `DecidedBy.Model` | `string` | Yes | Decision model (`"typesafe/jev-1.13"`) or chat model used to judge each arriving answer. |
| `prompt` | `DecidedBy.Model` | `string` | Yes | General instructions explaining how the model arbiter evaluates answers. |
| `criteria` | `DecidedBy.Model` | `readonly [ArbiterCriterion, ...]` | Yes | Array of `{ agent: AgentClass, prompt: string }` entries covering every agent in the parallel launch. |

## What related entities work with `@Arbiter`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `.acceptedBy(Arbiter)` & `.acceptedBy(anyOf(A, B))` | `"agboss"` | Chains arbiter gates after `.toParallelAgents(...)`; multiple `.acceptedBy()` calls form a logical `AND`, while `anyOf(A, B)` forms a logical `OR`. |
| `.joinQuorum({ min, max?, deadline? })` | Flow chain | Collects accepted answers as soon as `max` (default `min`) answers pass all arbiters, cancelling remaining branches (`BranchVerdict.Surplus`). |
| `.joinQuorumGroups(group(A, B).priority(1)..., { deadline? })` | `"agboss"` | Enforces prioritized group quorum rules where each `group(...)` declares its own `.returns(...)` and continuation path. |
| `QuorumNotReachedError` | `"agboss"` | Thrown when fewer than `min` answers are accepted or the `deadline` expires; catchable via `.onJoinError(QuorumNotReachedError, sidePath)`. |
| `testArbiter(ArbiterClass, options?)` | `"agboss/testing"` | Isolated unit runner that tests an arbiter's verdict for any agent and answer payload. |
