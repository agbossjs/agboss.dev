---
title: "@McpTool"
description: Complete API reference for the @McpTool decorator in agboss/mcp — wrapping external Model Context Protocol server tools with typed DTO schemas, DI, and channels.
---

The `@McpTool` decorator (`"agboss/mcp"`) wraps an external [`@McpServer`](/reference/mcp/) tool inside a typed AGBoss `ToolHandler<In, Out>` class. Because an `@McpTool` is a first-class class with constructor dependency injection (`deps`), it can inject its `@McpServer` client, `ExecutionContext`, `SpendRecorder`, or custom services, and can require human approval via `channel: MyChannelRole`.

## Complete `@McpTool` example

```ts title="src/mcp/create-pull-request.mcp.ts" file=src/mcp/create-pull-request.mcp.ts
import {
  ChannelRole,
  ChannelOf,
  PauseAnswerer,
  type ToolHandler,
} from "agboss";
import { Integer, Text, Url } from "agboss/dto";
import {
  McpServer,
  McpServerClient,
  McpTool,
  type ServerTools,
} from "agboss/mcp";
import { seconds } from "agboss/units";

export class CreatePrInputDto {
  @Text({ prompt: "Repository in owner/name format" })
  repo!: string;

  @Text({ prompt: "Pull request title" })
  title!: string;

  @Text({ prompt: "Source branch name" })
  head!: string;

  @Text({ prompt: "Target base branch name" })
  base!: string;
}

export class CreatePrOutputDto {
  @Integer({ prompt: "PR number" })
  number!: number;

  @Url({ prompt: "PR HTML URL" })
  htmlUrl!: string;
}

const githubTools = {
  create_pull_request: {
    input: CreatePrInputDto,
    output: CreatePrOutputDto,
  },
} as const satisfies ServerTools;

@McpServer({
  name: "github-mcp-server",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  tools: githubTools,
})
export class GithubMcpServer extends McpServerClient<typeof githubTools> {}

@ChannelRole({
  name: "release-approval-channel",
  description: "Approves opening release pull requests",
  approves: CreatePrInputDto,
  answeredBy: PauseAnswerer.Channel,
})
export abstract class ReleaseApprovalChannel
  extends ChannelOf<ReleaseApprovalChannel> {}

@McpTool({
  name: "create_pull_request",
  description: "Opens a GitHub pull request via the GitHub MCP server after human approval",
  server: GithubMcpServer,
  input: CreatePrInputDto,
  output: CreatePrOutputDto,
  timeout: seconds(20),
  channel: ReleaseApprovalChannel,
  deps: [GithubMcpServer],
})
export class CreatePullRequestMcpTool
  implements ToolHandler<CreatePrInputDto, CreatePrOutputDto>
{
  constructor(private readonly github: GithubMcpServer) {}

  run(input: CreatePrInputDto): Promise<CreatePrOutputDto> {
    return this.github.call("create_pull_request", input);
  }
}
```

```ts title="test/create-pull-request.mcp.test.ts" file=test/create-pull-request.mcp.test.ts
import { expect, it } from "vitest";
import { mcpServerStub } from "agboss/testing";
import {
  CreatePullRequestMcpTool,
  GithubMcpServer,
} from "../src/mcp/create-pull-request.mcp.js";

it("unit-tests @McpTool offline using mcpServerStub", async () => {
  const github = mcpServerStub(GithubMcpServer, {
    create_pull_request: () =>
      Promise.resolve({
        number: 42,
        htmlUrl: "https://github.com/agbossjs/agboss/pull/42",
      }),
  });

  const tool = new CreatePullRequestMcpTool(github);
  const output = await tool.run({
    repo: "agbossjs/agboss",
    title: "feat: quorum priority groups",
    head: "feat/quorum",
    base: "main",
  });
  expect(output.number).toBe(42);
});
```

## What options does `@McpTool` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | **Yes** | Unique snake_case tool identifier exposed to `@Agent({ tools })` (e.g., `"create_pull_request"`). |
| `description` | `string` | **Yes** | Instructions telling the LLM when and how to call this MCP tool. |
| `server` | `Class` | **Yes** | The [`@McpServer`](/reference/mcp/) class that backs this tool (`extends McpServerClient<typeof tools>`). |
| `input` | `DtoClass` | **Yes** | DTO class validating arguments before `run(input)` executes. |
| `output` | `DtoClass` | **Yes** | DTO class validating the structured output returned by `run(input)`. |
| `deps` | `readonly Token[]` | No | Constructor dependencies (typically `[MyMcpServer]` plus optional `ExecutionContext` or services). |
| `channel` | `Class` | No | [`@ChannelRole`](/reference/channel-role/) or [`@Channel`](/reference/channel/) requiring human approval before invoking the MCP tool. |
| `toolInterceptors` | `readonly Class[]` | No | [`@ToolInterceptor`](/reference/tool-interceptor/) classes attached directly to this MCP tool (`BeforeToolCall` / `AfterToolCall`). |
| `excludeToolInterceptors` | `readonly Class[]` | No | Inherited application, workflow, or agent `@ToolInterceptor` classes exempted for this MCP tool. |
| `timeout` | `Milliseconds` | No | Per-call timeout (`seconds(20)`); defaults to `seconds(30)`. |
| `maxResultSize` | `Bytes` | No | Maximum UTF-8 result size (`kilobytes(256)`) shown to the model before truncation. |
