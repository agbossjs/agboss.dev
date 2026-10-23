---
title: "@McpServer, @McpTool & @McpExpose"
description: Complete API reference for @McpServer, @McpTool, and @McpExpose in agboss/mcp — consuming external MCP servers with typed DTOs and exposing tools over MCP.
---

`agboss/mcp` provides three decorators for the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/): **`@McpServer`** (declares and supervises a connection to an external stdio or HTTP/SSE MCP server), **`@McpTool`** (wraps an external server's tool in compile-checked TypeScript input/output DTOs and `ToolHandler`), and **`@McpExpose`** (exposes your own `@Tool` and `@WorkflowStart` classes as an MCP server via `createMcpService(app, ConfigClass)`).

## Complete `@McpServer`, `@McpTool`, and `@McpExpose` example

```ts title="src/mcp/workspace-fs.mcp.ts" file=src/mcp/workspace-fs.mcp.ts
import { Agent, ExecutionContext, Tool, type ToolHandler } from "agboss";
import { Text } from "agboss/dto";
import {
  McpExpose,
  McpServer,
  McpServerClient,
  McpTool,
  type ServerTools,
} from "agboss/mcp";

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
} as const satisfies ServerTools;

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
export class ReadWorkspaceFileMcpTool
  implements ToolHandler<ReadFileArgsDto, ReadFileResultDto>
{
  constructor(
    private readonly server: WorkspaceFsMcpServer,
    private readonly executionContext: ExecutionContext,
  ) {}

  async run(input: ReadFileArgsDto): Promise<ReadFileResultDto> {
    void this.executionContext.signal;
    return this.server.call("read_file", input);
  }
}

@Tool({
  name: "ping_workspace",
  description: "Checks workspace status",
  input: ReadFileArgsDto,
  output: ReadFileResultDto,
})
export class PingWorkspaceTool implements ToolHandler<ReadFileArgsDto, ReadFileResultDto> {
  run(input: ReadFileArgsDto): Promise<ReadFileResultDto> {
    return Promise.resolve({ content: `ok:${input.path}` });
  }
}

// 3. @McpExpose: publishes @Tool and @WorkflowStart classes as an MCP server
@McpExpose({
  name: "acme-workspace-mcp-server",
  version: "1.0.0",
  exports: [PingWorkspaceTool],
})
export class AcmeWorkspaceMcpConfig {}

@Agent({
  name: "workspace-reader-agent",
  description: "Reads workspace files via MCP",
  model: "moonshotai/kimi-k2.6",
  prompt: "Use read_workspace_file to inspect requested files.",
  tools: [ReadWorkspaceFileMcpTool],
})
export class WorkspaceReaderAgent {}
```

```ts title="test/workspace-fs.mcp.test.ts" file=test/workspace-fs.mcp.test.ts
import { expect, it } from "vitest";
import { mcpServerStub, testTool } from "agboss/testing";
import {
  PingWorkspaceTool,
   WorkspaceFsMcpServer,
} from "../src/mcp/workspace-fs.mcp.js";

it("stubs @McpServer calls and unit-tests exposed @Tool offline", async () => {
  const fsStub = mcpServerStub(WorkspaceFsMcpServer, {
    read_file: ({ path }) => Promise.resolve({ content: `file:${path}` }),
  });
  const readRes = await fsStub.call("read_file", { path: "README.md" });
  expect(readRes.content).toBe("file:README.md");

  const runPing = testTool(PingWorkspaceTool);
  const { output } = await runPing({ path: "src/index.ts" });
  expect(output.content).toBe("ok:src/index.ts");
});
```

## What options do `@McpServer`, `@McpTool`, and `@McpExpose` accept?

| Decorator | Option | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `@McpServer` | `name` | `string` | **Yes** | Unique identifier for the external MCP server (`"workspace-fs-mcp"`). |
| `@McpServer` | `command` / `args` or `url` | `string` / `readonly string[]` | **Yes** | Launch command for stdio servers (`command`, `args`, `env`) or endpoint `url` for HTTP/SSE servers. |
| `@McpServer` | `tools` | `ServerTools` (`Record<string, { input: DtoClass; output: DtoClass }>`) | **Yes** | Map of upstream MCP tool names to their input and output DTO classes, typing `this.server.call(toolName, args)`. |
| `@McpTool` | `name`, `description`, `input`, `output` | Same as [`@Tool`](/reference/tool/) | **Yes** | Exposes the MCP capability to `@Agent({ tools: [...] })` with full DTO validation. |
| `@McpTool` | `server` | `Class` | **Yes** | The `@McpServer` class this tool calls; also listed in `deps` for constructor injection. |
| `@McpTool` | `deps` | `readonly Token[]` | No | Constructor dependencies including the `@McpServer` client class and `ExecutionContext`. |
| `@McpExpose` | `name` | `string` | **Yes** | Server name advertised to connecting MCP clients (`"acme-support-mcp"`). |
| `@McpExpose` | `version` | `string` | **Yes** | Server version advertised over MCP (`"1.0.0"`). |
| `@McpExpose` | `exports` | `readonly Class[]` | **Yes** | Array of `@Tool` and `@WorkflowStart` classes exposed over MCP. |

## What related entities work with `@McpServer`, `@McpTool`, and `@McpExpose`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `McpServerClient<TTools>` | `"agboss/mcp"` | Base class extended by `@McpServer` classes; provides `this.call(toolName, input)` with compile-checked arguments and return types. |
| `@Workflow({ mcp: [ServerClass] })` | `"agboss"` | Registers `@McpServer` classes on the workflow so the container connects them on startup and closes them on shutdown. |
| `createMcpService(app, ExposeConfigClass)` | `"agboss/mcp"` | Creates a stdio (`service.connectStdio()`) or session-based MCP server from a booted `App` and an `@McpExpose` class. |
| `mcpServerStub(ServerClass, handlers)` | `"agboss/testing"` | Stubs an `@McpServer` in unit tests (`testTool`) without spawning an external process. |
