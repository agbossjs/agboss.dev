---
title: "DTO Field Decorators (@Text, @ListOf, @Nested…)"
description: Complete API reference for DTO field decorators in agboss/dto — @Text, @Integer, @Decimal, @Flag, @OneOf, @ListOf, @Nested, PII tags, and standard DTOs.
---

In AGBoss, every payload crossing a workflow path, `@Agent`, `@Action`, `@Router`, `@Tool`, or `@ChannelRole` boundary is a **DTO class** whose properties carry field decorators from `agboss/dto`. A single DTO class serves simultaneously as the compile-time TypeScript type, the runtime validator, the JSON Schema generator for LLM structured outputs, and the field-level PII redaction contract. Runtime values are always plain object literals `{ ... }` — never instantiate DTOs with `new`.

## What field decorators does `agboss/dto` provide?

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

## Complete DTO example with nested objects, lists, formats, and PII sensitivity

```ts title="src/dto/candidate-offer.dto.ts" no-check: reference example
import { PiiAction, PiiKind } from "agboss";
import { CountryCode, CurrencyCode, Date, DateTime, DecimalString, Email, Flag, Integer, ListOf, Nested, OneOf, PhoneNumber, Text, Url, Uuid } from "agboss/dto";

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
    sensitive: { kind: PiiKind.Email, action: PiiAction.replaceWithToken() },
  })
  email!: string;

  @PhoneNumber({
    optional: true,
    prompt: "Candidate E.164 phone number",
    sensitive: PiiKind.PhoneNumber,
  })
  phone?: string;

  @CountryCode({ prompt: "Candidate residence country code" })
  country!: string;
}

export class OfferPackageDto {
  @Uuid({ prompt: "Unique offer package identifier" })
  offerId!: string;

  @Text({ minLength: 2, maxLength: 120, prompt: "Candidate full legal name", sensitive: true })
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
```

```ts title="src/agents/offer-drafter.agent.ts" no-check: reference example
import { Agent } from "agboss";
import { CandidateOfferDto } from "../dto/candidate-offer.dto.js";

@Agent({
  name: "offer-drafter-agent",
  description: "Produces a validated CandidateOfferDto structured output",
  model: "moonshotai/kimi-k2.6",
  prompt: "Draft a structured offer package matching CandidateOfferDto.",
  output: CandidateOfferDto,
})
export class OfferDrafterAgent {}
```

```ts title="test/candidate-offer.dto.test.ts" no-check: reference example
import { expect } from "vitest";
import { replyWith, testWith } from "agboss/testing";
import { OfferApplication } from "../src/offer.application.js";
import { OfferDrafterAgent } from "../src/agents/offer-drafter.agent.js";
import { CandidateOfferDto } from "../src/dto/candidate-offer.dto.js";

const test = testWith(OfferApplication);

test("validates plain object DTO literals without new", async ({ app, mockLlm }) => {
  mockLlm(OfferDrafterAgent).thenReturn(
    replyWith(CandidateOfferDto, {
      offerId: "550e8400-e29b-41d4-a716-446655440000",
      candidateEmail: "ada@example.com",
      candidatePhone: "+14155552671",
      country: "US",
      startDate: "2026-06-01",
      expiresAt: "2026-05-15T17:00:00Z",
      portfolioUrl: "https://example.com/ada",
      remoteEligible: true,
      levelBand: "L6",
      lineItems: [{ label: "Base", currency: "USD", amount: "210000.00" }],
      primaryItem: { label: "Base", currency: "USD", amount: "210000.00" },
      yearsExperience: 9,
    }),
  );
  const res = await app.execute(OfferStart, { text: "Draft L6 offer" });
  expect(res.isFinished()).toBe(true);
});
```

## What related entities work with DTOs?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `WorkflowStartTextDto` & `WorkflowFinishTextDto` | `"agboss/dto"` | Built-in standard DTOs (`{ text: string }`) for text inputs and outputs. |
| `MoneyDto`, `DateRangeDto`, `PageDto`, `FileUrlDto` | `"agboss/dto"` | Built-in standard domain DTOs for currency amounts, date windows, pagination, and file links. |
| `oneOf(DtoA, DtoB)`, `listOf(Dto)`, `optional(Dto)`, `historyOf(Dto, { limit })` | `"agboss"` | Path Scope wrappers used in `@Agent`, `@Action`, `@Router`, and `@WorkflowStart` `input` / `output` declarations. |
| `variant(DtoClass, plainObject)` & `isVariant(value, DtoClass)` | `"agboss/dto"` | Tags and narrows union variants when returning or inspecting `oneOf(DtoA, DtoB)` values in code. |
