---
title: MCP Servers, RAG & Sub-Workflows
description: Connect AGBoss agents to Model Context Protocol (@McpServer, @McpTool, @McpExpose), knowledge bases (@Rag), A2A agents, and built-in AI coding skills.
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

<!-- snippet-context
import { Text } from "agboss/dto";
export class ReadFileInputDto { @Text() path!: string; }
export class ReadFileOutputDto { @Text() content!: string; }
// @snippet
-->
```ts title="src/mcp/read-file.mcp.ts" file=src/mcp/read-file.mcp.ts
import { type ToolHandler } from "agboss";
import { McpServer, McpServerClient, McpTool, type ServerTools } from "agboss/mcp";

const fsTools = {
  read_file: { input: ReadFileInputDto, output: ReadFileOutputDto },
} as const satisfies ServerTools;

@McpServer({
  name: "filesystem-mcp-server",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "./workspace"],
  tools: fsTools,
})
export class FilesystemMcpServer extends McpServerClient<typeof fsTools> {}

@McpTool({
  name: "read_file",
  description: "Reads a file from the workspace via MCP",
  server: FilesystemMcpServer,
  input: ReadFileInputDto,
  output: ReadFileOutputDto,
  deps: [FilesystemMcpServer],
})
export class ReadFileMcpTool implements ToolHandler<ReadFileInputDto, ReadFileOutputDto> {
  constructor(private readonly fs: FilesystemMcpServer) {}

  run(input: ReadFileInputDto): Promise<ReadFileOutputDto> {
    return this.fs.call("read_file", input);
  }
}
```

## How `@Rag` knowledge bases work (`agboss/rag`)

In AGBoss, a knowledge base is any `@Rag` class implementing `RagConnector` (`retrieve(query, { topK, signal })` and optional `index()`), or extending the built-in `SqliteFtsConnector`. The `topK` setting is required on every `@Rag` decorator, and reported retrieval spend (`costUsd`) is tracked automatically under `rag:<name>`:

```ts title="src/rag/company-docs.rag.ts" file=src/rag/company-docs.rag.ts
import { Agent, RagMode, env } from "agboss";
import { Rag, SqliteFtsConnector } from "agboss/rag";

export class AppEnvironment {
  handbookDbPath = env.optional("HANDBOOK_DB_PATH");
}

@Rag({
  name: "company_docs",
  description: "Product, onboarding, and engineering runbook documentation",
  topK: 4,
  deps: [AppEnvironment],
})
export class CompanyDocs extends SqliteFtsConnector {
  constructor(environment: AppEnvironment) {
    super({
      folder: "./docs/handbook",
      dbFile: environment.handbookDbPath ?? ":memory:",
    });
  }
}

@Agent({
  name: "onboarding-agent",
  description: "Answers questions from the handbook with citations",
  prompt: "Answer from company_docs and cite [source].",
  model: "moonshotai/kimi-k2.6",
  rag: [{ use: CompanyDocs, mode: RagMode.Tool }],
})
export class OnboardingAgent {}
```

```ts title="test/company-docs.rag.test.ts" file=test/company-docs.rag.test.ts
import { expect, it } from "vitest";
import { testRag } from "agboss/testing";
import { AppEnvironment, CompanyDocs } from "../src/rag/company-docs.rag.js";

it("retrieves BM25 chunks with [source] IDs via testRag", async () => {
  const runRag = testRag(CompanyDocs);
  const { output, spend } = await runRag("refund timeframe");
  expect(output).toBeDefined();
  expect(spend.totalUsd).toBe(0);
});
```

## How child workflows (`.toWorkflow()`), `ThisWorkflow` recursion, and A2A (`agboss/a2a`) work

When a workflow grows beyond a single responsibility or crosses service boundaries, compose child `@Workflow` classes in-process or delegate over HTTP using Agent-to-Agent (`agboss/a2a`):

1. **Workflow as a step (`.toWorkflow(ChildWorkflow)`):** Runs an ordinary `@Workflow` listed in the application as an isolated child execution with its own `maxSteps` and path scope, while sharing the parent's checkpoint and budgets. Branch on the child's finishes using `.returns(oneOf(ScoreDto, RejectedDto)).switch(caseOf(...)...)`.
2. **Parallel child workflows (`.toParallelWorkflows(ChildWorkflow, { maxConcurrency, maxItems })`):** Fans out a `listOf(ItemDto)` across concurrent child workflow executions and joins their outputs with `.join().returns(listOf(oneOf(...)))`.
3. **Self-recursion (`ThisWorkflow`):** A workflow with `@Workflow({ maxDepth: 3, maxConcurrentExecutions: 6 })` can launch itself via `.toWorkflow(ThisWorkflow)` or `.toParallelWorkflows(ThisWorkflow, { maxItems })` to decompose recursive tasks safely.
4. **Multi-tenant Agent-to-Agent (`@A2AExpose`, `a2aHttpListener`, and `@A2AAgent`):** Expose any `@WorkflowStart` entry points over HTTP with [`@A2AExpose`](/reference/a2a-agent/) (`@Application({ exposes: [BillingA2AExpose] })`) and `a2aHttpListener({ app, expose: BillingA2AExpose, base: "/a2a", callerOf })`. `a2aHttpListener` never falls back to a default tenant — `callerOf(request)` authenticates every incoming request and returns `A2ACaller.accepted({ tenant, ownerId, peer })` or `A2ACaller.rejected({ reason: A2ARejection.Unauthenticated })`. On the client side, declare `@A2AAgent({ name: "billing-desk-a2a-agent", url, target: { application, start }, input: QuestionDto, output: AnswerDto }) extends A2AClient` and inject it into an `@Action` or `@Tool`.

## Cross-Service Agent Mesh Envelope & Federation Verification

When multiple AGBoss services call each other over A2A or MCP (`@A2AAgent` $\to$ `@A2AExpose` or `@McpServer` $\to$ `@McpExpose`), AGBoss propagates a signed **Agent Mesh Envelope** (`agboss-mesh` JWS EdDSA header on HTTP requests, `_meta["agboss.dev/mesh"]` on MCP calls, plus W3C `traceparent`):

- **Propagated invariants:** `origin` (`rootExecutionId`, `executionId`, `tenantId`, `workflow`, `step.idempotencyKey`), `budget.remaining` (capping downstream execution spend to the caller's remaining budget), `deadline.remaining` (`DeadlineExceededError` if exhausted), and `callChain`.
- **Distributed cycle & hop protection:** If `callChain` already contains the receiving application/workflow (`Service A -> Service B -> Service A`), the receiver rejects the call before the first step with `MeshLoopDetectedError`. If `callChain.length` reaches `@Application({ maxMeshHops })` (`6` by default), it rejects with `HopsLimitExceededError`.
- **Cross-repo contract verification (`--federation`):** `npx agboss describe --json` includes an `application.contracts` passport (`exports` and `imports` with `schemaHash` for every exposed and consumed DTO). In CI, verify that all services in a federation agree on input/output schemas before deployment:

```bash
$ agboss check --federation snapshots/
```

If an upstream service changes an exposed DTO without updating consumers, `$ agboss check --federation` fails with `[federation.incompatible-schema]`, `[federation.missing-target]`, or `[federation.version-not-bumped]` and prints the cross-service blast radius.
