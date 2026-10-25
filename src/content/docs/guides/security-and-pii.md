---
title: Security, Guardrails & PII Policies
description: Protect prompts, tool calls, and logs in AGBoss using @PiiPolicy rules, KV-cache-friendly HMAC replaceWithToken() pseudonymization, @InputGuardrail, @OutputGuardrail, and secret() masking.
---

When enterprise workflows process customer tickets, financial records, or medical notes, personal data and credentials must never leak into external LLM prompts or observability logs. AGBoss provides three defense-in-depth mechanisms: [`@PiiPolicy`](/reference/pii-policy/) for declarative or custom PII masking and reversible pseudonymization at the model boundary, [`@InputGuardrail` and `@OutputGuardrail`](/reference/guardrail/) for pre-model and post-model safety enforcement, and `secret()` for environment credential masking.

## How `@PiiPolicy` masks and reveals personal data at the model boundary (without breaking KV caches)

A `@PiiPolicy` class (whose `name` must end with `-pii-policy`) can declare built-in `rules: [pii(Kind | Group, Action)]` or implement `PiiPolicyHandler.findMatches(text)` for custom project detectors. Masking happens at the model boundary: models only see masked tokens, while `PiiAction.replaceWithToken()` computes a **deterministic HMAC pseudonym** with `pseudonymKey` so the exact same email or badge ID maps to the exact same token across every turn and step — preserving multi-turn LLM KV prefix cache hits while restoring real values before tools, actions, and finishes run:

```ts title="src/policies/customer.pii-policy.ts" file=src/policies/customer.pii-policy.ts
import { ExecutionContext, Injectable, InputGuardrail, OutputGuardrail, PiiAction, PiiGroup, PiiKind, PiiPolicy, pii, secret, type GuardrailRefusal, type PiiMatch, type PiiPolicyHandler, type PiiRefusal } from "agboss";
import { OneOf, Text } from "agboss/dto";

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

// 4. Input and output guardrails (DecidedBy.Model and DecidedBy.Code)
export class ClinicExecutionContext extends ExecutionContext {
  @OneOf({ values: ["en", "he"] })
  locale!: "en" | "he";
}

@Injectable()
export class RefusalTextService {
  legalAdvice(locale: "en" | "he"): Promise<string> {
    return Promise.resolve(locale === "he" ? "אין ייעוץ משפטי." : "No legal advice.");
  }
}

@InputGuardrail({
  name: "legal-advice-guardrail",
  description: "Blocks requests for legal advice",
  prompt: "Does the message ask for legal advice?",
  model: "typesafe/jev-1.13",
  threshold: 0.8,
  deps: [ClinicExecutionContext, RefusalTextService],
})
export class LegalAdviceGuardrail implements GuardrailRefusal {
  constructor(
    private readonly clinicExecutionContext: ClinicExecutionContext,
    private readonly refusalTextService: RefusalTextService,
  ) {}

  refusal(): Promise<string> {
    return this.refusalTextService.legalAdvice(this.clinicExecutionContext.locale);
  }
}

@OutputGuardrail({
  name: "no-legal-advice-guardrail",
  description: "Blocks answers that give legal advice",
  prompt: "Does the answer give legal advice?",
  threshold: 0.8,
  refusal: "I can't give legal advice. Please contact a lawyer.",
})
export class NoLegalAdviceGuardrail {}
```

```ts title="test/customer.pii-policy.test.ts" file=test/customer.pii-policy.test.ts
import { expect, it } from "vitest";
import { testPii } from "agboss/testing";
import { EmployeeIdPiiPolicy } from "../src/policies/customer.pii-policy.js";

it("redacts EMP-42 employee badges before model calls and restores them on reveal", async () => {
  const pii = testPii([EmployeeIdPiiPolicy]);
  const { output: masked } = await pii.mask("Badge EMP-42 requested access.");
  expect(masked).not.toContain("EMP-42");
  expect(pii.reveal(masked)).toBe("Badge EMP-42 requested access.");
});
```

## Deterministic Code Guardrails (`DecidedBy.Code`)

When a safety rule is deterministic — such as a tenant-specific blocklist from a database, a regex/checksum check, or an external moderation microservice — declare `decidedBy: DecidedBy.Code` on [`@InputGuardrail` or `@OutputGuardrail`](/reference/guardrail/) and implement `GuardrailHandler.check(text)`. Code guardrails receive the PII-masked text, support full DI (`deps: [...]`), emit `GuardrailStartEvent` / `GuardrailEndEvent` with `$0.00` cost, and require no LLM call:

```ts title="src/policies/tenant-blocklist.guardrail.ts" file=src/policies/tenant-blocklist.guardrail.ts
import {
  DecidedBy,
  GuardrailVerdict,
  Injectable,
  OutputGuardrail,
  TenantContext,
  type GuardrailHandler,
} from "agboss";
import { OneOf } from "agboss/dto";

export class ShopTenantContext extends TenantContext {
  @OneOf({ values: ["toys", "tools"] })
  shop!: "toys" | "tools";
}

@Injectable()
export class BlocklistService {
  containsBlockedTerms(shop: "toys" | "tools", text: string): Promise<boolean> {
    const blocked = shop === "toys" ? ["knife"] : ["toy"];
    return Promise.resolve(blocked.some((term) => text.toLowerCase().includes(term)));
  }
}

@OutputGuardrail({
  name: "tenant-blocklist-guardrail",
  description: "Blocks replies containing terms forbidden for the active tenant",
  decidedBy: DecidedBy.Code,
  refusal: "The response contained restricted terms.",
  deps: [ShopTenantContext, BlocklistService],
})
export class TenantBlocklistGuardrail implements GuardrailHandler {
  constructor(
    private readonly tenant: ShopTenantContext,
    private readonly blocklist: BlocklistService,
  ) {}

  async check(text: string): Promise<GuardrailVerdict> {
    const hasForbidden = await this.blocklist.containsBlockedTerms(this.tenant.shop, text);
    return hasForbidden ? GuardrailVerdict.blocked() : GuardrailVerdict.passed();
  }
}
```

```ts title="test/tenant-blocklist.guardrail.test.ts" file=test/tenant-blocklist.guardrail.test.ts
import { expect, it } from "vitest";
import { testGuardrail } from "agboss/testing";
import {
  ShopTenantContext,
  TenantBlocklistGuardrail,
} from "../src/policies/tenant-blocklist.guardrail.js";

it("blocks restricted tenant terms deterministically without a model stub", async () => {
  const check = testGuardrail(TenantBlocklistGuardrail, {
    tenantContext: ShopTenantContext,
    tenant: { tenantId: "t-1", shop: "toys" },
  });

  const blocked = await check("We recommend a pocket knife.");
  expect(blocked.output.isBlocked).toBe(true);
  expect(blocked.output.refusal).toBe("The response contained restricted terms.");
});
```

## How PII inheritance and unit testing work

- **Hierarchical policy lists (`piiPolicies` & `excludePiiPolicies`):** Policies listed on `@Application`, `@Workflow`, `@Agent`, and `@Router` add up automatically. An agent can opt out of an inherited policy for its own model calls via `excludePiiPolicies`, while logs, traces, and `result.record` remain masked by the application and workflow policies.
- **Cross-instance token consistency:** Set `@Application({ pseudonymKey: "piiPseudonymKey" })` pointing to a `Secret` field in your environment contract so every replica generates identical HMAC tokens for logs and traces.
- **Unit testing with `testPii` and `testGuardrail`:** Validate `mask(text)` and `reveal(text)` offline with `testPii([CustomerPiiPolicy])` and verify both `DecidedBy.Model` and `DecidedBy.Code` guardrails with `testGuardrail(TenantBlocklistGuardrail)` from `agboss/testing`.
- **Standalone executable proof:** Inspect **[`03-support-refund-desk`](https://github.com/agbossjs/agboss-examples/tree/main/03-support-refund-desk)** in [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples) for end-to-end HMAC token roundtrips (`<email:d1ac5c>` $\to$ `revealPii: true` in `IssueRefundTool`), `PiiRefusedError` boundary refusal, `@ToolInterceptor` policy enforcement, and `DecidedBy.Code` / `DecidedBy.Model` guardrails (see [7 Verified Examples](/examples/job-scout/)).
