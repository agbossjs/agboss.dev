---
title: "@InputGuardrail & @OutputGuardrail"
description: Complete API reference for @InputGuardrail, @OutputGuardrail, DecidedBy.Model vs DecidedBy.Code, GuardrailHandler, GuardrailVerdict, GuardrailRefusal, and testGuardrail() in AGBoss.
---

`@InputGuardrail` and `@OutputGuardrail` (`"agboss"`) define boundary safety checks on [`@Application`](/reference/application/), [`@Workflow`](/reference/workflow/), [`@Agent`](/reference/agent/), and [`@Router`](/reference/router/). Unlike [`@Judge`](/reference/judge/) (which retries an agent with feedback), a guardrail **blocks** execution immediately (`GuardFailedError`) when a message or reply violates the guardrail.

Both `@InputGuardrail` and `@OutputGuardrail` support two execution modes via `decidedBy`:
- **`DecidedBy.Model` (default):** Evaluates a yes/no `prompt` against `model` (such as `"typesafe/jev-1.13"`) and blocks when $P(\text{yes}) \ge \text{threshold}$.
- **`DecidedBy.Code`:** Runs a deterministic `check(text: string): Promise<GuardrailVerdict> | GuardrailVerdict` method on your `GuardrailHandler` class with full DI (`deps: [...]`) at `$0.00` LLM cost and `0` tokens (`model`, `prompt`, `promptUrls`, and `threshold` are forbidden).

## Complete `@InputGuardrail` and `@OutputGuardrail` example

```ts title="src/guardrails/clinic.guardrails.ts" file=src/guardrails/clinic.guardrails.ts
import {
  Agent,
  DecidedBy,
  ExecutionContext,
  GuardrailVerdict,
  Injectable,
  InputGuardrail,
  OutputGuardrail,
  TenantContext,
  type GuardrailHandler,
  type GuardrailRefusal,
} from "agboss";
import { OneOf } from "agboss/dto";

export class ClinicTenantContext extends TenantContext {
  @OneOf({ values: ["pediatrics", "general"] })
  department!: "pediatrics" | "general";
}

export class ClinicExecutionContext extends ExecutionContext {
  @OneOf({ values: ["en", "de"] })
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

// 1. Model-backed @InputGuardrail with dynamic refusal via GuardrailRefusal + DI
@InputGuardrail({
  name: "prescription-request-guardrail",
  description: "Blocks prompts asking for a medical prescription",
  decidedBy: DecidedBy.Model,
  prompt: "Does the message ask the assistant to prescribe medication?",
  model: "typesafe/jev-1.13",
  threshold: 0.8,
  deps: [ClinicExecutionContext, LocalizedRefusalService],
})
export class PrescriptionRequestGuardrail implements GuardrailRefusal {
  constructor(
    private readonly ctx: ClinicExecutionContext,
    private readonly refusals: LocalizedRefusalService,
  ) {}

  refusal(): Promise<string> {
    return this.refusals.medicalPrescription(this.ctx.locale);
  }
}

// 2. Model-backed @OutputGuardrail with fixed refusal string
@OutputGuardrail({
  name: "no-diagnosis-output-guardrail",
  description: "Blocks answers that state a definitive medical diagnosis",
  prompt: "Does the answer provide a definitive medical diagnosis?",
  model: "typesafe/jev-1.13",
  threshold: 0.75,
  refusal: "I can only share general wellness information, not a medical diagnosis.",
})
export class NoDiagnosisOutputGuardrail {}

// 3. Deterministic DecidedBy.Code @OutputGuardrail with GuardrailHandler + DI ($0 cost)
@OutputGuardrail({
  name: "tenant-blocklist-guardrail",
  description: "Blocks replies containing department-restricted drug terms",
  decidedBy: DecidedBy.Code,
  refusal: "The response contained restricted clinical terms.",
  deps: [ClinicTenantContext, RestrictedTermsService],
})
export class TenantBlocklistGuardrail implements GuardrailHandler {
  constructor(
    private readonly tenant: ClinicTenantContext,
    private readonly blocklist: RestrictedTermsService,
  ) {}

  async check(text: string): Promise<GuardrailVerdict> {
    const blocked = await this.blocklist.containsForbiddenTerm(this.tenant.department, text);
    return blocked ? GuardrailVerdict.blocked() : GuardrailVerdict.passed();
  }
}

// 4. Attach via guardrails: [...] (lists add up across @Application -> @Workflow -> @Agent; remove with excludeGuardrails)
@Agent({
  name: "triage-nurse-agent",
  description: "Collects symptom summaries under model and code guardrails",
  model: "moonshotai/kimi-k2.6",
  prompt: "Ask clarifying questions about the patient's symptoms.",
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
import { decideWith, testGuardrail } from "agboss/testing";
import {
  ClinicTenantContext,
  NoDiagnosisOutputGuardrail,
  TenantBlocklistGuardrail,
} from "../src/guardrails/clinic.guardrails.js";

it("blocks answers when the model guardrail score meets the threshold", async () => {
  const check = testGuardrail(NoDiagnosisOutputGuardrail, {
    model: decideWith({ blocks: 0.92 }),
  });

  const { output } = await check("You have acute bronchitis.");
  expect(output.isBlocked).toBe(true);
  expect(output.refusal).toContain("not a medical diagnosis");
});

it("runs DecidedBy.Code guardrails with zero LLM calls via GuardrailHandler", async () => {
  const check = testGuardrail(TenantBlocklistGuardrail, {
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

| Option / Interface | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | **Yes** | Unique kebab-case identifier ending with `-guardrail`; the class name must end with `Guardrail` (`[name.kind-suffix]`). |
| `description` | `string` | **Yes** | Non-empty summary of the safety rule. |
| `decidedBy` | `DecidedBy.Model \| DecidedBy.Code` | No | Execution mode (defaults to `DecidedBy.Model`). |
| `prompt` / `promptUrls` | `string` / `readonly string[]` | For `DecidedBy.Model` | Yes/no safety question evaluated by the guardrail model (`"yes"` blocks). Forbidden on `DecidedBy.Code`. |
| `threshold` | `number` | For `DecidedBy.Model` | Probability ceiling (`0 < threshold <= 1`); blocks when $P(\text{yes}) \ge \text{threshold}$. Forbidden on `DecidedBy.Code`. |
| `model` | `string` | For `DecidedBy.Model`* | Decision model (`"typesafe/jev-1.13"`) or chat model (*uses `defaults.guardrail.model` when omitted; never inherits `defaults.router.model`). Forbidden on `DecidedBy.Code`. |
| `refusal` | `string` | Either `refusal` or `implements GuardrailRefusal` | Fixed refusal text returned when the guardrail blocks (`[guardrail.refusal-twice]` if both `refusal` and `GuardrailRefusal` are provided). |
| `deps` | `readonly Token[]` | No | Constructor dependencies injected into `GuardrailHandler` and/or `GuardrailRefusal`. |

## `GuardrailHandler` & `GuardrailVerdict` (`DecidedBy.Code`)

When `decidedBy: DecidedBy.Code` is set, the guardrail class must implement `GuardrailHandler` (`[guardrail.missing-handler]`):
- **`check(text: string): Promise<GuardrailVerdict> | GuardrailVerdict`:** Receives the PII-masked input or output string and returns `GuardrailVerdict.passed()` or `GuardrailVerdict.blocked()`.
- **Nominal `GuardrailVerdict`:** Plain `{ isBlocked: boolean }` objects are rejected by TypeScript and at runtime; always construct verdicts via `GuardrailVerdict.passed()` (`isBlocked: false`) or `GuardrailVerdict.blocked()` (`isBlocked: true`).
- **Fail-closed & `$0` cost:** If `check()` throws, the runtime fails closed with `GuardFailedError` without calling the downstream LLM or leaking internal error strings into `result.refusal`. Observer events (`GuardrailStartEvent` / `GuardrailEndEvent`) fire identically for both modes, with `cost: usd(0)` on code guardrails.

## Hierarchical inheritance (`guardrails` & `excludeGuardrails`)

- **Additive inheritance:** Guardrails declared on `@Application({ guardrails })`, `@Workflow({ guardrails })`, and `@Agent({ guardrails })` / `@Router({ guardrails })` accumulate automatically.
- **Selective opt-out (`excludeGuardrails`):** An individual `@Agent` or `@Router` can opt out of an inherited application or workflow guardrail via `excludeGuardrails: [PrescriptionRequestGuardrail]`.
