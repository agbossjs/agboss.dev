---
title: "@Agent"
description: Complete API reference for the @Agent decorator in AGBoss — all options, prompts, input/output shapes, tools, RAG, @Judge gates, reasoning, and testing.
---

The `@Agent` decorator defines an LLM-powered workflow node (`agents/*.agent.ts`) in AGBoss. An agent is a pure declarative class that binds a model, static instructions (`prompt` or `promptUrls`), typed Path Scope `input` fields, structured `output` DTOs (including `oneOf(...)` union variants), `@Tool` and `@McpTool` capabilities, `@Rag` knowledge bases, `@Judge` quality gates, and loop/token limits.

## What options does `@Agent` accept?

Every `@Agent` class name ends with `Agent` and its `name` option ends with `-agent`:

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier ending with `-agent` (e.g., `"draft-reviewer-agent"`). |
| `description` | `string` | Yes | Describes the agent's responsibility for traces, Studio graphs, and CLI inspection. |
| `model` | `string` | Yes | Model identifier (e.g., `"moonshotai/kimi-k2.6"`); must match a `@ModelProvider({ serves })` pattern. |
| `prompt` | `string` | No* | Inline system prompt instructions (*either `prompt` or `promptUrls` is required). |
| `promptUrls` | `readonly string[]` | No* | Relative paths to Markdown prompt files (`["./reviewer.prompt.md"]`) verified at assembly. |
| `promptVariables` | `Readonly<Record<string, string>>` | No | Static `{{key}}` template values substituted into the agent's prompt at assembly time. |
| `input` | `InputFields` | No | Map of DTOs read from the workflow's Path Scope (`{ draft: OfferDraftDto, history: historyOf(CritiqueDto, { limit: 3 }) }`). |
| `output` | `OutputShape` | No | Structured output DTO class, `listOf(Dto)`, or `oneOf(ApprovedDto, ChangesRequestedDto)`. Defaults to `WorkflowFinishTextDto` when omitted. |
| `tools` | `readonly Class[]` | No | `@Tool` and `@McpTool` classes the agent can invoke during its tool-calling loop. |
| `rag` | `readonly AgentRag[]` | No | Knowledge bases attached as `[{ use: DocsRag, mode: RagMode.Tool \| RagMode.Context }]`. |
| `judges` | `readonly Class[]` | No | `@Judge` classes that verify the agent's reply and trigger self-correction retries on failure. |
| `maxRetries` | `number` | No | Maximum self-correction retries when a `@Judge` rejects the agent's answer. |
| `maxToolCalls` | `number` | No | Maximum tool calls allowed within a single visit to this agent. |
| `maxVisits` | `number` | No | Maximum times a workflow execution may visit this agent (`VisitsLimitExceededError`). |
| `reasoning` | `Reasoning` | No | Reasoning effort: `Reasoning.off()`, `Reasoning.on({ effort: "low" \| "medium" \| "high" })`, or `Reasoning.modelDecides()`. |
| `cache` | ` boolean \| PromptCaching` | No | Prompt caching policy (`PromptCaching.ephemeral()` or `false`). |
| `temperature` | `number` | No | Sampling temperature (`0` by default). |
| `maxTokens` | `number \| "max"` | No | Maximum completion tokens (`8192` by default, or `MODEL_MAX`). |
| `historyLimit` | `number` | No | Maximum conversation turns retained in the agent's message window. |
| `historySummaries` | `number` | No | Number of compacted conversation summaries retained in context. |
| `piiPolicies` | `readonly Class[]` | No | Additional `@PiiPolicy` classes applied to this agent's model and tool calls. |
| `excludePiiPolicies` | `readonly Class[]` | No | Application or workflow `@PiiPolicy` classes explicitly exempted for this agent. |
| `guardrails` | `readonly Class<Guardrail>[]` | No | Additional `@Guardrail` classes applied to this agent's tool calls and final answer. |
| `price` | `{ input: number; output: number }` | No | Custom USD price per 1M input/output tokens overriding the provider's cost table. |

## Complete `@Agent` example with all capabilities

```ts title="src/agents/offer-reviewer.agent.ts" no-check: reference example
import { Agent, RagMode, historyOf, oneOf, optional } from "agboss";
import { MODEL_MAX } from "agboss";
import { PromptCaching, Reasoning } from "agboss/models";
import { SearchJobsTool } from "../tools/search-jobs.tool.js";
import { FetchSalaryBandMcpTool } from "../mcp/fetch-salary-band.mcp.js";
import { CompensationHandbookRag } from "../rag/compensation-handbook.rag.js";
import { GroundedOfferJudge } from "../judges/grounded-offer.judge.js";
import { CandidatePiiPolicy } from "../policies/candidate.pii-policy.js";
import { OfferComplianceGuardrail } from "../guardrails/offer-compliance.guardrail.js";
import { CandidateInputDto, OfferDraftDto, DraftApprovedDto, ChangesRequestedDto } from "../dto/offer.dto.js";

@Agent({
  name: "offer-reviewer-agent",
  description: "Audits offer drafts against compensation bands and either approves or requests changes",
  model: "moonshotai/kimi-k2.6",
  promptUrls: ["./offer-reviewer.prompt.md"],
  promptVariables: {
    department: "Core Engineering",
  },
  input: {
    candidate: CandidateInputDto,
    draft: OfferDraftDto,
    priorCritiques: optional(historyOf(ChangesRequestedDto, { limit: 3 })),
  },
  output: oneOf(DraftApprovedDto, ChangesRequestedDto),
  tools: [SearchJobsTool, FetchSalaryBandMcpTool],
  rag: [
    {
      use: CompensationHandbookRag,
      mode: RagMode.Tool,
    },
  ],
  judges: [GroundedOfferJudge],
  maxRetries: 2,
  maxToolCalls: 6,
  maxVisits: 4,
  temperature: 0.1,
  maxTokens: MODEL_MAX,
  reasoning: Reasoning.on({ effort: "medium" }),
  cache: PromptCaching.ephemeral(),
  historyLimit: 8,
  historySummaries: 2,
  piiPolicies: [CandidatePiiPolicy],
  guardrails: [OfferComplianceGuardrail],
})
export class OfferReviewerAgent {}
```

```md title="src/agents/offer-reviewer.prompt.md"
# Role: Principal Compensation Reviewer ({{department}})

Audit the candidate offer draft against the {{department}} salary bands.
- Cite every handbook rule using its [source] identifier.
- Output `DraftApprovedDto` only if base salary and equity are within band.
- Otherwise output `ChangesRequestedDto` with concrete revision instructions.
```

```ts title="src/dto/offer.dto.ts" no-check: reference example
import { Integer, Text } from "agboss/dto";

export class CandidateInputDto {
  @Text() level!: string;
  @Text() location!: string;
}

export class OfferDraftDto {
  @Text() text!: string;
  @Integer() baseSalaryUsd!: number;
}

export class DraftApprovedDto {
  @Text() summary!: string;
}

export class ChangesRequestedDto {
  @Text() notes!: string;
}
```

```ts title="src/workflows/offer-review.workflow.ts" no-check: reference example
import { Workflow, agent, caseOf, start } from "agboss";
import { OfferReviewerAgent } from "../agents/offer-reviewer.agent.js";
import { CandidateInputDto, OfferDraftDto, DraftApprovedDto, ChangesRequestedDto } from "../dto/offer.dto.js";

const draftStep = agent(OfferWriterAgent);

@Workflow({
  name: "offer-review-workflow",
  version: "1.0.0",
  flow: [
    start(OfferReviewStart)
      .returns(CandidateInputDto)
      .toAgent(draftStep)
      .returns(OfferDraftDto)
      .toAgent(OfferReviewerAgent)
      .switch(
        caseOf(DraftApprovedDto, { about: draftStep })
          .toFinish(OfferReviewFinish),
        caseOf(ChangesRequestedDto, { about: draftStep })
          .toAgent(draftStep),
      ),
  ],
})
export class OfferReviewWorkflow {}
```

## What related entities work with `@Agent`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `oneOf(DtoA, DtoB)`, `listOf(Dto)`, `optional(Dto)`, `historyOf(Dto, { limit })` | `"agboss"` | Declares union output variants, list outputs, optional inputs, and bounded loop histories. |
| `Reasoning` & `PromptCaching` | `"agboss/models"` | Configures reasoning effort (`Reasoning.on({ effort })`) and prompt caching (`PromptCaching.ephemeral()`). |
| `RagMode` (`Tool`, `Context`) | `"agboss"` | Controls whether a `@Rag` knowledge base is exposed as a callable search tool or injected into context automatically. |
| `VisitsLimitExceededError` | `"agboss"` | Thrown before the model call when an agent exceeds `maxVisits` in a review loop; catchable via `.onError()`. |
| `mockLlm(AgentClass)` & `replyWith(Dto, value)` | `"agboss/testing"` | Scripts deterministic agent responses, tool calls (`callTool`), and simulated latency (`waitFor`) in `testWith()` tests. |

### Scripting `@Agent` behavior in tests with `mockLlm`

```ts title="test/offer-reviewer.agent.test.ts" no-check: reference example
import { callTool, replyWith, testWith } from "agboss/testing";
import { usd } from "agboss/units";
import { OfferApplication } from "../offer.application.js";
import { OfferReviewerAgent } from "./offer-reviewer.agent.js";
import { SearchJobsTool } from "../tools/search-jobs.tool.js";
import { DraftApprovedDto, ChangesRequestedDto } from "../dto/offer.dto.js";

const test = testWith(OfferApplication);

test("scripts tool calls and union output variants on OfferReviewerAgent", async ({ app, mockLlm }) => {
  mockLlm(OfferReviewerAgent)
    .when({ draft: { text: "Draft v1" } })
    .thenReturn(
      callTool(SearchJobsTool, { query: "Staff Engineer" }),
      replyWith(ChangesRequestedDto, { notes: "Add equity vesting schedule" }),
    );

  mockLlm(OfferReviewerAgent)
    .when({ draft: { text: "Draft v2" } })
    .thenReturn(
      replyWith(DraftApprovedDto, { summary: "Meets all bands" }, { cost: usd(0.012) }),
    );
});
```

```ts title="src/offer.application.ts" no-check: reference example
import { Application } from "agboss";
import { OfferReviewWorkflow } from "./workflows/offer-review.workflow.js";

@Application({
  name: "offer-application",
  version: "1.0.0",
  workflows: [OfferReviewWorkflow],
})
export class OfferApplication {}
```
