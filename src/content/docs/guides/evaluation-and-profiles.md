---
title: "Loop 2–4: Live Evals, pass^k, Nightly Polygon & Judge Calibration"
description: "Run Loops 2–4 of the AGBoss Verification Funnel — Fail-Fast @EvalSuite cascades, pass@k vs pass^k, Cohen's kappa calibration, and RFC 8785 Tern profiling."
---

In the AGBoss [5-Loop Cost & Determinism Verification Funnel](/concepts/verification-funnel/), once [Loop 0 (`agboss check`) and Loop 1 (`npm test`)](/guides/testing-agents/) have verified your topology and TypeScript harness for `$0`, **Loops 2–4** evaluate live model trajectories, memory compaction survival, and production telemetry. AGBoss combines in-loop [`@Judge`](/reference/judge/) gates (`DecidedBy.Code` and `DecidedBy.Model`), declarative [`@EvalSuite`](/guides/evaluation-and-profiles/#principle-5-declarative-evalsuite-passk--passk-calibration--eval-ui) benchmarks (`@agboss/core/eval`), Fail-Fast `$0 → $$$` cascades, `pass@k` vs `pass^k` baseline gates (`flaky-on-baseline` quarantine), nightly `--metamorphic` and `--chaos` polygons, Cohen's $\kappa$ calibration (`agboss eval calibrate`), and two production feedback loops (`agboss golden` & [Progressive Crystallization](/concepts/progressive-crystallization/)).

---

## Complete example: `@Judge` quality gates, `oneOf` narrowing, YAML profile & eval test

<!-- snippet-context
import { Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, type BudgetHandler } from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";
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
  DecidedBy,
  Decision,
  Judge,
  JudgeModel,
  JudgeVerdict,
  Tool,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  start,
  type JudgeHandler,
  type JudgeInput,
  type ToolHandler,
} from "@agboss/core";
import { Integer, Text, isVariant, oneOf } from "@agboss/core/dto";

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

@Tool({
  name: "job-board-search-tool",
  description: "Searches verified engineering job boards",
  input: OpeningsDto,
  output: OpeningsDto,
})
export class JobBoardSearchTool implements ToolHandler<OpeningsDto, OpeningsDto> {
  run(input: OpeningsDto): Promise<OpeningsDto> {
    return Promise.resolve({ openings: `Results for ${input.openings} [gh-104]` });
  }
}

// 1. $0 deterministic code @Judge checking bracketed citation format before any LLM judge runs:
@Judge({
  name: "citation-format-judge",
  description: "Checks that the reply contains at least one bracketed [source] citation",
  decidedBy: DecidedBy.Code,
  reply: OpeningsDto,
})
export class CitationFormatJudge implements JudgeHandler<OpeningsDto> {
  judge(input: JudgeInput<OpeningsDto>): Promise<JudgeVerdict> {
    const hasCitation = /\[[a-z0-9-]+\]/i.test(input.reply.openings);
    return Promise.resolve(
      hasCitation
        ? JudgeVerdict.passed({ metrics: { hasCitation: true } })
        : JudgeVerdict.failed({ reason: "Every listed opening must include a [source] tag." }),
    );
  }
}

// 2. Decision-model @Judge using calibrated Decision.noul + Decision.score:
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

// 3. Deterministic DTO @Judge narrowing a oneOf(OfferDto, RefusalDto) union via isVariant:
@Judge({
  name: "fair-decision-judge",
  description: "Checks that offers have positive salary and refusals explain why",
  decidedBy: DecidedBy.Code,
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
  description: "Finds matching roles gated by CitationFormatJudge and AnswerGroundedJudge",
  prompt: "List matching roles and cite [source] for each role.",
  model: "moonshotai/kimi-k2.6",
  input: { query: OpeningsDto },
  output: OpeningsDto,
  tools: [JobBoardSearchTool],
  judges: [CitationFormatJudge, AnswerGroundedJudge],
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
import { decideWith, replyWith, testJudge, testWith } from "@agboss/core/testing";
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

## Principle 1: How do Loops 2–4 fit into the 5-Loop Verification Funnel?

A foundational rule of AGBoss is: **never verify with a paid language model what can be proven by the compiler or checked by deterministic TypeScript; and when you invoke a model, check `$0` trajectory invariants and code judges first before calling a calibrated LLM judge.** See the full [5-Loop Cost & Determinism Verification Funnel](/concepts/verification-funnel/) architecture for all four objects of verification and both production feedback loops:

| Loop | Command / Runner | Latency & Cost | What It Proves |
| :--- | :--- | :--- | :--- |
| **[Loop 0: Compiler](/concepts/verification-funnel/#loop-0-static-proof-agboss-check---federation--0--1-second)** | `$ agboss check --federation` | `< 1s` · **`$0`** (every save) | **Object 1 (Topology & Mesh Contracts):** Path Scope dominance, `{ about }` staleness, LIFO saga compensations, and Agent Mesh federation schemas |
| **[Loop 1: Deterministic Harness](/guides/testing-agents/)** | `npm test` (`testWith(App)`, 10 unit runners, `VirtualClock`, VCR) | `~3s` · **`$0`** (every commit; locked by `[vcr.stale-cassette]`) | **Object 2 (Harness Code):** `@Action`, `DecidedBy.Code` `@Router`/`@Arbiter`, `@Tool`, `@ToolInterceptor`, `@PiiPolicy`, retries, `ModelFailure` chaos, and `{ instances: 2 }` pod leases |
| **Loop 2: PR Smoke Gate** | `$ agboss eval run --runs 5 --baseline` | `~1 min` · **`$`** (on PR when `promptHash` / `schemaHash` changes) | **Object 3 (Model & Trajectory):** Fail-Fast cascade (`$0` `requiredTools`/`forbiddenTools`/`toolInvariant` $\to$ `$0` code `@Judge` $\to$ LLM `@Judge`), `pass^5` vs cached `--baseline` (`flaky-on-baseline` quarantine), and `eval-report.html` |
| **Loop 3: Nightly Polygon** | `$ agboss eval run --runs 20 --metamorphic --chaos` | `~15 min` · **`$$`** (nightly on `main` / pre-release) | **Objects 3 & 4 (Trajectory & Memory):** Full 30–50+ task benchmark with pinned `vendorRouting`, `--metamorphic` paraphrase invariance, multi-turn `@Compaction` survival, stale-memory override, `--chaos`, and provider drift detection |
| **Loop 4: Production & Feedback Loops A/B** | `ExecutionRecord` $\to$ `$ agboss eval ui` / `$ agboss eval calibrate` / `agboss golden` | `24/7` · Continuous | **Loop A:** Failure taxonomy tagging, Cohen's $\kappa \ge 0.80$ judge calibration, and 1-click promotion to `golden/*.yaml`. **Loop B:** [Progressive Crystallization](/concepts/progressive-crystallization/) from paid Loop 2 back into `$0` Loop 1 |

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
2. **Score unscored `Tern`s (`agboss eval score`):**
   ```bash
   npx agboss eval score --version 1.0.0 --limit 100
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
declare class JobScout { settings(): import("@agboss/core").WorkflowSettings }
declare class ChatWorkflowStart {}
-->
```ts title="src/evals/compare-profiles.ts"
import { compareProfiles } from "@agboss/core";

export async function runComparison() {
  const comparison = await compareProfiles(JobScout, {
    start: ChatWorkflowStart,
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

In addition to scoring recorded `Tern`s, `@agboss/core/eval` lets you declare typed, multi-turn evaluation suites (`@EvalSuite`) with trajectory expectations (`checkTrajectory()`, `toolCall`, `toolInvariant`) and Fail-Fast cascading judges (`EvalCascade.StopAtFirstFailure`, running `$0` `DecidedBy.Code` judges before `DecidedBy.Model` judges):

```ts title="src/evals/job-scout.eval-suite.ts" file=src/evals/job-scout.eval-suite.ts
import {
  EvalCascade,
  EvalSuite,
  checkTrajectory,
  evalCase,
  judgedBy,
  pastTurn,
  toolCall,
  toolInvariant,
  turn,
} from "@agboss/core/eval";
import {
  AnswerGroundedJudge,
  CitationFormatJudge,
  JobBoardSearchTool,
  ScoutEvalFinish,
  ScoutEvalStart,
} from "../judges/answer-grounded.judge.js";

@EvalSuite({
  name: "job-scout-eval-suite",
  description: "Multi-turn grounding and trajectory benchmark for JobScoutEvalWorkflow",
  start: ScoutEvalStart,
  checks: [
    checkTrajectory(), // 1. $0 deterministic trajectory invariants
    judgedBy(CitationFormatJudge), // 2. $0 DecidedBy.Code judge
    judgedBy(AnswerGroundedJudge), // 3. Paid DecidedBy.Model judge (runs only if 1 & 2 pass)
  ],
  cascade: EvalCascade.StopAtFirstFailure,
  cases: [
    evalCase({
      name: "berlin-staff-ts-roles",
      history: [
        pastTurn(
          ScoutEvalStart,
          { openings: "Focus on remote-friendly EU hubs" },
          ScoutEvalFinish,
          { openings: "Filtering to EU remote hubs [eu-hub]" },
        ),
      ],
      turns: [turn({ openings: "Find Staff TypeScript roles in Berlin" })],
      variants: [
        turn({ openings: "List open Staff-level TypeScript engineering jobs based in Berlin" }),
        turn({ openings: "Which Berlin companies are hiring Staff TS engineers?" }),
      ],
      tools: {
        required: [toolCall(JobBoardSearchTool, { openings: "Berlin" })],
        invariants: [toolInvariant(JobBoardSearchTool, (input) => input.openings.trim().length > 0)],
      },
    }),
  ],
})
export class JobScoutEvalSuite {}
```

### Multi-Run Reliability (`pass@k` vs `pass^k`), Regression Gates & Calibration

```bash
# 1. Run an @EvalSuite across k=5 trials per case and export JSON + static HTML report:
npx agboss eval run --suite job-scout-eval-suite --runs 5 --report .artifacts/eval/pr.json --html .artifacts/eval/report.html

# 2. Gate CI against the main branch baseline (exit code 5 on regression; flaky-on-baseline cases are quarantined):
npx agboss eval run --suite job-scout-eval-suite --runs 5 --baseline .artifacts/eval/main.json --fail-on-regression

# 3. Re-render a saved EvalRunReport artifact into a standalone HTML page without calling any models:
npx agboss eval show .artifacts/eval/pr.json --html .artifacts/eval/report.html

# 4. Verify judge agreement with human labels (pairwise Cohen's kappa & confusion matrix):
npx agboss eval calibrate --report .artifacts/eval/pr.json --labels eval/labels/job-scout-eval-suite.jsonl

# 5. Run chaos fault injection (429s, timeouts, truncated tool JSON) and metamorphic paraphrase checks:
npx agboss eval run --suite job-scout-eval-suite --chaos 0.3 --chaos-seed 42 --metamorphic

# 6. Promote a stored production ExecutionRecord into a typed @EvalSuite case (Loop 5):
npx agboss generate eval-case refund-edge-eval-case --suite job-scout-eval-suite --from-execution exec-9102

# 7. Export stored ExecutionRecords to JSONL for offline analysis or AGBoss Mesh Hub:
npx agboss records export --all-tenants --out .artifacts/records.jsonl

# 8. Open the local interactive Eval UI workbench (trajectory inspector, failure taxonomy tagging & live kappa labeling):
npx agboss eval ui --dir .artifacts/eval
```

| Capability | How It Works |
| :--- | :--- |
| **`pass@k` vs `pass^k` (`--runs <k>`)** | `pass@k` measures whether a case passed **at least once** in $k$ trials (capability); `pass^k` measures whether it passed **all $k$ of $k$ trials** (production reliability). High `pass@k` (`1.00`) paired with low `pass^k` (`< 0.80`) marks the case `unstable` and flags the step as a **Progressive Crystallization candidate**. |
| **Baseline Regression Gate (`--baseline --fail-on-regression`)** | Compares every case against a baseline report JSON (`exit code 5` on new failures). Any case whose baseline had `0 < pass^k < 1` is marked `flaky-on-baseline` (`CaseComparison.FlakyOnBaseline`) and quarantined so baseline noise never blocks unrelated pull requests. |
| **Judge Calibration (`eval calibrate` & Cohen's $\kappa$)** | Computes pairwise **Cohen's kappa ($\kappa$)**, a confusion matrix (`TP`, `FP`, `TN`, `FN`), disagreements, and per-metric rubrics between each `@Judge` and human `EvalLabel` JSONL annotations (`eval/labels/<suite>.jsonl`). Also warns with `[judge.same-model-family]` when a model judge shares the evaluated agent's model family. |
| **Chaos (`--chaos <rate> --chaos-seed <n>`) & Metamorphic (`--metamorphic`)** | `--chaos` injects transient provider faults (`429`, timeouts, truncated answers) below `ProviderFetch` to verify retry and `.onError()` resilience; `--metamorphic` runs case `variants` and verifies that the tool-call trajectory (`metamorphic` check) remains invariant across prompt rewordings. |
| **Production Flywheel (`generate eval-case --from-execution` & `records export`)** | Reads an `ExecutionRecord` from `ExecutionHistoryRepository` (`SqliteExecutionHistoryRepository`), turns its conversation history, input, and required tool calls into a typed `evalCase(...)` in your `@EvalSuite`, and exports JSONL records (`agboss records export`) for offline auditing and `agboss hub`. |
| **HTML Report (`eval show --html`) & Interactive Workbench (`eval ui`)** | Generates a self-contained single-file HTML report for CI artifacts (`eval run --html` or `eval show <run.json> --html`), or launches a local web workbench (`127.0.0.1`) to inspect multi-turn trajectories, tag failure modes, label runs with live $\kappa$ recalculation, and promote production traces into `@EvalSuite` cases. |

---

## Standalone Executable Proof: [`03-support-refund-desk`](https://github.com/agbossjs/agboss-examples/tree/main/03-support-refund-desk)

Inspect **[`03-support-refund-desk`](https://github.com/agbossjs/agboss-examples/tree/main/03-support-refund-desk)** in [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples) for a complete runnable `@EvalSuite` (`src/eval-suites/refund-desk.eval-suite.ts`), compact git-diff-friendly baseline (`eval/baseline/main-baseline.json`), human label calibration (`eval/human-labels/refund-desk-eval-suite.jsonl`), and PII-safe `generate eval-case` promotion (see [7 Verified Examples](/examples/job-scout/)).
