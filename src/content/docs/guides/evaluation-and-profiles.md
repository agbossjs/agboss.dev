---
title: Profiles, Golden Sets & Evaluation
description: Compare models, prompts, and router settings side by side without code changes using YAML profile overlays, golden datasets, and agboss compare.
---

Changing an agent's model, temperature, or tool-call ceiling in production should be driven by measurable accuracy and cost data rather than guesswork. AGBoss supports declarative YAML profile overlays (`profiles/<workflow-name>/<profile>.yaml`) that override component settings at runtime and can be benchmarked side by side against golden test datasets using `npx agboss compare`.

## How YAML profile overlays work

A profile YAML file sits under `profiles/<workflow-name>/` and overrides models, temperatures, or `maxToolCalls` for specific agents, routers, or workflow defaults while keeping the underlying `@Workflow` TypeScript graph identical:

```yaml title="profiles/job-scout-workflow/scout-low-thinking.yaml"
# profiles/job-scout-workflow/scout-low-thinking.yaml
profile: scout-low-thinking
version: 1.0.0-low-thinking
agents:
  scout-agent:
    model: moonshotai/kimi-k2.6
    maxToolCalls: 4
defaults:
  models:
    temperature: 0
  router:
    model: typesafe/jev-1.13
```

```ts title="src/judges/answer-grounded.judge.ts" no-check: context tab
import { Decision, Judge, JudgeModel, JudgeVerdict, type JudgeHandler, type JudgeInput } from "agboss";
import { OpeningsDto } from "../dto/openings.dto.js";

@Judge({
  name: "answer-grounded-judge",
  description: "Verifies that every listed role comes from a tool call",
  model: "typesafe/jev-1.13",
  reply: OpeningsDto,
  deps: [JudgeModel],
})
export class AnswerGroundedJudge implements JudgeHandler<OpeningsDto> {
  constructor(private readonly judgeModel: JudgeModel) {}
  async judge(input: JudgeInput<OpeningsDto>): Promise<JudgeVerdict> {
    const res = await this.judgeModel.decide({
      context: input.reply.openings,
      questions: { grounded: Decision.noul("Are all openings grounded in tool outputs?") },
    });
    return res.grounded.answer === "yes"
      ? JudgeVerdict.passed()
      : JudgeVerdict.failed({ reason: "Unverified job listing" });
  }
}
```

## How the 3-tier test and evaluation split works

AGBoss separates fast, deterministic CI checks from live model benchmarking so your test suite never depends on external network calls or API keys:

| Tier | Command / Runner | Network & Cost | Purpose |
| :--- | :--- | :--- | :--- |
| **1. Offline Unit & Workflow Tests** | `npm test` (`testWith`, `testTool`, `testJudge`, …) | Zero network (`VirtualClock`, $0.00) | Verifies graph paths, review loops, error handlers, PII policies, budgets, and multi-instance leases on every commit |
| **2. Golden Set Profile Comparison** | `npx agboss compare --workflow src/job-scout.workflow.ts` | Recorded VCR cassettes or live models | Compares two or more YAML profiles side by side on quality, latency, and USD cost across a golden dataset |
| **3. Live Provider Smoke Check** | `npx agboss check --models --workflow src/job-scout.workflow.ts` | Read-only model catalogue check | Verifies that every model identifier in `@Workflow` and `profiles/` is served by its `@ModelProvider` |

## How to run profile comparisons from the CLI

1. **Validate profile model coverage:** Run `npx agboss check --models --workflow src/job-scout.workflow.ts` to ensure every model referenced in your YAML profiles matches a registered `@ModelProvider`.
2. **Run a side-by-side comparison:** Run `npx agboss compare --workflow src/job-scout.workflow.ts --profiles base,scout-low-thinking` to execute both profiles against your golden cases and print a diff table of pass rates, step counts, and total USD spend.
