---
title: "@Arbiter & @Arbitrate"
description: Complete API reference for the @Arbiter and @Arbitrate decorators in AGBoss — quorum voting by code, by model or hybrid, and testUnit().
---

The `@Arbiter` class decorator and `@Arbitrate(…targets)` method decorator (`arbiters/*.arbiter.ts`) evaluate individual answers arriving from a parallel launch (`.inParallel([…])` or `.forEachItem(…)`) to decide whether each answer counts toward a `.joinQuorum()` or `.joinQuorumGroups()` consensus. Unlike a `@Router`, an `@Arbiter` never chooses where the graph goes next — it votes `true` (accept) or `false` (reject) as each parallel branch finishes so the quorum can resolve immediately and cancel slower branches.

## Complete `@Arbiter` and `@Arbitrate` examples (by code, by model, and by code that asks a model)

```ts title="src/arbiters/risk-quorum.arbiter.ts" file=src/arbiters/risk-quorum.arbiter.ts
import {
  Arbiter,
  ArbiterModel,
  Arbitrate,
  Decision,
  ExecutionContext,
  inline,
  type ArbitratedAnswerOf,
} from "@agboss/core";
import {
  BackupRiskAgent,
  DecisionsModelProvider,
  FastRiskAgent,
  PrimaryRiskAgent,
  RiskThresholdService,
} from "../agents/risk.agents.js";
import { RiskScoreDto } from "../dto/risk.dto.js";

// 1. Code arbiter (@Arbitrate(…targets) methods, no decidedBy; the method name is yours) + constructor DI:
@Arbiter({
  name: "confidence-threshold-arbiter",
  deps: [ExecutionContext, RiskThresholdService],
})
export class ConfidenceThresholdArbiter {
  constructor(
    private readonly executionContext: ExecutionContext,
    private readonly thresholds: RiskThresholdService,
  ) {}

  // one method judges the answers of one target; the parameter is Tracked as that target gave it
  @Arbitrate(PrimaryRiskAgent)
  isPrimaryConfident(answer: RiskScoreDto): boolean {
    void this.executionContext.executionId;
    return answer.confidence >= this.thresholds.primaryMinConfidence();
  }

  // or one method for several targets: the parameter is the union of their outputs
  @Arbitrate(FastRiskAgent, BackupRiskAgent)
  isConfident(answer: RiskScoreDto): boolean {
    return answer.confidence >= 0.8;
  }
}

// 2. Model arbiter (declarative: `criteria`, one per target, no methods):
@Arbiter({
  name: "rationale-quality-arbiter",
  model: "typesafe/jev-1.13",
  modelProvider: DecisionsModelProvider,
  prompt: inline("Accept the risk assessment only if its rationale cites specific financial metrics."),
  criteria: [
    { target: PrimaryRiskAgent, prompt: "The rationale cites debt-to-income and cash-flow figures from the input" },
    { target: FastRiskAgent, prompt: "The rationale names at least one concrete risk factor and a numeric score" },
    { target: BackupRiskAgent, prompt: "The rationale is complete and non-contradictory" },
  ],
})
export class RationaleQualityArbiter {}

// 3. Hybrid: code decides at $0 where it can and asks its own model (ArbiterModel) only where it must:
@Arbiter({
  name: "hybrid-risk-arbiter",
  model: "typesafe/jev-1.13",
  modelProvider: DecisionsModelProvider,
  deps: [ArbiterModel],
})
export class HybridRiskArbiter {
  constructor(private readonly arbiterModel: ArbiterModel) {}

  @Arbitrate(PrimaryRiskAgent, FastRiskAgent, BackupRiskAgent)
  async isSound(
    answer: ArbitratedAnswerOf<[typeof PrimaryRiskAgent, typeof FastRiskAgent, typeof BackupRiskAgent]>,
  ): Promise<boolean> {
    if (answer.confidence >= 0.95) return true; // no model call
    const verdict = await this.arbiterModel.decide({
      state: { rationale: answer.rationale },
      questions: { cited: Decision.boolean("The rationale cites a concrete metric") },
    });
    return verdict.cited.probability >= 0.5;
  }
}
```

```ts title="src/dto/risk.dto.ts" file=src/dto/risk.dto.ts
import { Float, Integer, Text } from "@agboss/core/dto";

export class RiskScoreDto {
  @Integer({ min: 0, max: 100 })
  score!: number;

  @Float({ min: 0, max: 1 })
  confidence!: number;

  @Text()
  rationale!: string;
}
```

```ts title="src/agents/risk.agents.ts" file=src/agents/risk.agents.ts
import { Agent, Injectable, inline, secret } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
import { DecisionsDriver, ModelCost, ModelProvider, OpenRouterDriver } from "@agboss/core/models";
import { minutes, seconds } from "@agboss/core/units";
import { RiskScoreDto } from "../dto/risk.dto.js";

@ModelProvider({
  name: "risk-model-provider",
  description: "OpenRouter chat models",
  driver: OpenRouterDriver({ apiKey: secret("OPENROUTER_API_KEY") }),
  timeout: minutes(2),
  cost: ModelCost.fromResponse(),
})
export class RiskModelProvider {}

@ModelProvider({
  name: "risk-decisions-model-provider",
  description: "Decision models on OpenRouter's Decisions API",
  driver: DecisionsDriver({ baseUrl: "https://openrouter.ai/api/v1", apiKey: secret("OPENROUTER_API_KEY") }),
  timeout: seconds(30),
  cost: ModelCost.fromResponse(),
})
export class DecisionsModelProvider {}

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
  prompt: inline("Score credit risk from 0 to 100."),
  input: { req: WorkflowStartTextDto },
  output: RiskScoreDto,
})
export class PrimaryRiskAgent {}

@Agent({
  name: "fast-risk-agent",
  description: "Fast heuristic credit risk evaluation",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Score credit risk quickly from 0 to 100."),
  input: { req: WorkflowStartTextDto },
  output: RiskScoreDto,
})
export class FastRiskAgent {}

@Agent({
  name: "backup-risk-agent",
  description: "Backup credit risk evaluation",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Provide backup credit risk score from 0 to 100."),
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
  listOf,
  onAction,
  onStart,
  toAction,
  toAgent,
  toFinish,
  type ActionHandler,
  type InputOf,
  Ttl,
} from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
import { seconds } from "@agboss/core/units";
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
  execute(input: InputOf<MergeRiskScoresAction>): RiskScoreDto {
    return input.scores[0]!;
  }
}

@Action({
  name: "fallback-risk-action",
  description: "Returns conservative fallback score when quorum fails",
  input: { req: WorkflowStartTextDto },
  output: RiskScoreDto,
})
export class FallbackRiskAction implements ActionHandler<FallbackRiskAction> {
  execute(_input: InputOf<FallbackRiskAction>): RiskScoreDto {
    return { score: 50, confidence: 0.5, rationale: "Fallback assessment" };
  }
}

@Workflow({
  name: "risk-quorum-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  providers: [RiskThresholdService],
  flow: [
    onStart(RiskStart)
      .inParallel([toAgent(PrimaryRiskAgent), toAgent(FastRiskAgent), toAgent(BackupRiskAgent)])
      .arbitratedBy(ConfidenceThresholdArbiter) // one arbiter class, once per launch
      .joinQuorumGroups({ deadline: seconds(6) })
      .onError(
        QuorumNotReachedError,
        toAction(FallbackRiskAction)
          .toFinish(RiskFinish),
      )
      .onGroup(
        [PrimaryRiskAgent, FastRiskAgent],
        { priority: 1 },
        toAction(MergeRiskScoresAction),
      )
      .onGroup(
        [PrimaryRiskAgent, BackupRiskAgent],
        { priority: 2 },
        toAction(MergeRiskScoresAction),
      ),

    onAction(MergeRiskScoresAction)
      .toFinish(RiskFinish),
  ],
})
export class RiskQuorumWorkflow {}
```

<!--
```ts file=src/risk.application.ts
import { Application, Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, type BudgetHandler } from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";
import { DecisionsModelProvider, RiskModelProvider } from "./agents/risk.agents.js";
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
  modelProvider: RiskModelProvider,
  providers: [RiskModelProvider, DecisionsModelProvider],
  budgets: [RqAppBudget, RqTenantBudget, RqExecBudget],
})
export class RiskQuorumApplication {}
```
-->

```ts title="test/risk-quorum.arbiter.test.ts" file=test/risk-quorum.arbiter.test.ts
import { expect, it } from "vitest";
import { testUnit } from "@agboss/core/testing";
import { ConfidenceThresholdArbiter } from "../src/arbiters/risk-quorum.arbiter.js";
import { FastRiskAgent } from "../src/agents/risk.agents.js";

it("unit-tests @Arbitrate handlers on ConfidenceThresholdArbiter", async () => {
  const runArbiter = testUnit(ConfidenceThresholdArbiter);

  const { output } = await runArbiter(FastRiskAgent, {
    score: 72,
    confidence: 0.91,
    rationale: "Healthy cash reserve",
  });
  expect(output).toBe(true);
});
```

## What options do `@Arbiter` and `@Arbitrate` accept?

An `@Arbiter` takes no `decidedBy`: `criteria` makes a model arbiter, `@Arbitrate` methods make a code arbiter, `@Arbiter()` alone is allowed. `name` and `description` are optional (the class name in kebab-case by default; `[name.kind-suffix]` is not raised for it).

| Option / Decorator | Applies To | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | All | `string` | No | Kebab-case identifier (default: the class name, `ScoreRangeArbiter` becomes `score-range-arbiter`). |
| `description` | All | `string` | No | Describes the rule for traces and `agboss describe`. |
| `deps` | Code | `readonly Token[]` | No | Constructor dependencies (`ExecutionContext`, `@Injectable` services). Listing `ArbiterModel` makes the arbiter hybrid: it decides at `$0` where it can and calls `arbiterModel.decide(…)` / `.invoke(…)` where it must; each call is checked against the execution's budgets and charged under `arbiter:<name>`. |
| `@Arbitrate(…targets)` | Code | `MethodDecorator` | Yes | Decorates a method (`(answer) => boolean \| Promise<boolean>`, its name is yours) that judges the answers of one or more launched targets; the parameter is the union of their outputs, `Tracked` as that target gave it (`ArbitratedAnswerOf<[typeof A, typeof B]>` names the union, `Metadata.createdBy(answer)` tells the targets apart). Every target of the launch must be covered once: `[arbiter.unhandled-target]`, `[arbiter.unknown-target]`, `[arbiter.duplicate-target]`. |
| `model` / `modelProvider` | Model, hybrid | `string` / `Class` | No | Decision model (`"typesafe/jev-1.13"`) or chat model, and the provider that serves it (the cascade: the arbiter's, its workflow's, its application's). |
| `prompt` | Model | `PromptSource` | Yes | General instructions explaining how the model arbiter evaluates answers. |
| `criteria` | Model | `readonly [ArbiterCriterion, ...]` | Yes | Array of `{ target: Class, prompt: string }` entries covering every target of the launch. |

## What related entities work with `@Arbiter`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `.arbitratedBy(Arbiter)` | `"@agboss/core"` | Names the one arbiter class that decides which answers of a launch count, right after `.inParallel([…])` or `.forEachItem(…)`, once per launch. It is followed by a quorum join, never `.join()`. There is no `anyOf`, no AND of several arbiters and no predicate tree: how a rule escalates from code to a model lives in the class. `.acceptedBy(…)` is gone. |
| `.joinQuorum({ min, max?, deadline? })` | Flow chain | Collects accepted answers as soon as `max` (default `min`) answers pass the arbiter, cancelling remaining branches (`BranchVerdict.Surplus`). Also follows `.forEachItem(…)`. |
| `.joinQuorumGroups({ deadline })` + `.onGroup([targets], { priority }, subPath)` | Flow chain | Enforces prioritized group quorum rules: the first complete group, by priority, continues its own path. Refused after `.forEachItem(…)`. |
| `ArbiterModel` | `"@agboss/core"` | Injectable model of a hybrid arbiter. |
| `QuorumNotReachedError` | `"@agboss/core"` | Thrown when fewer than `min` answers are accepted or the `deadline` expires; catchable via `.onError(QuorumNotReachedError, sidePath)` right after the join. |
| `testUnit(ArbiterClass, options?)` | `"@agboss/core/testing"` | Isolated unit runner that tests an arbiter's verdict for any target and answer payload; `testUnit(HybridArbiter, { model })` scripts its model. |
