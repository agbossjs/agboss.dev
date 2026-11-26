---
title: "@InputGuardrail & @OutputGuardrail"
description: "Complete API reference for @InputGuardrail, @OutputGuardrail, model guardrails vs code guardrails (check(content)), GuardrailVerdict, and testUnit in AGBoss."
---

`@InputGuardrail` and `@OutputGuardrail` (`"@agboss/core"`) define boundary safety checks on [`@Application`](/reference/application/), [`@Workflow`](/reference/workflow/), [`@Agent`](/reference/agent/), and [`@Router`](/reference/router/). Unlike [`@Judge`](/reference/judge/) (which retries an agent with feedback), a guardrail **blocks** execution immediately (`StepError.Guardrail`) when a message or reply violates the guardrail.

Both `@InputGuardrail` and `@OutputGuardrail` come in two forms, told apart by what the decorator sets (there is no `decidedBy`):
- **A model guardrail** sets a yes/no `prompt` (a `PromptSource`), a `threshold` and optionally `model` and `modelProvider` (such as `"typesafe/jev-1.13"` on a decisions provider), and blocks when $P(\text{yes}) \ge \text{threshold}$. Its class has no `check`.
- **A code guardrail** sets none of `prompt`, `threshold`, `model` and `modelProvider`: its class has one deterministic `check(content)` method with full DI (`deps: [...]`) at `$0.00` LLM cost and `0` tokens, returning `GuardrailVerdict.passed()` or `GuardrailVerdict.blocked(refusal?)`.

## Complete `@InputGuardrail` and `@OutputGuardrail` example

```ts title="src/guardrails/clinic.guardrails.ts" file=src/guardrails/clinic.guardrails.ts
import {
  Agent,
  ExecutionContext,
  GuardrailVerdict,
  Injectable,
  InputGuardrail,
  OutputGuardrail,
  TenantContext,
  inline,
  type GuardrailContent,
} from "@agboss/core";
import { Enum } from "@agboss/core/dto";

export class ClinicTenantContext extends TenantContext {
  @Enum(["pediatrics", "general"])
  department!: "pediatrics" | "general";
}

export class ClinicExecutionContext extends ExecutionContext {
  @Enum(["en", "de"])
  locale!: "en" | "de";
}

@Injectable()
export class LocalizedRefusalService {
  medicalPrescription(locale: "en" | "de"): Promise<string> {
    return Promise.resolve(
      locale === "de"
        ? "Ich darf keine verschreibungspflichtigen Medikamente verordnen."
        : "I cannot prescribe medication. Please consult a licensed physician.",
    );
  }
}

@Injectable()
export class RestrictedTermsService {
  containsForbiddenTerm(department: "pediatrics" | "general", text: string): Promise<boolean> {
    const terms = department === "pediatrics" ? ["adult-dosage", "aspirin-500mg"] : ["unapproved-compound"];
    return Promise.resolve(terms.some((term) => text.toLowerCase().includes(term)));
  }
}

// 1. Model-backed @InputGuardrail with a dynamic refusal: its class's refusal(content) + DI
@InputGuardrail({
  name: "prescription-request-guardrail",
  description: "Blocks prompts asking for a medical prescription",
  prompt: inline("Does the message ask the assistant to prescribe medication?"),
  model: "typesafe/jev-1.13",
  threshold: 0.8,
  deps: [ClinicExecutionContext, LocalizedRefusalService],
})
export class PrescriptionRequestGuardrail {
  constructor(
    private readonly ctx: ClinicExecutionContext,
    private readonly refusals: LocalizedRefusalService,
  ) {}

  refusal(_content: GuardrailContent): Promise<string> {
    return this.refusals.medicalPrescription(this.ctx.locale);
  }
}

// 2. Model-backed @OutputGuardrail with fixed refusal string
@OutputGuardrail({
  name: "no-diagnosis-output-guardrail",
  description: "Blocks answers that state a definitive medical diagnosis",
  prompt: inline("Does the answer provide a definitive medical diagnosis?"),
  model: "typesafe/jev-1.13",
  threshold: 0.75,
  refusal: "I can only share general wellness information, not a medical diagnosis.",
})
export class NoDiagnosisOutputGuardrail {}

// 3. Code @OutputGuardrail: one check(content) + DI ($0 cost, no model)
@OutputGuardrail({
  name: "tenant-blocklist-guardrail",
  description: "Blocks replies containing department-restricted drug terms",
  deps: [ClinicTenantContext, RestrictedTermsService],
})
export class TenantBlocklistGuardrail {
  constructor(
    private readonly tenant: ClinicTenantContext,
    private readonly blocklist: RestrictedTermsService,
  ) {}

  // content.text is the masked text (the text of text files appended); content.files lists the files
  async check(content: GuardrailContent): Promise<GuardrailVerdict> {
    const blocked = await this.blocklist.containsForbiddenTerm(this.tenant.department, content.text);
    return blocked
      ? GuardrailVerdict.blocked("The response contained restricted clinical terms.")
      : GuardrailVerdict.passed();
  }
}

// 4. Attach via guardrails: [...] (lists add up across @Application -> @Workflow -> @Agent; remove with excludeGuardrails)
@Agent({
  name: "triage-nurse-agent",
  description: "Collects symptom summaries under model and code guardrails",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Ask clarifying questions about the patient's symptoms."),
  guardrails: [
    PrescriptionRequestGuardrail,
    NoDiagnosisOutputGuardrail,
    TenantBlocklistGuardrail,
  ],
})
export class TriageNurseAgent {}
```

```ts title="test/clinic.guardrails.test.ts" file=test/clinic.guardrails.test.ts
import { expect, it } from "vitest";
import { decideWith, testUnit } from "@agboss/core/testing";
import {
  ClinicTenantContext,
  NoDiagnosisOutputGuardrail,
  TenantBlocklistGuardrail,
} from "../src/guardrails/clinic.guardrails.js";

it("blocks answers when the model guardrail score meets the threshold", async () => {
  const check = testUnit(NoDiagnosisOutputGuardrail, {
    model: decideWith({ blocks: 0.92 }),
  });

  const { output } = await check("You have acute bronchitis.");
  expect(output.isBlocked).toBe(true);
  expect(output.refusal).toContain("not a medical diagnosis");
});

it("runs code guardrails with zero LLM calls via GuardrailHandler", async () => {
  const check = testUnit(TenantBlocklistGuardrail, {
    tenantContext: ClinicTenantContext,
    tenant: { tenantId: "clinic-1", department: "pediatrics" },
  });

  const blocked = await check("Take aspirin-500mg twice daily.");
  expect(blocked.output.isBlocked).toBe(true);
  expect(blocked.output.refusal).toBe("The response contained restricted clinical terms.");

  const passed = await check("Rest and drink plenty of fluids.");
  expect(passed.output.isBlocked).toBe(false);
});
```

## What options do `@InputGuardrail` and `@OutputGuardrail` accept?

`@InputGuardrail()` and `@OutputGuardrail()` with no options are valid (a code guardrail). `name` and `description` are optional (the class name in kebab-case by default).

| Option / Method | Applies To | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` / `description` | Both | `string` | No | Kebab-case identifier (the `-guardrail` suffix is no longer required) and a summary of the safety rule. |
| `prompt` | Model | `PromptSource` | Yes | Yes/no safety question evaluated by the guardrail model (`"yes"` blocks): a file path, `inline("…")` or a list. |
| `threshold` | Model | `number` | Yes | Probability ceiling (`0 < threshold <= 1`); blocks when $P(\text{yes}) \ge \text{threshold}$. |
| `model` / `modelProvider` | Model | `string` / `Class` | No | Decision model (`"typesafe/jev-1.13"`) or chat model, and the provider that serves it, resolved through guardrail → workflow → application (`defaults.guardrail.model` when omitted; never `defaults.router.model`). No provider: `[model.missing-provider]`. |
| `refusal` | Model | `string` | Either `refusal` or a `refusal(content)` method on the class | Fixed refusal text returned when the guardrail blocks (`[guardrail.refusal-twice]` if both are given; a model guardrail with neither is `[guardrail.missing-refusal]`). |
| `deps` | Both | `readonly Token[]` | No | Constructor dependencies injected into the guardrail class (its `check` or its `refusal(content)`). |
| `check(content)` | Code | method | Yes | One deterministic method on the class (see below); a class that sets a `prompt` and has a `check` is rejected at compile time. |

## `check(content)` & `GuardrailVerdict` (code guardrails)

A guardrail that sets no `prompt`, `threshold`, `model` or `modelProvider` is decided by its class's single `check(content)` (`[guardrail.missing-handler]` otherwise):
- **`check(content: GuardrailContent): Promise<GuardrailVerdict> | GuardrailVerdict`:** `content.text` carries the PII-masked text with the text of text files appended (a transcription, a CSV), `content.files` lists the files (`[]` when none), and `content.component` and `content.side` say which agent or router and which side (input or output).
- **Nominal `GuardrailVerdict`:** Plain `{ isBlocked: boolean }` objects are rejected by TypeScript and at runtime; always construct verdicts via `GuardrailVerdict.passed()` or `GuardrailVerdict.blocked(refusal?)`. The refusal of its own call wins, then the decorator's `refusal`, then the class's `refusal(content)`; none of the three fails closed with `StepError.Guardrail`.
- **Fail-closed & `$0` cost:** If `check()` throws, the runtime fails closed with `StepError.Guardrail` without calling the downstream LLM or leaking internal error strings into `result.refusal`. Observer events (`GuardrailStartEvent` / `GuardrailEndEvent`) fire identically for both forms, with `cost: usd(0)` on code guardrails.

## Hierarchical inheritance (`guardrails` & `excludeGuardrails`)

- **Additive inheritance:** Guardrails declared on `@Application({ guardrails })`, `@Workflow({ guardrails })`, and `@Agent({ guardrails })` / `@Router({ guardrails })` accumulate automatically.
- **Selective opt-out (`excludeGuardrails`):** An individual `@Agent` or `@Router` can opt out of an inherited application or workflow guardrail via `excludeGuardrails: [PrescriptionRequestGuardrail]`.
