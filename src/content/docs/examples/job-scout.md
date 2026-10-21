---
title: "Examples: job-scout & flow-patterns"
description: Explore runnable job-scout and flow-patterns examples in AGBoss — multi-agent routing, review loops with about, code routers, parallel waves, MCP, and RAG.
---

The AGBoss repository includes two complete reference packages under `examples/` that depend only on the public `agboss` entries (enforced by ESLint): `examples/job-scout` for a full interactive multi-agent application, and `examples/flow-patterns` for advanced workflow control-flow patterns verified by scripted tests.

## How the `examples/job-scout` application works

`examples/job-scout` reads a candidate's resume from disk, proposes a structured search brief, fetches live openings from public Greenhouse boards, ranks every match using the Jev decision model (`JobFitJudge`), explains why top matches fit using a SQLite FTS5 `@Rag` knowledge base (`company_notes`), and saves selected jobs through the official filesystem `@McpServer` after pausing for user approval (`TerminalUserChannel`):

<!--
```ts file=job-scout.components.ts
import { Agent, DecidedBy, Injectable, Router, WorkflowFinish, WorkflowStart } from "agboss";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "agboss/dto";

@WorkflowStart({ name: "chat-workflow-start", description: "A message", input: WorkflowStartTextDto })
export class ChatWorkflowStart {}

@WorkflowFinish({ name: "chat-workflow-finish", description: "The answer", output: WorkflowFinishTextDto })
export class ChatWorkflowFinish {}

@Agent({ name: "profiler-agent", description: "Reads the resume", prompt: "Read the resume.", model: "moonshotai/kimi-k2.6" })
export class ProfilerAgent {}

@Agent({ name: "scout-agent", description: "Finds jobs", prompt: "Find jobs.", model: "moonshotai/kimi-k2.6" })
export class ScoutAgent {}

@Agent({ name: "shortlist-agent", description: "Saves jobs", prompt: "Save shortlist.", model: "moonshotai/kimi-k2.6" })
export class ShortlistAgent {}

@Router({
  name: "main-router",
  description: "Sends the message to the agent that answers it",
  decidedBy: DecidedBy.Model,
  prompt: "Pick the agent that answers the message.",
  input: { message: WorkflowStartTextDto },
  routes: [
    { prompt: "Reading the resume", target: ProfilerAgent },
    { prompt: "Finding jobs", target: ScoutAgent },
    { prompt: "Managing the shortlist", target: ShortlistAgent },
  ],
})
export class MainRouter {}

@Injectable()
export class JobFitJudge {}
```
-->

<!-- snippet-context
import {
  ChatWorkflowFinish,
  ChatWorkflowStart,
  JobFitJudge,
  MainRouter,
  ProfilerAgent,
  ScoutAgent,
  ShortlistAgent,
} from "./job-scout.components.js";
-->
```ts title="src/job-scout.workflow.ts" file=job-scout.workflow.ts
import { Workflow, route, start } from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";

@Workflow({
  name: "job-scout-workflow",
  version: "1.0.0",
  flow: [
    start(ChatWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toRouter(MainRouter)
      .chooseOne(
        route(ProfilerAgent)
          .toFinish(ChatWorkflowFinish),
        route(ScoutAgent)
          .toFinish(ChatWorkflowFinish),
        route(ShortlistAgent)
          .toFinish(ChatWorkflowFinish),
      ),
  ],
  defaults: {
    models: { temperature: 0 },
    router: { model: "typesafe/jev-1.13" },
    tools: { maxToolCalls: 8 },
    history: { limit: 5 },
  },
  providers: [JobFitJudge],
})
export class JobScout {}
```

```ts title="src/job-scout.components.ts" no-check: context tab
import { Agent, DecidedBy, Injectable, Router, WorkflowFinish, WorkflowStart } from "agboss";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "agboss/dto";

@WorkflowStart({ name: "chat-workflow-start", description: "A message", input: WorkflowStartTextDto })
export class ChatWorkflowStart {}

@WorkflowFinish({ name: "chat-workflow-finish", description: "The answer", output: WorkflowFinishTextDto })
export class ChatWorkflowFinish {}

@Agent({ name: "profiler-agent", description: "Reads the resume", prompt: "Read the resume.", model: "moonshotai/kimi-k2.6" })
export class ProfilerAgent {}

@Agent({ name: "scout-agent", description: "Finds jobs", prompt: "Find jobs.", model: "moonshotai/kimi-k2.6" })
export class ScoutAgent {}

@Agent({ name: "shortlist-agent", description: "Saves jobs", prompt: "Save shortlist.", model: "moonshotai/kimi-k2.6" })
export class ShortlistAgent {}

@Router({
  name: "main-router",
  description: "Sends the message to the agent that answers it",
  decidedBy: DecidedBy.Model,
  prompt: "Pick the agent that answers the message.",
  input: { message: WorkflowStartTextDto },
  routes: [
    { prompt: "Reading the resume", target: ProfilerAgent },
    { prompt: "Finding jobs", target: ScoutAgent },
    { prompt: "Managing the shortlist", target: ShortlistAgent },
  ],
})
export class MainRouter {}

@Injectable()
export class JobFitJudge {}
```

Run `examples/job-scout` from the repository root:

```bash
npm install && npm run build
cd examples/job-scout
npm run chat
npm run describe
```

## What patterns are demonstrated in `examples/flow-patterns`?

`examples/flow-patterns` (`src/flow-patterns.application.ts`) demonstrates four advanced AGBoss workflow patterns tested 100% offline with `testWith` and `agboss check`:

- **`src/offer/` (Review loop with `{ about }`):** `draft-agent` → `reviewer-agent` returning `oneOf(ChangesRequestedDto, DraftApprovedDto)`. When changes are requested, `caseOf(ChangesRequestedDto, { about: OfferDraftDto })` routes to `editor-agent` (`maxVisits: 2`), with `.onError(VisitsLimitExceededError, ...)` handling exhausted review cycles.
- **`src/credit/` (Code router beside model router):** Combines a Jev model router with `credit-limit-router` (`DecidedBy.Code`), routing small orders to `charge-card-action` and larger orders to `approval-agent`.
- **`src/review/` (Parallel launches in waves):** Runs a reviewer per document section via `.toParallelAgents(...)`, joins their outputs, and launches a second wave with a critic alongside parallel fact-checker copies.
- **`src/topic/` (Recursive `ThisWorkflow`):** Researches broad topics by launching `.toParallelWorkflows(ThisWorkflow, { maxItems })` with `@Workflow({ maxDepth: 3 })`.

Inspect any pattern workflow directly with the CLI:

```bash
cd examples/flow-patterns
npx agboss describe --workflow src/offer/offer.workflow.ts
npx agboss describe --workflow src/credit/credit.workflow.ts
npm test
```
