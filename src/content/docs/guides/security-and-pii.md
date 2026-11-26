---
title: Security, Guardrails & PII Policies
description: "Protect prompts, tool calls, and logs in AGBoss using @PiiPolicy HMAC tokenization, @InputGuardrail, @OutputGuardrail, and @ToolInterceptor policies."
---

When enterprise workflows process customer tickets, financial records, or medical notes, personal data and credentials must never leak into external LLM prompts or observability logs. AGBoss provides three defense-in-depth mechanisms: [`@PiiPolicy`](/reference/pii-policy/) for declarative or custom PII masking and reversible pseudonymization at the model boundary, [`@InputGuardrail` and `@OutputGuardrail`](/reference/guardrail/) for pre-model and post-model safety enforcement, and `secret()` for environment credential masking.

## How `@PiiPolicy` masks and reveals personal data at the model boundary (without breaking KV caches)

A `@PiiPolicy` class can declare built-in `rules` written on the kind — `PiiKind.Email.tokenize()`, `PiiGroup.Contact.mask()`, `PiiKind.CardNumber.block()` — or have a `findMatches(text)` method for custom project detectors. There are three actions: `mask()` / `mask({ keepLast })`, `tokenize()` and `block(refusal?)`. Masking happens at the model boundary: models only see masked tokens, while `tokenize()` computes a **deterministic HMAC pseudonym** under the policy's `secret` (or the storage's `piiSecret`) so the exact same email or badge ID maps to the exact same token across every turn and step — preserving multi-turn LLM KV prefix cache hits while restoring real values before tools, actions, and finishes run:

```ts title="src/policies/customer.pii-policy.ts" file=src/policies/customer.pii-policy.ts
import { ExecutionContext, Injectable, InputGuardrail, OutputGuardrail, PiiAction, PiiGroup, PiiKind, PiiPolicy, secret, type GuardrailContent, type PiiMatch, inline } from "@agboss/core";
import { Enum, Text } from "@agboss/core/dto";

// 1. Declarative PII policy with reversible token replacement and card blocking
@PiiPolicy({
  name: "customer-pii-policy",
  description: "Contact details hidden, cards refused, names found by a model",
  rules: [
    PiiGroup.Contact.mask(),
    PiiKind.Email.tokenize(),
    PiiKind.PersonName.mask(),
    PiiKind.CardNumber.block(),
  ],
  model: "moonshotai/kimi-k2.6", // finds names with a model; modelProvider names its provider
  secret: secret("PII_PSEUDONYM_KEY"), // the key of tokenize(); previousSecret rotates it
})
export class CustomerPiiPolicy {
  refusal(kind: PiiKind): string {
    return `Please do not send a ${kind.id} here.`;
  }
}

@Injectable()
export class EmployeeDirectory {
  readonly ids: readonly string[] = ["EMP-42"];
}

// 2. Custom project detector with a findMatches(text) method
@PiiPolicy({
  name: "employee-id-pii-policy",
  action: PiiAction.mask(), // or PiiAction.tokenize() with a policy that has a secret
  deps: [EmployeeDirectory],
})
export class EmployeeIdPiiPolicy {
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
    sensitive: PiiAction.mask({ keepLast: 4 }),
  })
  account!: string;
}

// 4. Input and output guardrails (model guardrails here, a code guardrail below)
export class ClinicExecutionContext extends ExecutionContext {
  @Enum(["en", "he"])
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
  prompt: inline("Does the message ask for legal advice?"),
  model: "typesafe/jev-1.13",
  threshold: 0.8,
  deps: [ClinicExecutionContext, RefusalTextService],
})
export class LegalAdviceGuardrail {
  constructor(
    private readonly clinicExecutionContext: ClinicExecutionContext,
    private readonly refusalTextService: RefusalTextService,
  ) {}

  refusal(_content: GuardrailContent): Promise<string> {
    return this.refusalTextService.legalAdvice(this.clinicExecutionContext.locale);
  }
}

@OutputGuardrail({
  name: "no-legal-advice-guardrail",
  description: "Blocks answers that give legal advice",
  prompt: inline("Does the answer give legal advice?"),
  threshold: 0.8,
  refusal: "I can't give legal advice. Please contact a lawyer.",
})
export class NoLegalAdviceGuardrail {}
```

```ts title="test/customer.pii-policy.test.ts" file=test/customer.pii-policy.test.ts
import { expect, it } from "vitest";
import { testUnit } from "@agboss/core/testing";
import { EmployeeIdPiiPolicy } from "../src/policies/customer.pii-policy.js";

it("redacts EMP-42 employee badges before model calls and restores them on reveal", async () => {
  const pii = testUnit([EmployeeIdPiiPolicy]);
  const { output: masked } = await pii.mask("Badge EMP-42 requested access.");
  expect(masked).not.toContain("EMP-42");
  expect(pii.reveal(masked)).toBe("Badge EMP-42 requested access.");
});
```

## Deterministic Code Guardrails (`check(content)`)

When a safety rule is deterministic — such as a tenant-specific blocklist from a database, a regex/checksum check, or an external moderation microservice — set no `prompt` or `model` on [`@InputGuardrail` or `@OutputGuardrail`](/reference/guardrail/) and give the class one `check(content)` method. Code guardrails receive the PII-masked content (`content.text`, and the files), support full DI (`deps: [...]`), emit `GuardrailStartEvent` / `GuardrailEndEvent` with `$0.00` cost, and require no LLM call:

```ts title="src/policies/tenant-blocklist.guardrail.ts" file=src/policies/tenant-blocklist.guardrail.ts
import {
  GuardrailVerdict,
  Injectable,
  OutputGuardrail,
  TenantContext,
  type GuardrailContent,
} from "@agboss/core";
import { Enum } from "@agboss/core/dto";

export class ShopTenantContext extends TenantContext {
  @Enum(["toys", "tools"])
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
  deps: [ShopTenantContext, BlocklistService],
})
export class TenantBlocklistGuardrail {
  constructor(
    private readonly tenant: ShopTenantContext,
    private readonly blocklist: BlocklistService,
  ) {}

  async check(content: GuardrailContent): Promise<GuardrailVerdict> {
    const hasForbidden = await this.blocklist.containsBlockedTerms(this.tenant.shop, content.text);
    return hasForbidden
      ? GuardrailVerdict.blocked("The response contained restricted terms.")
      : GuardrailVerdict.passed();
  }
}
```

```ts title="test/tenant-blocklist.guardrail.test.ts" file=test/tenant-blocklist.guardrail.test.ts
import { expect, it } from "vitest";
import { testUnit } from "@agboss/core/testing";
import {
  ShopTenantContext,
  TenantBlocklistGuardrail,
} from "../src/policies/tenant-blocklist.guardrail.js";

it("blocks restricted tenant terms deterministically without a model stub", async () => {
  const check = testUnit(TenantBlocklistGuardrail, {
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
- **A child workflow is masked by its chain.** A child is masked by the union of the application's, the root's, every ancestor's and its own policy lists, at its models and in everything observed of it; where a child's agent must see a value, `excludePiiPolicies: [ParentPolicy]` on that agent or router (observability stays masked). Two rules of one kind that differ along a way are `[pii.conflicting-rules]` at assembly; `agboss describe` shows each way's effective sets under `pii chains`.
- **Cross-instance token consistency:** The key of a `tokenize()` rule is the policy's `secret`, else the storage's `@DatabaseStorage({ piiSecret })` — a `secret(…)` reference from the environment, so every replica generates identical HMAC tokens for logs and traces; a token with no key fails the start (`[pii.secret-required]`). Every use of the key has a key of its own, derived by HKDF-SHA256, and `previousSecret` / `previousPiiSecret` rotate it: a value a thread already holds a token for keeps it, a new value gets one under the new key, and every old token still reveals.
- **Unit testing with `testUnit`:** Validate `mask(text)` and `reveal(text)` offline with `testUnit([CustomerPiiPolicy])` and verify both model and code guardrails with `testUnit(TenantBlocklistGuardrail)` from `@agboss/core/testing`.
- **Standalone executable proof:** Inspect **[`03-support-refund-desk`](https://github.com/agbossjs/agboss-examples/tree/main/03-support-refund-desk)** in [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples) for end-to-end HMAC token roundtrips (`<email:d1ac5c>` $\to$ `revealPii: true` in `IssueRefundTool`), `PiiError.Refused` boundary refusal, `@ToolInterceptor` policy enforcement, and code and model guardrails (see [7 Verified Examples](/examples/verified-examples/)).
