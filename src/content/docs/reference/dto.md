---
title: "DTO Field Decorators (@Text, @ListOf, @Nested…)"
description: "Complete API reference for DTO classes and field decorators in agboss/dto — @Text, @Integer, @Floating, @Flag, @Choice, @ListOf, @OneOf, and @RecordOf."
---

In AGBoss, every payload crossing a workflow path, `@Agent`, `@Action`, `@Router`, `@Tool`, or `@ChannelRole` boundary is a **DTO class** (`*Dto`) whose properties each carry a single field decorator from `@agboss/core/dto` (`[dto.missing-decorator]`, `[dto.multiple-decorators]`). A single DTO class serves simultaneously as the compile-time TypeScript type, the runtime validator, the deterministic JSON Schema generator for LLM structured outputs, and the field-level PII masking contract. Runtime values are always plain object literals `{ ... }` — never instantiate DTOs with `new`.

## Complete DTO example with nested objects, lists, formats, and `sensitive: PiiAction.*`

Every scalar field decorator accepts `sensitive?: MaskingPiiAction` (`PiiAction.replaceWithKind()`, `PiiAction.replaceWithToken()`, or `PiiAction.replacePart({ keepFirst?, keepLast?, maskChar? })`):

```ts title="src/dto/candidate-offer.dto.ts" file=src/dto/candidate-offer.dto.ts
import { Agent, PiiAction } from "@agboss/core";
import {
  CountryCode,
  CurrencyCode,
  Date,
  DateTime,
  DecimalString,
  Email,
  Flag,
  Integer,
  ListOf,
  Nested,
  OneOf,
  PhoneNumber,
  Text,
  Url,
  Uuid,
} from "@agboss/core/dto";

export class CompensationLineItemDto {
  @OneOf({ values: ["base", "bonus", "equity"], prompt: "Compensation component type" })
  kind!: "base" | "bonus" | "equity";

  @DecimalString({ scale: 2, prompt: "Exact amount as a decimal string, e.g. 185000.00" })
  amount!: string;

  @CurrencyCode({ prompt: "ISO 4217 currency code" })
  currency!: string;
}

export class CandidateContactDto {
  @Email({
    prompt: "Candidate personal email address",
    sensitive: PiiAction.replaceWithToken(),
  })
  email!: string;

  @PhoneNumber({
    optional: true,
    prompt: "Candidate E.164 phone number",
    sensitive: PiiAction.replacePart({ keepLast: 4 }),
  })
  phone?: string;

  @CountryCode({ prompt: "Candidate residence country code" })
  country!: string;
}

export class OfferPackageDto {
  @Uuid({ prompt: "Unique offer package identifier" })
  offerId!: string;

  @Text({
    minLength: 2,
    maxLength: 120,
    prompt: "Candidate full legal name",
    sensitive: PiiAction.replaceWithKind(),
  })
  candidateName!: string;

  @Nested(CandidateContactDto, { prompt: "Candidate contact details" })
  contact!: CandidateContactDto;

  @ListOf(CompensationLineItemDto, { minItems: 1, maxItems: 5, prompt: "Breakdown of compensation items" })
  items!: CompensationLineItemDto[];

  @ListOf(Text, { optional: true, prompt: "Optional onboarding tags" })
  tags?: string[];

  @Date({ prompt: "Proposed start date (YYYY-MM-DD)" })
  startDate!: string;

  @DateTime({ prompt: "Offer expiration timestamp (ISO 8601)" })
  expiresAt!: string;

  @Url({ prompt: "Link to benefits summary PDF" })
  benefitsUrl!: string;

  @Integer({ min: 1, max: 10, prompt: "Engineering level (1-10)" })
  level!: number;

  @Flag({ prompt: "Whether relocation assistance is included" })
  relocationIncluded!: boolean;
}

@Agent({
  name: "offer-drafter-agent",
  description: "Produces a validated OfferPackageDto structured output",
  model: "moonshotai/kimi-k2.6",
  prompt: "Draft a structured offer package matching OfferPackageDto.",
  output: OfferPackageDto,
})
export class OfferDrafterAgent {}
```

<!--
```ts file=src/offer-drafter.application.ts
import {
  Application,
  Budget,
  BudgetPeriod,
  BudgetScope,
  EmptyEnvironment,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  start,
  type BudgetHandler,
} from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
import { usd, type Usd } from "@agboss/core/units";
import { OfferDrafterAgent, OfferPackageDto } from "./dto/candidate-offer.dto.js";

@WorkflowStart({ name: "offer-draft-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class OfferDraftStart {}

@WorkflowFinish({ name: "offer-draft-workflow-finish", description: "Finish", output: OfferPackageDto })
export class OfferDraftFinish {}

@Workflow({
  name: "offer-draft-workflow",
  version: "1.0.0",
  flow: [
    start(OfferDraftStart)
      .returns(WorkflowStartTextDto)
      .toAgent(OfferDrafterAgent)
      .returns(OfferPackageDto)
      .toFinish(OfferDraftFinish),
  ],
})
export class OfferDraftWorkflow {}

@Budget({ name: "dto-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class DtoAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(20); } }
@Budget({ name: "dto-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class DtoTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "dto-exec-budget", scope: BudgetScope.Execution })
export class DtoExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "offer-draft-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [OfferDraftWorkflow],
  budgets: [DtoAppBudget, DtoTenantBudget, DtoExecBudget],
})
export class OfferDraftApplication {}
```
-->

```ts title="test/candidate-offer.dto.test.ts" file=test/candidate-offer.dto.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "@agboss/core";
import { replyWith, testWith } from "@agboss/core/testing";
import { OfferDrafterAgent, OfferPackageDto } from "../src/dto/candidate-offer.dto.js";
import { OfferDraftApplication, OfferDraftStart } from "../src/offer-drafter.application.js";

const test = testWith(OfferDraftApplication);

test("validates nested OfferPackageDto structured output at runtime", async ({ app, mockLlm }) => {
  mockLlm(OfferDrafterAgent).thenReturn(
    replyWith(OfferPackageDto, {
      offerId: "550e8400-e29b-41d4-a716-446655440000",
      candidateName: "Ada Lovelace",
      contact: {
        email: "ada@example.com",
        phone: "+14155550199",
        country: "US",
      },
      items: [{ kind: "base", amount: "225000.00", currency: "USD" }],
      tags: ["principal", "distributed-systems"],
      startDate: "2026-11-01",
      expiresAt: "2026-10-31T23:59:59Z",
      benefitsUrl: "https://example.com/benefits.pdf",
      level: 7,
      relocationIncluded: true,
    }),
  );

  const res = await app.execute(OfferDraftStart, { text: "Prepare Principal Engineer offer" });
  expect(res.status).toBe(ExecutionStatus.Finished);
});
```

## What field decorators does `@agboss/core/dto` provide?

| Decorator | TypeScript Field Type | Options | Description |
| :--- | :--- | :--- | :--- |
| `@Text(options?)` | `string` | `minLength`, `maxLength`, `pattern`, `prompt`, `optional`, `sensitive` | UTF-8 string with optional length bounds and regex pattern. |
| `@Integer(options?)` | `number` | `min`, `max`, `prompt`, `optional`, `sensitive` | Whole integer number (`Number.isInteger`). |
| `@Decimal(options?)` | `number` | `min`, `max`, `prompt`, `optional`, `sensitive` | Finite floating-point number. |
| `@DecimalString(options?)` | `string` | `scale`, `prompt`, `optional`, `sensitive` | Exact base-10 decimal formatted as a string (`"19.99"`) with at most `scale` fractional digits. |
| `@Flag(options?)` | `boolean` | `prompt`, `optional`, `sensitive` | Boolean `true` or `false`. |
| `@OneOf({ values, ... })` | `V[number]` | `values: readonly [string, ...]`, `prompt`, `optional`, `sensitive` | String literal union; TypeScript enforces that the property type matches `values` exactly. |
| `@ListOf(Item, options?)` | `T[]` | `minItems`, `maxItems`, `prompt`, `optional`, `sensitive` | Array of scalar field factories (`@ListOf(Text)`) or nested DTO classes (`@ListOf(LineItemDto)`). |
| `@Nested(DtoClass, options?)` | `DtoClass` | `prompt`, `optional`, `sensitive` | Embeds a child DTO object inside a parent DTO. |
| `@Email(options?)` | `string` | `prompt`, `optional`, `sensitive` | Validated email address string. |
| `@PhoneNumber(options?)` | `string` | `prompt`, `optional`, `sensitive` | E.164 phone number (`"+14155550199"`). |
| `@Url(options?)` | `string` | `prompt`, `optional`, `sensitive` | Validated `http://` or `https://` URL string. |
| `@Uuid(options?)` | `string` | `prompt`, `optional`, `sensitive` | RFC 4122 UUID string. |
| `@Date(options?)` | `string` | `prompt`, `optional`, `sensitive` | ISO 8601 calendar date (`"2026-10-20"`). |
| `@DateTime(options?)` | `string` | `prompt`, `optional`, `sensitive` | ISO 8601 timestamp with timezone offset or `Z` (`"2026-10-20T09:00:00Z"`). |
| `@Duration(options?)` | `string` | `prompt`, `optional`, `sensitive` | ISO 8601 duration string (`"PT30M"`). |
| `@CurrencyCode(options?)` | `string` | `prompt`, `optional`, `sensitive` | ISO 4217 3-letter currency code (`"USD"`). |
| `@CountryCode(options?)` | `string` | `prompt`, `optional`, `sensitive` | ISO 3166-1 alpha-2 country code (`"US"`). |
| `@TimeZone(options?)` | `string` | `prompt`, `optional`, `sensitive` | IANA time zone identifier (`"America/New_York"`). |
| `@MediaType(options?)` | `string` | `prompt`, `optional`, `sensitive` | MIME type string (`"application/pdf"`). |

## Built-in standard DTOs and Path Scope wrappers

| Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `PlainTextDto`, `WorkflowStartTextDto`, `WorkflowFinishTextDto` | `"@agboss/core/dto"` | Built-in standard text DTOs (`{ text: string }`) for plain-text agent judges, workflow starts, and workflow finishes. |
| `ToolCallApprovalAskDto` & `ToolCallApprovalDecisionDto` | `"@agboss/core/dto"` | Built-in standard DTOs used by `@ChannelRole({ approves })` tool approval pauses (`{ approved: boolean, reason?: string, overrideArguments?: ... }`). |
| `oneOf(DtoA, DtoB)`, `listOf(Dto)`, `optional(Dto)`, `historyOf(Dto, { limit })` | `"@agboss/core"` | Path Scope type wrappers used in `.returns(...)` and `@Agent` / `@Action` / `@Router` `input` and `output` contracts. |
| `variant(DtoClass, plainObject)` & `isVariant(value, DtoClass)` | `"@agboss/core"` | Tags and narrows union variants when returning or inspecting `oneOf(DtoA, DtoB)` values in deterministic code. |
