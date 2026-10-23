---
title: Evals, Golden Sets, Judges & A/B Profiles
description: How AGBoss evaluates multi-agent quality using the 3-layer test split, @EvalSuite, pass@k and pass^k reliability metrics, @Judge calibration (Cohen's kappa), golden sets, and side-by-side YAML profile comparisons.
---

Changing an agent's prompt, model, or reasoning effort in production should be driven by measurable accuracy, `pass@k` / `pass^k` reliability, pairwise win rates, latency, and USD cost rather than guesswork. AGBoss provides a complete evaluation architecture: in-loop [`@Judge`](/reference/judge/) quality gates (`DecidedBy.Model` and `DecidedBy.Code`), declarative [`@EvalSuite`](/guides/evaluation-and-profiles/#principle-5-declarative-evalsuite-passk--passk-calibration--eval-ui) benchmark suites (`agboss/eval`), automatic **`Tern`** recording (`promptVersion`, `modelVersion`, and RFC 8785 `configHash`), YAML profile overlays (`profiles/<workflow>/<profile>.yaml`), golden datasets (`agboss golden`), and side-by-side A/B evaluation (`agboss compare`, `$ agboss eval run`, and `$ agboss eval ui`).

---

## Complete example: `@Judge` quality gates, `oneOf` narrowing, YAML profile & eval test

<!-- snippet-context
import { Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, type BudgetHandler } from "agboss";
import { usd, type Usd } from "agboss/units";
@Budget({ name: "eval-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class EvalAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(50); } }
@Budget({ name: "eval-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class EvalTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "eval-exec-budget", scope: BudgetScope.Execution })
export class EvalExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }
// @snippet
-->
```ts title="src/judges/answer-grounded.judge.ts" file=src/judges/answer-grounded.judge.ts
import {
  Agent,
  Application,
  Decision,
  Judge,
  JudgeModel,
  JudgeVerdict,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  start,
  type JudgeHandler,
  type JudgeInput,
} from "agboss";
import { Integer, Text, isVariant, oneOf } from "agboss/dto";

export class OpeningsDto {
  @Text({ prompt: "Verified job openings with [source] citations" })
  openings!: string;
}

export class OfferDto {
  @Integer({ prompt: "Annual base salary offered in USD" })
  salary!: number;
}

export class RefusalDto {
  @Text({ prompt: "Explicit reason why the candidate was not selected" })
  why!: string;
}

// 1. Decision-model @Judge using calibrated Decision.noul + Decision.score:
@Judge({
  name: "answer-grounded-judge",
  description: "Verifies that every listed role is grounded and complete",
  model: "typesafe/jev-1.13",
  reply: OpeningsDto,
  deps: [JudgeModel],
})
export class AnswerGroundedJudge implements JudgeHandler<OpeningsDto> {
  constructor(private readonly judgeModel: JudgeModel) {}

  async judge(input: JudgeInput<OpeningsDto>): Promise<JudgeVerdict> {
    const answers = await this.judgeModel.decide({
      state: { task: input.task, openings: input.reply.openings },
      questions: {
        grounded: Decision.noul("Are all openings grounded in tool outputs?"),
        usefulness: Decision.score("Overall completeness", [
          "useless",
          "partial",
          "complete",
        ]),
      },
    });
    return answers.grounded.noul >= 0.8 && answers.usefulness.score >= 1
      ? JudgeVerdict.passed({
          metrics: {
            groundedProbability: answers.grounded.noul,
            usefulness: answers.usefulness.score,
          },
        })
      : JudgeVerdict.failed({
          reason: "Cite a verified [source] for every job opening.",
        });
  }
}

// 2. Deterministic DTO @Judge narrowing a oneOf(OfferDto, RefusalDto) union via isVariant:
@Judge({
  name: "fair-decision-judge",
  description: "Checks that offers have positive salary and refusals explain why",
  model: "typesafe/jev-1.13",
  reply: oneOf(OfferDto, RefusalDto),
})
export class FairDecisionJudge implements JudgeHandler<OfferDto | RefusalDto> {
  judge(input: JudgeInput<OfferDto | RefusalDto>): Promise<JudgeVerdict> {
    if (isVariant(input, OfferDto)) {
      return Promise.resolve(
        input.reply.salary > 0
          ? JudgeVerdict.passed({ metrics: { salary: input.reply.salary } })
          : JudgeVerdict.failed({ reason: "An offer must specify salary > 0." }),
      );
    }
    return Promise.resolve(
      input.reply.why.trim().length > 0
        ? JudgeVerdict.passed()
        : JudgeVerdict.failed({ reason: "A refusal must explain why." }),
    );
  }
}

@WorkflowStart({
  name: "scout-eval-workflow-start",
  description: "Starts a job search evaluation turn",
  input: OpeningsDto,
})
export class ScoutEvalStart {}

@WorkflowFinish({
  name: "scout-eval-workflow-finish",
  description: "Returns verified job openings",
  output: OpeningsDto,
})
export class ScoutEvalFinish {}

@Agent({
  name: "scout-eval-agent",
  description: "Finds matching roles gated by AnswerGroundedJudge",
  prompt: "List matching roles and cite [source] for each role.",
  model: "moonshotai/kimi-k2.6",
  input: { query: OpeningsDto },
  output: OpeningsDto,
  judges: [AnswerGroundedJudge],
  maxRetries: 2,
})
export class ScoutEvalAgent {}

@Workflow({
  name: "job-scout-workflow",
  version: "1.0.0",
  flow: [
    start(ScoutEvalStart)
      .returns(OpeningsDto)
      .toAgent(ScoutEvalAgent)
      .returns(OpeningsDto)
      .toFinish(ScoutEvalFinish),
  ],
})
export class JobScoutEvalWorkflow {}

@Application({
  name: "job-scout-eval-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [JobScoutEvalWorkflow],
  budgets: [EvalAppBudget, EvalTenantBudget, EvalExecBudget],
})
export class JobScoutEvalApplication {}
```

```yaml title="profiles/job-scout-workflow/scout-low-thinking.yaml"
# yaml-language-server: $schema=../../schema/profile.schema.json
profile: scout-low-thinking
version: 1.0.0-low-thinking
agents:
  scout-eval-agent:
    model: moonshotai/kimi-k2.6
    maxToolCalls: 4
defaults:
  models:
    temperature: 0
  router:
    model: typesafe/jev-1.13
```

```ts title="test/eval-and-judges.test.ts" file=test/eval-and-judges.test.ts
import { expect } from "vitest";
import { decideWith, replyWith, testJudge, testWith } from "agboss/testing";
import {
  AnswerGroundedJudge,
  FairDecisionJudge,
  JobScoutEvalApplication,
  OfferDto,
  OpeningsDto,
  RefusalDto,
  ScoutEvalAgent,
  ScoutEvalStart,
} from "../src/judges/answer-grounded.judge.js";

const test = testWith(JobScoutEvalApplication);

test("retries ScoutEvalAgent when AnswerGroundedJudge rejects attempt 1, and unit-tests FairDecisionJudge", async ({
  app,
  mockLlm,
}) => {
  // 1. Unit-test the oneOf union judge with isVariant narrowing:
  const runFairJudge = testJudge(FairDecisionJudge);
  const offerVerdict = await runFairJudge({
    variant: OfferDto,
    reply: { salary: 195_000 },
    task: "Make an offer",
    attempt: 0,
  });
  expect(offerVerdict.output.passed).toBe(true);

  const emptyRefusal = await runFairJudge({
    variant: RefusalDto,
    reply: { why: "   " },
    task: "Decline candidate",
    attempt: 0,
  });
  expect(emptyRefusal.output.passed).toBe(false);

  // 2. Full workflow test: judge rejects first answer, agent retries and passes on attempt 2:
  mockLlm(ScoutEvalAgent).thenReturn(
    replyWith(OpeningsDto, { openings: "Uncited role" }),
    replyWith(OpeningsDto, { openings: "Staff TS Engineer [gh-104]" }),
  );

  mockLlm(AnswerGroundedJudge).thenReturn(
    decideWith({ grounded: 0.2, usefulness: 0 }),
    decideWith({ grounded: 0.95, usefulness: 2 }),
  );

  const result = await app.execute(ScoutEvalStart, {
    openings: "Find Staff TS roles",
  });
  expect(result.output).toEqual({ openings: "Staff TS Engineer [gh-104]" });
  expect(mockLlm(ScoutEvalAgent)).toHaveBeenCalledTimes(2);
});
```

---

## Principle 1: The 3-layer test & evaluation split

A foundational rule of AGBoss is that **unit tests (`npm test`) never call a live model**: scripted tests verify *your TypeScript graph code*, while evaluations (`agboss eval`, `agboss replay`, `agboss compare`) measure *model and prompt behavior* against real tasks:

| Layer | Command / Runner | Models & Cost | What It Proves |
| :--- | :--- | :--- | :--- |
| **1. Unit & Workflow Tests** (`*.test.ts`, `npm test`, CI) | `testWith(App)` with `mockLlm`, `TestConcurrency`, `VirtualClock`, and the 10 unit runners (`testTool`, `testJudge`, `testCompaction`, `testToolInterceptor`, …) | Scripted (`$0.00`, offline, deterministic) | Your graph paths, Path Scope inputs, `{ about }` outdating, `.onError` handlers, saga rollbacks, and multi-instance leases work as designed |
| **1.5. Recorded VCR Runs** (`*.integration.test.ts`) | `testWith(App, { vcr: { cassetteName } })` (`VcrMode.Auto` / `VcrMode.Replay`, verified by `[vcr.stale-cassette]`) | Recorded once from real models, replayed offline (`$0.00` in CI) | Real multi-step model responses and tool payloads integrate cleanly with your DTO schemas |
| **2. Evaluation & Golden Sets** (`@EvalSuite`, `agboss eval`, `replay`, `golden`, `compare`) | `$ agboss eval run`, `npx agboss eval`, `npx agboss replay`, `npx agboss compare`, or `compareProfiles()` | Real models, capped by `@Application({ budgets })` | `pass@k` capability, `pass^k` production reliability, tool trajectory invariants, and whether a new YAML profile or prompt version improves quality without regressions |
| **3. Provider Smoke Tests** (`tests/smoke/`, `agboss check --models`) | `npx agboss check --models` and a small budget-capped smoke suite | Real provider endpoints | Every model ID, reasoning effort, cache retention, and price table matches the live `@ModelProvider` |

---

## Principle 2: What every `Tern` stores & RFC 8785 `configHash`

In AGBoss, one question-to-answer execution round is called a **`Tern`**, and a `threadId` is a client's sequence of `Tern`s. Every execution — whether `answered`, `guarded`, `failed`, or `paused` — writes a `Tern` into `ExecutionRecordRepository` containing:

- `task`, `answer`, `status`, `stopReason`, `route`, `steps` (what each agent/router answered), and `cost`.
- **`promptVersion` & `modelVersion`:** Short SHA-256 fingerprints of all agent/router prompts and resolved model settings. Editing a `*.prompt.md` file automatically produces a new `promptVersion`.
- **`configHash` (RFC 8785 Canonical JSON):** A 64-character SHA-256 fingerprint (first 8 hex characters shown in `agboss describe`) computed over RFC 8785 canonical JSON (UTF-16 code-unit key order, locale-independent) covering:
  - **`elements`:** Each agent and model router's active `@PiiPolicy` rules, `uncompactedTurns`, `@Compaction` strategy, and attached `@Judge`s.
  - **`frame`:** The framework's own system framing for routers, tool loops, judge retry prompts, and RAG citations.
  - **`children`:** Every reachable child `@Workflow` recursively.
  - If you modify a workflow's prompt or flow without bumping `@Workflow({ version })`, AGBoss logs a drift warning at startup: `warning: config "job-scout" 1.0.0 changed without a version bump (hash 3f2a…)`.

---

## Principle 3: Scoring, calibrating & replaying with `agboss eval` and `agboss replay`

1. **Calibrate your judge first:** Before trusting aggregate eval numbers, inspect and hand-label 20–30 recorded `Tern`s to verify that your decision judge agrees with human domain judgment.
2. **Score unscored `Tern`s (`agboss eval`):**
   ```bash
   npx agboss eval --version 1.0.0 --limit 100
   ```
   Scores every unscored answered `Tern` (`P(adequate)`) and prints a summary table per `promptVersion` (total `Tern`s, scored count, mean score, and USD cost).
3. **Replay historical tasks against a prompt edit (`agboss replay`):**
   ```bash
   npx agboss replay --version <old-prompt-version> --limit 100
   ```
   Re-runs the stored tasks from `<old-prompt-version>` against your **current** code and prompts as new threads (`replay_of` set), scores both sides, and prints the `before → after` delta on the exact same tasks. Both `eval` and `replay` run strictly inside your `@Application({ budgets })` and stop cleanly if a budget cap is reached.

---

## Principle 4: Golden sets & A/B profile comparisons (`agboss compare` & `compareProfiles`)

A profile YAML file (`profiles/<workflow-name>/<profile>.yaml`) overrides `defaults`, `compactions.<name>`, `agents.*`, or `prompts` without touching TypeScript code.

### From the CLI (`agboss golden` & `agboss compare`)

```bash
# 1. Save the last 20 real tasks into a versioned golden set (golden/<workflow>/core.yaml):
npx agboss golden add --name core --from-last 20

# 2. Run side-by-side evaluation of base vs candidate YAML profile:
npx agboss compare --profiles base,scout-low-thinking --golden core
```

`agboss compare` runs each golden task as a fresh first-contact turn on every listed profile, computes **mean adequacy score**, runs **randomized-order pairwise A/B judging (`wins/losses/ties` vs `base`)**, and reports total cost, cost per task, `p50`/`p95` latency, and a diff of the exact settings that changed:

```text
profile            | version            | mean | vs base (w/l/t) | cost    | per task | p50 s | p95 s | failed
base               | 1.0.0              | 0.50 | baseline        | $0.0141 | $0.0071  | 30.6  | 35.8  | 0
scout-low-thinking | 1.0.0-low-thinking | 0.62 | 1/0/1           | $0.0115 | $0.0058  | 21.7  | 33.5  | 0
```

### From TypeScript code (`compareProfiles`)

You can also invoke `compareProfiles` programmatically inside custom benchmark scripts or Vitest evaluation suites:

<!-- snippet-context
declare class JobScout { settings(): import("agboss").WorkflowSettings }
-->
```ts title="src/evals/compare-profiles.ts"
import { compareProfiles } from "agboss";

export async function runComparison() {
  const comparison = await compareProfiles(JobScout, {
    profiles: ["base", "scout-low-thinking"],
    tasks: ["Find senior backend jobs in Europe", "Save the first two jobs"],
  });

  for (const profile of comparison.profiles) {
    const pairwise = profile.pairwise
      ? `${String(profile.pairwise.wins)}/${String(profile.pairwise.losses)}/${String(profile.pairwise.ties)}`
      : "—";
    console.log(
      `${profile.name}: score ${String(profile.meanScore ?? "—")}, w/l/t ${pairwise}, $${profile.costPerTaskUsd.toFixed(4)}/task`,
    );
  }
}
```

---

## Principle 5: Declarative `@EvalSuite`, `pass@k` / `pass^k`, Calibration & Eval UI

In addition to scoring recorded `Tern`s, `agboss/eval` lets you declare typed, multi-turn evaluation suites (`@EvalSuite`) with deterministic tool stubs (`toolCall`), trajectory assertions (`checkTrajectory`), and cascading judges (`EvalCascade.StopAtFirstFailure`, running `$0` `DecidedBy.Code` judges before `DecidedBy.Model` judges):

<!--
```ts file=src/evals/eval-ambient.d.ts
declare module "agboss/eval" {
  export enum EvalCascade {
    StopAtFirstFailure = "stop-at-first-failure",
    RunAll = "run-all",
  }

  export function toolCall(tool: unknown, input: unknown, output: unknown): unknown;
  export function toolInvariant(tool: unknown, check: (input: unknown, output: unknown) => boolean): unknown;
  export function pastTurn(input: unknown, output: unknown, options?: { tools?: readonly unknown[] }): unknown;
  export function turn(input: unknown, options?: {
    tools?: readonly unknown[];
    expectedFinish?: unknown;
    checkTrajectory?: (result: { toolCalls: readonly unknown[]; output: unknown }) => void;
    judgedBy?: readonly unknown[];
  }): unknown;
  export function evalCase(name: string, config: {
    turns: readonly unknown[];
    paraphrases?: readonly string[];
  }): unknown;
  export function EvalSuite(options: {
    name: string;
    description: string;
    application: unknown;
    start: unknown;
    cascade?: EvalCascade;
    toolInvariants?: readonly unknown[];
    judges?: readonly unknown[];
    cases: readonly unknown[];
  }): (target: unknown, context?: unknown) => void;
}
```
--->

```ts title="src/evals/job-scout.eval-suite.ts" file=src/evals/job-scout.eval-suite.ts
import { EvalCascade, EvalSuite, evalCase, pastTurn, turn } from "agboss/eval";
import {
  AnswerGroundedJudge,
  FairDecisionJudge,
  JobScoutEvalApplication,
  ScoutEvalFinish,
  ScoutEvalStart,
} from "../judges/answer-grounded.judge.js";

@EvalSuite({
  name: "job-scout-eval-suite",
  description: "Multi-turn grounding and trajectory benchmark for JobScoutEvalWorkflow",
  application: JobScoutEvalApplication,
  start: ScoutEvalStart,
  cascade: EvalCascade.StopAtFirstFailure,
  judges: [FairDecisionJudge, AnswerGroundedJudge],
  cases: [
    evalCase("berlin-staff-ts-roles", {
      turns: [
        pastTurn(
          { openings: "Focus on remote-friendly EU hubs" },
          { openings: "Filtering to EU remote hubs [eu-hub]" },
        ),
        turn(
          { openings: "Find Staff TypeScript roles in Berlin" },
          {
            expectedFinish: ScoutEvalFinish,
            judgedBy: [AnswerGroundedJudge],
          },
        ),
      ],
      paraphrases: [
        "List open Staff-level TypeScript engineering jobs based in Berlin",
        "Which Berlin companies are hiring Staff TS engineers?",
      ],
    }),
  ],
})
export class JobScoutEvalSuite {}
```

### Multi-Run Reliability (`pass@k` vs `pass^k`), Regression Gates & Calibration

```bash
# 1. Run an @EvalSuite across k=5 trials per case and export JSON + static HTML report:
$ agboss eval run --suite job-scout-eval-suite --runs 5 --report .artifacts/eval/pr.json --html .artifacts/eval/report.html

# 2. Gate CI against the main branch baseline (exit code 5 on regression; flaky-on-baseline cases are quarantined):
$ agboss eval run --suite job-scout-eval-suite --runs 5 --baseline .artifacts/eval/main.json --fail-on-regression

# 3. Verify judge agreement with human labels (pairwise Cohen's kappa >= 0.75):
$ agboss eval calibrate --report .artifacts/eval/pr.json --labels evals/labels/scout.jsonl --min-kappa 0.75

# 4. Run chaos fault injection (429s, timeouts, truncated tool JSON) and metamorphic paraphrase checks:
$ agboss eval run --suite job-scout-eval-suite --chaos --metamorphic

# 5. Open the local interactive Eval UI workbench (trajectory inspector, failure taxonomy tagging & live kappa labeling):
$ agboss eval ui --report .artifacts/eval/pr.json --labels evals/labels/scout.jsonl
```

| Capability | How It Works |
| :--- | :--- |
| **`pass@k` vs `pass^k` (`--runs <k>`)** | `pass@k` measures whether a case passed **at least once** in $k$ trials (capability); `pass^k` measures whether it passed **all $k$ of $k$ trials** (production reliability). High `pass@k` (`1.00`) paired with low `pass^k` (`< 0.80`) automatically flags the step as a **Progressive Crystallization candidate**. |
| **Baseline Regression Gate (`--baseline --fail-on-regression`)** | Compares every case against a baseline report JSON (`exit code 5` on new failures). Any case whose baseline had `0 < pass^k < 1` is marked `flaky-on-baseline` and quarantined so baseline noise never blocks unrelated pull requests. |
| **Judge Calibration (`eval calibrate` & Cohen's $\kappa$)** | Computes pairwise **Cohen's kappa ($\kappa$)** and a confusion matrix (`TP`, `FP`, `TN`, `FN`) between each `@Judge` and human JSONL annotations, failing with exit code `6` if $\kappa < \text{--min-kappa}$. Also warns with `[judge.same-model-family]` when a model judge shares the evaluated agent's model family. |
| **Chaos (`--chaos`) & Metamorphic (`--metamorphic`)** | `--chaos` injects transient provider faults (`429`, timeouts, truncated tool arguments) below `ProviderFetch` to verify retry and `.onError()` resilience; `--metamorphic` runs case `paraphrases` and verifies that the tool-call trajectory remains invariant across prompt rewordings. |
| **HTML Report (`eval show --html`) & Interactive Workbench (`eval ui`)** | Generates a self-contained single-file HTML report for CI artifacts, or launches a local web workbench (`127.0.0.1`) to inspect multi-turn trajectories, tag failure modes, label runs with live $\kappa$ recalculation, and promote production traces into `@EvalSuite` cases. |
