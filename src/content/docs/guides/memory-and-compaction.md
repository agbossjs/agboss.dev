---
title: Conversation Memory & Compaction
description: Manage multi-turn thread history windows and automatic FIFO summary compaction in AGBoss workflows and agents.
---

In AGBoss, a conversation thread is a sequence of completed workflow executions (**turns**). Routers and agents automatically see a bounded window of recent finished turns plus compacted summaries of older turns, keeping context windows small and predictable without losing long-range facts.

## How turn windows and FIFO summary compaction work

Only **finished** executions enter thread memory (each formatted as `start <start-name>: <input JSON>` and `finish <finish-name>: <output JSON>`; paused or failed executions and intermediate step outputs never pollute thread history). When `compaction` is configured on `@Workflow`, AGBoss summarizes every `every` turns into a self-contained memory summary and retains the latest `keep` summaries in a FIFO queue:

```ts title="src/workflows/compacting-support.workflow.ts" no-check: reference example
import { Agent, Workflow, WorkflowFinish, WorkflowStart, start } from "agboss";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "agboss/dto";
import { Reasoning } from "agboss/models";

@WorkflowStart({
  name: "support-turn-workflow-start",
  description: "Customer message in a multi-turn support thread",
  input: WorkflowStartTextDto,
})
export class SupportTurnStart {}

@WorkflowFinish({
  name: "support-turn-workflow-finish",
  description: "Agent reply persisted in thread history",
  output: WorkflowFinishTextDto,
})
export class SupportTurnFinish {}

@Agent({
  name: "support-memory-agent",
  description: "Answers customer questions using recent turns and compacted summaries",
  model: "moonshotai/kimi-k2.6",
  prompt: "Answer the customer consistently with earlier turns in the thread.",
  historyLimit: 6,
  historySummaries: 3,
})
export class SupportMemoryAgent {}

@Workflow({
  name: "compacting-support-workflow",
  version: "1.0.0",
  flow: [
    start(SupportTurnStart)
      .returns(WorkflowStartTextDto)
      .toAgent(SupportMemoryAgent)
      .toFinish(SupportTurnFinish),
  ],
  defaults: {
    models: { temperature: 0 },
    router: { model: "typesafe/jev-1.13" },
    history: {
      limit: 4,
      summaries: 3,
    },
  },
  compaction: {
    every: 2,
    keep: 3,
    model: {
      model: "moonshotai/kimi-k2.6",
      reasoning: Reasoning.off(),
    },
  },
})
export class CompactingSupportWorkflow {}
```

```ts title="test/compacting-support.workflow.test.ts" no-check: reference example
import { expect } from "vitest";
import { replyWith, testWith } from "agboss/testing";
import { WorkflowFinishTextDto } from "agboss/dto";
import { SupportApplication } from "../src/support.application.js";
import { SupportMemoryAgent, SupportTurnStart } from "../src/workflows/compacting-support.workflow.js";

const test = testWith(SupportApplication);

test("retains thread turns across executions on the same threadId", async ({ app, mockLlm }) => {
  mockLlm(SupportMemoryAgent).thenReturn(
    replyWith(WorkflowFinishTextDto, { text: "Noted: cluster region is eu-central-1." }),
  );
  await app.execute(
    SupportTurnStart,
    { text: "Our production cluster is in eu-central-1." },
    { threadId: "thread-acme-1" },
  );

  mockLlm(SupportMemoryAgent).thenReturn(
    replyWith(WorkflowFinishTextDto, { text: "Your cluster runs in eu-central-1." }),
  );
  const second = await app.execute(
    SupportTurnStart,
    { text: "Which region is our cluster in?" },
    { threadId: "thread-acme-1" },
  );
  expect(second.isFinished()).toBe(true);
});
```

## Memory configuration options

| Option | Where Configured | Purpose |
| :--- | :--- | :--- |
| `defaults.history.limit` | `@Workflow({ defaults })` | Default number of recent finished turns shown to agents and routers in the workflow. |
| `defaults.history.summaries` | `@Workflow({ defaults })` | Default number of compacted summaries shown before recent turns (`0` disables reading summaries). |
| `historyLimit` | `@Agent` | Overrides `defaults.history.limit` for a specific agent. |
| `historySummaries` | `@Agent` | Overrides `defaults.history.summaries` for a specific agent. |
| `compaction.every` | `@Workflow({ compaction })` | Compacts older turns into a new summary after every `every` completed turns. |
| `compaction.keep` | `@Workflow({ compaction })` | Maximum number of summaries retained in the FIFO summary queue. |
| `compaction.model` | `@Workflow({ compaction })` | Model and reasoning configuration used to generate turn summaries. |
