---
title: "@WorkflowStart"
description: Complete API reference for the @WorkflowStart decorator in AGBoss — input DTO shapes, start() flow chains, and app.execute() options.
---

The `@WorkflowStart` decorator defines a typed entry point (`workflow-starts/*.workflow-start.ts`) for starting a `@Workflow`. A workflow can declare multiple `@WorkflowStart` classes (for example, an interactive chat start and a batch webhook start), each seeding its own initial DTOs into the workflow's Path Scope via `start(StartClass).returns(InputDto)`.

## What options does `@WorkflowStart` accept?

Every `@WorkflowStart` class name ends with `WorkflowStart` and its `name` option ends with `-workflow-start`:

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier ending with `-workflow-start` (e.g., `"chat-workflow-start"`). |
| `description` | `string` | Yes | Human- and CLI-readable description of what triggers this entry point. |
| `input` | `DtoClass \| ListWrapper<DtoClass> \| Readonly<Record<string, ValueShape>>` | Yes | The DTO class, `listOf(DtoClass)`, or map of DTO fields required by `app.execute(StartClass, payload)`. |

## Complete `@WorkflowStart` examples (single DTO, list input, and multi-field input)

```ts title="src/workflow-starts/role-match.workflow-start.ts" no-check: reference example
import { WorkflowStart, listOf, optional } from "agboss";
import { Text, Url } from "agboss/dto";

export class CandidateProfileDto {
  @Text({ minLength: 1, prompt: "Candidate full name" })
  fullName!: string;

  @Url({ prompt: "Link to candidate resume or portfolio" })
  resumeUrl!: string;
}

export class JobRoleDto {
  @Text({ minLength: 1, prompt: "Target engineering role title" })
  roleTitle!: string;
}

// 1. Single DTO input:
@WorkflowStart({
  name: "single-candidate-workflow-start",
  description: "Evaluates a single candidate profile",
  input: CandidateProfileDto,
})
export class SingleCandidateWorkflowStart {}

// 2. List of DTOs input (for .toParallelAgents({ each })):
@WorkflowStart({
  name: "batch-candidates-workflow-start",
  description: "Screens a batch of candidates in parallel",
  input: listOf(CandidateProfileDto),
})
export class BatchCandidatesWorkflowStart {}

// 3. Multi-field map input with optional fields:
@WorkflowStart({
  name: "role-match-workflow-start",
  description: "Matches a candidate against a specific job role",
  input: {
    candidate: CandidateProfileDto,
    role: optional(JobRoleDto),
  },
})
export class RoleMatchWorkflowStart {}
```

```ts title="src/agents/matcher.agent.ts" no-check: reference example
import { Agent, listOf, optional } from "agboss";
import { CandidateProfileDto, JobRoleDto } from "../workflow-starts/role-match.workflow-start.js";

@Agent({
  name: "matcher-agent",
  description: "Scores candidate profile against open roles",
  model: "moonshotai/kimi-k2.6",
  prompt: "Rank the candidate profile against open roles.",
  input: {
    profile: CandidateProfileDto,
    roles: optional(listOf(JobRoleDto)),
  },
})
export class MatcherAgent {}
```

## What related entities work with `@WorkflowStart`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `start(StartClass)` | `"agboss"` | Starts a flow path in `@Workflow({ flow })` and chains `.returns(...)` to place the start's input DTOs into Path Scope. |
| `WorkflowStartTextDto` | `"agboss/dto"` | Standard built-in DTO (`{ text: string }`) for chat and text-first workflow entry points. |
| `app.execute(StartClass, input, options?)` | `"agboss"` | Executes the workflow owning `StartClass` with compile-checked `InputOf<StartClass>` payload. |
| `ExecutionOptions` | `"agboss"` | Optional third argument to `app.execute`: `{ threadId, ownerId, tenant, execution, signal, record }`. |
| `ExecutionOutput` | `"agboss"` | Return value of `app.execute`: discriminated by `status` (`ExecutionStatus.Finished` or `ExecutionStatus.Paused`). |

### Wiring `@WorkflowStart` in a workflow and calling `app.execute()`

```ts title="src/workflows/role-match.workflow.ts" no-check: reference example
import { ExecutionStatus, start } from "agboss";
import { RoleMatchWorkflowStart, CandidateProfileDto, JobRoleDto } from "./role-match.workflow-start.js";
import { MatcherAgent } from "../agents/matcher.agent.js";
import { MatchWorkflowFinish } from "../workflow-finishes/match.workflow-finish.js";

// Inside @Workflow({ flow }):
const path = start(RoleMatchWorkflowStart)
  .returns(CandidateProfileDto)
  .returns(JobRoleDto)
  .toAgent(MatcherAgent)
  .toFinish(MatchWorkflowFinish);

// Calling app.execute() with typed payload and execution options:
const result = await app.execute(
  RoleMatchWorkflowStart,
  {
    candidate: { fullName: "Ada Lovelace", resumeUrl: "https://example.com/ada.pdf" },
    role: { roleTitle: "Principal Systems Engineer" },
  },
  {
    threadId: "candidate-ada-01",
    ownerId: "recruiter-7",
    tenant: { tenantId: "acme" },
    record: true,
  },
);

if (result.status === ExecutionStatus.Finished) {
  console.log(result.finish.name, result.output);
}
```

```ts title="test/role-match.workflow-start.test.ts" no-check: reference example
import { expect } from "vitest";
import { testWith } from "agboss/testing";
import { RoleMatchApplication } from "../src/role-match.application.js";
import { RoleMatchWorkflowStart } from "../src/workflow-starts/role-match.workflow-start.js";

const test = testWith(RoleMatchApplication);

test("validates RoleMatchWorkflowStart input before entering the graph", async ({ app }) => {
  const res = await app.execute(RoleMatchWorkflowStart, {
    profile: { fullName: "Ada Lovelace", resumeUrl: "https://example.com/ada.pdf" },
  });
  expect(res.record.executionId).toBeDefined();
});
```
