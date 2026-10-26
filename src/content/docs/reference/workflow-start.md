---
title: "@WorkflowStart"
description: Complete API reference for the @WorkflowStart decorator in AGBoss — input DTO shapes, start() flow chains, and app.execute() options.
---

The `@WorkflowStart` decorator defines a typed entry point (`workflows/<workflow-name>/<start-name>.workflow-start.ts`) for starting a `@Workflow`. A workflow can declare multiple `@WorkflowStart` classes (for example, an interactive chat start and a batch webhook start), each seeding its own initial DTOs into the workflow's Path Scope via `start(StartClass).returns(InputDto)`.

## Complete `@WorkflowStart` examples (single DTO, list input, and multi-field input)

```ts title="src/workflows/role-match/role-match.workflow-start.ts" file=src/workflows/role-match/role-match.workflow-start.ts
import { WorkflowStart, listOf, optional } from "@agboss/core";
import { Text, Url } from "@agboss/core/dto";

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

```ts title="src/agents/matcher/matcher.agent.ts" file=src/agents/matcher/matcher.agent.ts
import { Agent, optional } from "@agboss/core";
import {
  CandidateProfileDto,
  JobRoleDto,
} from "../../workflows/role-match/role-match.workflow-start.js";

@Agent({
  name: "matcher-agent",
  description: "Scores candidate profile against open roles",
  model: "moonshotai/kimi-k2.6",
  prompt: "Rank the candidate profile against open roles.",
  input: {
    profile: CandidateProfileDto,
    role: optional(JobRoleDto),
  },
})
export class MatcherAgent {}
```

```ts title="src/workflows/role-match/role-match.workflow.ts" file=src/workflows/role-match/role-match.workflow.ts
import { Workflow, WorkflowFinish, optional, start } from "@agboss/core";
import { WorkflowFinishTextDto } from "@agboss/core/dto";
import {
  CandidateProfileDto,
  JobRoleDto,
  RoleMatchWorkflowStart,
} from "./role-match.workflow-start.js";
import { MatcherAgent } from "../../agents/matcher/matcher.agent.js";

@WorkflowFinish({
  name: "match-workflow-finish",
  description: "Returns candidate match report",
  output: WorkflowFinishTextDto,
})
export class MatchWorkflowFinish {}

@Workflow({
  name: "role-match-workflow",
  version: "1.0.0",
  flow: [
    start(RoleMatchWorkflowStart)
      .returns(CandidateProfileDto)
      .returns(optional(JobRoleDto))
      .toAgent(MatcherAgent)
      .toFinish(MatchWorkflowFinish),
  ],
})
export class RoleMatchWorkflow {}
```

<!--
```ts file=src/role-match.application.ts
import { Application, Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, type BudgetHandler } from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";
import { RoleMatchWorkflow } from "./workflows/role-match/role-match.workflow.js";

@Budget({ name: "rm-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class RmAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(20); } }
@Budget({ name: "rm-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class RmTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "rm-exec-budget", scope: BudgetScope.Execution })
export class RmExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "role-match-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [RoleMatchWorkflow],
  budgets: [RmAppBudget, RmTenantBudget, RmExecBudget],
})
export class RoleMatchApplication {}
```
-->

```ts title="test/role-match.workflow-start.test.ts" file=test/role-match.workflow-start.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "@agboss/core";
import { replyWith, testWith } from "@agboss/core/testing";
import { RoleMatchApplication } from "../src/role-match.application.js";
import { MatcherAgent } from "../src/agents/matcher/matcher.agent.js";
import { RoleMatchWorkflowStart } from "../src/workflows/role-match/role-match.workflow-start.js";

const test = testWith(RoleMatchApplication);

test("validates RoleMatchWorkflowStart input before entering the graph", async ({ app, mockLlm }) => {
  mockLlm(MatcherAgent).thenReturn(replyWith("Strong match for Principal Systems Engineer"));
  const res = await app.execute(
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
  expect(res.status).toBe(ExecutionStatus.Finished);
});
```

## What options does `@WorkflowStart` accept?

Every `@WorkflowStart` class name ends with `WorkflowStart` and its `name` option ends with `-workflow-start`:

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier ending with `-workflow-start` (e.g., `"chat-workflow-start"`). |
| `description` | `string` | Yes | Human- and CLI-readable description of what triggers this entry point. |
| `input` | `DtoClass \| ListWrapper<DtoClass> \| Readonly<Record<string, ValueShape>>` | Yes | The DTO class, `listOf(DtoClass)`, or map of DTO fields required by `app.execute(StartClass, payload)`. |

## What related entities work with `@WorkflowStart`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `start(StartClass)` | `"@agboss/core"` | Starts a flow path in `@Workflow({ flow })` and chains `.returns(...)` to place the start's input DTOs into Path Scope. |
| `WorkflowStartTextDto` | `"@agboss/core/dto"` | Standard built-in DTO (`{ text: string }`) for chat and text-first workflow entry points. |
| `app.execute(StartClass, input, options?)` | `"@agboss/core"` | Executes the workflow owning `StartClass` with compile-checked `InputOf<StartClass>` payload. |
| `ExecutionOptions` | `"@agboss/core"` | Optional third argument to `app.execute`: `{ threadId, ownerId, tenant, execution, signal, record }`. |
| `ExecutionOutput` | `"@agboss/core"` | Return value of `app.execute`: discriminated by `status` (`ExecutionStatus.Finished` or `ExecutionStatus.Paused`). |
