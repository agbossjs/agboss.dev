---
title: Conversation Memory & Compaction
description: "Configure what a workflow remembers of its thread with @Memory: the window of recent turns (uncompactedTurns), summaries (CompactionStrategy or compact()), and ttl."
---

In AGBoss, a conversation thread is a sequence of completed workflow executions (**turns**). Agents and model-backed routers see a bounded window of recent finished turns (`uncompactedTurns`) plus summaries of older turns written by a [`@Memory`](/reference/memory/) class, keeping context windows bounded and predictable without losing long-range facts. A workflow without a `memory` is **stateless**: its agents and routers read no earlier turn (before, they read the last five), and a start that reuses a `threadId` without one is a warning.

## How turn windows (`uncompactedTurns`) and `@Memory` strategies work

Only **finished** executions enter thread memory (each formatted as `start <start-name>: <input JSON>` and `finish <finish-name>: <output JSON>`; paused or failed executions and intermediate step outputs never pollute thread history).

What a thread remembers is declared as a dedicated [`@Memory`](/reference/memory/) class — a window (`uncompactedTurns`), a `ttl`, and either a `compaction` strategy (`CompactionStrategy.SummaryQueue` or `CompactionStrategy.SingleSummary`) or a `compact()` method of your own — and bound via `memory` on `@Workflow`, `@Agent` or a model `@Router` (the lowest level that sets one wins; `NoMemory` sees no earlier turn). A compaction summarizes every turn older than the smallest `uncompactedTurns` among the agents and routers that share it, so no reader ever loses a turn:

<!-- snippet-context
import {
  Application,
  Budget,
  BudgetPeriod,
  BudgetScope,
  EmptyEnvironment,
  type BudgetHandler,
} from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";

// @snippet

@Budget({ name: "support-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class SupportAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(50); } }
@Budget({ name: "support-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class SupportTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "support-exec-budget", scope: BudgetScope.Execution })
export class SupportExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "support-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [CompactingSupportWorkflow],
  budgets: [SupportAppBudget, SupportTenantBudget, SupportExecBudget],
})
export class SupportApplication {}
-->
```ts title="src/workflows/compacting-support.workflow.ts" file=src/compacting-support.workflow.ts
import {
  Agent,
  CompactionStrategy,
  ExecutionContext,
  Injectable,
  Memory,
  TokenLimit,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  onStart,
  type CompactionInput,
  type CompactionTurn,
  inline,
  Ttl,
} from "@agboss/core";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "@agboss/core/dto";
import { days } from "@agboss/core/units";

@Memory({
  name: "support-thread-memory",
  description: "Summarizes older support turns into a FIFO queue of 3 summaries",
  ttl: days(30), // required: how long the thread's turns and summaries are kept
  uncompactedTurns: 6,
  turnsBetweenCompactions: 2,
  compaction: {
    strategy: CompactionStrategy.SummaryQueue,
    model: "moonshotai/kimi-k2.6",
    summaryQueueLength: 3,
    summaryMaxTokens: TokenLimit.ModelMax,
  },
})
export class SupportThreadMemory {}

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

// a compact() method instead of a compaction strategy: the summaries are written in code
@Memory({
  name: "graph-memory",
  description: "Extracts facts from aged-out turns into a knowledge graph via DI",
  ttl: days(30),
  uncompactedTurns: 1,
  turnsBetweenCompactions: 2,
  deps: [KnowledgeGraphService, ExecutionContext],
})
export class GraphMemory {
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

@WorkflowStart({
  name: "support-turn-workflow-start",
  description: "Customer message in a multi-turn support thread",
  input: WorkflowStartTextDto,
})
export class SupportTurnWorkflowStart {}

@WorkflowFinish({
  name: "support-turn-workflow-finish",
  description: "Agent reply persisted in thread history",
  output: WorkflowFinishTextDto,
})
export class SupportTurnWorkflowFinish {}

@Agent({
  name: "support-memory-agent",
  description: "Answers customer questions using recent turns and compacted summaries",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Answer the customer consistently with earlier turns in the thread."),
  memory: SupportThreadMemory, // an agent's own memory overrides its workflow's
})
export class SupportMemoryAgent {}

@Workflow({
  name: "compacting-support-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [
    onStart(SupportTurnWorkflowStart)
      .toAgent(SupportMemoryAgent)
      .toFinish(SupportTurnWorkflowFinish),
  ],
  memory: GraphMemory,
  providers: [KnowledgeGraphService],
})
export class CompactingSupportWorkflow {}
```

```ts title="test/compacting-support.workflow.test.ts" file=test/compacting-support.workflow.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "@agboss/core";
import { replyWith, testWith } from "@agboss/core/testing";
import {
  KnowledgeGraphService,
  SupportApplication,
  SupportMemoryAgent,
  SupportTurnWorkflowStart,
} from "../src/compacting-support.workflow.js";

const test = testWith(SupportApplication);

test("retains thread turns and invokes custom compaction when turns age out", async ({
  app,
  mockLlm,
  mockOf,
}) => {
  mockLlm(SupportMemoryAgent).thenReturnAlways(
    replyWith("Your cluster runs in eu-central-1."),
  );
  const graph = mockOf(KnowledgeGraphService);
  graph.saveFactsAndSummarize.mockResolvedValue(["cluster region: eu-central-1"]);

  for (let i = 1; i <= 4; i++) {
    const res = await app.execute(
      SupportTurnWorkflowStart,
      { text: `Turn ${String(i)}: cluster is in eu-central-1.` },
      { threadId: "thread-acme-1" },
    );
    expect(res.status).toBe(ExecutionStatus.Finished);
  }
  expect(graph.saveFactsAndSummarize).toHaveBeenCalledTimes(1);
});
```

## `@Memory` configuration options

| Option | Where Configured | Purpose |
| :--- | :--- | :--- |
| `memory` | `@Workflow`, `@Agent`, model `@Router` | The `@Memory` class a reader uses; the lowest level that sets one wins. No `memory` on a workflow: stateless. `NoMemory` on an agent or router sees no earlier turn. |
| `ttl` | `@Memory` (required) | How long the thread's turns and summaries are kept: `days(30)` or `Ttl.Forever`. The recovery sweep removes the threads of a workflow idle for longer. |
| `uncompactedTurns` | `@Memory` | Number of recent finished turns shown in full (`TurnLimit.All` for every turn; default `5`). One memory summarises everything older than the **smallest** window among its readers. |
| `turnsBetweenCompactions` | `@Memory` | How many turns older than the window pile up before they are summarised (default `1`). |
| `CompactionStrategy.SummaryQueue` | `@Memory({ compaction: { strategy } })` | Writes a new self-contained summary every `turnsBetweenCompactions` turns and retains the latest `summaryQueueLength` summaries in FIFO order. |
| `CompactionStrategy.SingleSummary` | `@Memory({ compaction: { strategy } })` | Maintains a single rolling summary rewritten from the previous summary plus the newly aged-out turns. |
| `compact(input: CompactionInput)` | method of a `@Memory` class | Writes the summaries in code, with full DI (`deps: [...]`) and automatic PII masking/unmasking; together with `compaction` it is `[memory.conflicting-compaction]`. A memory with neither keeps the window only. |
| `summaryMaxTokens` | `@Memory({ compaction })` | Maximum tokens for each summary generation call (`number` or `TokenLimit.ModelMax`). If a summary is cut at the limit, AGBoss retries once asking for a shorter summary before throwing `StepError.Memory` — never a cut summary. |

A compaction runs lazily, before a new execution's first read of its thread, never after a turn; it is observable (`onCompactionStart` / `onCompactionEnd`, `result.compacted`) and its spend is `memory:<name>`. The memory's model reads the turns through the application's and the workflow's PII policies (masked). In a test the summary is scripted — `mockLlm(SupportThreadMemory).thenReturn(replyWith("…"))` — and `testUnit(Memory)` runs one compaction on its own.
