---
title: "@Judge"
description: "Complete API reference for the @Judge decorator in AGBoss — declarative, code and hybrid judges, JudgeVerdict, toolCalls inspection, and testUnit runner."
---

The `@Judge` decorator (`"@agboss/core"`) defines an independent quality gate attached to an `@Agent` via `@Agent({ judges: [MyJudge], executionLimits: { maxRetries: 2 } })` or to an `@EvalSuite` case via `judgedBy: [MyJudge]`. Every time the agent produces an answer, its judges inspect `{ output, task, attempt, toolCalls, files }` and return a `JudgeVerdict` built via `JudgeVerdict.passed({ metrics? })` or `JudgeVerdict.failed(reason, { metrics? })`. When an in-loop judge fails, AGBoss feeds `reason` back into the agent and retries up to `maxRetries` times before letting the output leave the step.

A judge has no `decidedBy`; its class says how it decides:
- **Declarative model judge:** an empty class with a `prompt` and a `threshold`, decided by its own model, which answers one structured verdict (never a text marker). No code, no `JudgeModel`.
- **Code judge:** a class with a `judge(input)` method and no `JudgeModel` in `deps` — deterministic DTO, state and tool-trajectory checks (`input.toolCalls` / `toolCallsOf(ToolClass, input.toolCalls)`) at `$0.00` LLM cost; it names no `model` (`[judge.model-on-code-judge]`).
- **Hybrid judge:** a `judge(input)` method whose class injects `JudgeModel` (`judgeModel.decide()` for decision models like `"typesafe/jev-1.13"`, `judgeModel.invoke()` for chat models); `model` and `modelProvider` name its own model. It warns `[judge.same-model-family]` if it shares the judged agent's model family (self-preference bias).

## Complete `@Judge` example with `JudgeInput`, `JudgeModel`, and `JudgeVerdict`

```ts title="src/judges/grounded-citation.judge.ts" file=src/judges/grounded-citation.judge.ts
import {
  Agent,
  Decision,
  ExecutionContext,
  Judge,
  JudgeModel,
  JudgeVerdict,
  inline,
  type JudgeHandler,
  type JudgeInput,
} from "@agboss/core";
import { List, Text } from "@agboss/core/dto";
import { Rag, RagScope, RagSource, type RagRetrieval } from "@agboss/core/rag";

export class PolicyAnswerDto {
  @Text({ prompt: "Policy answer citing [source] identifiers" })
  answer!: string;

  @List(Text, { prompt: "Cited source IDs" })
  citations!: string[];
}

@Rag({
  name: "handbook_rag",
  description: "Company policy handbook",
  scope: RagScope.Tenant,
  topK: 3,
})
export class HandbookRag extends RagSource {
  protected override retrieve(): RagRetrieval {
    return { results: [{ text: "16 weeks paid parental leave", source: "hr-leave" }] };
  }
}

// a hybrid judge: its class injects JudgeModel, so it names its own model
@Judge({
  name: "grounded-citation-judge",
  description: "Verifies that every factual claim cites a retrieved [source] and answers the question",
  model: "typesafe/jev-1.13",
  output: PolicyAnswerDto,
  deps: [JudgeModel, ExecutionContext],
})
export class GroundedCitationJudge implements JudgeHandler<PolicyAnswerDto> {
  constructor(
    private readonly judgeModel: JudgeModel,
    private readonly executionContext: ExecutionContext,
  ) {}

  async judge(input: JudgeInput<PolicyAnswerDto>): Promise<JudgeVerdict> {
    void this.executionContext.executionId;
    const answers = await this.judgeModel.decide({
      state: {
        task: input.task,
        answer: input.output.answer,
        citations: input.output.citations.join(", "),
      },
      questions: {
        hasCitations: Decision.boolean("Does every factual claim cite a [source] identifier?"),
        accuracyScore: Decision.score("Rate how directly the reply answers the task", [
          "inaccurate or off-topic",
          "partially answers the question",
          "directly and accurately answers the question",
        ]),
      },
    });

    const passed =
      input.output.citations.length > 0 &&
      answers.hasCitations.probability >= 0.8 &&
      answers.accuracyScore.score >= 2;

    const metrics = {
      hasCitationsProbability: answers.hasCitations.probability,
      accuracyScore: answers.accuracyScore.score,
      attempt: input.attempt,
    };

    return passed
      ? JudgeVerdict.passed({ metrics })
      : JudgeVerdict.failed(
          "Cite the exact [source] for every claim and directly answer the user's question.",
          { metrics },
        );
  }
}

// a declarative judge: an empty class with a prompt and a threshold
@Judge({
  description: "The answer is polite",
  output: PolicyAnswerDto,
  prompt: inline("The answer is polite and professional."),
  model: "typesafe/jev-1.13",
  threshold: 0.8,
})
export class PoliteAnswerJudge {}

@Agent({
  name: "policy-advisor-agent",
  description: "Answers policy questions verified by GroundedCitationJudge",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Answer using the handbook and cite [source] on every claim."),
  rag: [HandbookRag],
  output: PolicyAnswerDto,
  judges: [GroundedCitationJudge, PoliteAnswerJudge],
  executionLimits: { maxRetries: 2 },
})
export class PolicyAdvisorAgent {}
```

```ts title="test/grounded-citation.judge.test.ts" file=test/grounded-citation.judge.test.ts
import { expect, it } from "vitest";
import { decideWith, testUnit } from "@agboss/core/testing";
import { GroundedCitationJudge, PolicyAnswerDto } from "../src/judges/grounded-citation.judge.js";

it("fails an uncited reply and returns actionable retry reason", async () => {
  const runJudge = testUnit(GroundedCitationJudge, {
    model: decideWith({
      hasCitations: 0.1,
      accuracyScore: 2,
    }),
  });

  const { output } = await runJudge({
    variant: PolicyAnswerDto,
    task: "What is our parental leave policy?",
    output: { answer: "Employees receive 16 weeks of paid leave.", citations: [] },
    attempt: 0,
  });

  expect(output.passed).toBe(false);
  if (!output.passed) {
    expect(output.reason).toContain("[source]");
  }
});
```

## What options does `@Judge` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | No | Kebab-case identifier (the class name in kebab-case by default; `[name.kind-suffix]` is no longer raised); keys profile overrides (`judges.<name>`) and cost attribution (`judge:<name>`). |
| `description` | `string` | No | Human-readable summary of what quality criteria this judge enforces. |
| `output` | `DtoClass \| oneOf(…) \| listOf(…)` | Yes | What the judge inspects: the DTO shape of the agent's `output` (`PolicyAnswerDto`, `oneOf(A, B)`, `listOf(Dto)`, `listOf(A, B)`, or `PlainTextDto` for text agents). It must match the judged agent's `output` shape (`[judge.wrong-output]`). `reply` is gone. |
| `prompt` | `PromptSource` | Declarative only | The criterion: a file path, `inline("…")` or a list. A `prompt` and a `judge()` method on one class is `[judge.declarative-with-judge]`; with `deps`, `[judge.declarative-with-deps]`. |
| `threshold` | `number` | No | In `(0, 1]` (`[judge.bad-threshold]`), only with a `prompt`. Without it the model answers `{ passed, reason }`; with it `{ score, reason }` and the answer passes at `score >= threshold`. |
| `model` / `modelProvider` | `string` / `Class` | Declarative, hybrid | The judge's own model and its provider (the cascade: the judge's, its workflow's, its application's); left out, the provider's default role. Not on a code judge. |
| `deps` | `readonly Token[]` | No | Constructor dependencies (`JudgeModel`, `ExecutionContext`, `@Injectable` services) verified at compile time. `JudgeModel` makes the judge hybrid. |

## What related entities work with `@Judge`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `JudgeInput<Self \| Dto>` | `"@agboss/core"` | Typed input passed to `judge()`: `{ output, variant, task, attempt, toolCalls, files }`. It takes the judge class (its output is read from the generated `AGBossTypes.JudgeOutputs` table) or the output type directly. |
| `JudgeHandler<TOutput>` | `"@agboss/core"` | Optional signature check (`judge(input): JudgeVerdict \| Promise<JudgeVerdict>`); a code judge may return its verdict directly. |
| `toolCallsOf(ToolClass, input.toolCalls)` | `"@agboss/core"` | Filters `input.toolCalls` to calls of `ToolClass` with `input` and `output` narrowed to that tool's DTO types. |
| `JudgeVerdict` (`passed({ metrics? })`, `failed(reason, { metrics? })`) | `"@agboss/core"` | The only way to build a verdict: `{ passed: true, metrics? }` or `{ passed: false, reason, metrics? }`. |
| `JudgeModel` | `"@agboss/core"` | Injected via `deps: [JudgeModel]`; provides `judgeModel.decide({ state, questions })` for decision models and `judgeModel.invoke(prompt)` for chat models, with automatic FinOps cost tracking under `judge:<name>`; every call is checked against the execution's budgets first. |
| `Decision` (`boolean`, `choice`, `score`) | `"@agboss/core"` | Builders for typed multi-question evaluation requests sent to `judgeModel.decide()`; a yes/no answer is `answers.id.probability` (`Decision.noul` is gone). |
| `testUnit(JudgeClass, options?)` | `"@agboss/core/testing"` | Isolated unit runner that tests a `@Judge` class offline with scripted `decideWith` / `replyWith` turns or code logic. |
