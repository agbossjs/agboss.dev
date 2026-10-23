---
title: "@Agent"
description: Complete API reference for the @Agent decorator in AGBoss — all options, prompts, input/output shapes, tools, RAG, @Judge gates, reasoning, and testing.
---

The `@Agent` decorator defines an LLM-powered workflow node (`agents/*.agent.ts`) in AGBoss. An agent is a pure declarative class that binds a model, static instructions (`prompt` or `promptUrls`), typed Path Scope `input` fields, structured `output` DTOs (including `oneOf(...)` union variants), `@Tool` and `@McpTool` capabilities, `@Rag` knowledge bases, `@Judge` quality gates, and loop/token limits.

## Complete `@Agent` example with all capabilities

```ts title="src/agents/offer-reviewer.agent.ts" file=src/agents/offer-reviewer.agent.ts
import { Agent, RagMode, TokenLimit, historyOf, oneOf } from "agboss";
import {
  CacheRetention,
  CachedPart,
  PromptCaching,
  Reasoning,
  ReasoningEffort,
} from "agboss/models";
import {
  CandidatePiiPolicy,
  CompensationHandbookRag,
  FetchSalaryBandMcpTool,
  GroundedOfferJudge,
  OfferComplianceGuardrail,
  SearchJobsTool,
} from "./offer-deps.js";
import {
  CandidateInputDto,
  ChangesRequestedDto,
  DraftApprovedDto,
  OfferDraftDto,
} from "../dto/offer.dto.js";

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
    drafts: historyOf(OfferDraftDto, { limit: 3 }),
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
  maxTokens: TokenLimit.MODEL_MAX,
  reasoning: Reasoning.on({ effort: ReasoningEffort.Medium }),
  cache: PromptCaching.whereSupported({
    retention: CacheRetention.FiveMinutes,
    cachedParts: [CachedPart.SystemPrompt, CachedPart.Tools, CachedPart.History],
  }),
  uncompactedTurns: 8,
  piiPolicies: [CandidatePiiPolicy],
  guardrails: [OfferComplianceGuardrail],
})
export class OfferReviewerAgent {}
```

```md title="src/agents/offer-reviewer.prompt.md" file=src/agents/offer-reviewer.prompt.md
# Role: Principal Compensation Reviewer ({{department}})

Audit the candidate offer draft against the {{department}} salary bands.
- Cite every handbook rule using its [source] identifier.
- Output `DraftApprovedDto` only if base salary and equity are within band.
- Otherwise output `ChangesRequestedDto` with concrete revision instructions.
```

```ts title="src/dto/offer.dto.ts" file=src/dto/offer.dto.ts
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

```ts title="src/workflows/offer-review.workflow.ts" file=src/workflows/offer-review.workflow.ts
import { Workflow, agent, caseOf, oneOf, start } from "agboss";
import { OfferReviewerAgent } from "../agents/offer-reviewer.agent.js";
import {
  CompensationMcpServer,
  OfferReviewFinish,
  OfferReviewStart,
  OfferWriterAgent,
} from "../agents/offer-deps.js";
import {
  CandidateInputDto,
  ChangesRequestedDto,
  DraftApprovedDto,
  OfferDraftDto,
} from "../dto/offer.dto.js";

@Workflow({
  name: "offer-review-workflow",
  version: "1.0.0",
  mcp: [CompensationMcpServer],
  flow: [
    start(OfferReviewStart)
      .returns(CandidateInputDto)
      .toAgent(OfferWriterAgent),

    agent(OfferWriterAgent)
      .returns(OfferDraftDto)
      .toAgent(OfferReviewerAgent)
      .returns(oneOf(DraftApprovedDto, ChangesRequestedDto))
      .switch(
        caseOf(DraftApprovedDto)
          .toFinish(OfferReviewFinish),
        caseOf(ChangesRequestedDto, { about: OfferDraftDto })
          .toAgent(OfferWriterAgent),
      ),
  ],
})
export class OfferReviewWorkflow {}
```

```ts title="src/offer.application.ts" file=src/offer.application.ts
import { Application, EmptyEnvironment } from "agboss";
import { AgAppBudget, AgExecBudget, AgTenantBudget } from "./agents/offer-deps.js";
import { OfferReviewWorkflow } from "./workflows/offer-review.workflow.js";

@Application({
  name: "offer-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [OfferReviewWorkflow],
  budgets: [AgAppBudget, AgTenantBudget, AgExecBudget],
})
export class OfferApplication {}
```

```ts title="test/offer-reviewer.agent.test.ts" file=test/offer-reviewer.agent.test.ts
import { callTool, replyWith, testWith } from "agboss/testing";
import { usd } from "agboss/units";
import { OfferApplication } from "../src/offer.application.js";
import { OfferReviewerAgent } from "../src/agents/offer-reviewer.agent.js";
import { SearchJobsTool } from "../src/agents/offer-deps.js";
import { ChangesRequestedDto, DraftApprovedDto } from "../src/dto/offer.dto.js";

const test = testWith(OfferApplication);

test("scripts tool calls and union output variants on OfferReviewerAgent", ({ mockLlm }) => {
  mockLlm(OfferReviewerAgent)
    .thenReturn(
      callTool(SearchJobsTool, { level: "L6", location: "Berlin" }),
      replyWith(ChangesRequestedDto, { notes: "Add equity vesting schedule" }),
    )
    .thenReturn(
      replyWith(DraftApprovedDto, { summary: "Meets all bands" }, { cost: usd(0.012) }),
    );
});
```

<!--
```ts file=src/agents/offer-deps.ts
import {
  Agent,
  Budget,
  BudgetPeriod,
  BudgetScope,
  Judge,
  JudgeVerdict,
  OutputGuardrail,
  PiiAction,
  PiiKind,
  PiiPolicy,
  Tool,
  WorkflowFinish,
  WorkflowStart,
  oneOf,
  pii,
  type BudgetHandler,
  type JudgeHandler,
  type JudgeInput,
  type ToolHandler,
} from "agboss";
import { McpServer, McpServerClient, McpTool, type ServerTools } from "agboss/mcp";
import { Rag, type RagConnector, type RagRetrieval } from "agboss/rag";
import { usd, type Usd } from "agboss/units";
import {
  CandidateInputDto,
  ChangesRequestedDto,
  DraftApprovedDto,
  OfferDraftDto,
} from "../dto/offer.dto.js";

@Tool({
  name: "search_jobs",
  description: "Searches open roles",
  input: CandidateInputDto,
  output: OfferDraftDto,
})
export class SearchJobsTool implements ToolHandler<CandidateInputDto, OfferDraftDto> {
  run(_input: CandidateInputDto): Promise<OfferDraftDto> {
    return Promise.resolve({ text: "Band L6", baseSalaryUsd: 220_000 });
  }
}

const serverTools = {
  fetch_salary_band: { input: CandidateInputDto, output: OfferDraftDto },
} as const satisfies ServerTools;

@McpServer({
  name: "compensation-mcp",
  transport: "stdio",
  command: "npx",
  args: ["comp-mcp"],
  tools: serverTools,
})
export class CompensationMcpServer extends McpServerClient<typeof serverTools> {}

@McpTool({
  name: "fetch_salary_band",
  description: "Fetches salary band from MCP",
  server: CompensationMcpServer,
  input: CandidateInputDto,
  output: OfferDraftDto,
  deps: [CompensationMcpServer],
})
export class FetchSalaryBandMcpTool implements ToolHandler<CandidateInputDto, OfferDraftDto> {
  constructor(private readonly server: CompensationMcpServer) {}
  run(input: CandidateInputDto): Promise<OfferDraftDto> {
    return this.server.call("fetch_salary_band", input);
  }
}

@Rag({ name: "compensation_handbook", description: "Compensation handbook", topK: 3 })
export class CompensationHandbookRag implements RagConnector {
  retrieve(): Promise<RagRetrieval> {
    return Promise.resolve({ results: [{ text: "L6 band $200k-$240k", source: "band-l6" }] });
  }
}

@Judge({
  name: "grounded-offer-judge",
  description: "Verifies offer review grounding",
  model: "typesafe/jev-1.13",
  reply: oneOf(DraftApprovedDto, ChangesRequestedDto),
})
export class GroundedOfferJudge
  implements JudgeHandler<DraftApprovedDto | ChangesRequestedDto>
{
  judge(_input: JudgeInput<DraftApprovedDto | ChangesRequestedDto>): Promise<JudgeVerdict> {
    return Promise.resolve(JudgeVerdict.passed());
  }
}

@PiiPolicy({
  name: "candidate-pii-policy",
  description: "Masks candidate emails",
  rules: [pii(PiiKind.Email, PiiAction.replaceWithKind())],
})
export class CandidatePiiPolicy {}

@OutputGuardrail({
  name: "offer-compliance-guardrail",
  description: "Checks offer compliance",
  prompt: "Does the reply violate offer policy?",
  model: "typesafe/jev-1.13",
  threshold: 0.85,
  refusal: "Offer review blocked by compliance policy.",
})
export class OfferComplianceGuardrail {}

@WorkflowStart({ name: "offer-review-workflow-start", description: "Start", input: CandidateInputDto })
export class OfferReviewStart {}

@WorkflowFinish({ name: "offer-review-workflow-finish", description: "Finish", output: DraftApprovedDto })
export class OfferReviewFinish {}

@Agent({
  name: "offer-writer-agent",
  description: "Writes offer draft",
  model: "moonshotai/kimi-k2.6",
  prompt: "Write the offer draft.",
  input: { candidate: CandidateInputDto },
  output: OfferDraftDto,
})
export class OfferWriterAgent {}

@Budget({ name: "ag-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class AgAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(20); } }
@Budget({ name: "ag-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class AgTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "ag-exec-budget", scope: BudgetScope.Execution })
export class AgExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }
```
-->

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
| `reasoning` | `Reasoning` | No | Reasoning effort: `Reasoning.off()`, `Reasoning.on({ effort: ReasoningEffort.Low \| Medium \| High })`, or `Reasoning.modelDecides()`. |
| `cache` | `PromptCaching` | No | Prompt caching policy (`PromptCaching.off()` or `PromptCaching.whereSupported({ retention, cachedParts })`). |
| `temperature` | `number` | No | Sampling temperature (`0` by default). |
| `maxTokens` | `number \| TokenLimit` | No | Maximum completion tokens (`8192` by default, or `TokenLimit.MODEL_MAX`). |
| `uncompactedTurns` | `number \| TurnLimit` | No | Number of recent conversation turns shown in full to this agent (overrides workflow/app `uncompactedTurns`). |
| `compaction` | `Class` | No | [`@Compaction`](/reference/compaction/) class summarizing older turns for this agent. |
| `piiPolicies` | `readonly Class[]` | No | Additional `@PiiPolicy` classes applied to this agent's model and tool calls. |
| `excludePiiPolicies` | `readonly Class[]` | No | Application or workflow `@PiiPolicy` classes explicitly exempted for this agent. |
| `guardrails` | `readonly Class[]` | No | Additional [`@InputGuardrail` / `@OutputGuardrail`](/reference/guardrail/) classes applied to this agent. |
| `excludeGuardrails` | `readonly Class[]` | No | Inherited application or workflow guardrails exempted for this agent. |
| `toolInterceptors` | `readonly Class[]` | No | Additional [`@ToolInterceptor`](/reference/tool-interceptor/) classes applied to every `@Tool` and `@McpTool` invoked by this agent. |
| `excludeToolInterceptors` | `readonly Class[]` | No | Inherited application or workflow `@ToolInterceptor` classes exempted for this agent. |
| `price` | `{ input: number; output: number }` | No | Custom USD price per 1M input/output tokens overriding the provider's cost table. |

## What related entities work with `@Agent`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `oneOf(DtoA, DtoB)`, `listOf(Dto)`, `optional(Dto)`, `historyOf(Dto, { limit })` | `"agboss"` | Declares union output variants, list outputs, optional inputs, and bounded loop histories. |
| `Reasoning` & `PromptCaching` | `"agboss/models"` | Configures reasoning effort (`Reasoning.on({ effort })`) and prompt caching (`PromptCaching.whereSupported()`). |
| `RagMode` (`Tool`, `Context`) | `"agboss"` | Controls whether a `@Rag` knowledge base is exposed as a callable search tool or injected into context automatically. |
| `VisitsLimitExceededError` | `"agboss"` | Thrown before the model call when an agent exceeds `maxVisits` in a review loop; catchable via `.onError()`. |
| `mockLlm(AgentClass)` & `replyWith(Dto, value)` | `"agboss/testing"` | Scripts deterministic agent responses, tool calls (`callTool`), and simulated latency (`waitFor`) in `testWith()` tests. |
