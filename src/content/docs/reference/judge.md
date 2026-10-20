---
title: "@Judge"
description: Complete API reference for the @Judge decorator in AGBoss — quality gates on @Agent replies, JudgeHandler, JudgeModel, Decision questions, and testJudge().
---

The `@Judge` decorator defines an independent quality gate (`judges/*.judge.ts`) attached to an `@Agent` via `@Agent({ judges: [MyJudge], maxRetries: 2 })`. Every time the agent produces a reply, its judges inspect `{ reply, task, attempt }` and return a `JudgeVerdict`. If a judge returns `{ passed: false, feedback }`, AGBoss feeds `feedback` back into the agent and re-runs the turn up to `maxRetries` times before letting the answer leave the node.

## What options does `@Judge` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier in the workflow; keys profile overrides (`judges.<name>`) and cost attribution (`judge:<name>`). |
| `model` | `string` | Yes | Model used by the judge (`"typesafe/jev-1.13"` for fast structured decisions via `judgeModel.decide()`, or a chat model via `judgeModel.invoke()`). |
| `description` | `string` | No | Human-readable summary of what quality criteria this judge enforces. |
| `deps` | `readonly Token[]` | No | Constructor dependencies (`JudgeModel`, `ExecutionContext`, `@Injectable` services) verified at compile time. |

## Complete `@Judge` example with `JudgeModel` and `Decision`

```ts title="src/judges/grounded-citation.judge.ts" no-check: reference example
import { Decision, ExecutionContext, Judge, JudgeModel, type JudgeHandler, type JudgeInput, type JudgeVerdict } from "agboss";

@Judge({
  name: "grounded-citation-judge",
  description: "Verifies that every factual claim cites a retrieved [source] and answers the user's question",
  model: "typesafe/jev-1.13",
  deps: [JudgeModel, ExecutionContext],
})
export class GroundedCitationJudge implements JudgeHandler {
  constructor(
    private readonly judgeModel: JudgeModel,
    private readonly executionContext: ExecutionContext,
  ) {}

  async judge(input: JudgeInput): Promise<JudgeVerdict> {
    const answers = await this.judgeModel.decide({
      context: `Task:\n${input.task}\n\nAgent Reply (attempt ${String(input.attempt)}):\n${input.reply}`,
      questions: {
        hasCitations: Decision.noul("Does every factual claim cite a [source] identifier?"),
        accuracyScore: Decision.score("Rate how directly the reply answers the task from 0 to 10"),
      },
    });

    const passed = answers.hasCitations.answer === "yes" && answers.accuracyScore.score >= 7;
    return {
      passed,
      ...(passed
        ? {}
        : {
            feedback: "Cite the exact [source] for every claim and directly answer the user's question.",
          }),
      metrics: {
        hasCitations: answers.hasCitations.answer === "yes",
        accuracyScore: answers.accuracyScore.score,
        attempt: input.attempt,
      },
    };
  }
}
```

```ts title="src/agents/policy-advisor.agent.ts" no-check: reference example
import { Agent, RagMode } from "agboss";
import { GroundedCitationJudge } from "../judges/grounded-citation.judge.js";
import { HandbookRag } from "../rag/handbook.rag.js";

@Agent({
  name: "policy-advisor-agent",
  description: "Answers policy questions verified by GroundedCitationJudge",
  model: "moonshotai/kimi-k2.6",
  prompt: "Answer using HandbookRag and cite [source] on every claim.",
  rag: [{ use: HandbookRag, mode: RagMode.Tool }],
  judges: [GroundedCitationJudge],
  maxRetries: 2,
})
export class PolicyAdvisorAgent {}
```

## What related entities work with `@Judge`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `JudgeHandler` | `"agboss"` | Interface implemented by every `@Judge` class (`judge(input: JudgeInput): Promise<JudgeVerdict>`). |
| `JudgeInput` | `"agboss"` | Input passed to `judge()`: `{ reply: string, task: string, attempt: number }`. |
| `JudgeVerdict` | `"agboss"` | Return shape of `judge()`: `{ passed: boolean, feedback?: string, metrics?: Record<string, number \| string \| boolean> }`. |
| `JudgeModel` | `"agboss"` | Injected via `deps: [JudgeModel]`; provides `judgeModel.decide({ context, questions })` for decision models and `judgeModel.invoke(messages)` for chat models, with automatic FinOps cost tracking under `judge:<name>`. |
| `Decision` (`choice`, `noul`, `score`) | `"agboss"` | Builders for typed multi-question evaluation requests sent to `judgeModel.decide()`. |
| `testJudge(JudgeClass, options?)` | `"agboss/testing"` | Isolated unit runner that tests a `@Judge` class offline with scripted `JudgeModel` decisions or replies. |

### Unit-testing a `@Judge` in isolation with `testJudge`

```ts title="test/grounded-citation.judge.test.ts" no-check: reference example
import { expect, it } from "vitest";
import { decideWith, testJudge } from "agboss/testing";
import { GroundedCitationJudge } from "./grounded-citation.judge.js";

it("fails an uncited reply and returns actionable retry feedback", async () => {
  const runJudge = testJudge(GroundedCitationJudge, {
    decision: decideWith({
      hasCitations: { answer: "no" },
      accuracyScore: { score: 4 },
    }),
  });

  const verdict = await runJudge({
    task: "What is our parental leave policy?",
    reply: "Employees receive 16 weeks of paid leave.",
    attempt: 0,
  });

  expect(verdict.passed).toBe(false);
  expect(verdict.feedback).toContain("[source]");
});
```

```ts title="src/dto/policy-answer.dto.ts" no-check: reference example
import { ListOf, Text } from "agboss/dto";

export class PolicyAnswerDto {
  @Text({ prompt: "Policy answer with [source] citations" })
  answer!: string;

  @ListOf(Text)
  citations!: string[];
}
```
