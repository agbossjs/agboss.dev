---
title: "DTO Field Decorators (@Text, @List, @Nested…)"
description: "Complete API reference for DTO classes and field decorators in @agboss/core/dto — @Text, @Integer, @Float, @Bool, @Enum, @List, @Nested, @KeyText, and @Validate."
---

In AGBoss, every payload crossing a workflow path, `@Agent`, `@Action`, `@Router`, `@Tool`, or pause-target boundary is a **DTO class** (`*Dto`) whose properties each carry a single field decorator from `@agboss/core/dto` (`[dto.missing-decorator]`, `[dto.multiple-decorators]`). A single DTO class serves simultaneously as the compile-time TypeScript type, the runtime validator, the deterministic JSON Schema generator for LLM structured outputs, and the field-level PII masking contract. The values you write are plain object literals `{ ... }` — never instantiate DTOs with `new`. A value the framework validates (an agent's answer, a tool's arguments, an action's output, a value read back from the scope) is an instance of its class: `item instanceof ScoreDto` holds, nothing is frozen and no constructor runs.

## Complete DTO example with nested objects, lists, formats, and `sensitive: PiiAction.*`

Every scalar field decorator accepts `sensitive?: MaskingPiiAction` (`PiiAction.mask()`, `PiiAction.tokenize()`, or `PiiAction.mask({ keepFirst?, keepLast?, maskChar? })` — there are three actions and `block` does not compile on a field):

```ts title="src/dto/candidate-offer.dto.ts" file=src/dto/candidate-offer.dto.ts
import { Agent, PiiAction, inline } from "@agboss/core";
import {
  CountryCode,
  CurrencyCode,
  DecimalString,
  Email,
  Enum,
  Bool,
  Integer,
  IsoDate,
  IsoDateTime,
  List,
  Nested,
  PhoneNumber,
  Text,
  Url,
  Uuid,
} from "@agboss/core/dto";

export class CompensationLineItemDto {
  @Enum(["base", "bonus", "equity"], { prompt: "Compensation component type" })
  kind!: "base" | "bonus" | "equity";

  @DecimalString({ scale: 2, prompt: "Exact amount as a decimal string, e.g. 185000.00" })
  amount!: string;

  @CurrencyCode({ prompt: "ISO 4217 currency code" })
  currency!: string;
}

export class CandidateContactDto {
  @Email({
    prompt: "Candidate personal email address",
    sensitive: PiiAction.tokenize(),
  })
  email!: string;

  @PhoneNumber({
    optional: true,
    prompt: "Candidate E.164 phone number",
    sensitive: PiiAction.mask({ keepLast: 4 }),
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
    sensitive: PiiAction.mask(),
  })
  candidateName!: string;

  @Nested(CandidateContactDto, { prompt: "Candidate contact details" })
  contact!: CandidateContactDto;

  @List(CompensationLineItemDto, { minItems: 1, maxItems: 5, prompt: "Breakdown of compensation items" })
  items!: CompensationLineItemDto[];

  @List(Text, { optional: true, prompt: "Optional onboarding tags" })
  tags?: string[];

  @IsoDate({ prompt: "Proposed start date (YYYY-MM-DD)" })
  startDate!: string;

  @IsoDateTime({ prompt: "Offer expiration timestamp (ISO 8601)" })
  expiresAt!: string;

  @Url({ prompt: "Link to benefits summary PDF" })
  benefitsUrl!: string;

  @Integer({ min: 1, max: 10, prompt: "Engineering level (1-10)" })
  level!: number;

  @Bool({ prompt: "Whether relocation assistance is included" })
  relocationIncluded!: boolean;
}

@Agent({
  name: "offer-drafter-agent",
  description: "Produces a validated OfferPackageDto structured output",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Draft a structured offer package matching OfferPackageDto."),
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
  onStart,
  type BudgetHandler,
  Ttl,
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
  historyTtl: Ttl.Forever,
  flow: [
    onStart(OfferDraftStart)
      .toAgent(OfferDrafterAgent)
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

test("validates nested OfferPackageDto structured output at runtime", async ({ app, mockModel }) => {
  mockModel(OfferDrafterAgent).thenReturn(
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
| `@Float(options?)` | `number` | `min`, `max`, `prompt`, `optional`, `sensitive` | Finite floating-point number (was `@Decimal`; `@DecimalString` is the exact one). |
| `@DecimalString(options?)` | `string` | `scale`, `prompt`, `optional`, `sensitive` | Exact base-10 decimal formatted as a string (`"19.99"`) with at most `scale` fractional digits. |
| `@Bool(options?)` | `boolean` | `prompt`, `optional`, `sensitive` | Boolean `true` or `false` (was `@Flag`). |
| `@Enum(values, options?)` | `V[number]` | `prompt`, `optional`, `sensitive` | String literal union; `values` is the first argument (`@Enum(["a", "b"], { prompt })`) or a string `enum` object (`@Enum(StatusEnum)`), and TypeScript enforces that the property type matches. Replaces `@OneOf({ values })`. |
| `@List(Item, options?)` | `T[]` \| `readonly T[]` | `minItems`, `maxItems`, `prompt`, `optional`, `sensitive` | Array of scalar field factories (`@List(Text)`), nested DTO classes (`@List(LineItemDto)`) or an enum's values (`@List(["a", "b"])`). Replaces `@ListOf`. |
| `@KeyText(options?)` | `string` | `minLength`, `maxLength`, `pattern`, `prompt`, `optional` | A key: 1 to 200 characters of `[a-zA-Z0-9._:-]` only, NFC, safe as a URL segment, an object-store key and a log key; the issue names the rule, never the text. |
| `@Nested(DtoClass, options?)` | `DtoClass` | `prompt`, `optional`, `sensitive` | Embeds a child DTO object inside a parent DTO. |
| `@Email(options?)` | `string` | `prompt`, `optional`, `sensitive` | Validated email address string. |
| `@PhoneNumber(options?)` | `string` | `prompt`, `optional`, `sensitive` | E.164 phone number (`"+14155550199"`). |
| `@Url(options?)` | `string` | `prompt`, `optional`, `sensitive` | Validated `http://` or `https://` URL string. |
| `@Uuid(options?)` | `string` | `prompt`, `optional`, `sensitive` | RFC 4122 UUID string. |
| `@IsoDate(options?)` | `string` | `prompt`, `optional`, `sensitive` | ISO 8601 calendar date (`"2026-10-20"`). |
| `@IsoDateTime(options?)` | `string` | `prompt`, `optional`, `sensitive` | ISO 8601 timestamp with timezone offset or `Z` (`"2026-10-20T09:00:00Z"`). |
| `@IsoDuration(options?)` | `string` | `prompt`, `optional`, `sensitive` | ISO 8601 duration string (`"PT30M"`). |
| `@CurrencyCode(options?)` | `string` | `prompt`, `optional`, `sensitive` | ISO 4217 3-letter currency code (`"USD"`). |
| `@CountryCode(options?)` | `string` | `prompt`, `optional`, `sensitive` | ISO 3166-1 alpha-2 country code (`"US"`). |
| `@TimeZone(options?)` | `string` | `prompt`, `optional`, `sensitive` | IANA time zone identifier (`"America/New_York"`). |
| `@MediaType(options?)` | `string` | `prompt`, `optional`, `sensitive` | MIME type string (`"application/pdf"`). |

## Cross-field rules, helpers and standard DTOs

`@Validate<Dto>((dto) => dto.to >= dto.from || "to is before from")` is a class decorator for a rule across fields: return `undefined`, `true` or `[]` for valid, `false`, a string, `{ field?, reason }` or a list of them for invalid (a check that throws fails closed). A subclass inherits its parents' checks, and they run on a nested DTO too. `validate(Dto, raw)`, `jsonSchemaOf(Dto)` and `maskDto(Dto, value)` are public in `@agboss/core/dto`.

```ts
import { Integer, Validate } from "@agboss/core/dto";

@Validate<ReservationDto>((dto) => dto.to >= dto.from || "to is before from")
export class ReservationDto {
  @Integer({ min: 0, prompt: "first night" })
  from!: number;

  @Integer({ min: 0, prompt: "last night" })
  to!: number;
}
```

## Built-in standard DTOs and Path Scope wrappers

| Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `PlainTextDto`, `WorkflowStartTextDto`, `WorkflowFinishTextDto` | `"@agboss/core/dto"` | Built-in standard text DTOs (`{ text: string }`) for plain-text agent judges, workflow starts, and workflow finishes (`WorkflowFinishTextDto extends PlainTextDto`). |
| `MoneyDto`, `AddressDto`, `ContactInfoDto`, `PersonNameDto`, `DateRangeDto`, `DateTimeRangeDto` | `"@agboss/core/dto"` | Ready-made DTOs; `MoneyDto` follows the currency's ISO 4217 minor unit (`JPY` 0 digits, `USD` 2, `KWD` 3) and refuses a code that is no money. |
| `FileDto`, `WorkflowFinishFileDto`, `WorkflowFinishFilesDto` | `"@agboss/core/dto"` | A file carried by a workflow (the A2A prefix is gone: `FileDto`, `@File`, `Files`). |
| `ToolCallApprovalAskDto` & `ToolCallApprovalDecisionDto` | `"@agboss/core/dto"` | Built-in standard DTOs of `@ToolApproval` pauses (`{ approved: boolean, reason?: string, overrideArguments?: ... }`). |
| `oneOf(DtoA, DtoB)`, `listOf(A, B, …)`, `optional(Dto)`, `historyOf(Dto, { maxPrevious })` | `"@agboss/core"` | Path Scope type wrappers used in `@Agent` / `@Action` / `@Router` `input` and `output` contracts (no longer re-exported from `@agboss/core/dto`). `listOf` is variadic: `listOf(ScoreDto, RejectedDto)` is a polymorphic list. |
| `Metadata`, `Tracked<T, P>` | `"@agboss/core"` | An input field is the DTO itself, typed `Tracked<T, P>`; `Metadata.createdBy(value)` tells who made it. `variant` and `isVariant` are gone: an action returns a plain object for a `oneOf` output, told apart by its strict schema (`[dto.ambiguous-one-of]` when two classes could both match). |
