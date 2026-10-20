---
title: "@Arbiter & @OnAnswer"
description: Complete API reference for the @Arbiter and @OnAnswer decorators in AGBoss — quorum voting, DecidedBy.Code vs DecidedBy.Model, .acceptedBy(), and testArbiter().
---

The `@Arbiter` class decorator and `@OnAnswer(AgentClass)` method decorator (`arbiters/*.arbiter.ts`) evaluate individual answers arriving from a parallel agent launch (`.toParallelAgents(...)`) to decide whether each answer counts toward a `.joinQuorum()` or `.joinQuorumGroups()` consensus. Unlike a `@Router`, an `@Arbiter` never chooses where the graph goes next — it votes `true` (accept) or `false` (reject) as each parallel branch finishes so the quorum can resolve immediately and cancel slower branches.

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

## Complete `@Arbiter` and `@OnAnswer` examples (`DecidedBy.Code` and `DecidedBy.Model`)

```ts title="src/arbiters/risk-quorum.arbiter.ts" no-check: reference example
import { Arbiter, DecidedBy, ExecutionContext, OnAnswer, anyOf, group } from "agboss";
import { seconds } from "agboss/units";
import { PrimaryRiskAgent, FastRiskAgent, BackupRiskAgent } from "../agents/risk.agents.js";
import { RiskScoreDto } from "../dto/risk.dto.js";
import { RiskThresholdService } from "../services/risk-threshold.service.js";

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
  fromPrimary(answer: RiskScoreDto): boolean {
    return answer.confidence >= this.thresholds.primaryMinConfidence();
  }

  @OnAnswer(FastRiskAgent)
  fromFast(answer: RiskScoreDto): boolean {
    return answer.confidence >= 0.85 && answer.score >= 0;
  }

  @OnAnswer(BackupRiskAgent)
  fromBackup(answer: RiskScoreDto): boolean {
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

```ts title="src/dto/risk.dto.ts" no-check: reference example
import { Integer, Text } from "agboss/dto";

export class RiskScoreDto {
  @Integer({ minimum: 0, maximum: 100 })
  score!: number;

  @Text()
  rationale!: string;
}
```

```ts title="src/workflows/risk-quorum.workflow.ts" no-check: reference example
import { Workflow, anyOf, group, start } from "agboss";
import { seconds } from "agboss/units";
import { RiskQuorumArbiter } from "../arbiters/risk-quorum.arbiter.js";
import { RiskScoreDto } from "../dto/risk.dto.js";

@Workflow({
  name: "risk-quorum-workflow",
  version: "1.0.0",
  flow: [
    start(RiskStart)
      .toParallelAgents(
        group("primary", PrimaryRiskAgent),
        group("fast", FastRiskAgent, BackupRiskAgent),
      )
      .joinQuorumGroups({ deadline: seconds(6), arbiter: RiskQuorumArbiter })
      .acceptedBy("primary")
      .acceptedBy("fast")
      .returns(RiskScoreDto)
      .toFinish(RiskFinish),
  ],
})
export class RiskQuorumWorkflow {}
```

## What related entities work with `@Arbiter`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `.acceptedBy(Arbiter)` & `.acceptedBy(anyOf(A, B))` | `"agboss"` | Chains arbiter gates after `.toParallelAgents(...)`; multiple `.acceptedBy()` calls form a logical `AND`, while `anyOf(A, B)` forms a logical `OR`. |
| `.joinQuorum({ min, max?, deadline? })` | Flow chain | Collects accepted answers into a `listOf(Dto)` as soon as `min` answers pass all arbiters, cancelling remaining branches. |
| `.joinQuorumGroups(group(Name, { min, ... })...)` | `"agboss"` | Enforces multi-group quorum rules (e.g., 1 primary model + 1 of 2 secondary models). |
| `QuorumNotReachedError` | `"agboss"` | Thrown when fewer than `min` answers are accepted or the `deadline` expires; catchable via `.onJoinError(QuorumNotReachedError, sidePath)`. |
| `testArbiter(ArbiterClass, options?)` | `"agboss/testing"` | Isolated unit runner that tests an arbiter's verdict for any agent and answer payload. |

### Wiring `.acceptedBy()` with `.joinQuorum()` and testing with `testArbiter`

```ts title="test/risk-quorum.arbiter.test.ts" no-check: reference example
import { expect, it } from "vitest";
import { anyOf } from "agboss";
import { testArbiter } from "agboss/testing";
import { seconds } from "agboss/units";
import { ConfidenceThresholdArbiter, RationaleQualityArbiter } from "./risk.arbiters.js";
import { PrimaryRiskAgent, FastRiskAgent, BackupRiskAgent } from "../agents/risk.agents.js";

// In @Workflow({ flow }):
//   .toParallelAgents(PrimaryRiskAgent, FastRiskAgent, BackupRiskAgent)
//   .returns(RiskScoreDto)
//   .acceptedBy(ConfidenceThresholdArbiter)
//   .acceptedBy(anyOf(RationaleQualityArbiter))
//   .joinQuorum({ min: 2, deadline: seconds(10) })

it("unit-tests @OnAnswer handlers on ConfidenceThresholdArbiter", async () => {
  const runArbiter = testArbiter(ConfidenceThresholdArbiter);

  const accepted = await runArbiter(FastRiskAgent, {
    score: 72,
    confidence: 0.91,
    rationale: "Healthy cash reserve",
  });
  expect(accepted).toBe(true);
});
```

```ts title="src/agents/risk.agents.ts" no-check: reference example
import { Agent } from "agboss";
import { RiskScoreDto } from "../dto/risk.dto.js";

@Agent({
  name: "primary-risk-agent",
  description: "Deep credit risk evaluation",
  model: "moonshotai/kimi-k2.6",
  prompt: "Score credit risk from 0 to 100.",
  output: RiskScoreDto,
})
export class PrimaryRiskAgent {}
```
