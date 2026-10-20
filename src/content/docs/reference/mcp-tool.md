---
title: "@McpTool"
description: Complete API reference for the @McpTool decorator in AGBoss — binding external Model Context Protocol server tools with typed DTO schemas and guardrails.
---

The `@McpTool` decorator binds a single tool from an `@McpServer` as a typed, guardrail-protected AGBoss tool class (`mcp/*.mcp.ts`). At startup or `agboss check`, AGBoss verifies that the remote MCP tool's JSON Schema is compatible with your declared `input` and `output` DTO classes.

## What options does `@McpTool` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique snake_case tool identifier exposed to `@Agent({ tools })` (e.g., `"create_pull_request"`). |
| `description` | `string` | Yes | Instructions telling the LLM when and how to call this MCP tool. |
| `server` | `Class` | Yes | The [`@McpServer`](/reference/mcp/) class that hosts this tool. |
| `toolName` | `string` | No | Remote tool name on the MCP server when it differs from `name`. |
| `input` | `DtoClass` | Yes | DTO class validating arguments before sending them over MCP. |
| `output` | `DtoClass` | No | DTO class validating the structured MCP tool result. |
| `timeout` | `Milliseconds` | No | Per-call timeout (`seconds(15)`) enforced via `AbortSignal`. |
| `approvalChannel` | `Class` | No | [`@ChannelRole`](/reference/channel-role/) or [`@Channel`](/reference/channel/) requiring human approval before invoking the MCP tool. |

## Complete `@McpTool` example

```ts title="src/mcp/create-pull-request.mcp.ts" no-check: reference example
import { McpTool } from "agboss/mcp";
import { Integer, Text, Url } from "agboss/dto";
import { seconds } from "agboss/units";
import { GithubMcpServer } from "./github.server.js";
import { ReleaseApprovalChannelRole } from "../channels/release-approval.channel-role.js";

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
  @Integer()
  number!: number;

  @Url()
  htmlUrl!: string;
}

@McpTool({
  name: "create_pull_request",
  description: "Opens a GitHub pull request via the GitHub MCP server after human approval",
  server: GithubMcpServer,
  toolName: "create_pull_request",
  input: CreatePrInputDto,
  output: CreatePrOutputDto,
  timeout: seconds(20),
  approvalChannel: ReleaseApprovalChannelRole,
})
export class CreatePullRequestMcpTool {}
```

```ts title="src/mcp/github.server.ts" no-check: reference example
import { McpServer } from "agboss/mcp";
import { seconds } from "agboss/units";

@McpServer({
  name: "github-mcp-server",
  description: "Official GitHub MCP server over stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  timeout: seconds(15),
})
export class GithubMcpServer {}
```

```ts title="test/create-pull-request.mcp.test.ts" no-check: reference example
import { expect } from "vitest";
import { mockTool, testWith } from "agboss/testing";
import { ReleaseApplication } from "../src/release.application.js";
import { CreatePullRequestMcpTool } from "../src/mcp/create-pull-request.mcp.js";

const test = testWith(ReleaseApplication);

test("stubs @McpTool deterministically with mockTool() without spawning stdio servers", async ({ app }) => {
  mockTool(CreatePullRequestMcpTool).thenReturn({
    number: 42,
    htmlUrl: "https://github.com/agbossjs/agboss/pull/42",
  });
  const res = await app.execute(ReleaseStart, { branch: "feat/quorum" });
  expect(res.isFinished()).toBe(true);
});
```
