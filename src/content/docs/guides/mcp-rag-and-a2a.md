---
title: MCP Servers, RAG & Sub-Workflows
description: Connect AGBoss agents to Model Context Protocol (@McpServer, @McpTool, @McpExpose), knowledge bases (@Rag, RagConnector), and child workflows (.toWorkflow()).
---

Modern agent architectures rarely operate in isolation: they query internal knowledge bases via retrieval-augmented generation (`agboss/rag`), consume or expose tools over the Model Context Protocol (`agboss/mcp`), and delegate subtasks to child workflows or A2A peers. AGBoss models all of these integrations as typed, testable TypeScript components.

## How to consume and expose MCP tools (`agboss/mcp`)

`agboss/mcp` works in both directions: agents can call external MCP servers via `@McpServer` and `@McpTool`, and you can expose your own `@Tool` and `@WorkflowStart` components as an MCP server over stdio or HTTP using `@McpExpose` and `createMcpService`:

<!-- snippet-context
import { createApp, Tool, WorkflowStart, type ToolHandler } from "agboss";
import { Text, WorkflowStartTextDto } from "agboss/dto";
class IssueQuery { @Text() query!: string; }
class Issues { @Text() text!: string; }
@Tool({ name: "search_issues", description: "Searches the tracker", input: IssueQuery, output: Issues })
export class SearchIssues implements ToolHandler<IssueQuery, Issues> {
  run(): Promise<Issues> { return Promise.resolve({ text: "" }); }
}
@WorkflowStart({ name: "chat-workflow-start", description: "A message", input: WorkflowStartTextDto })
export class ChatWorkflowStart {}
declare class JobScoutApplication {}
// @snippet
-->
```ts title="src/mcp/job-scout.expose.ts"
import { createMcpService, McpExpose } from "agboss/mcp";

@McpExpose({
  name: "job-scout-mcp",
  version: "1.0.0",
  exports: [SearchIssues, ChatWorkflowStart],
})
export class JobScoutMcp {}

export async function serveStdio() {
  const app = await createApp(JobScoutApplication);
  const service = createMcpService(app, JobScoutMcp);
  await service.connectStdio();
}
```

```ts title="src/mcp/read-file.mcp.ts" no-check: context tab
import { McpServer, McpTool } from "agboss/mcp";
import { ReadFileInputDto, ReadFileOutputDto } from "../dto/read-file.dto.js";

@McpServer({
  name: "filesystem-mcp-server",
  description: "Local filesystem MCP server",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "./workspace"],
})
export class FilesystemMcpServer {}

@McpTool({
  name: "read_file",
  description: "Reads a file from the workspace via MCP",
  server: FilesystemMcpServer,
  toolName: "read_file",
  input: ReadFileInputDto,
  output: ReadFileOutputDto,
})
export class ReadFileMcpTool {}
```

## How `@Rag` knowledge bases work (`agboss/rag`)

In AGBoss, a knowledge base is any `@Rag` class implementing `RagConnector` (`retrieve(query, { topK, signal })` and optional `index()`), or extending the built-in `SqliteFtsConnector`. The `topK` setting is required on every `@Rag` decorator, and reported retrieval spend (`costUsd`) is tracked automatically under `rag:<name>`:

```ts title="src/rag/company-docs.rag.ts"
import { Agent, InjectionToken, RagMode, provide } from "agboss";
import { Rag, SqliteFtsConnector, type FtsOptions } from "agboss/rag";

export const DOCS_INDEX = new InjectionToken<FtsOptions>("DOCS_INDEX");

export const docsIndexProvider = provide(DOCS_INDEX, {
  folder: "./docs/handbook",
  dbFile: ".agboss/handbook.sqlite",
});

@Rag({
  name: "company_docs",
  description: "Product, onboarding, and engineering runbook documentation",
  topK: 4,
  deps: [DOCS_INDEX],
})
export class CompanyDocs extends SqliteFtsConnector {}

@Agent({
  name: "onboarding-agent",
  description: "Answers questions from the handbook with citations",
  prompt: "Answer from company_docs and cite [source].",
  model: "moonshotai/kimi-k2.6",
  rag: [{ use: CompanyDocs, mode: RagMode.Tool }],
})
export class OnboardingAgent {}
```

```ts title="test/company-docs.rag.test.ts" no-check: context tab
import { expect, it } from "vitest";
import { testRag } from "agboss/testing";
import { CompanyDocs } from "../src/rag/company-docs.rag.js";

it("indexes markdown docs and retrieves BM25 chunks with [source] IDs", async () => {
  const rag = testRag(CompanyDocs);
  await rag.index([{ id: "refund-policy", content: "Refunds are processed within 5 business days." }]);
  const res = await rag.retrieve("refund timeframe");
  expect(res.chunks[0]?.source).toBe("refund-policy");
});
```

## How child workflows (`.toWorkflow()`) and `ThisWorkflow` recursion work

When a workflow grows beyond a single responsibility, compose child `@Workflow` classes as steps:

1. **Workflow as a step (`.toWorkflow(ChildWorkflow)`):** Runs an ordinary `@Workflow` listed in the application as an isolated child execution with its own `maxSteps` and path scope, while sharing the parent's checkpoint and budgets. Branch on the child's finishes using `.returns(oneOf(ScoreDto, RejectedDto)).switch(caseOf(...)...)`.
2. **Parallel child workflows (`.toParallelWorkflows(ChildWorkflow, { maxConcurrency, maxItems })`):** Fans out a `listOf(ItemDto)` across concurrent child workflow executions and joins their outputs with `.join().returns(listOf(oneOf(...)))`.
3. **Self-recursion (`ThisWorkflow`):** A workflow with `@Workflow({ maxDepth: 3, maxConcurrentExecutions: 6 })` can launch itself via `.toWorkflow(ThisWorkflow)` or `.toParallelWorkflows(ThisWorkflow, { maxItems })` to decompose recursive tasks safely.
