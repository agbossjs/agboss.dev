---
title: "@McpExpose"
description: Complete API reference for @McpExpose and createMcpService in agboss/mcp — exposing AGBoss @WorkflowStart and @Tool classes as an MCP server.
---

The `@McpExpose` decorator and `createMcpService(app, ConfigClass)` (`"@agboss/core/mcp"`) turn an AGBoss `@Application` into a standards-compliant **Model Context Protocol (MCP) server**. External MCP clients (Codex, Cursor, Windsurf, Claude Code, or another AGBoss application) can discover and call your exposed [`@WorkflowStart`](/reference/workflow-start/) entry points and [`@Tool`](/reference/tool/) classes with full `@Budget`, `@PiiPolicy`, and `@InputGuardrail` / `@OutputGuardrail` enforcement.

## Complete `@McpExpose` and `createMcpService` example

```ts title="src/mcp/job-scout.expose.ts" file=src/mcp/job-scout.expose.ts
import { Tool, WorkflowStart, createApp, type ToolHandler } from "@agboss/core";
import { Text, WorkflowStartTextDto } from "@agboss/core/dto";
import { McpExpose, createMcpService } from "@agboss/core/mcp";
import { JobScoutApplication } from "../job-scout.application.js";

export class JobQueryDto {
  @Text({ prompt: "Role keywords" })
  query!: string;
}

export class JobResultsDto {
  @Text({ prompt: "Formatted job matches" })
  text!: string;
}

@Tool({
  name: "search_jobs",
  description: "Searches open engineering roles",
  input: JobQueryDto,
  output: JobResultsDto,
})
export class SearchJobsTool implements ToolHandler<JobQueryDto, JobResultsDto> {
  run({ query }: JobQueryDto): Promise<JobResultsDto> {
    return Promise.resolve({ text: `Matches for ${query}` });
  }
}

@WorkflowStart({
  name: "chat-workflow-start",
  description: "Starts a Job Scout recruiting turn from an MCP client",
  input: WorkflowStartTextDto,
})
export class ChatWorkflowStart {}

@McpExpose({
  name: "job-scout-mcp",
  version: "1.0.0",
  exports: [SearchJobsTool, ChatWorkflowStart],
})
export class JobScoutMcpExpose {}

export async function serveMcpStdio() {
  const app = await createApp(JobScoutApplication);
  const service = createMcpService(app, JobScoutMcpExpose);
  await service.connectStdio();
}
```

<!--
```ts file=src/job-scout.application.ts
import {
  Agent,
  Application,
  Budget,
  BudgetPeriod,
  BudgetScope,
  EmptyEnvironment,
  Workflow,
  WorkflowFinish,
  start,
  type BudgetHandler,
} from "@agboss/core";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "@agboss/core/dto";
import { usd, type Usd } from "@agboss/core/units";
import { ChatWorkflowStart, SearchJobsTool } from "./mcp/job-scout.expose.js";

@WorkflowFinish({ name: "chat-workflow-finish", description: "Answer", output: WorkflowFinishTextDto })
export class ChatWorkflowFinish {}

@Agent({
  name: "scout-agent",
  description: "Scout",
  model: "moonshotai/kimi-k2.6",
  prompt: "Scout.",
  tools: [SearchJobsTool],
})
export class ScoutAgent {}

@Workflow({
  name: "job-scout-workflow",
  version: "1.0.0",
  flow: [
    start(ChatWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toAgent(ScoutAgent)
      .toFinish(ChatWorkflowFinish),
  ],
})
export class JobScoutWorkflow {}

@Budget({ name: "js-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class JsAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(50); } }
@Budget({ name: "js-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class JsTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "js-exec-budget", scope: BudgetScope.Execution })
export class JsExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "job-scout-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [JobScoutWorkflow],
  budgets: [JsAppBudget, JsTenantBudget, JsExecBudget],
})
export class JobScoutApplication {}
```
-->

```ts title="test/job-scout.expose.test.ts" file=test/job-scout.expose.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "@agboss/core";
import { replyWith, testTool, testWith } from "@agboss/core/testing";
import { JobScoutApplication, ScoutAgent } from "../src/job-scout.application.js";
import {
  ChatWorkflowStart,
  JobScoutMcpExpose,
  SearchJobsTool,
} from "../src/mcp/job-scout.expose.js";

const test = testWith(JobScoutApplication);

test("executes the MCP-exposed tool and workflow start entry point", async ({ app, mockLlm }) => {
  expect(JobScoutMcpExpose).toBeDefined();

  const runSearchTool = testTool(SearchJobsTool);
  const { output: toolOut } = await runSearchTool({ query: "Staff TypeScript" });
  expect(toolOut.text).toContain("Staff TypeScript");

  mockLlm(ScoutAgent).thenReturn(replyWith("Found 3 Staff TypeScript roles."));
  const wfOut = await app.execute(ChatWorkflowStart, { text: "Find Staff TypeScript roles" });
  expect(wfOut.status).toBe(ExecutionStatus.Finished);
});
```

## What options does `@McpExpose` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | **Yes** | MCP server identifier advertised during protocol initialization (e.g., `"job-scout-mcp"`). |
| `version` | `string` | **Yes** | Semantic version of the exposed MCP surface (e.g., `"1.0.0"`). |
| `exports` | `readonly Class[]` | **Yes** | Array of [`@Tool`](/reference/tool/) and [`@WorkflowStart`](/reference/workflow-start/) classes exposed as callable MCP tools. |
