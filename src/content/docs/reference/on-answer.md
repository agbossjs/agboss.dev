---
title: "@OnAnswer"
description: Complete API reference for the @OnAnswer method decorator in AGBoss — scoring individual parallel branch outputs inside a DecidedBy.Code @Arbiter.
---

The `@OnAnswer` method decorator marks the per-branch evaluation hook inside a `DecidedBy.Code` [`@Arbiter`](/reference/arbiter/) class (`arbiters/*.arbiter.ts`). During a `.joinQuorum()` or `.joinQuorumGroups()` step, AGBoss invokes the `@OnAnswer()` method as each parallel branch finishes so your arbiter can accept or reject individual branch answers in real time and short-circuit the quorum as soon as consensus is reached.

## How `@OnAnswer` works inside `@Arbiter`

| Signature Part | Type | Description |
| :--- | :--- | :--- |
| `@OnAnswer()` | Method decorator | Marks the method on a `DecidedBy.Code` `@Arbiter` class that evaluates each branch's output DTO. |
| `answer` parameter | `ArbiterAnswerOf<Self>` | Contains `{ value: Dto, branch: ComponentClass, group?: string }` for the branch that just completed. |
| Return value | `AnswerJudgement \| Promise<AnswerJudgement>` | Returns `{ accepted: true, reason? }` to count toward quorum or `{ accepted: false, reason }` to reject the branch. |

## Complete `@OnAnswer` example

```ts title="src/arbiters/margin-threshold.arbiter.ts" no-check: reference example
import { Arbiter, DecidedBy, ExecutionContext, OnAnswer, type AnswerJudgement, type ArbiterAnswerOf } from "agboss";
import { PricingQuoteDto } from "../dto/pricing.dto.js";
import { MarginPolicyService } from "../services/margin-policy.service.js";

@Arbiter({
  name: "margin-threshold-arbiter",
  description: "Accepts pricing quotes that meet the minimum gross margin threshold",
  decidedBy: DecidedBy.Code,
  deps: [ExecutionContext, MarginPolicyService],
})
export class MarginThresholdArbiter {
  constructor(
    private readonly ctx: ExecutionContext,
    private readonly policy: MarginPolicyService,
  ) {}

  @OnAnswer()
  evaluateQuote(answer: ArbiterAnswerOf<MarginThresholdArbiter, PricingQuoteDto>): AnswerJudgement {
    const minMargin = this.policy.minMarginForTenant(this.ctx.tenant.tenantId);
    if (answer.value.marginPercent >= minMargin) {
      return {
        accepted: true,
        reason: `Margin ${answer.value.marginPercent}% meets floor (${minMargin}%)`,
      };
    }
    return {
      accepted: false,
      reason: `Margin ${answer.value.marginPercent}% is below floor (${minMargin}%)`,
    };
  }
}
```

```ts title="src/dto/pricing.dto.ts" no-check: reference example
import { Integer, Text } from "agboss/dto";

export class PricingQuoteDto {
  @Text()
  tierName!: string;

  @Integer({ minimum: 0, maximum: 50 })
  marginPercent!: number;
}
```

```ts title="test/margin-threshold.arbiter.test.ts" no-check: reference example
import { expect, it } from "vitest";
import { testArbiter } from "agboss/testing";
import { MarginThresholdArbiter } from "../src/arbiters/margin-threshold.arbiter.js";

it("accepts quotes meeting the margin threshold via @OnAnswer", async () => {
  const res = await testArbiter(MarginThresholdArbiter, {
    value: { tierName: "Enterprise", marginPercent: 42 },
  });
  expect(res.accepted).toBe(true);
});
```
