---
title: MCP Servers, RAG & Sub-Workflows
description: Connect AGBoss agents to Model Context Protocol (@McpServer, @McpTool, @McpExpose), knowledge bases (@Rag), A2A agents, and built-in AI coding skills.
---

Modern agent architectures rarely operate in isolation: they query internal knowledge bases via retrieval-augmented generation (`@agboss/core/rag`), consume or expose tools over the Model Context Protocol (`@agboss/core/mcp`), and delegate subtasks to child workflows or A2A peers. AGBoss models all of these integrations as typed, testable TypeScript components.

## How to consume and expose MCP tools (`@agboss/core/mcp`)

`@agboss/core/mcp` works in both directions: agents can call external MCP servers via `@McpServer` and `@McpTool`, and you can expose your own `@Tool` and `@WorkflowStart` components as an MCP server over stdio or HTTP using `@McpExpose` and `createMcpService`:

<!-- snippet-context
import { createApp, Tool, WorkflowStart, type ToolHandler } from "@agboss/core";
import { Text, WorkflowStartTextDto } from "@agboss/core/dto";
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
import { createMcpService, McpExpose } from "@agboss/core/mcp";

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
import { Text } from "@agboss/core/dto";
export class ReadFileInputDto { @Text() path!: string; }
export class ReadFileOutputDto { @Text() content!: string; }
// @snippet
-->
```ts title="src/mcp/read-file.mcp.ts" file=src/mcp/read-file.mcp.ts
import { type ToolHandler } from "@agboss/core";
import { McpServer, McpServerClient, McpTool, type ServerTools } from "@agboss/core/mcp";

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

## How `@Rag` knowledge bases work (`@agboss/core/rag`)

In AGBoss, a knowledge base is any `@Rag` class implementing `RagConnector` (`retrieve(query, { topK, signal })` and optional `index()`), or extending the built-in `SqliteFtsConnector`. The `tenancy` (`RagTenancy.PerTenant`, or one corpus every tenant may read) and `topK` settings are required on every `@Rag` decorator, and reported retrieval spend (`costUsd`) is tracked automatically under `rag:<name>`:

```ts title="src/rag/company-docs.rag.ts" file=src/rag/company-docs.rag.ts
import { Agent, RagMode, env } from "@agboss/core";
import { Rag, RagTenancy, SqliteFtsConnector } from "@agboss/core/rag";

export class AppEnvironment {
  handbookDbPath = env.optional("HANDBOOK_DB_PATH");
}

@Rag({
  name: "company_docs",
  description: "Product, onboarding, and engineering runbook documentation",
  tenancy: RagTenancy.PerTenant, // each tenant indexes and reads its own copy
  topK: 4,
  deps: [AppEnvironment],
})
export class CompanyDocs extends SqliteFtsConnector {
  constructor(environment: AppEnvironment) {
    super({
      folder: "./docs/handbook",
      sqlitePath: environment.handbookDbPath ?? ":memory:",
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
import { testRag } from "@agboss/core/testing";
import { AppEnvironment, CompanyDocs } from "../src/rag/company-docs.rag.js";

it("retrieves BM25 chunks with [source] IDs via testRag", async () => {
  const runRag = testRag(CompanyDocs);
  const { output, spend } = await runRag("refund timeframe");
  expect(output).toBeDefined();
  expect(spend.totalUsd).toBe(0);
});
```

## How child workflows (`.toWorkflow()`), `ThisWorkflow` recursion, and A2A (`@agboss/core/a2a`) work

When a workflow grows beyond a single responsibility or crosses service boundaries, compose child `@Workflow` classes in-process / across instances or delegate over HTTP using Agent-to-Agent (`@agboss/core/a2a`):

1. **Workflow as a step (`.toWorkflow(ChildWorkflow, { placement? })`):** Runs an ordinary `@Workflow` listed in the application as an isolated child execution with its own `maxSteps` and path scope, while sharing the parent's checkpoint and budgets. Pass `{ placement: ChildPlacement.AnyInstance }` to queue the child in `ChildExecutionQueueRepository` (`SqliteChildExecutionQueueRepository`) so any worker instance with free slots can steal it while the parent yields its tree lease. Branch on the child's finishes using `.returns(oneOf(ScoreDto, RejectedDto)).switch(caseOf(...)...)`.
2. **Parallel child workflows (`.toParallelWorkflows(ChildWorkflow, { maxConcurrency, maxItems, placement? })`):** Fans out a `listOf(ItemDto)` across concurrent child workflow executions (in-process via `ChildPlacement.ParentInstance` or distributed across worker pods via `ChildPlacement.AnyInstance` with per-child 30s leases and per-child crash recovery) and joins their outputs with `.join().returns(listOf(oneOf(...)))`.
3. **Self-recursion (`ThisWorkflow`):** A workflow with `@Workflow({ maxDepth: 3, maxConcurrentExecutions: 6 })` can launch itself via `.toWorkflow(ThisWorkflow)` or `.toParallelWorkflows(ThisWorkflow, { maxItems })` to decompose recursive tasks safely.
4. **Agent-to-Agent over A2A v1.0 (`@A2AExpose`, `a2aHttpListener`, `A2ACallerResolver`, `@A2AAgent`):** an AGBoss application is served as an [A2A v1.0](https://a2a-protocol.org/v1.0.0/specification/) agent and calls other A2A v1.0 agents, on the official `@a2a-js/sdk`: an Agent Card, a JSON-RPC 2.0 binding, tasks. Any v1.0 client or server interoperates; the full surface is in the [A2A reference](/reference/a2a-agent/).

### Serving a workflow

An `@A2AExpose` lists the `@WorkflowStart` classes (the **skills**) an `@Application({ exposes })` serves, and `a2aHttpListener` serves them: the Agent Card at `<base>/.well-known/agent-card.json` (one skill per exported start, with each skill's JSON Schemas in the [skills extension](/a2a/skills/v1/)) and the JSON-RPC binding at `POST <base>`: `SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`. `A2A-Version: 1.0` is required.

<!-- snippet-context
import { Injectable, WorkflowStart } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
import { A2ACallerResolution, A2AExpose, A2ASecurity, type A2ACallerRequest, type A2ACallerResolver } from "@agboss/core/a2a";
@WorkflowStart({ name: "support-workflow-start", description: "A question", input: WorkflowStartTextDto })
export class SupportWorkflowStart {}
@Injectable()
export class SupportA2aCallerResolver implements A2ACallerResolver<typeof SupportWorkflowStart> {
  resolveCaller(_request: A2ACallerRequest): A2ACallerResolution<typeof SupportWorkflowStart> {
    return A2ACallerResolution.resolved({});
  }
}
@A2AExpose({
  name: "support-a2a-expose",
  version: "1.0.0",
  description: "Answers support questions",
  exports: [SupportWorkflowStart],
  security: [A2ASecurity.bearer()],
})
export class SupportA2AExpose {}
declare const SupportApplication: new () => object;
// @snippet
-->
```ts title="src/server.ts"
import { createServer } from "node:http";
import { createApp } from "@agboss/core";
import { a2aHttpListener } from "@agboss/core/a2a";

const app = await createApp(SupportApplication, { env: "prod" });

createServer(
  a2aHttpListener(app, {
    expose: SupportA2AExpose, // listed in @Application({ exposes })
    callerResolver: SupportA2aCallerResolver, // the class: its instance is the container's
    publicUrl: "https://support.example", // where callers reach it: the card's interface URL
    base: "/a2a",
  }),
).listen(8080);
```

What the server guarantees:

- **Who calls is the host's decision.** `a2aHttpListener` never guesses a tenant from a request: it takes an `@Injectable()` [`A2ACallerResolver<typeof Start>`](/reference/a2a-agent/#who-calls-the-caller-resolver) from the container (`providers`, else `[a2a.caller-resolver-not-listed]`). `resolveCaller({ operation, taskId?, http })` returns `A2ACallerResolution.resolved({ tenant, ownerId, execution, peer })`, `.unauthenticated({ reason, challenge? })` (`401`) or `.forbidden({ reason })` (`403`); a refused request runs nothing.
- **Tasks.** One task is one root execution, kept in `A2ATaskRepository`; the same `messageId` gets the same task, never a second run, on any instance when the store is shared (`[a2a.task-store-not-shared]` otherwise). A task outlives its connection: a caller that disconnects never cancels it, it reads it again with `GetTask` or `SubscribeToTask`. A pause the caller answers is `TASK_STATE_INPUT_REQUIRED`; a follow-up `SendMessage` with the same `taskId` answers it.
- **Direct replies.** `skills: { [id]: { reply: A2AReply.Message } }` answers a stateless skill (a lookup, a classification) with a `Message` at once instead of a task, once per `messageId`.
- **Files.** A start's input may hold `A2AFileDto` fields, filled from `raw` or `url` parts. A file by `url` is fetched once, by the server, at the admission, behind an SSRF guard: `https:` only, on `allowedFileOrigins`, three redirects at most, never a private, loopback, link-local or otherwise not globally reachable address, never through a proxy.
- **Streaming carries only the agent's answer.** `SendStreamingMessage` streams the task's status and the answering agent's text as chunks of one artifact (`<taskId>:output`); never a judge's, a router's or another internal model's text, and the finish's output replaces it, so the stream and `GetTask` end with the same artifacts.
- **A failure never leaks.** A `FAILED` task carries a stable code and that code's fixed text, never the error's own text.

### Calling a remote agent

An `@A2AAgent` declares the remote agent as a typed contract; it is registered in `providers` and injected into a `@Tool` or an `@Action`. `target.skill` names the start (it was `target.start` in 0.1.0), `target.application` makes it an AGBoss peer (the mesh, below), `target.finishes` limits the finishes whose output the client takes. The card is read from `<url>/.well-known/agent-card.json` and checked before the first send.

<!-- snippet-context
import { Text } from "@agboss/core/dto";
export class OrderQuestionDto { @Text({ prompt: "the question for the order desk" }) question!: string; }
export class OrderDeskReplyDto { @Text({ prompt: "the order desk's answer" }) text!: string; }
// @snippet
-->
```ts title="src/a2a/order-desk.a2a-agent.ts"
import { ExecutionContext, Tool, type ToolHandler } from "@agboss/core";
import { A2AAgent, A2AClient } from "@agboss/core/a2a";
import { seconds, usd } from "@agboss/core/units";

@A2AAgent({
  name: "order-desk-a2a-agent",
  url: "https://orders.example/a2a",
  target: { application: "orders-application", skill: "order-desk-workflow-start" },
  input: OrderQuestionDto,
  output: OrderDeskReplyDto,
  price: usd(0.002), // the step records the larger of it and a trusted peer's signed report
  deps: [ExecutionContext],
})
export class OrderDeskA2AAgent extends A2AClient<OrderQuestionDto, OrderDeskReplyDto> {
  constructor(private readonly executionContext: ExecutionContext) {
    super();
  }

  protected override getHeaders(): Promise<Record<string, string>> {
    // what the remote's caller resolver authenticates: never trusted from a body
    return Promise.resolve({ "x-tenant-id": this.executionContext.tenant.tenantId });
  }
}

@Tool({
  name: "ask-order-desk-tool",
  description: "Asks the order desk about an order",
  input: OrderQuestionDto,
  output: OrderDeskReplyDto,
  timeout: seconds(60), // also the envelope's remaining time
  deps: [OrderDeskA2AAgent, ExecutionContext],
})
export class AskOrderDeskTool implements ToolHandler<OrderQuestionDto, OrderDeskReplyDto> {
  constructor(
    private readonly orderDesk: OrderDeskA2AAgent,
    private readonly executionContext: ExecutionContext,
  ) {}

  run(question: OrderQuestionDto): Promise<OrderDeskReplyDto> {
    // the input and the output validated, the price recorded
    return this.orderDesk.execute(question, { signal: this.executionContext.signal });
  }
}
```

`execute` returns the `COMPLETED` task's output. `FAILED` and `REJECTED` are `A2ATaskFailedError`, `CANCELED` is `A2ATaskCanceledError`, `INPUT_REQUIRED` is `A2ATaskInterruptedError`, a JSON-RPC error is `A2AProtocolError`, and a `401` / `403` is `A2ACallerRejectedError` (`code: "a2a.caller-rejected"`, the server's code in `wireCode`). `send(message)` returns the whole `A2ATaskResult`, and `reply(taskId, answer)`, `getTask`, `cancel(taskId)` and `agentCard()` work on a task. Inside an execution the send is exactly-once: a send of unknown outcome is sent again with the same `messageId` only to an AGBoss peer, never to a foreign agent (`OutboundCallUnreconciledError`).

:::caution[Migrating from 0.1.0]
The 0.1.0 wire is gone, with no shim: `POST <base>/execute`, `/resume` and `/cancel`, the `agboss-mesh` header, `A2ARoute`, `A2AAdapterContract` and `A2AExecutionResponse` are removed; `target: { application, start }` is `target: { application, skill }`; `execute(input, { threadId })` takes a `call` with `signal`, `timeout`, `key` and `onEvent`; `cancel` takes a task id. A 0.1.0 client fails against a 0.1.1 server with `-32009`.
:::

In tests, the `a2aServer({ expose, callerResolver })` fixture of `testWith` serves the app on a loopback listener and returns `{ url }`; any v1.0 client, or a plain JSON-RPC `fetch`, calls it, and `A2ACallerRejectedError` is asserted on `401` / `403` without external network sockets.

## Cross-Service Agent Mesh (the mesh extension, JWS signing, `--federation` & `agboss hub`)

When multiple AGBoss applications call each other over A2A (`A2AClient` to `a2aHttpListener`) or MCP (`@McpServer` to `createMcpService`), AGBoss propagates an **Agent Mesh Envelope** with no code of yours. Over A2A it travels as the [mesh extension](/a2a/mesh/v1/) `https://agboss.dev/a2a/mesh/v1` in `message.metadata`, with `A2A-Extensions` and a W3C `traceparent`; over MCP it is `_meta["agboss.dev/mesh"]`:

- **Propagated context (`MeshEnvelope`):** `origin` (`executionId` / `rootExecutionId`, `parentExecutionId`, `workflow`, `step.idempotencyKey`), `budget.remaining` (a `caller-budget` cap on the downstream execution, so a child hop can never exceed its parent's remaining USD budget), `deadline.remaining` (`DeadlineExceededError` if exhausted) and `callChain` (`readonly MeshHop[]`).
- **Cryptographic peer verification (`@Application({ mesh })` & `MeshVerifier`):** an application that names its keys signs every outgoing envelope and every run report it answers with (JWS `EdDSA`, Ed25519); its `peers` are the applications whose signatures it checks. A request is trusted only when the caller resolver's `peer` is the envelope's verified issuer. The caller records verified remote spend under `a2a:<issuer>` / `mcp:<issuer>` and `ToolCallRecord.remote`, exactly once however many passes replay the call.

<!-- snippet-context
import { Application, type Secret } from "@agboss/core";
export class BillingWorkflow {} // a @Workflow of its own
// @snippet
-->
```ts title="src/billing.application.ts"
export class BillingEnvironment {
  meshSigningKey!: Secret; // secret("MESH_SIGNING_KEY") in each environment
  ordersPublicKey!: string; // env("ORDERS_PUBLIC_KEY")
}

@Application({
  name: "billing-application",
  version: "1.0.0",
  environment: BillingEnvironment,
  workflows: [BillingWorkflow],
  mesh: {
    signingKey: "meshSigningKey",
    peers: [{ application: "orders-application", verifyKey: "ordersPublicKey" }],
  },
})
export class BillingApplication {}
```

- **Distributed cycle & hop protection:** if `callChain` already contains the receiving `(application, skill)` pair (`Service A -> Service B -> Service A`), or is as long as `@Application({ maxMeshHops })` (`8` by default), the A2A server accepts the message as a `REJECTED` task with `limit.mesh-loop` or `limit.hops`, nothing started, and `A2AClient` rethrows it as the typed **`MeshLoopDetectedError`** (catchable via `.onError(MeshLoopDetectedError, ...)`) or **`HopsLimitExceededError`**. An agent that does not support the extension (a foreign one) is called without it, and the call says so (`mesh: false`).
- **Cross-repo contract verification (`--federation`) & AGBoss Mesh Hub (`agboss hub`):** in CI and local operations, verify that all services in an Agent Mesh agree on input/output DTO schemas (an `@A2AAgent` is paired by `(target.application, target.skill)` with the other application's exported skill) and visualize cross-service topology, stitched execution trees (`ExecutionHistoryRepository` + `agboss records export`), Progressive Crystallization Radar and Blast Radius:

```bash
npx agboss check --federation snapshots/
npx agboss records export --all-tenants --out .artifacts/records.jsonl
npx agboss hub show snapshots/ .artifacts/records.jsonl --html .artifacts/hub.html
npx agboss hub ui snapshots/ .artifacts/records.jsonl
```

If an upstream service changes an exposed DTO without updating consumers, `npx agboss check --federation` fails before deployment and prints the cross-service blast radius. The extension specifications are [`a2a/mesh/v1`](/a2a/mesh/v1/) and [`a2a/skills/v1`](/a2a/skills/v1/).

---

## Standalone Executable Proofs: [`06-enterprise-agent-mesh`](https://github.com/agbossjs/agboss-examples/tree/main/06-enterprise-agent-mesh) & [`03-support-refund-desk`](https://github.com/agbossjs/agboss-examples/tree/main/03-support-refund-desk)

- **[`06-enterprise-agent-mesh`](https://github.com/agbossjs/agboss-examples/tree/main/06-enterprise-agent-mesh):** Demonstrates a 3-service microservice mesh (`apps/1-order-gateway`, `apps/2-billing-a2a` with `@A2AExpose`, and `apps/3-catalog-mcp` with `@McpExpose`), Ed25519 signed mesh envelopes, `MeshLoopDetectedError` / `HopsLimitExceededError` fallback routing, MCP `_meta.callId` deduplication via `SqliteMeshRequestRepository` and A2A `messageId` deduplication, and `agboss check --federation` Blast Radius over `federation/` snapshots.
- **[`03-support-refund-desk`](https://github.com/agbossjs/agboss-examples/tree/main/03-support-refund-desk):** Demonstrates an in-memory BM25/TF-IDF section indexer (`InMemoryKnowledgeIndexService` + `RefundPolicyRetriever`) wired into `@Rag({ mode: RagMode.Context })` alongside `PolicyAwareCompaction` (see [7 Verified Examples](/examples/verified-examples/)).
