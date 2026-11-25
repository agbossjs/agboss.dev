---
title: "@PiiPolicy"
description: Complete API reference for @PiiPolicy in AGBoss — rules written on a kind (mask, tokenize, block), reversible HMAC pseudonymization, custom handlers, and testUnit().
---

The `@PiiPolicy` decorator (`policies/*.pii-policy.ts`) defines personal-data protection rules applied at the LLM and tool boundaries as well as across structured logs and traces. `@PiiPolicy` supports two forms: **declarative policies** (rules written on a built-in `PiiKind` / `PiiGroup` target — `PiiKind.Email.tokenize()` — for transformations like reversible HMAC tokens `<email:7f3a91>`) and **custom detectors** implementing `PiiPolicyHandler.findMatches(text)`.

## Complete `@PiiPolicy` examples (declarative and custom detector)

```ts title="src/policies/customer.pii-policy.ts" file=src/policies/customer.pii-policy.ts
import {
  ExecutionContext,
  PiiAction,
  PiiGroup,
  PiiKind,
  PiiPolicy,
  secret,
  type PiiMatch,
} from "@agboss/core";

// 1. Declarative @PiiPolicy with reversible token masking and custom refusal message:
@PiiPolicy({
  name: "customer-contact-pii-policy",
  description: "Pseudonymizes emails and phones with reversible tokens and blocks payment card numbers",
  rules: [
    PiiKind.Email.tokenize(), // reversible HMAC token
    PiiKind.Phone.mask({ keepLast: 2 }),
    PiiKind.CardNumber.block(), // the class's refusal(kind) below, or block("…") with a text of its own
    PiiGroup.Government.mask(),
  ],
  model: "moonshotai/kimi-k2.6", // detects unstructured PII in free text; modelProvider names its provider
  secret: secret("PII_PSEUDONYM_KEY"), // the key of tokenize(); previousSecret is for rotation
  deps: [ExecutionContext],
})
export class CustomerContactPiiPolicy {
  constructor(private readonly executionContext: ExecutionContext) {}

  refusal(kind: PiiKind): string {
    return `For your security, please do not send a ${kind.id} in chat (ref: ${this.executionContext.executionId}).`;
  }
}

// 2. Custom detector @PiiPolicy implementing PiiPolicyHandler:
@PiiPolicy({
  name: "employee-badge-pii-policy",
  action: PiiAction.mask(), // or PiiAction.tokenize() with a policy that has a secret
})
export class EmployeeBadgePiiPolicy {
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

```ts title="src/tools/lookup-customer.tool.ts" file=src/tools/lookup-customer.tool.ts
import { Tool } from "@agboss/core";
import { Email, Text } from "@agboss/core/dto";

export class CustomerLookupDto {
  @Email({ prompt: "Customer email address" })
  email!: string;
}

export class CustomerProfileDto {
  @Email({ prompt: "Customer email address" })
  email!: string;

  @Text({ prompt: "Subscription tier" })
  tier!: string;
}

@Tool({
  name: "lookup_customer",
  description: "Receives de-tokenized email automatically when invoked by the LLM",
  input: CustomerLookupDto,
  output: CustomerProfileDto,
})
export class LookupCustomerTool {
  execute(input: CustomerLookupDto): CustomerProfileDto {
    // input.email is transparently restored from <email:7f3a91> to the real address
    return { email: input.email, tier: "enterprise" };
  }
}
```

```ts title="src/support.application.ts" file=src/support.application.ts
import {
  Application,
  Budget,
  BudgetPeriod,
  BudgetScope,
  EmptyEnvironment,
  type BudgetHandler,
} from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";
import {
  CustomerContactPiiPolicy,
  EmployeeBadgePiiPolicy,
} from "./policies/customer.pii-policy.js";
import { SupportModelProvider, SupportWorkflow } from "./workflows/support.workflow.js";

@Budget({ name: "pii-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class PiiAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(20); } }
@Budget({ name: "pii-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class PiiTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "pii-exec-budget", scope: BudgetScope.Execution })
export class PiiExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "support-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [SupportWorkflow],
  modelProvider: SupportModelProvider,
  providers: [SupportModelProvider],
  piiPolicies: [CustomerContactPiiPolicy, EmployeeBadgePiiPolicy],
  budgets: [PiiAppBudget, PiiTenantBudget, PiiExecBudget],
})
export class SupportApplication {}
```

```ts title="test/employee-badge.pii-policy.test.ts" file=test/employee-badge.pii-policy.test.ts
import { expect, it } from "vitest";
import { testUnit } from "@agboss/core/testing";
import { EmployeeBadgePiiPolicy } from "../src/policies/customer.pii-policy.js";

it("pseudonymizes employee badge numbers and restores them for tools", async () => {
  const pii = testUnit([EmployeeBadgePiiPolicy]);

  const { output: masked } = await pii.mask("Assign ticket to EMP-482910 immediately.");
  expect(masked).not.toContain("EMP-482910");
  expect(pii.reveal(masked)).toBe("Assign ticket to EMP-482910 immediately.");
});
```

<!--
```ts file=src/workflows/support.workflow.ts
import { Agent, Workflow, WorkflowFinish, WorkflowStart, onStart, inline, secret, Ttl } from "@agboss/core";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "@agboss/core/dto";
import { ModelCost, ModelProvider, OpenRouterDriver } from "@agboss/core/models";
import { minutes } from "@agboss/core/units";
import { LookupCustomerTool } from "../tools/lookup-customer.tool.js";

@ModelProvider({
  name: "support-model-provider",
  description: "OpenRouter for the support agent and the PII detector",
  driver: OpenRouterDriver({ apiKey: secret("OPENROUTER_API_KEY") }),
  timeout: minutes(2),
  cost: ModelCost.fromResponse(),
})
export class SupportModelProvider {}

@WorkflowStart({ name: "support-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class SupportStart {}

@WorkflowFinish({ name: "support-workflow-finish", description: "Finish", output: WorkflowFinishTextDto })
export class SupportFinish {}

@Agent({
  name: "support-agent",
  description: "Handles customer questions",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Help the customer."),
  tools: [LookupCustomerTool],
})
export class SupportAgent {}

@Workflow({
  name: "support-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [
    onStart(SupportStart)
      .toAgent(SupportAgent)
      .toFinish(SupportFinish),
  ],
})
export class SupportWorkflow {}
```
-->

## What options does `@PiiPolicy` accept?

`name` and `description` are optional (the class name in kebab-case by default; `[name.kind-suffix]` is no longer raised). Rules are written **on the kind**: a rule that names a kind or a group a second time in one policy is `[pii.duplicate-target]`.

| Option | Applies To | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | Both | `string` | No | Kebab-case identifier (default: the class name in kebab-case). |
| `description` | Both | `string` | No | Explains which PII categories this policy governs. |
| `rules` | Declarative | `readonly [PiiRule, ...]` | Yes | Non-empty list of rules written on the target: `PiiKind.Email.tokenize()`, `PiiKind.CardNumber.mask({ keepLast: 4 })`, `PiiGroup.Government.block("…")`; specific `PiiKind` rules override broader `PiiGroup` rules. |
| `model` / `modelProvider` | Declarative | `string` / `Class` | No | Chat model used to detect unstructured PII (such as person names and street addresses) in free text, and its provider (`detectWithModel` of 0.1.0). A value a detection model files under a kind of no id is masked as `<pii>` (`pii.model-unknown-kind`). |
| `secret` | Declarative | `SecretRef` | For `tokenize()` | `secret("PII_PSEUDONYM_KEY")` — the key `tokenize()` derives its tokens under (HKDF-SHA256); `pseudonymKey` is gone. A `tokenize()` rule or action with no policy `secret` and no storage `piiSecret` fails the start (`[pii.secret-required]`). |
| `previousSecret` | Declarative | `SecretRef \| OptionalSecretRef` | No | The key before a rotation: a value a thread already holds a token for keeps it, a new value gets one under the new key, and every old token still reveals. |
| `files` | Both | `PiiFileAction` | No | What happens to the files of a model's input (redaction, blocking). |
| `action` | Custom Detector | `MaskingPiiAction` | Yes | `PiiAction.mask()`, `PiiAction.mask({ keepLast })` or `PiiAction.tokenize()` applied to every `[start, end)` match returned by `findMatches()`. |
| `deps` | Both | `readonly Token[]` | No | Constructor dependencies injected into the class (its `refusal(kind)` or `findMatches(text)`). |

## What related entities work with `@PiiPolicy`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `PiiKind` & `PiiGroup` | `"@agboss/core"` | Built-in PII categories — descriptors, not strings (`.id`, compared by identity, `PiiKind.fromId(id)`): `Email`, `Phone`, `CardNumber`, `Iban`, `IpAddress`, `PersonName`, `StreetAddress`, `Government`, `Financial`, `Contact`. Each carries the verbs below. |
| `mask()`, `mask(part)`, `tokenize()`, `block(refusal?)` | on a kind or group | The three actions: `mask()` replaces with the kind's placeholder (`replaceWithKind` of 0.1.0), `mask({ keepFirst?, keepLast?, maskChar? })` keeps part (`replacePart`), `tokenize()` is the reversible HMAC `<email:7f3a91>` restored on tool calls (`replaceWithToken`), `block(refusal?)` refuses the message (`blockWithRefusal`). `pii(…)` is gone. |
| `PiiAction` | `"@agboss/core"` | `PiiAction.mask()`, `PiiAction.mask(part)` and `PiiAction.tokenize()` for `sensitive:` DTO fields and custom detectors (a field cannot `block`). |
| `findMatches(text)` & `refusal(kind)` | methods | Written on a custom range detector and on a localized refusal builder; no `implements` needed (`PiiPolicyHandler`, `PiiRefusal` document the shape). |
| `testUnit(Policies, options?)` | `"@agboss/core/testing"` | Isolated unit runner that tests masking, reversible token restoration, and refusal triggers offline; `testWith` has a fixed test key, refused under `NODE_ENV=production`. |
