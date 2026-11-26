---
title: "@McpServer"
description: Complete API reference for @McpServer in @agboss/core/mcp — consuming external MCP servers from a @Tool with typed DTOs, transports, references, and stubbing in tests. Replaces @McpTool.
---

`@agboss/core/mcp` provides two decorators for the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/): **`@McpServer`** (declares and supervises a connection to an external stdio or Streamable HTTP MCP server, and types its tools) and **[`@McpEndpoint`](/reference/mcp-endpoint/)** (exposes your own `@Tool` and `@WorkflowStart` classes as an MCP server). **`@McpTool` is gone**, and so are `@Workflow({ mcp })` and the `"mcp-tool"` component kind: a plain [`@Tool`](/reference/tool/) lists its `@McpServer` class in `deps` and calls it, and the application connects every server its components reach when it starts and closes them in `app.close()` — no list, no lifecycle hook of yours.

## Complete `@McpServer` and `@McpEndpoint` example

```ts title="src/mcp/workspace-fs.mcp.ts" file=src/mcp/workspace-fs.mcp.ts
import { Agent, ExecutionContext, Tool, inline } from "@agboss/core";
import { Text } from "@agboss/core/dto";
import {
  McpEndpoint,
  McpServer,
  McpServerClient,
  McpTransport,
} from "@agboss/core/mcp";

export class ReadFileArgsDto {
  @Text({ prompt: "Relative path inside the workspace" })
  path!: string;
}

export class ReadFileResultDto {
  @Text({ prompt: "UTF-8 file contents" })
  content!: string;
}

const serverTools = {
  read_file: { input: ReadFileArgsDto, output: ReadFileResultDto }, // the server's own tool name
};

// 1. @McpServer: connects to an external MCP server and types its tools (checked at start)
@McpServer({
  name: "workspace-fs-mcp",
  transport: McpTransport.Stdio, // or McpTransport.Http with a url
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "./workspace"],
  tools: serverTools,
})
export class WorkspaceFsMcpServer extends McpServerClient<typeof serverTools> {}

// 2. A @Tool the model sees; it lists the server in deps and calls it
@Tool({
  name: "read_workspace_file",
  description: "Reads a file from the sandboxed workspace MCP server",
  input: ReadFileArgsDto,
  output: ReadFileResultDto,
  deps: [WorkspaceFsMcpServer, ExecutionContext],
})
export class ReadWorkspaceFileTool {
  constructor(
    private readonly server: WorkspaceFsMcpServer,
    private readonly executionContext: ExecutionContext,
  ) {}

  execute(input: ReadFileArgsDto): Promise<ReadFileResultDto> {
    void this.executionContext.signal; // the running step's signal ends the call unless one is given
    return this.server.call("read_file", input);
  }
}

@Tool({
  name: "ping_workspace",
  description: "Checks workspace status",
  input: ReadFileArgsDto,
  output: ReadFileResultDto,
})
export class PingWorkspaceTool {
  execute(input: ReadFileArgsDto): ReadFileResultDto {
    return { content: `ok:${input.path}` };
  }
}

// 3. @McpEndpoint: publishes @Tool and @WorkflowStart classes as an MCP server
@McpEndpoint({
  name: "acme-workspace-mcp-server",
  version: "1.0.0",
  tools: [PingWorkspaceTool],
})
export class AcmeWorkspaceMcpEndpoint {}

@Agent({
  name: "workspace-reader-agent",
  description: "Reads workspace files via MCP",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Use read_workspace_file to inspect requested files."),
  tools: [ReadWorkspaceFileTool],
})
export class WorkspaceReaderAgent {}
```

```ts title="test/workspace-fs.mcp.test.ts" file=test/workspace-fs.mcp.test.ts
import { expect, it } from "vitest";
import { testModule, testUnit } from "@agboss/core/testing";
import {
  PingWorkspaceTool,
  ReadWorkspaceFileTool,
  WorkspaceFsMcpServer,
} from "../src/mcp/workspace-fs.mcp.js";

it("stubs @McpServer calls and unit-tests exposed @Tool offline", async () => {
  const module = await testModule({ components: [ReadWorkspaceFileTool, PingWorkspaceTool] });
  const fs = module.mockMcp(WorkspaceFsMcpServer).thenReturn({
    read_file: ({ path }) => Promise.resolve({ content: `file:${path}` }),
  });
  const read = await module.runTool(ReadWorkspaceFileTool, { path: "README.md" });
  expect(read.output).toEqual({ content: "file:README.md" });
  expect(fs.calls).toHaveLength(1);
  await module.close();

  const runPing = testUnit(PingWorkspaceTool);
  const { output } = await runPing({ path: "src/index.ts" });
  expect(output.content).toBe("ok:src/index.ts");
});
```

## What options does `@McpServer` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Plain identifier of the external MCP server (`"workspace-fs-mcp"`); no kind suffix. |
| `transport` | `McpTransport.Stdio \| McpTransport.Http` | Yes | The transport — an enum, not the strings of 0.1.0. |
| `command` / `args` / `env` | `string` / `readonly string[]` / `Record` | Stdio | Launch command of a stdio server. Each takes text or `defineEnv` references (`EnvRef`, `SecretRef`); an `env` entry that resolves to `undefined` is left out, and `inheritSystemEnv` (default `true`) passes `PATH`, `HOME`, `LANG` and `TMPDIR`. |
| `url` / `headers` | `string \| EnvRef` / `Record` | Http | Endpoint and headers, read once at start; secrets are references, never values (`headers: { authorization: bearer(secretRef) }`). The class's `protected getHeaders()` adds headers per request. |
| `tools` | `ServerTools` (`Record<string, { input?: DtoClass; output: DtoClass }>`) | Yes | The server's tools this application uses, typing `this.server.call(toolName, args)`; at start each must exist with a compatible input schema, else the start fails with `McpError.Contract`. A tool that takes no arguments declares no `input`; a plain-text one declares `output: PlainTextDto`. |
| `timeout` | `Milliseconds` | No | One call at most (30 s by default). |
| `costPerCall` | `Usd` | No | Charged to the step once per call, under the call's own ledger identity. |
| `maxConcurrentCalls` | `number` | No | Queues calls past the limit. |
| `target` | `{ application, endpoint }` | No | Names an AGBoss application's endpoint for `agboss check --federation`. |

A call is `call(name, args, { key?, signal?, timeout? })`: two calls of one step to one tool need distinct `key`s to be distinct calls. A failure is an `McpError` (`Unavailable`, `Contract`, `MethodNotFound`) — never the server's text — or the `AGBossError` it carried as it is (a mesh limit, a timeout). Everything a tool gets applies: `timeout`, `maxResultSize`, `approval`, PII masking of arguments and results, `SpendRecorder`, `executionContext.step.idempotencyKey`. `AgentsConfig.mcpServers` is removed.

## What related entities work with `@McpServer`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `McpServerClient<TTools>` | `"@agboss/core/mcp"` | Base class extended by `@McpServer` classes; provides `this.call(toolName, input)` with compile-checked arguments and return types. |
| `McpTransport`, `connectMcp`, `connectMcpStdio`, `mcpHttpListener` | `"@agboss/core/mcp"` | The transports of a client and of an [`@McpEndpoint`](/reference/mcp-endpoint/). |
| `bearer(secretRef)`, `defineEnv`, `env`, `secret` | `"@agboss/core"` | The references a server's settings are written with. |
| `mockMcp(ServerClass).thenReturn({ … })` | fixture of `testWith`, `testModule`, `testAgent` | Stubs an `@McpServer` in tests without spawning an external process; `.calls` lists what the server got, `.reset()` forgets handlers and calls. |
