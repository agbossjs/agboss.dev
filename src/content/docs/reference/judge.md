---
title: "@Judge"
description: "Complete API reference for the @Judge decorator in AGBoss — DecidedBy.Model vs DecidedBy.Code, JudgeVerdict, toolCalls inspection, and testJudge runner."
---

The `@Judge` decorator (`"agboss"`) defines an independent quality gate attached to an `@Agent` via `@Agent({ judges: [MyJudge], maxRetries: 2 })` or to an `@EvalSuite` case via `judgedBy: [MyJudge]`. Every time the agent produces a reply, its judges inspect `{ reply, variant, task, attempt, toolCalls }` and return a `JudgeVerdict` built via `JudgeVerdict.passed({ metrics? })` or `JudgeVerdict.failed({ reason, metrics? })`. When an in-loop judge fails, AGBoss feeds `reason` back into the agent and retries up to `maxRetries` times before letting the output leave the step.

`@Judge` supports two execution modes via `decidedBy`:
- **`DecidedBy.Model` (default):** Injects `JudgeModel` (`judgeModel.decide()` for decision models like `"typesafe/jev-1.13"` or `judgeModel.invoke()` for chat models). Emits a `[judge.same-model-family]` warning if the judge uses the same model family as the judged `@Agent` (preventing self-preference bias).
- **`DecidedBy.Code`:** Runs deterministic DTO, state, and tool-trajectory checks (`input.toolCalls` / `toolCallsOf(ToolClass, input.toolCalls)`) at `$0.00` LLM cost without requiring a `model` option.

## Complete `@Judge` example with `JudgeHandler<TReply>`, `JudgeModel`, and `JudgeVerdict`

```ts title="src/judges/grounded-citation.judge.ts" file=src/judges/grounded-citation.judge.ts
import {
  Agent,
  Decision,
  ExecutionContext,
  Judge,
  JudgeModel,
  JudgeVerdict,
  RagMode,
  type JudgeHandler,
  type JudgeInput,
} from "agboss";
import { ListOf, Text } from "agboss/dto";
import { Rag, type RagConnector, type RagRetrieval } from "agboss/rag";

export class PolicyAnswerDto {
  @Text({ prompt: "Policy answer citing [source] identifiers" })
  answer!: string;

  @ListOf(Text, { prompt: "Cited source IDs" })
  citations!: string[];
}

@Rag({
  name: "handbook_rag",
  description: "Company policy handbook",
  topK: 3,
})
export class HandbookRag implements RagConnector {
  retrieve(
    _query: string,
    _options: { readonly topK: number; readonly signal: AbortSignal },
  ): Promise<RagRetrieval> {
    return Promise.resolve({
      results: [{ text: "16 weeks paid parental leave", source: "hr-leave" }],
    });
  }
}

@Judge({
  name: "grounded-citation-judge",
  description: "Verifies that every factual claim cites a retrieved [source] and answers the question",
  model: "typesafe/jev-1.13",
  reply: PolicyAnswerDto,
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
      state: `Task:\n${input.task}\n\nReply:\n${input.reply.answer}\nCitations: ${input.reply.citations.join(", ")}`,
      questions: {
        hasCitations: Decision.noul("Does every factual claim cite a [source] identifier?"),
        accuracyScore: Decision.score("Rate how directly the reply answers the task", [
          "inaccurate or off-topic",
          "partially answers the question",
          "directly and accurately answers the question",
        ]),
      },
    });

    const passed =
      input.reply.citations.length > 0 &&
      answers.hasCitations.noul >= 0.8 &&
      answers.accuracyScore.score >= 2;

    const metrics = {
      hasCitationsProbability: answers.hasCitations.noul,
      accuracyScore: answers.accuracyScore.score,
      attempt: input.attempt,
    };

    return passed
      ? JudgeVerdict.passed({ metrics })
      : JudgeVerdict.failed({
          reason: "Cite the exact [source] for every claim and directly answer the user's question.",
          metrics,
        });
  }
}

@Agent({
  name: "policy-advisor-agent",
  description: "Answers policy questions verified by GroundedCitationJudge",
  model: "moonshotai/kimi-k2.6",
  prompt: "Answer using handbook_rag and cite [source] on every claim.",
  rag: [{ use: HandbookRag, mode: RagMode.Tool }],
  output: PolicyAnswerDto,
  judges: [GroundedCitationJudge],
  maxRetries: 2,
})
export class PolicyAdvisorAgent {}
```

```ts title="test/grounded-citation.judge.test.ts" file=test/grounded-citation.judge.test.ts
import { expect, it } from "vitest";
import { decideWith, testJudge } from "agboss/testing";
import { GroundedCitationJudge, PolicyAnswerDto } from "../src/judges/grounded-citation.judge.js";

it("fails an uncited reply and returns actionable retry reason", async () => {
  const runJudge = testJudge(GroundedCitationJudge, {
    model: decideWith({
      hasCitations: "no",
      accuracyScore: 4,
    }),
  });

  const { output } = await runJudge({
    variant: PolicyAnswerDto,
    task: "What is our parental leave policy?",
    reply: { answer: "Employees receive 16 weeks of paid leave.", citations: [] },
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
| `name` | `string` | **Yes** | Unique kebab-case identifier ending with `-judge` (class name ending with `Judge`, `[name.kind-suffix]`); keys profile overrides (`judges.<name>`) and cost attribution (`judge:<name>`). |
| `decidedBy` | `DecidedBy.Model \| DecidedBy.Code` | No | Execution mode (defaults to `DecidedBy.Model`). With `DecidedBy.Code`, `model` is forbidden and the judge runs deterministically at `$0.00` cost. |
| `model` | `string` | For `DecidedBy.Model` | Model used by the judge (`[judge.no-model]` if omitted on `DecidedBy.Model`): a decision model (`"typesafe/jev-1.13"`, called via `judgeModel.decide()`) or a chat model (`judgeModel.invoke()`). Checked by `[judge.same-model-family]`. |
| `reply` | `DtoClass \| OneOfWrapper \| ListWrapper` | **Yes** | The DTO shape the judge inspects (`PolicyAnswerDto`, `oneOf(A, B)`, `listOf(Dto)`, or `PlainTextDto` for text agents). Must match the `@Agent`'s `output` shape (`[judge.wrong-reply]`). |
| `description` | `string` | No | Human-readable summary of what quality criteria this judge enforces. |
| `deps` | `readonly Token[]` | No | Constructor dependencies (`JudgeModel`, `ExecutionContext`, `@Injectable` services) verified at compile time. |

## What related entities work with `@Judge`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `JudgeHandler<TReply>` | `"agboss"` | Interface implemented by every `@Judge` class (`judge(input: JudgeInput<TReply>): Promise<JudgeVerdict> \| JudgeVerdict`). |
| `JudgeInput<TReply>` | `"agboss"` | Typed input passed to `judge()`: `{ reply: TReply, variant: DtoClass<TReply>, task: string, attempt: number, toolCalls: readonly ToolCallRecord[] }` (use `isVariant(input, VariantDto)` when `reply: oneOf(A, B)`). |
| `toolCallsOf(ToolClass, input.toolCalls)` | `"agboss"` | Filters `input.toolCalls` to calls of `ToolClass` with `input` and `output` narrowed to that tool's DTO types. |
| `JudgeVerdict` (`passed()`, `failed({ reason })`) | `"agboss"` | Branded builders for pass/fail verdicts (`{ passed: true, metrics? }` or `{ passed: false, reason, metrics? }`). |
| `JudgeModel` | `"agboss"` | Injected via `deps: [JudgeModel]` on `DecidedBy.Model` judges; provides `judgeModel.decide({ state, questions })` for decision models and `judgeModel.invoke(messages)` for chat models, with automatic FinOps cost tracking under `judge:<name>`. |
| `Decision` (`choice`, `noul`, `score`) | `"agboss"` | Builders for typed multi-question evaluation requests sent to `judgeModel.decide()`. |
| `testJudge(JudgeClass, options?)` | `"agboss/testing"` | Isolated unit runner that tests a `@Judge` class offline with scripted `decideWith` / `replyWith` turns or `DecidedBy.Code` logic. |
