---
title: "@McpExpose"
description: Complete API reference for @McpExpose and createMcpService in AGBoss — exposing workflows and tools as an outbound Model Context Protocol (MCP) server.
---

The `@McpExpose` decorator and `createMcpService(Application)` turn an AGBoss `@Application` or `@Workflow` into a standards-compliant **Model Context Protocol (MCP) server** (`mcp/*.expose.ts`). External MCP clients (Claude Desktop, Cursor, or another AGBoss service) can discover and call your exposed `@WorkflowStart` entry points and `@Tool` classes with full `@Budget`, `@PiiPolicy`, and `@Guardrail` enforcement.

## What options does `@McpExpose` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | MCP server identifier advertised during protocol initialization (e.g., `"job-scout-mcp"`). |
| `version` | `string` | Yes | Semantic version of the exposed MCP surface (e.g., `"1.0.0"`). |
| `description` | `string` | Yes | Human- and LLM-readable summary of the exposed server capabilities. |
| `starts` | `readonly Class[]` | No | [`@WorkflowStart`](/reference/workflow-start/) classes exposed as callable MCP tools. |
| `tools` | `readonly Class[]` | No | [`@Tool`](/reference/tool/) classes exposed directly to MCP clients. |

## Complete `@McpExpose` and `createMcpService` example

```ts title="src/mcp/job-scout.expose.ts" no-check: reference example
import { createApp } from "agboss";
import { McpExpose, createMcpService } from "agboss/mcp";
import { JobScoutApplication } from "../job-scout.application.js";
import { ChatWorkflowStart } from "../workflow-starts/chat.workflow-start.js";
import { SearchJobsTool } from "../tools/search-jobs.tool.js";

@McpExpose({
  name: "job-scout-mcp",
  version: "1.0.0",
  description: "Exposes Job Scout workflow starts and search tools over MCP",
  starts: [ChatWorkflowStart],
  tools: [SearchJobsTool],
})
export class JobScoutMcpExpose {}

export async function bootMcpSession() {
  const app = await createApp(JobScoutApplication);
  const mcp = createMcpService(app, JobScoutMcpExpose);
  return mcp.openSession({
    tenant: { tenantId: "acme", weight: 2 },
    ownerId: "ide-user-7",
  });
}
```

```ts title="src/workflow-starts/chat.workflow-start.ts" no-check: reference example
import { WorkflowStart } from "agboss";
import { WorkflowStartTextDto } from "agboss/dto";

@WorkflowStart({
  name: "chat-workflow-start",
  description: "Starts a Job Scout recruiting turn from an MCP client",
  input: WorkflowStartTextDto,
})
export class ChatWorkflowStart {}
```

```ts title="test/job-scout.expose.test.ts" no-check: reference example
import { expect } from "vitest";
import { testWith } from "agboss/testing";
import { createMcpService } from "agboss/mcp";
import { JobScoutApplication } from "../src/job-scout.application.js";
import { JobScoutMcpExpose } from "../src/mcp/job-scout.expose.js";

const test = testWith(JobScoutApplication);

test("lists exposed @WorkflowStart and @Tool schemas in an MCP session", async ({ app }) => {
  const mcp = createMcpService(app, JobScoutMcpExpose);
  const session = mcp.openSession({ tenant: { tenantId: "acme" } });
  const tools = await session.listTools();
  expect(tools.map((t) => t.name)).toContain("search_jobs");
});
```
