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

When a workflow grows beyond a single responsibility or crosses service boundaries, compose child `@Workflow` classes in-process / across instances or delegate over HTTP using Agent-to-Agent (`agboss/a2a`):

1. **Workflow as a step (`.toWorkflow(ChildWorkflow, { placement? })`):** Runs an ordinary `@Workflow` listed in the application as an isolated child execution with its own `maxSteps` and path scope, while sharing the parent's checkpoint and budgets. Pass `{ placement: ChildPlacement.AnyInstance }` to queue the child in `ChildExecutionQueueRepository` (`SqliteChildExecutionQueueRepository`) so any worker instance with free slots can steal it while the parent yields its tree lease. Branch on the child's finishes using `.returns(oneOf(ScoreDto, RejectedDto)).switch(caseOf(...)...)`.
2. **Parallel child workflows (`.toParallelWorkflows(ChildWorkflow, { maxConcurrency, maxItems, placement? })`):** Fans out a `listOf(ItemDto)` across concurrent child workflow executions (in-process via `ChildPlacement.ParentInstance` or distributed across worker pods via `ChildPlacement.AnyInstance` with per-child 30s leases and per-child crash recovery) and joins their outputs with `.join().returns(listOf(oneOf(...)))`.
3. **Self-recursion (`ThisWorkflow`):** A workflow with `@Workflow({ maxDepth: 3, maxConcurrentExecutions: 6 })` can launch itself via `.toWorkflow(ThisWorkflow)` or `.toParallelWorkflows(ThisWorkflow, { maxItems })` to decompose recursive tasks safely.
4. **Multi-tenant Agent-to-Agent (`@A2AExpose`, `a2aHttpListener`, `A2ACallerResolver`, and `@A2AAgent`):**
   - **Exposing (`@A2AExpose({ name, version, exports: [Start] })` in `@Application({ exposes })`):** Declares the `@WorkflowStart` entry points served over A2A and exported in `agboss describe --json` for `agboss check --federation`.
   - **Serving (`a2aHttpListener(app, { expose, callerResolver, meshVerifier?, base })`):** Serves `POST <base>/execute` (`{ input, start?, threadId? }`), `POST <base>/resume` (`{ pauseId, decision }`), and `POST <base>/cancel` (`{ threadId }`). `a2aHttpListener` never guesses a tenant from the request body — it resolves an `@Injectable()` [`A2ACallerResolver<typeof StartClass>`](/reference/a2a-agent/) from the DI container (`providers: [ShopA2aCallerResolver]`, `[a2a.caller-resolver-not-listed]` if omitted). `resolveCaller(request: A2ACallerRequest)` inspects `request.http`, `request.route` (`A2ARoute.Execute` / `Resume` / `Cancel`), and `request.envelope` (`MeshEnvelope`), returning `A2ACallerResolution.resolved({ tenant, ownerId, execution, peer })`, `.unauthenticated({ reason, challenge? })` (`401`), or `.forbidden({ reason })` (`403`).
   - **Calling (`@A2AAgent` `extends A2AClient<InDto, OutDto>`):** Declare `@A2AAgent({ name: "order-desk-a2a-agent", url, target: { application, start }, input: InDto, output: OutDto, price?, deps: [ExecutionContext] })` in `providers` and inject it into a `@Tool` or `@Action` to call `execute(input, { threadId, signal, onEvent })` or `send(input, call)`. On `401` / `403`, `A2AClient` throws `A2ACallerRejectedError` (`code: "a2a.caller-rejected"`, with the server's rejection code in `wireCode`: `"a2a.caller-unauthenticated"` or `"a2a.caller-forbidden"`, `#457`).
   - **In-process testing (`a2aServer({ expose, callerResolver })`):** In `testWith(App)`, the `a2aServer` fixture spins up a loopback listener (`{ url }`) and asserts `A2ACallerRejectedError` on `401`/`403` without external network sockets.

## Cross-Service Agent Mesh (`MeshEnvelope`, JWS Signing, `--federation` & `agboss hub`)

When multiple AGBoss applications call each other over A2A (`A2AClient` $\to$ `a2aHttpListener`) or MCP (`@McpServer` $\to$ `createMcpService`), AGBoss automatically propagates an **Agent Mesh Envelope** (`agboss-mesh` JWS EdDSA Ed25519 header over A2A, `_meta["agboss.dev/mesh"]` over MCP, plus W3C `traceparent`):

- **Propagated context (`MeshEnvelope`):** Carries `origin` (`executionId` / `rootExecutionId`, `parentExecutionId`, `workflow`, `step.idempotencyKey`), `budget.remaining` (installing a `caller-budget` cap on the downstream execution so a child hop can never exceed its parent's remaining USD budget), `deadline.remaining` (`DeadlineExceededError` if exhausted), and `callChain` (`readonly MeshHop[]`).
- **Cryptographic peer verification (`@Application({ mesh })` & `MeshVerifier`):** Applications with `mesh: { signingKey: "meshSigningKey", peers: [{ application: "orders-application", verifyKey: "ordersPublicKey" }] }` sign every outgoing `MeshEnvelope` and every returned `MeshRunReport` (`spend`, `executionId`, `bodyHash`). When both `callerResolver` (`peer`) and the Ed25519 signature (`signedBy`) match, the receiver deduplicates retries by `origin.step.idempotencyKey` (`MeshRequestRepository` / `SqliteMeshRequestRepository`) and the caller records verified remote spend under `a2a:<issuer>` / `mcp:<issuer>` and `ToolCallRecord.remote`.
- **Distributed cycle & hop protection:** If `callChain` already contains the receiving `(application, start)` pair (`Service A -> Service B -> Service A`), the receiver rejects the call before the first step with `409 limit.mesh-loop`, which `A2AClient` rethrows as typed **`MeshLoopDetectedError`** (catchable via `.onError(MeshLoopDetectedError, ...)`). If `callChain.length` reaches `@Application({ maxMeshHops })` (`8` by default), it rejects with **`HopsLimitExceededError`**.
- **Cross-repo contract verification (`--federation`) & AGBoss Mesh Hub (`agboss hub`, `#401`):** In CI and local operations, verify that all services in an Agent Mesh agree on input/output DTO schemas and visualize cross-service topology, stitched execution trees (`ExecutionHistoryRepository` + `agboss records export`), Progressive Crystallization Radar, and Blast Radius:

```bash
npx agboss check --federation snapshots/
npx agboss records export --all-tenants --out .artifacts/records.jsonl
npx agboss hub show snapshots/ .artifacts/records.jsonl --html .artifacts/hub.html
npx agboss hub ui snapshots/ .artifacts/records.jsonl
```

If an upstream service changes an exposed DTO without updating consumers, `npx agboss check --federation` fails before deployment and prints the cross-service blast radius.

---

## Standalone Executable Proofs: [`06-enterprise-agent-mesh`](https://github.com/agbossjs/agboss-examples/tree/main/06-enterprise-agent-mesh) & [`03-support-refund-desk`](https://github.com/agbossjs/agboss-examples/tree/main/03-support-refund-desk)

- **[`06-enterprise-agent-mesh`](https://github.com/agbossjs/agboss-examples/tree/main/06-enterprise-agent-mesh):** Demonstrates a 3-service microservice mesh (`apps/1-order-gateway`, `apps/2-billing-a2a` with `@A2AExpose`, and `apps/3-catalog-mcp` with `@McpExpose`), Ed25519 `agboss-mesh` JWS signatures, `MeshLoopDetectedError` / `HopsLimitExceededError` fallback routing, MCP `_meta.callId` deduplication via `SqliteMeshRequestRepository`, and `agboss check --federation` Blast Radius over `federation/` snapshots.
- **[`03-support-refund-desk`](https://github.com/agbossjs/agboss-examples/tree/main/03-support-refund-desk):** Demonstrates an in-memory BM25/TF-IDF section indexer (`InMemoryKnowledgeIndexService` + `RefundPolicyRetriever`) wired into `@Rag({ mode: RagMode.Context })` alongside `PolicyAwareCompaction` (see [7 Verified Examples](/examples/job-scout/)).
