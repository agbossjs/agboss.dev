---
title: "@McpEndpoint"
description: Complete API reference for @McpEndpoint, connectMcpStdio, connectMcp and mcpHttpListener in @agboss/core/mcp — exposing AGBoss @WorkflowStart and @Tool classes as an MCP server. Replaces @McpExpose.
---

The `@McpEndpoint` decorator (`"@agboss/core/mcp"`, `mcp/*.mcp-endpoint.ts`) and the transports `connectMcpStdio`, `connectMcp` and `mcpHttpListener` turn an AGBoss `@Application` into a standards-compliant **Model Context Protocol (MCP) server**. External MCP clients (Codex, Cursor, Windsurf, Claude Code, or another AGBoss application) can discover and call your exposed [`@WorkflowStart`](/reference/workflow-start/) entry points and [`@Tool`](/reference/tool/) classes with full `@Budget`, `@PiiPolicy`, and `@InputGuardrail` / `@OutputGuardrail` enforcement.

## Complete `@McpEndpoint` example

```ts title="src/mcp/job-scout.expose.ts" file=src/mcp/job-scout.expose.ts
import { Tool, WorkflowStart, createApp } from "@agboss/core";
import { Text, WorkflowStartTextDto } from "@agboss/core/dto";
import { McpEndpoint, connectMcpStdio } from "@agboss/core/mcp";
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
export class SearchJobsTool {
  execute({ query }: JobQueryDto): JobResultsDto {
    return { text: `Matches for ${query}` };
  }
}

@WorkflowStart({
  name: "chat-workflow-start",
  description: "Starts a Job Scout recruiting turn from an MCP client",
  input: WorkflowStartTextDto,
})
export class ChatWorkflowStart {}

@McpEndpoint({
  name: "job-scout-mcp",
  version: "1.0.0",
  description: "Job Scout's tools and its chat start",
  tools: [SearchJobsTool, ChatWorkflowStart], // tools of the workflow, and its starts
})
export class JobScoutMcpEndpoint {}

export async function serveMcpStdio() {
  const app = await createApp(JobScoutApplication);
  // local clients over stdio; for HTTP: mcpHttpListener(app, { endpoint, publicUrl, authenticator })
  await using connection = await connectMcpStdio(app, {
    endpoint: JobScoutMcpEndpoint,
    session: { tenant: { tenantId: "acme" }, ownerId: "claude-desktop" }, // who the local client is
  }); // serves until closed
  void connection;
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
  onStart,
  type BudgetHandler,
  inline,
  secret,
  Ttl,
} from "@agboss/core";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "@agboss/core/dto";
import { ModelCost, ModelProvider, OpenRouterDriver } from "@agboss/core/models";
import { minutes, usd, type Usd } from "@agboss/core/units";
import { ChatWorkflowStart, JobScoutMcpEndpoint, SearchJobsTool } from "./mcp/job-scout.expose.js";

@ModelProvider({
  name: "job-scout-model-provider",
  description: "OpenRouter for the scout",
  driver: OpenRouterDriver({ apiKey: secret("OPENROUTER_API_KEY") }),
  timeout: minutes(2),
  cost: ModelCost.fromResponse(),
})
export class JobScoutModelProvider {}

@WorkflowFinish({ name: "chat-workflow-finish", description: "Answer", output: WorkflowFinishTextDto })
export class ChatWorkflowFinish {}

@Agent({
  name: "scout-agent",
  description: "Scout",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Scout."),
  tools: [SearchJobsTool],
})
export class ScoutAgent {}

@Workflow({
  name: "job-scout-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [
    onStart(ChatWorkflowStart)
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
  modelProvider: JobScoutModelProvider,
  providers: [JobScoutModelProvider],
  endpoints: [JobScoutMcpEndpoint],
  budgets: [JsAppBudget, JsTenantBudget, JsExecBudget],
})
export class JobScoutApplication {}
```
-->

```ts title="test/job-scout.expose.test.ts" file=test/job-scout.expose.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "@agboss/core";
import { replyWith, testUnit, testWith } from "@agboss/core/testing";
import { JobScoutApplication, ScoutAgent } from "../src/job-scout.application.js";
import {
  ChatWorkflowStart,
  JobScoutMcpEndpoint,
  SearchJobsTool,
} from "../src/mcp/job-scout.expose.js";

const test = testWith(JobScoutApplication);

test("executes the MCP-exposed tool and workflow start entry point", async ({ app, mockModel }) => {
  expect(JobScoutMcpEndpoint).toBeDefined();

  const runSearchTool = testUnit(SearchJobsTool);
  const { output: toolOut } = await runSearchTool({ query: "Staff TypeScript" });
  expect(toolOut.text).toContain("Staff TypeScript");

  mockModel(ScoutAgent).thenReturn(replyWith("Found 3 Staff TypeScript roles."));
  const wfOut = await app.execute(ChatWorkflowStart, { text: "Find Staff TypeScript roles" });
  expect(wfOut.status).toBe(ExecutionStatus.Finished);
});
```

## What options does `@McpEndpoint` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | **Yes** | MCP server identifier advertised during protocol initialization (e.g., `"job-scout-mcp"`); kebab-case, no suffix needed. |
| `version` | `string` | **Yes** | Semantic version of the exposed MCP surface (e.g., `"1.0.0"`). |
| `description` | `string` | No | What the endpoint offers. |
| `tools` | `readonly Class[]` | **Yes** | Array of [`@Tool`](/reference/tool/) and [`@WorkflowStart`](/reference/workflow-start/) classes exposed as callable MCP tools (`exports` of 0.1.0). A start runs `app.execute`, and with any start exported `resume_workflow` (`app.resume`) is offered too. |

List the endpoint in `@Application({ endpoints })`.

## How an endpoint is served

`McpService`, `createMcpService`, `McpSession`, `McpServiceOptions`, `handleSse` and `handleMessage` of 0.1.0 are removed:

- **stdio:** `connectMcpStdio(app, { endpoint, session? })` returns an `McpConnection`; `await using` closes it.
- **Any SDK server transport:** `connectMcp(app, { endpoint, transport, session? })`; the transport is typed by AGBoss's own structural `McpWireTransport`. An application with a `tenantContext` must pass a `session` with its tenant.
- **Streamable HTTP:** `mcpHttpListener(app, { endpoint, publicUrl, authenticator?, base?, maxBodySize?, onError?, allowAnonymous? })`. Each HTTP request is admitted on its own — a signed mesh peer (`X-AGBoss-Mesh`, for `publicUrl`'s origin) or the caller an [`@HttpAuthenticator`](/reference/a2a-endpoint/#who-calls-an-endpoint-httpauthenticator) names (required with a `tenantContext`). Anonymous access is opt-in (`allowAnonymous: true`, only in an application with no `tenantContext` and beside no authenticator) and token-bound, never socket-bound: an anonymous caller is `anonymous:<Mcp-Session-Id>`.

## What related entities work with `@McpEndpoint`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `connectMcpStdio`, `connectMcp`, `mcpHttpListener` | `"@agboss/core/mcp"` | The transports above. |
| `McpServer` | `"@agboss/core/mcp"` | The client side: [`@McpServer`](/reference/mcp/). |
| `@HttpAuthenticator` | `"@agboss/core"` | Who calls an HTTP listener — a class with `authenticate(request)`. |
| `@Mesh` | `"@agboss/core"` | Signs calls between AGBoss applications over MCP and A2A. |
