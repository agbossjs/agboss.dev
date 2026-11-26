---
title: "@Agent"
description: Complete API reference for the @Agent decorator in AGBoss — all options, prompts, input/output shapes, tools, RAG, @Judge gates, reasoning, and testing.
---

The `@Agent` decorator defines an LLM-powered workflow node (`agents/*.agent.ts`) in AGBoss. An agent is a pure declarative class that binds a model, static instructions (`prompt`, a `PromptSource`), typed Path Scope `input` fields, structured `output` DTOs (including `oneOf(...)` union variants), `@Tool` capabilities (a tool may call an `@McpServer`), `@Rag` knowledge bases, `@Judge` quality gates, a `@Memory`, and loop/token limits.

## Complete `@Agent` example with all capabilities

```ts title="src/agents/offer-reviewer.agent.ts" file=src/agents/offer-reviewer.agent.ts
import { Agent, TokenLimit, historyOf, oneOf } from "@agboss/core";
import {
  CacheRetention,
  CachedPart,
  PromptCaching,
  Reasoning,
  ReasoningEffort,
} from "@agboss/core/models";
import {
  CandidatePiiPolicy,
  CompensationHandbookRag,
  FetchSalaryBandTool,
  GroundedOfferJudge,
  OfferComplianceGuardrail,
  OfferMemory,
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
  prompt: "./offer-reviewer.prompt.md", // a PromptSource: a file next to this one (./, ../, /), inline("…") or a list
  promptVariables: {
    department: "Core Engineering",
  },
  input: {
    candidate: CandidateInputDto,
    drafts: historyOf(OfferDraftDto, { maxPrevious: 3 }),
  },
  output: oneOf(DraftApprovedDto, ChangesRequestedDto),
  tools: [SearchJobsTool, FetchSalaryBandTool],
  rag: [CompensationHandbookRag], // retrieved before the first model call; search(query) is for a tool
  judges: [GroundedOfferJudge],
  executionLimits: { maxRetries: 2, maxToolCalls: 6, maxVisits: 4 },
  temperature: 0.1,
  maxTokens: TokenLimit.ModelMax,
  reasoning: Reasoning.on({ effort: ReasoningEffort.Medium }),
  cache: PromptCaching.on({
    retention: CacheRetention.FiveMinutes,
    cachedParts: [CachedPart.SystemPrompt, CachedPart.Tools, CachedPart.History],
  }),
  memory: OfferMemory,
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
import { Integer, Text } from "@agboss/core/dto";

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
import { Workflow, onAgent, onStart, toAgent, toFinish, Ttl } from "@agboss/core";
import { OfferReviewerAgent } from "../agents/offer-reviewer.agent.js";
import {
  OfferReviewFinish,
  OfferReviewStart,
  OfferWriterAgent,
} from "../agents/offer-deps.js";

@Workflow({
  name: "offer-review-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [
    onStart(OfferReviewStart)
      .toAgent(OfferWriterAgent),

    onAgent(OfferWriterAgent)
      .toAgent(OfferReviewerAgent)
      .toOneOf([
        toFinish(OfferReviewFinish),
        toAgent(OfferWriterAgent),
      ]),
  ],
})
export class OfferReviewWorkflow {}
```

```ts title="src/offer.application.ts" file=src/offer.application.ts
import { Application, EmptyEnvironment } from "@agboss/core";
import { AgAppBudget, AgExecBudget, AgModelProvider, AgTenantBudget } from "./agents/offer-deps.js";
import { OfferReviewWorkflow } from "./workflows/offer-review.workflow.js";

@Application({
  name: "offer-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [OfferReviewWorkflow],
  modelProvider: AgModelProvider,
  providers: [AgModelProvider],
  budgets: [AgAppBudget, AgTenantBudget, AgExecBudget],
})
export class OfferApplication {}
```

```ts title="test/offer-reviewer.agent.test.ts" file=test/offer-reviewer.agent.test.ts
import { callTool, replyWith, testWith } from "@agboss/core/testing";
import { usd } from "@agboss/core/units";
import { OfferApplication } from "../src/offer.application.js";
import { OfferReviewerAgent } from "../src/agents/offer-reviewer.agent.js";
import { SearchJobsTool } from "../src/agents/offer-deps.js";
import { ChangesRequestedDto, DraftApprovedDto } from "../src/dto/offer.dto.js";

const test = testWith(OfferApplication);

test("scripts tool calls and union output variants on OfferReviewerAgent", ({ mockModel }) => {
  mockModel(OfferReviewerAgent)
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
  Memory,
  OutputGuardrail,
  PiiKind,
  PiiPolicy,
  Tool,
  WorkflowFinish,
  WorkflowStart,
  inline,
  oneOf,
  secret,
  type BudgetHandler,
  type JudgeHandler,
  type JudgeInput,
} from "@agboss/core";
import { McpServer, McpServerClient, McpTransport } from "@agboss/core/mcp";
import { ModelCost, ModelProvider, OpenRouterDriver } from "@agboss/core/models";
import { Rag, RagScope, RagSource, type RagRetrieval } from "@agboss/core/rag";
import { days, minutes, usd, type Usd } from "@agboss/core/units";
import {
  CandidateInputDto,
  ChangesRequestedDto,
  DraftApprovedDto,
  OfferDraftDto,
} from "../dto/offer.dto.js";

@ModelProvider({
  name: "ag-model-provider",
  description: "OpenRouter for the agents of this page",
  driver: OpenRouterDriver({ apiKey: secret("OPENROUTER_API_KEY") }),
  timeout: minutes(2),
  cost: ModelCost.fromResponse(),
})
export class AgModelProvider {}

@Memory({
  name: "offer-memory",
  description: "Remembers eight turns in full",
  ttl: days(30),
  uncompactedTurns: 8,
})
export class OfferMemory {}

@Tool({
  name: "search_jobs",
  description: "Searches open roles",
  input: CandidateInputDto,
  output: OfferDraftDto,
})
export class SearchJobsTool {
  execute(_input: CandidateInputDto): OfferDraftDto {
    return { text: "Band L6", baseSalaryUsd: 220_000 };
  }
}

const serverTools = {
  fetch_salary_band: { input: CandidateInputDto, output: OfferDraftDto },
};

@McpServer({
  name: "compensation-mcp",
  transport: McpTransport.Stdio,
  command: "npx",
  args: ["comp-mcp"],
  tools: serverTools,
})
export class CompensationMcpServer extends McpServerClient<typeof serverTools> {}

// the model sees the @Tool; the tool calls the server it lists in deps (there is no @McpTool)
@Tool({
  name: "fetch_salary_band",
  description: "Fetches salary band from MCP",
  input: CandidateInputDto,
  output: OfferDraftDto,
  deps: [CompensationMcpServer],
})
export class FetchSalaryBandTool {
  constructor(private readonly server: CompensationMcpServer) {}
  execute(input: CandidateInputDto): Promise<OfferDraftDto> {
    return this.server.call("fetch_salary_band", input);
  }
}

@Rag({
  name: "compensation_handbook",
  description: "Compensation handbook",
  scope: RagScope.Tenant,
  topK: 3,
})
export class CompensationHandbookRag extends RagSource {
  protected override retrieve(): RagRetrieval {
    return { results: [{ text: "L6 band $200k-$240k", source: "band-l6" }] };
  }
}

@Judge({
  name: "grounded-offer-judge",
  description: "Verifies offer review grounding",
  output: oneOf(DraftApprovedDto, ChangesRequestedDto),
})
export class GroundedOfferJudge implements JudgeHandler<DraftApprovedDto | ChangesRequestedDto> {
  judge(_input: JudgeInput<DraftApprovedDto | ChangesRequestedDto>): JudgeVerdict {
    return JudgeVerdict.passed();
  }
}

@PiiPolicy({
  name: "candidate-pii-policy",
  description: "Masks candidate emails",
  rules: [PiiKind.Email.mask()],
})
export class CandidatePiiPolicy {}

@OutputGuardrail({
  name: "offer-compliance-guardrail",
  description: "Checks offer compliance",
  prompt: inline("Does the reply violate offer policy?"),
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
  prompt: inline("Write the offer draft."),
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

Every `@Agent` class name ends with `Agent` and its `name` option ends with `-agent`. An option that is not on the list is `[decorator.unknown-option]` at assembly:

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier ending with `-agent` (e.g., `"draft-reviewer-agent"`). |
| `description` | `string` | Yes | Describes the agent's responsibility for traces, Studio graphs, and CLI inspection. |
| `model` | `string` | No | Model identifier (e.g., `"moonshotai/kimi-k2.6"`); left out, `defaults.models.model` or the provider's default role is used. It must be served by the provider the cascade resolves. |
| `modelProvider` | `Class` | No | The `@ModelProvider` of this agent's model; left out, the workflow's, then the application's. No provider anywhere: `[model.missing-provider]`. |
| `prompt` | `PromptSource` | No | The system prompt: a file path (a string starting with `./`, `../` or `/`, read next to the declaring file), `inline("…")` (or the tagged `` inline`…` ``), or a list of them joined by one blank line. Bare text does not compile (`[prompt.bare-text]`); `promptUrls` and `file()` are gone. |
| `promptVariables` | `Record<string, string \| EnvRef<string>>` | No | Static `{{key}}` template values substituted into the prompt at assembly time (the nearest declaration wins; a `secret(…)` is `[prompt.secret-in-instructions]`, a key no prompt uses `[prompt.unused-variable]`). |
| `input` | `InputFields` | No | Map of DTOs read from the workflow's Path Scope (`{ draft: OfferDraftDto, history: historyOf(CritiqueDto, { maxPrevious: 3 }) }`). |
| `output` | `OutputShape` | No | Structured output DTO class, `listOf(Dto)`, or `oneOf(ApprovedDto, ChangesRequestedDto)`. A text agent (no `output`) answers `WorkflowFinishTextDto`. |
| `tools` | `readonly Class[]` | No | `@Tool` classes the agent can invoke during its tool-calling loop. A tool that reaches an MCP server lists its `@McpServer` in `deps`. |
| `rag` | `readonly Class[]` | No | `@Rag` knowledge bases retrieved before the agent's first model call and put in its input; a `@Tool` that injects one calls `search(query)` instead. A class listed twice is `[agent.duplicate-rag]`. |
| `judges` | `readonly Class[]` | No | `@Judge` classes that verify the agent's reply and trigger self-correction retries on failure. |
| `executionLimits` | `AgentExecutionLimits` | No | `{ maxRetries, maxToolCalls, maxModelCalls, maxVisits }`: self-correction retries when a `@Judge` rejects or the answer is invalid, tool calls and model calls within one visit, and the times an execution may visit the agent (`LimitError.Visits`). The flat `maxRetries`, `maxToolCalls` and `maxVisits` of 0.1.0 are gone. |
| `memory` | `Class` | No | The [`@Memory`](/reference/memory/) of this agent: its window and summaries (overrides the workflow's); `NoMemory` sees no earlier turn. |
| `reasoning` | `Reasoning` | No | Reasoning effort: `Reasoning.off()`, `Reasoning.on({ effort: ReasoningEffort.Low \| Medium \| High })`, or `Reasoning.modelDecides()`. |
| `cache` | `CacheSetting` | No | Prompt caching policy (`PromptCaching.off()` or `PromptCaching.on({ retention, cachedParts, key })`; `whereSupported` is gone). |
| `temperature` | `number` | No | Sampling temperature (`0` by default). |
| `maxTokens` | `number \| TokenLimit` | No | Maximum completion tokens (`8192` by default, or `TokenLimit.ModelMax`). |
| `files` | `ModelFiles` | No | Which files of the thread reach this agent's model and how (views); bounded by the workflow's `@FilePolicy`. |
| `piiPolicies` | `readonly Class[]` | No | Additional `@PiiPolicy` classes applied to this agent's model and tool calls. |
| `excludePiiPolicies` | `readonly Class[]` | No | Application or workflow `@PiiPolicy` classes explicitly exempted for this agent. |
| `guardrails` | `readonly Class[]` | No | Additional [`@InputGuardrail` / `@OutputGuardrail`](/reference/guardrail/) classes applied to this agent. |
| `excludeGuardrails` | `readonly Class[]` | No | Inherited application or workflow guardrails exempted for this agent. |
| `toolInterceptors` | `readonly Class[]` | No | Additional [`@ToolInterceptor`](/reference/tool-interceptor/) classes applied to every `@Tool` invoked by this agent. |
| `excludeToolInterceptors` | `readonly Class[]` | No | Inherited application or workflow `@ToolInterceptor` classes exempted for this agent. |
| `price` | `Price` | No | A custom USD price per 1M input/output tokens (and cache reads and writes) overriding the provider's cost table; a model with no price fails closed. |

## What related entities work with `@Agent`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `oneOf(DtoA, DtoB)`, `listOf(Dto)`, `optional(Dto)`, `historyOf(Dto, { maxPrevious })` | `"@agboss/core"` | Declares union output variants, list outputs, optional inputs, and bounded loop histories. |
| `inline`, `PromptSource` | `"@agboss/core"` | The forms of a `prompt`. |
| `Reasoning` & `PromptCaching` | `"@agboss/core/models"` | Configures reasoning effort (`Reasoning.on({ effort })`) and prompt caching (`PromptCaching.on({ … })`). |
| `LimitError.Visits` | `"@agboss/core"` | Thrown before the model call when an agent exceeds `executionLimits.maxVisits` in a review loop; catchable via `.onError()`. |
| `mockModel(AgentClass)` & `replyWith(Dto, value)` | `"@agboss/core/testing"` | Scripts deterministic agent responses, tool calls (`callTool`), and simulated latency (`waitFor`) in `testWith()` tests. |
