---
title: "@Compaction"
description: API reference for the @Compaction decorator, CompactionStrategy (SummaryQueue, SingleSummary, Custom, None), and CompactionHandler in AGBoss.
---

`@Compaction` (`"@agboss/core"`) declares how completed conversation turns older than a reader's `uncompactedTurns` window are summarized in multi-turn threads. A `@Compaction` class is bound via `compaction: MyCompaction` on [`@Application`](/reference/application/), [`@Workflow`](/reference/workflow/), [`@Agent`](/reference/agent/), or [`@Router`](/reference/router/) (the most specific level that sets `compaction` wins).

## Complete `@Compaction` example

A `@Compaction` `name` must end with `-compaction` (and its TypeScript class name must end with `Compaction`). Choose one of four strategies via `CompactionStrategy` (`SummaryQueue`, `SingleSummary`, `Custom`, or `None`). With `CompactionStrategy.Custom`, your class implements `CompactionHandler` (`compact(input: CompactionInput): Promise<readonly string[]> | readonly string[]`) and can inject DI services, `TenantContext`, or `ExecutionContext` via `deps: [...]`:

```ts title="src/compactions/support.compaction.ts" file=src/compactions/support.compaction.ts
import {
  Agent,
  Application,
  Budget,
  BudgetPeriod,
  BudgetScope,
  Compaction,
  CompactionStrategy,
  EmptyEnvironment,
  ExecutionContext,
  Injectable,
  TokenLimit,
  TurnLimit,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  start,
  type BudgetHandler,
  type CompactionHandler,
  type CompactionInput,
  type CompactionTurn,
} from "@agboss/core";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "@agboss/core/dto";
import { usd, type Usd } from "@agboss/core/units";

// 1. FIFO SummaryQueue strategy (model-backed)
@Compaction({
  name: "support-queue-compaction",
  description: "Keeps the latest 3 FIFO summaries of older support turns",
  strategy: CompactionStrategy.SummaryQueue,
  model: "moonshotai/kimi-k2.6",
  turnsBetweenCompactions: 2,
  summaryQueueLength: 3,
  summaryMaxTokens: TokenLimit.MODEL_MAX,
})
export class SupportQueueCompaction {}

// 2. Rolling SingleSummary strategy (model-backed)
@Compaction({
  name: "support-rolling-compaction",
  description: "Rewrites a single rolling summary every 3 turns",
  strategy: CompactionStrategy.SingleSummary,
  model: "moonshotai/kimi-k2.6",
  turnsBetweenCompactions: 3,
  summaryMaxTokens: 512,
  prompt: "Summarize key customer facts, region settings, and unresolved questions.",
})
export class SupportRollingCompaction {}

// 3. Custom strategy (CompactionHandler + DI services / knowledge graph)
@Injectable()
export class KnowledgeGraphService {
  saveFactsAndSummarize(
    threadId: string,
    turns: readonly CompactionTurn[],
    previous: readonly string[],
  ): Promise<readonly string[]> {
    const facts = turns.map((turn) => `[${threadId}] ${JSON.stringify(turn.input)}`);
    return Promise.resolve([...previous, ...facts]);
  }
}

@Compaction({
  name: "graph-memory-compaction",
  description: "Stores aged-out turn facts in a knowledge graph and returns updated summaries",
  strategy: CompactionStrategy.Custom,
  turnsBetweenCompactions: 2,
  deps: [KnowledgeGraphService, ExecutionContext],
})
export class GraphMemoryCompaction implements CompactionHandler {
  constructor(
    private readonly knowledgeGraph: KnowledgeGraphService,
    private readonly executionContext: ExecutionContext,
  ) {}

  async compact(input: CompactionInput): Promise<readonly string[]> {
    return this.knowledgeGraph.saveFactsAndSummarize(
      this.executionContext.threadId,
      input.turnsToCompact,
      input.previousSummaries,
    );
  }
}

// 4. Window-only None strategy (no summary calls)
@Compaction({
  name: "window-only-compaction",
  description: "Shows only recent uncompactedTurns without generating summaries",
  strategy: CompactionStrategy.None,
})
export class WindowOnlyCompaction {}

@WorkflowStart({
  name: "support-chat-workflow-start",
  description: "Customer turn input",
  input: WorkflowStartTextDto,
})
export class SupportChatWorkflowStart {}

@WorkflowFinish({
  name: "support-chat-workflow-finish",
  description: "Agent turn reply",
  output: WorkflowFinishTextDto,
})
export class SupportChatWorkflowFinish {}

@Agent({
  name: "support-specialist-agent",
  description: "Answers support questions with 6 uncompacted turns",
  model: "moonshotai/kimi-k2.6",
  prompt: "Help the customer using the conversation context.",
  uncompactedTurns: 6,
})
export class SupportSpecialistAgent {}

@Agent({
  name: "audit-transcript-agent",
  description: "Sees every turn in full without compaction",
  model: "moonshotai/kimi-k2.6",
  prompt: "Review the full thread.",
  compaction: WindowOnlyCompaction,
  uncompactedTurns: TurnLimit.ALL,
})
export class AuditTranscriptAgent {}

@Workflow({
  name: "support-chat-workflow",
  version: "1.0.0",
  flow: [
    start(SupportChatWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toAgent(SupportSpecialistAgent)
      .toFinish(SupportChatWorkflowFinish),
  ],
  compaction: GraphMemoryCompaction,
  uncompactedTurns: 1,
  providers: [KnowledgeGraphService],
})
export class SupportChatWorkflow {}

@Budget({ name: "cmp-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class CmpAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(20); } }
@Budget({ name: "cmp-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class CmpTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "cmp-exec-budget", scope: BudgetScope.Execution })
export class CmpExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "support-chat-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [SupportChatWorkflow],
  budgets: [CmpAppBudget, CmpTenantBudget, CmpExecBudget],
})
export class SupportChatApplication {}
```

```ts title="test/support.compaction.test.ts" file=test/support.compaction.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "@agboss/core";
import { replyWith, testWith } from "@agboss/core/testing";
import {
  KnowledgeGraphService,
  SupportChatApplication,
  SupportChatWorkflowStart,
  SupportSpecialistAgent,
} from "../src/compactions/support.compaction.js";

const test = testWith(SupportChatApplication);

test("compacts aged-out turns using GraphMemoryCompaction across a multi-turn thread", async ({
  app,
  mockLlm,
  mockOf,
}) => {
  mockLlm(SupportSpecialistAgent).thenReturnAlways(replyWith("Updated your EU VAT ID."));
  const graph = mockOf(KnowledgeGraphService);
  graph.saveFactsAndSummarize.mockResolvedValue(["EU VAT ID updated"]);

  for (let turn = 1; turn <= 4; turn++) {
    const res = await app.execute(
      SupportChatWorkflowStart,
      { text: `Turn ${String(turn)}: update EU VAT ID` },
      { threadId: "thread-eu-1" },
    );
    expect(res.status).toBe(ExecutionStatus.Finished);
  }

  expect(graph.saveFactsAndSummarize).toHaveBeenCalledTimes(1);
});
```

## `@Compaction` options reference

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | **Yes** | Kebab-case identifier ending with `-compaction`; the class name must end with `Compaction` (`[name.kind-suffix]`). |
| `description` | `string` | **Yes** | Non-empty summary of the compaction policy. |
| `strategy` | `CompactionStrategy` | **Yes** | `CompactionStrategy.SummaryQueue`, `CompactionStrategy.SingleSummary`, `CompactionStrategy.Custom`, or `CompactionStrategy.None`. |
| `turnsBetweenCompactions` | `number` | For `SummaryQueue`, `SingleSummary`, and `Custom` | Positive integer (`>= 1`) specifying how many aged-out turns accumulate before compaction runs. |
| `deps` | `readonly Class[]` | No (`Custom` only) | Injectable dependencies (`@Injectable()`, `TenantContext`, `ExecutionContext`) passed to the `CompactionHandler` constructor. |
| `model` | `string` | For `SummaryQueue` and `SingleSummary` | Chat model identifier used to write summaries (resolved against `@ModelProvider({ serves })`). Forbidden on `Custom` and `None` (`[compaction.invalid-setting]`). |
| `summaryQueueLength` | `number` | For `SummaryQueue` only | Positive integer (`>= 1`) specifying how many summaries are retained in the FIFO queue. Forbidden on `Custom`, `SingleSummary`, and `None`. |
| `summaryMaxTokens` | `number \| TokenLimit.MODEL_MAX` | For `SummaryQueue` and `SingleSummary` | `max_tokens` limit for each summary call. Forbidden on `Custom` and `None`. |
| `prompt` / `promptUrls` | `string` / `readonly string[]` | No (`SummaryQueue` / `SingleSummary`) | Custom summarization instructions (defaults to the built-in factual summarization prompt). Forbidden on `Custom` and `None`. |

## How `CompactionHandler` & `CompactionInput` work

When `strategy: CompactionStrategy.Custom` is selected, the decorated class must implement `CompactionHandler` (enforced by TypeScript and at `agboss check` / assembly time via `[compaction.missing-handler]`):

| Interface / Type | Signature / Fields | Description |
| :--- | :--- | :--- |
| `CompactionHandler` | `compact(input: CompactionInput): Promise<readonly string[]> \| readonly string[]` | Receives the aged-out turns and existing summaries (both masked by active `@PiiPolicy` rules) and returns the complete list of summaries to store for the thread. Throws `CompactionError` if `compact()` rejects or returns a non-string / blank item. |
| `CompactionInput` | `{ turnsToCompact: readonly CompactionTurn[]; previousSummaries: readonly string[] }` | Frozen input passed to `compact()`. `previousSummaries` is `[]` on the first compaction of a thread and the previously returned `readonly string[]` on subsequent runs. |
| `CompactionTurn` | `{ startName: string; input: Readonly<Record<string, unknown>>; finishName: string; output: Readonly<Record<string, unknown>> }` | One completed workflow turn older than the `uncompactedTurns` window, with its `input` and `output` masked by the application's and workflow's `@PiiPolicy` rules. |
