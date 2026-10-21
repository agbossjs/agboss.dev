---
title: Security, Guardrails & PII Policies
description: Protect prompts, tool calls, and logs in AGBoss using @PiiPolicy rules, reversible replaceWithToken() pseudonymization, @Guardrail, and secret() masking.
---

When enterprise workflows process customer tickets, financial records, or medical notes, personal data and credentials must never leak into external LLM prompts or observability logs. AGBoss provides three defense-in-depth mechanisms: `@PiiPolicy` for declarative or custom PII masking and reversible pseudonymization at the model boundary, `@Guardrail` for tool/answer boundary hooks, and `secret()` for environment credential masking.

## How `@PiiPolicy` masks and reveals personal data at the model boundary

A `@PiiPolicy` class (whose `name` must end with `-pii-policy`) can declare built-in `rules: [pii(Kind | Group, Action)]` or implement `PiiPolicyHandler.findMatches(text)` for custom project detectors. Masking happens at the model boundary: models only see masked tokens (such as `<email:7f3a91>`), while `PiiAction.replaceWithToken()` uses an HMAC with `pseudonymKey` so tools, actions, and finishes receive the restored real values:

```ts title="src/policies/customer.pii-policy.ts"
import { Guardrail, Injectable, PiiAction, PiiGroup, PiiKind, PiiPolicy, pii, secret, type PiiMatch, type PiiPolicyHandler, type PiiRefusal } from "agboss";
import { Text } from "agboss/dto";

// 1. Declarative PII policy with reversible token replacement and card blocking
@PiiPolicy({
  name: "customer-pii-policy",
  description: "Contact details hidden, cards refused, names found by a model",
  rules: [
    pii(PiiGroup.Contact, PiiAction.replaceWithKind()),
    pii(PiiKind.Email, PiiAction.replaceWithToken()),
    pii(PiiKind.PersonName, PiiAction.replaceWithKind()),
    pii(PiiKind.CardNumber, PiiAction.blockWithRefusal()),
  ],
  detectWithModel: "moonshotai/kimi-k2.6",
  pseudonymKey: secret("PII_PSEUDONYM_KEY"),
})
export class CustomerPiiPolicy implements PiiRefusal {
  refusal(kind: PiiKind): string {
    return `Please do not send a ${kind} here.`;
  }
}

@Injectable()
export class EmployeeDirectory {
  readonly ids: readonly string[] = ["EMP-42"];
}

// 2. Custom project detector implementing PiiPolicyHandler.findMatches(text)
@PiiPolicy({
  name: "employee-id-pii-policy",
  action: PiiAction.replaceWithToken(),
  deps: [EmployeeDirectory],
})
export class EmployeeIdPiiPolicy implements PiiPolicyHandler {
  constructor(private readonly employeeDirectory: EmployeeDirectory) {}

  findMatches(text: string): readonly PiiMatch[] {
    return this.employeeDirectory.ids.flatMap((id) => {
      const start = text.indexOf(id);
      return start < 0 ? [] : [{ start, end: start + id.length }];
    });
  }
}

// 3. Field-level sensitive masking on DTO properties
export class TicketDto {
  @Text({
    prompt: "the customer's account",
    sensitive: PiiAction.replacePart({ keepLast: 4 }),
  })
  account!: string;
}

// 4. Code guardrail around agent answers and tool calls
type AnswerContext = Parameters<NonNullable<Guardrail["beforeAgentAnswer"]>>[0];

@Guardrail({ name: "no-internal-urls" })
export class NoInternalUrlsGuardrail implements Guardrail {
  beforeAgentAnswer(ctx: AnswerContext): Promise<void> {
    if ((ctx.replyWith ?? "").includes(".internal.corp")) {
      return Promise.reject(
        new Error(`${ctx.agent} tried to expose an internal hostname`),
      );
    }
    return Promise.resolve();
  }
}
```

```ts title="test/customer.pii-policy.test.ts" no-check: context tab
import { expect, it } from "vitest";
import { testPii } from "agboss/testing";
import { EmployeeIdPiiPolicy } from "../src/policies/customer.pii-policy.js";

it("redacts EMP-XXXXXX employee badges before model calls", async () => {
  const pii = testPii(EmployeeIdPiiPolicy);
  const res = await pii.scan("Badge EMP-482910 requested access.");
  expect(res.matches).toHaveLength(1);
});
```

## How PII inheritance and unit testing work

- **Hierarchical policy lists (`piiPolicies` & `excludePiiPolicies`):** Policies listed on `@Application`, `@Workflow`, `@Agent`, and `@Router` add up automatically. An agent can opt out of an inherited policy for its own model calls via `excludePiiPolicies`, while logs, traces, and `result.record` remain masked by the application and workflow policies.
- **Cross-instance token consistency:** Set `@Application({ pseudonymKey: "piiPseudonymKey" })` pointing to a `Secret` field in your environment contract so every replica generates identical HMAC tokens for logs and traces.
- **Unit testing with `testPii` and `testGuardrail`:** Validate `mask(text)` and `reveal(text)` offline with `testPii([CustomerPiiPolicy])` and verify guardrail hooks with `testGuardrail(NoInternalUrlsGuardrail)` from `agboss/testing`.
