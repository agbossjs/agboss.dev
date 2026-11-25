---
title: "@Memory"
description: "API reference for the @Memory decorator in AGBoss — what a workflow, agent or router remembers of its thread: window, summaries (CompactionStrategy), ttl, and a compact() of your own. Replaces @Compaction."
---

`@Memory` (`"@agboss/core"`, `memories/*.memory.ts`) declares what a workflow, an agent or a model router **remembers of its thread**: the last turns in full (its window) and, for what is older, summaries the memory writes. It replaces 0.1.0's `@Compaction`, `uncompactedTurns`, `memoryStrategy` and the `@agboss/core/memory` entry. A memory is named by `memory: MyMemory` on [`@Workflow`](/reference/workflow/), [`@Agent`](/reference/agent/) or a model [`@Router`](/reference/router/) — the lowest level that sets one wins; on a code router it does not compile. **A workflow without `memory` is stateless**: its agents and routers read no earlier turn of a thread (before, they read the last five), and a start that reuses a `threadId` without one is an assembly warning (`memory.thread-reuse-without-memory`). `NoMemory` (built in) on an agent or a router sees no earlier turn.

A thread is a sequence of **turns**, one finished root execution each — two lines, `start <start-name>: <input JSON>` and `finish <finish-name>: <output JSON>`. A paused or failed execution is not a turn; intermediate values never enter the history.

## Complete `@Memory` example

```ts title="src/memories/support.memory.ts" file=src/memories/support.memory.ts
import {
  Agent,
  CompactionStrategy,
  ExecutionContext,
  Memory,
  Ttl,
  TurnLimit,
  inline,
  type CompactionInput,
} from "@agboss/core";
import { days } from "@agboss/core/units";

// 1. A summary queue (model-backed): every turnsBetweenCompactions turns older than the window become one summary
@Memory({
  name: "support-queue-memory",
  description: "Remembers 8 turns in full and keeps the latest 3 summaries of older support turns",
  ttl: days(30), // required: how long the thread's turns and summaries are kept (or Ttl.Forever)
  uncompactedTurns: 8,
  turnsBetweenCompactions: 2,
  compaction: {
    strategy: CompactionStrategy.SummaryQueue,
    prompt: inline("Summarise the turns under `Turns to compact`: what was asked, decided and is still open."),
    model: "moonshotai/kimi-k2.6",
    summaryQueueLength: 3,
    summaryMaxTokens: 400,
  },
})
export class SupportQueueMemory {}

// 2. One rolling summary, rewritten from the previous summary and the new turns:
@Memory({
  name: "support-single-memory",
  description: "One rolling summary",
  ttl: days(30),
  compaction: { strategy: CompactionStrategy.SingleSummary },
})
export class SupportSingleMemory {}

// 3. Every turn in full: no summaries needed
@Memory({
  name: "support-archive-memory",
  description: "Every turn of the thread in full",
  ttl: Ttl.Forever,
  uncompactedTurns: TurnLimit.All,
})
export class SupportArchiveMemory {}

// 4. Summaries written in code: a compact() method (no compaction option, no implements)
@Memory({
  name: "support-facts-memory",
  description: "Keeps the facts a customer stated, written in code",
  ttl: days(7),
  deps: [ExecutionContext],
})
export class SupportFactsMemory {
  constructor(private readonly executionContext: ExecutionContext) {}

  compact(input: CompactionInput): readonly string[] {
    const stated = input.turnsToCompact.map((turn) => JSON.stringify(turn.input));
    return [...input.previousSummaries, `${this.executionContext.tenant.tenantId}: ${stated.join("; ")}`];
  }
}

@Agent({
  name: "archive-agent",
  description: "Answers from the whole thread",
  prompt: inline("Answer from the thread."),
  model: "moonshotai/kimi-k2.6",
  memory: SupportArchiveMemory, // an agent's own memory overrides its workflow's
})
export class ArchiveAgent {}

// @Workflow({ …, memory: SupportQueueMemory }) — its agents and routers
```

```ts title="test/support.memory.test.ts" file=test/support.memory.test.ts
import { expect, it } from "vitest";
import { replyWith, testUnit } from "@agboss/core/testing";
import { SupportQueueMemory } from "../src/memories/support.memory.js";

it("testUnit: the turns reach the model, the summary joins the queue", async () => {
  const compact = testUnit(SupportQueueMemory, { model: replyWith("Dana: no calls before 9.") });

  const { output } = await compact({
    previousSummaries: ["Dana asked about order 7."],
    turnsToCompact: [
      { start: "chat-workflow-start", input: { text: "Never call me before 9." }, finish: "chat-workflow-finish", output: { text: "Noted." } },
    ],
  });

  expect(output.requests[0]?.input).toContain("Never call me before 9.");
  expect(output.summaries).toEqual(["Dana asked about order 7.", "Dana: no calls before 9."]);
});
```

## `@Memory` options reference

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Kebab-case identifier ending with `-memory` (the class ends with `Memory`). |
| `description` | `string` | No | Summary of what the memory keeps. |
| `ttl` | `Milliseconds \| Ttl` | Yes | How long the thread's turns and summaries are kept: a duration (`days(30)`) or `Ttl.Forever`. The recovery sweep removes the threads of a workflow idle for longer (counted from the thread's last activity). |
| `uncompactedTurns` | `number \| TurnLimit` | No | How many recent turns a reader sees in full, as a message of its own before its input message; default 5, `TurnLimit.All` is every turn (`[memory.uncompacted-turns-invalid]`). |
| `turnsBetweenCompactions` | `number` | No | How many turns older than the window pile up before they are summarised; default 1 (`[memory.invalid-setting]`: whole numbers from 1). |
| `compaction` | `{ strategy, prompt?, model?, modelProvider?, summaryQueueLength?, summaryMaxTokens? }` | No | What is older than the window. `strategy`: `CompactionStrategy.SummaryQueue` (the latest `summaryQueueLength` summaries are kept, the oldest leaves first) or `CompactionStrategy.SingleSummary` (one summary rewritten at every compaction). `prompt` is a `PromptSource` (none: the strategy's built-in prompt); `model` / `modelProvider` follow the cascade for a chat model (a decision model is refused); `summaryMaxTokens` is the summarising call's `max_tokens` (`TokenLimit.ModelMax` = what the model allows): a summary cut at the limit is asked again once, then `StepError.Memory` — never a cut summary. |
| `compact()` | method | No | Writes the summaries in code instead; `compaction` and `compact()` together fail assembly (`[memory.conflicting-compaction]`). |
| `deps` | `readonly Token[]` | No | Constructor dependencies for `compact()`; created by the container and run in the frame of the execution's start. |

`CompactionStrategy.Custom`, `CompactionStrategy.None`, `CompactionHandler` and `@Compaction` are gone: a memory with neither `compaction` nor `compact()` keeps the window only.

## How `compact()` and `CompactionInput` work

A memory may write its summaries in code: a `compact({ previousSummaries, turnsToCompact })` method (sync or async) returns the summaries readers see from now on. `previousSummaries` is `readonly string[]`; each `CompactionTurn` has `start`, `input`, `finish` and `output`, masked like a model's input. A custom summariser writing structured facts into a knowledge graph or vector store injects that service through `deps`.

## When it runs, who reads it, what it costs

- **One memory, several readers.** A memory summarises everything older than the **smallest** window among the agents and routers that use it (a profile may set an agent's own window), so no one loses a turn: a reader sees in full its window and every turn its memory has not summarised yet, and only the summaries its turns do not cover.
- **Lazily, before a new execution's first read of its thread**, never after a turn: a finished turn's answer is always kept, a thread that ends pays for none, and a `StepError.Memory` fails the new execution before any of its work. It is observable: `onCompactionStart` / `onCompactionEnd` on an `@Observer`, `result.compacted`, and the spend is `memory:<name>` (category `memory`).
- **Privacy.** The memory's model reads the turns through the application's and the workflow's PII policies (masked); the summary is revealed before it is stored, and each reader's own policies mask it at its boundary.
- **Tests.** The summary is scripted — `mockLlm(SupportQueueMemory).thenReturn(replyWith("…"))` (`{ truncated: true }` = cut at the limit) — and unscripted it is a fixed text; `testUnit(Memory)` runs one compaction on its own.
- **Assembly rules:** `[memory.not-a-memory]`, `[memory.invalid-setting]`, `[memory.uncompacted-turns-invalid]`, `[memory.conflicting-compaction]`; `agboss describe` prints each memory with its window and strategy.
