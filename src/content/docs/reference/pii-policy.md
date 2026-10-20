---
title: "@PiiPolicy"
description: Complete API reference for the @PiiPolicy decorator in AGBoss — declarative pii() rules, reversible replaceWithToken() pseudonymization, custom PiiPolicyHandler detectors, and testPii().
---

The `@PiiPolicy` decorator (`policies/*.pii-policy.ts`) defines personal-data protection rules applied at the LLM and tool boundaries as well as across structured logs and traces. `@PiiPolicy` supports two forms: **declarative policies** (mapping built-in `PiiKind` / `PiiGroup` targets to `PiiAction` transformations like reversible HMAC tokens `<email:7f3a91>`) and **custom detectors** implementing `PiiPolicyHandler.findMatches(text)`.

## What options does `@PiiPolicy` accept?

Every `@PiiPolicy` class name ends with `PiiPolicy` and its `name` option ends with `-pii-policy`:

| Option | Applies To | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | Both | `string` | Yes | Unique kebab-case identifier ending with `-pii-policy` (e.g., `"customer-pii-policy"`). |
| `description` | Declarative | `string` | Yes | Explains which PII categories this policy governs. |
| `rules` | Declarative | `readonly [PiiRule, ...]` | Yes | Non-empty list of `pii(PiiKind \| PiiGroup, PiiAction.*)` rules; specific `PiiKind` rules override broader `PiiGroup` rules. |
| `detectWithModel` | Declarative | `string` | No | Chat model used to detect unstructured PII (such as person names and street addresses) in free text. |
| `pseudonymKey` | Declarative | `Secret` | No | `secret("PII_PSEUDONYM_KEY")` used for `PiiAction.replaceWithToken()`; falls back to `@Application({ pseudonymKey })`. |
| `action` | Custom Detector | `MaskingPiiAction` | Yes | `PiiAction.replaceWithToken()`, `replaceWithKind()`, or `replacePart()` applied to every `[start, end)` match returned by `findMatches()`. |
| `deps` | Both | `readonly Token[]` | No | Constructor dependencies injected into a `PiiRefusal` or `PiiPolicyHandler` class. |

## Complete `@PiiPolicy` examples (declarative and custom detector)

```ts title="src/policies/customer.pii-policy.ts" no-check: reference example
import { ExecutionContext, PiiAction, PiiGroup, PiiKind, PiiPolicy, pii, secret, type PiiMatch, type PiiPolicyHandler, type PiiRefusal } from "agboss";

// 1. Declarative @PiiPolicy with reversible token masking and custom refusal message:
@PiiPolicy({
  name: "customer-contact-pii-policy",
  description: "Pseudonymizes emails and phones with reversible tokens and blocks payment card numbers",
  rules: [
    pii(PiiKind.Email, PiiAction.replaceWithToken()),
    pii(PiiKind.PhoneNumber, PiiAction.replacePart({ keepLast: 2, maskWith: "*" })),
    pii(PiiKind.PaymentCard, PiiAction.blockWithRefusal()),
    pii(PiiGroup.GovernmentId, PiiAction.replaceWithKind()),
  ],
  detectWithModel: "moonshotai/kimi-k2.6",
  pseudonymKey: secret("PII_PSEUDONYM_KEY"),
  deps: [ExecutionContext],
})
export class CustomerContactPiiPolicy implements PiiRefusal {
  constructor(private readonly executionContext: ExecutionContext) {}

  refusal(kind: PiiKind): string {
    return `For your security, please do not send a ${kind} in chat (ref: ${this.executionContext.executionId}).`;
  }
}

// 2. Custom detector @PiiPolicy implementing PiiPolicyHandler:
@PiiPolicy({
  name: "employee-badge-pii-policy",
  action: PiiAction.replaceWithToken(),
})
export class EmployeeBadgePiiPolicy implements PiiPolicyHandler {
  findMatches(text: string): readonly PiiMatch[] {
    const matches: PiiMatch[] = [];
    for (const match of text.matchAll(/\bEMP-\d{6}\b/g)) {
      if (match.index !== undefined) {
        matches.push({ start: match.index, end: match.index + match[0].length });
      }
    }
    return matches;
  }
}
```

```ts title="src/support.application.ts" no-check: reference example
import { Application } from "agboss";
import { CustomerPrivacyPiiPolicy, EmployeeBadgePiiPolicy } from "./policies/customer.pii-policy.js";
import { SupportWorkflow } from "./workflows/support.workflow.js";

@Application({
  name: "support-application",
  version: "1.0.0",
  workflows: [SupportWorkflow],
  piiPolicies: [CustomerPrivacyPiiPolicy, EmployeeBadgePiiPolicy],
})
export class SupportApplication {}
```

## What related entities work with `@PiiPolicy`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `pii(target, action)` | `"agboss"` | Binds a `PiiKind` or `PiiGroup` to a `PiiAction` inside `@PiiPolicy({ rules })`. |
| `PiiKind` & `PiiGroup` | `"agboss"` | Built-in PII categories (`Email`, `PhoneNumber`, `PaymentCard`, `Iban`, `IpAddress`, `PersonName`, `StreetAddress`, `GovernmentId`, `Financial`, `Contact`). |
| `PiiAction` | `"agboss"` | Action factories: `replaceWithToken()` (reversible HMAC `<email:7f3a91>` restored on tool calls), `replaceWithKind()`, `replacePart({ keepLast, keepDomain })`, and `blockWithRefusal()`. |
| `PiiPolicyHandler` & `PiiRefusal` | `"agboss"` | Interfaces implemented by custom range detectors (`findMatches(text)`) and localized refusal builders (`refusal(kind)`). |
| `testPii(PolicyClass, options?)` | `"agboss/testing"` | Isolated unit runner that tests masking, reversible token restoration, and refusal triggers offline. |

### Unit-testing a `@PiiPolicy` with `testPii`

```ts title="test/employee-badge.pii-policy.test.ts" no-check: reference example
import { expect, it } from "vitest";
import { testPii } from "agboss/testing";
import { EmployeeBadgePiiPolicy } from "./employee-badge.pii-policy.js";

it("pseudonymizes employee badge numbers and restores them for tools", async () => {
  const runPii = testPii(EmployeeBadgePiiPolicy);

  const masked = await runPii.mask("Assign ticket to EMP-482910 immediately.");
  expect(masked.text).not.toContain("EMP-482910");
  expect(masked. unmaskedText(masked.text)).toBe("Assign ticket to EMP-482910 immediately.");
});
```

```ts title="src/tools/lookup-customer.tool.ts" no-check: reference example
import { Tool, type ToolHandler } from "agboss";
import { CustomerLookupDto, CustomerProfileDto } from "../dto/customer.dto.js";

@Tool({
  name: "lookup_customer",
  description: "Receives de-tokenized email automatically when invoked by the LLM",
  input: CustomerLookupDto,
  output: CustomerProfileDto,
})
export class LookupCustomerTool implements ToolHandler<CustomerLookupDto, CustomerProfileDto> {
  async run(input: CustomerLookupDto): Promise<CustomerProfileDto> {
    // input.email is transparently restored from <email:7f3a91> to the real address
    return { email: input.email, tier: "enterprise" };
  }
}
```
