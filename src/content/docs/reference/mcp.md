---
title: "@McpServer, @McpTool & @McpExpose"
description: Complete API reference for the @McpServer, @McpTool, and @McpExpose decorators in AGBoss — consuming external MCP servers with typed DTOs and exposing AGBoss tools over MCP.
---

AGBoss provides three decorators for the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/): **`@McpServer`** (declares and supervises a connection to an external stdio, SSE, or Streamable HTTP MCP server), **`@McpTool`** (wraps an external server's tool in compile-checked TypeScript input/output DTOs and `ToolHandler`), and **`@McpExpose`** (exposes your own `@Tool` classes as an MCP server via `createMcpService(app, ConfigClass)`).

## What options do `@McpServer`, `@McpTool`, and `@McpExpose` accept?

| Decorator | Option | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `@McpServer` | `name` | `string` | Yes | Unique identifier for the external MCP server (`"filesystem-mcp"`). |
| `@McpServer` | `transport` | `"stdio" \| "http" \| "sse"` | Yes | Transport protocol used to connect to the server (`command`/`args` for `"stdio"`, `url` for `"http"`/`"sse"`). |
| `@McpServer` | `tools` | `Record<string, { input: DtoClass; output: DtoClass }>` | Yes | Map of upstream MCP tool names to their input and output DTO classes, typing `this.server.call(toolName, args)`. |
| `@McpTool` | `name`, `description`, `input`, `output` | Same as `@Tool` | Yes | Exposes the MCP capability to `@Agent({ tools: [...] })` with full DTO validation. |
| `@McpTool` | `server` | `Class` | Yes | The `@McpServer` class this tool calls; also listed in `deps` for constructor injection. |
| `@McpTool` | `deps` | `readonly Token[]` | No | Constructor dependencies including the `@McpServer` client class and `ExecutionContext`. |
| `@McpExpose` | `name` | `string` | Yes | Server name advertised to connecting MCP clients (`"support-tools-mcp"`). |
| `@McpExpose` | `version` | `string` | Yes | Server version advertised over MCP (`"0.0.2"`). |
| `@McpExpose` | `exports` | `readonly Class[]` | Yes | Array of `@Tool` classes exposed over MCP; each call runs in an isolated AGBoss execution. |

## Complete `@McpServer`, `@McpTool`, and `@McpExpose` examples

```ts title="src/mcp/github-and-exposed.mcp.ts" no-check: reference example
import { ExecutionContext, McpExpose, McpServer, McpServerClient, McpTool, type ToolHandler } from "agboss";
import { createMcpService } from "agboss/mcp";
import { Text } from "agboss/dto";
import { RefundCardPaymentTool } from "../tools/refund-card-payment.tool.js";

export class ReadFileArgsDto {
  @Text({ prompt: "Relative path inside the workspace" })
  path!: string;
}

export class ReadFileResultDto {
  @Text({ prompt: "UTF-8 file contents" })
  content!: string;
}

const serverTools = {
  read_file: {
    input: ReadFileArgsDto,
    output: ReadFileResultDto,
  },
} as const;

// 1. @McpServer: connects to an external MCP server and types its tools
@McpServer({
  name: "workspace-fs-mcp",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "./workspace"],
  tools: serverTools,
})
export class WorkspaceFsMcpServer extends McpServerClient<typeof serverTools> {}

// 2. @McpTool: wraps the MCP server call with constructor DI and ToolHandler
@McpTool({
  name: "read_workspace_file",
  description: "Reads a file from the sandboxed workspace MCP server",
  server: WorkspaceFsMcpServer,
  input: ReadFileArgsDto,
  output: ReadFileResultDto,
  deps: [WorkspaceFsMcpServer, ExecutionContext],
})
export class ReadWorkspaceFileMcpTool implements ToolHandler<ReadFileArgsDto, ReadFileResultDto> {
  constructor(
    private readonly server: WorkspaceFsMcpServer,
    private readonly executionContext: ExecutionContext,
  ) {}

  async run(input: ReadFileArgsDto): Promise<ReadFileResultDto> {
    return this.server.call("read_file", input, {
      signal: this.executionContext.signal,
    });
  }
}

// 3. @McpExpose: publishes internal @Tool classes as an MCP server
@McpExpose({
  name: "acme-support-mcp-server",
  version: "0.0.2",
  exports: [RefundCardPaymentTool],
})
export class AcmeSupportMcpConfig {}
```

```ts title="src/agents/release-notes.agent.ts" no-check: reference example
import { Agent } from "agboss";
import { ListPullRequestsMcpTool } from "../mcp/github-and-exposed.mcp.js";

@Agent({
  name: "release-notes-agent",
  description: "Summarizes merged pull requests via GitHub MCP",
  model: "moonshotai/kimi-k2.6",
  prompt: "Fetch open and merged PRs using list_pull_requests.",
  tools: [ListPullRequestsMcpTool],
})
export class ReleaseNotesAgent {}
```

```ts title="test/list-pull-requests.mcp.test.ts" no-check: reference example
import { expect } from "vitest";
import { mockTool, testWith } from "agboss/testing";
import { ReleaseApplication } from "../src/release.application.js";
import { ListPullRequestsMcpTool } from "../src/mcp/github-and-exposed.mcp.js";

const test = testWith(ReleaseApplication);

test("mocks @McpTool calls deterministically without spawning an MCP child process", async ({ app }) => {
  mockTool(ListPullRequestsMcpTool).thenReturn({
    pullRequests: ["#412 Add weighted tenant queues"],
  });
  const res = await app.execute(ReleaseStart, { repo: "agbossjs/agboss" });
  expect(res.isFinished()).toBe(true);
});
```

## What related entities work with `@McpServer`, `@McpTool`, and `@McpExpose`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `McpServerClient<TTools>` | `"agboss"` | Base class extended by `@McpServer` classes; provides `this.call(toolName, input, options)` with compile-checked arguments and return types. |
| `@Workflow({ mcp: [ServerClass] })` | `"agboss"` | Registers `@McpServer` classes on the workflow so the container connects them on startup and closes them on shutdown. |
| `createMcpService(app, ExposeConfigClass)` | `"agboss/mcp"` | Creates a stdio or HTTP MCP server from a booted `App` and an `@McpExpose` class. |
| `testTool(McpToolClass, { overrides })` | `"agboss/testing"` | Unit-tests an `@McpTool` offline by overriding its `@McpServer` dependency. |
