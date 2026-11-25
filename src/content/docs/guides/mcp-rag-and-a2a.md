---
title: MCP Servers, RAG & Sub-Workflows
description: Connect AGBoss agents to Model Context Protocol (@McpServer, @McpEndpoint), knowledge bases (@Rag), child workflows, A2A agents (@A2AAgent, @A2AEndpoint), and the agent mesh.
---

Modern agent architectures rarely operate in isolation: they query internal knowledge bases via retrieval-augmented generation (`@agboss/core/rag`), consume or expose tools over the Model Context Protocol (`@agboss/core/mcp`), and delegate subtasks to child workflows or A2A peers. AGBoss models all of these integrations as typed, testable TypeScript components.

## How to consume and expose MCP tools (`@agboss/core/mcp`)

`@agboss/core/mcp` works in both directions: a `@Tool` calls an external MCP server through its `@McpServer` class (listed in the tool's `deps`; `@McpTool` and `@Workflow({ mcp })` are gone), and you expose your own `@Tool` and `@WorkflowStart` components as an MCP server with an `@McpEndpoint`, served over stdio with `connectMcpStdio`, over any SDK transport with `connectMcp`, or over Streamable HTTP with `mcpHttpListener`:

<!-- snippet-context
import { createApp, Tool, WorkflowStart } from "@agboss/core";
import { Text, WorkflowStartTextDto } from "@agboss/core/dto";
class IssueQuery { @Text() query!: string; }
class Issues { @Text() text!: string; }
@Tool({ name: "search_issues", description: "Searches the tracker", input: IssueQuery, output: Issues })
export class SearchIssues {
  execute(): Issues { return { text: "" }; }
}
@WorkflowStart({ name: "chat-workflow-start", description: "A message", input: WorkflowStartTextDto })
export class ChatWorkflowStart {}
declare class JobScoutApplication {}
// @snippet
-->
```ts title="src/mcp/job-scout.mcp-endpoint.ts"
import { connectMcpStdio, McpEndpoint } from "@agboss/core/mcp";

@McpEndpoint({
  name: "job-scout-mcp",
  version: "1.0.0",
  tools: [SearchIssues, ChatWorkflowStart], // tools of the workflow, and its starts (listed in @Application({ endpoints }))
})
export class JobScoutMcp {}

export async function serveStdio() {
  const app = await createApp(JobScoutApplication);
  await using connection = await connectMcpStdio(app, {
    endpoint: JobScoutMcp,
    session: { tenant: { tenantId: "acme" }, ownerId: "claude-desktop" }, // who the local client is
  }); // serves until closed
  void connection;
}
```

Over HTTP each request is admitted on its own — a signed mesh peer or the caller an `@HttpAuthenticator` names (required with a `tenantContext`; `allowAnonymous: true` only without one) — see [`@McpEndpoint`](/reference/mcp-endpoint/).

<!-- snippet-context
import { Text } from "@agboss/core/dto";
export class ReadFileInputDto { @Text() path!: string; }
export class ReadFileOutputDto { @Text() content!: string; }
// @snippet
-->
```ts title="src/mcp/read-file.mcp.ts" file=src/mcp/read-file.mcp.ts
import { Tool } from "@agboss/core";
import { McpServer, McpServerClient, McpTransport } from "@agboss/core/mcp";

const fsTools = {
  read_file: { input: ReadFileInputDto, output: ReadFileOutputDto }, // the server's own tool name
};

@McpServer({
  name: "filesystem-mcp-server",
  transport: McpTransport.Stdio,
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "./workspace"],
  tools: fsTools,
})
export class FilesystemMcpServer extends McpServerClient<typeof fsTools> {}

// the model sees the @Tool; it lists the server in deps and calls it
@Tool({
  name: "read_file",
  description: "Reads a file from the workspace via MCP",
  input: ReadFileInputDto,
  output: ReadFileOutputDto,
  deps: [FilesystemMcpServer],
})
export class ReadFileTool {
  constructor(private readonly fs: FilesystemMcpServer) {}

  execute(input: ReadFileInputDto): Promise<ReadFileOutputDto> {
    return this.fs.call("read_file", input);
  }
}
```

## How `@Rag` knowledge bases work (`@agboss/core/rag`)

In AGBoss, a knowledge base is a class that **extends `RagSource`** (`protected retrieve(query, options)` and an optional `protected index()`), annotated `@Rag`, or extends the built-in `SqliteFtsRagSource`. The `scope` (`RagScope.Shared`, `Tenant`, `Owner` or `Custom`) and `topK` settings are required on every `@Rag` decorator, and reported retrieval spend (`costUsd`) is tracked automatically under `rag:<name>`. An agent lists the class in `rag: [CompanyDocs]` (its passages are retrieved before the first model call), and a tool that injects it calls `search(query)`:

```ts title="src/rag/company-docs.rag.ts" file=src/rag/company-docs.rag.ts
import { Agent, inline } from "@agboss/core";
import { Rag, RagScope, SqliteFtsRagSource } from "@agboss/core/rag";

@Rag({
  name: "company_docs",
  description: "Product, onboarding, and engineering runbook documentation",
  scope: RagScope.Tenant, // each tenant indexes and reads its own copy
  topK: 4,
})
export class CompanyDocs extends SqliteFtsRagSource {
  constructor() {
    super({ directory: "./docs/handbook", path: ".agboss/rag/company-docs.sqlite" });
  }
}

@Agent({
  name: "onboarding-agent",
  description: "Answers questions from the handbook with citations",
  prompt: inline("Answer from the handbook passages and cite [source]."),
  model: "moonshotai/kimi-k2.6",
  rag: [CompanyDocs],
})
export class OnboardingAgent {}
```

```ts title="test/company-docs.rag.test.ts" file=test/company-docs.rag.test.ts
import { expect, it } from "vitest";
import { testUnit } from "@agboss/core/testing";
import { CompanyDocs } from "../src/rag/company-docs.rag.js";

it("retrieves BM25 chunks with [source] IDs via testUnit", async () => {
  const runRag = testUnit(CompanyDocs);
  const { output, spend } = await runRag("refund timeframe");
  expect(output).toBeDefined();
  expect(spend.totalUsd).toBe(0);
});
```

## How child workflows (`.toWorkflow()`), `() => Self` recursion, and A2A (`@agboss/core/a2a`) work

When a workflow grows beyond a single responsibility or crosses service boundaries, compose child `@Workflow` classes in-process / across instances or delegate over HTTP using Agent-to-Agent (`@agboss/core/a2a`):

1. **Workflow as a step (`.toWorkflow(ChildWorkflow)`):** Runs an ordinary `@Workflow` of the application as an isolated child execution with its own limits and path scope, while sharing the parent's budgets. Put `placement: ChildPlacement.AnyWorker` on the **child** (`@Workflow({ placement })`, or `@Application({ defaults: { workflows: { placement } } })`; it is never written on the flow) to queue it in the application's child queue so any worker instance with free slots can steal it while the parent yields its tree lease. Branch on the child's finishes with `.onFinish(ChildFinish, subPath)` (one path per finish of a child with two or more) or `.toOneOf([…])`.
2. **Parallel child workflows (`.forEachItem(toWorkflow(ChildWorkflow), { takeFirst, maxConcurrency })`):** Fans out a `listOf(ItemDto)` across concurrent child workflow executions (in-process via `ChildPlacement.CurrentProcess` or distributed across worker pods via `ChildPlacement.AnyWorker` with per-child 30s leases and per-child crash recovery) and joins their outputs with `.join()` into one polymorphic list.
3. **Self-recursion (`toWorkflow(() => Self)`):** A workflow with `@Workflow({ executionLimits: { maxDepth: 3, maxConcurrency: 6 } })` can launch itself with a thunk of its own class, alone or per item, to decompose recursive tasks safely.
4. **Agent-to-Agent over A2A v1.0 (`@A2AEndpoint`, `a2aHttpListener`, `@HttpAuthenticator`, `@A2AAgent`):** an AGBoss application is served as an [A2A v1.0](https://a2a-protocol.org/v1.0.0/specification/) agent and calls other A2A v1.0 agents, on the official `@a2a-js/sdk`: an Agent Card, a JSON-RPC 2.0 binding, tasks. Any v1.0 client or server interoperates; the full surface is in the [`@A2AEndpoint`](/reference/a2a-endpoint/) and [`@A2AAgent`](/reference/a2a-agent/) references.

### Serving a workflow

An `@A2AExpose` lists the `@WorkflowStart` classes (the **skills**) an `@Application({ exposes })` serves, and `a2aHttpListener` serves them: the Agent Card at `<base>/.well-known/agent-card.json` (one skill per exported start, with each skill's JSON Schemas in the [skills extension](/a2a/skills/v1/)) and the JSON-RPC binding at `POST <base>`: `SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`. `A2A-Version: 1.0` is required.

### Serving a workflow

An `@A2AEndpoint` lists the `@WorkflowStart` classes (the **skills**) an `@Application({ endpoints })` serves and the `ttl` of its tasks and direct replies, and `a2aHttpListener` serves them: the Agent Card at `<base>/.well-known/agent-card.json` (one skill per listed start, with each skill's JSON Schemas in the [skills extension](/a2a/skills/v1/)) and the JSON-RPC binding at `POST <base>`: `SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`. `A2A-Version: 1.0` is required.

<!-- snippet-context
import { Injectable, HttpAuthenticator, HttpAuthResult, HttpSecurity, WorkflowStart } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
import { A2AEndpoint } from "@agboss/core/a2a";
import { hours, minutes } from "@agboss/core/units";
@WorkflowStart({ name: "support-workflow-start", description: "A question", input: WorkflowStartTextDto })
export class SupportWorkflowStart {}
@HttpAuthenticator({ schemes: [HttpSecurity.bearer()] })
export class SupportHttpAuthenticator {
  authenticate(): HttpAuthResult {
    return HttpAuthResult.authenticated({});
  }
}
@A2AEndpoint({
  name: "support",
  version: "1.0.0",
  description: "Answers support questions",
  ttl: { tasks: hours(24), messages: minutes(15) },
  skills: [SupportWorkflowStart],
})
export class SupportA2AEndpoint {}
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
    endpoint: SupportA2AEndpoint, // listed in @Application({ endpoints })
    authenticator: SupportHttpAuthenticator, // the class: its instance is the container's
    publicUrl: "https://support.example", // where callers reach it: the card's interface URL
    base: "/a2a",
  }),
).listen(8080);
```

What the server guarantees:

- **Who calls is the host's decision.** `a2aHttpListener` never guesses a tenant from a request: it takes an [`@HttpAuthenticator`](/reference/a2a-endpoint/#who-calls-an-httpauthenticator) from the container (`[http.not-an-authenticator]` otherwise). `authenticate({ operation, taskId?, http })` returns `HttpAuthResult.authenticated({ tenant, ownerId, execution, peer })`, `.unauthenticated(reason, { challenge? })` (`401`) or `.forbidden(reason)` (`403`); a refused request runs nothing. Anonymous access is opt-in (`allowAnonymous: true`, never beside a `tenantContext`) and token-bound.
- **Tasks.** One task is one root execution, kept in `A2ATaskRepository` for the endpoint's `ttl.tasks`; the same `messageId` gets the same task, never a second run, on any instance when the store is shared (`[a2a.task-store-not-shared]` otherwise). A task outlives its connection: a caller that disconnects never cancels it, it reads it again with `GetTask` or `SubscribeToTask`. A pause the caller answers is `TASK_STATE_INPUT_REQUIRED`; a follow-up `SendMessage` with the same `taskId` answers it.
- **Direct replies.** `skills: [{ start, reply: A2AReply.Message }]` answers a stateless skill (a lookup, a classification) with a `Message` at once instead of a task, once per `messageId` (`ttl.messages`).
- **Files.** A start's input may hold `FileDto` fields (`@File()`), filled from `raw` or `url` parts. A file by `url` is fetched once, by the server, at the admission, behind an SSRF guard: `https:` only, on the `@FilePolicy`'s `allowedOrigins`, three redirects at most, never a private, loopback, link-local or otherwise not globally reachable address, never through a proxy.
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
import { ExecutionContext, Tool } from "@agboss/core";
import { A2AAgent, A2AClient } from "@agboss/core/a2a";
import { seconds, usd } from "@agboss/core/units";

@A2AAgent({
  name: "order-desk-a2a-agent",
  url: "https://orders.example/a2a",
  target: { application: "orders-application", skill: "order-desk-workflow-start" },
  input: OrderQuestionDto,
  output: OrderDeskReplyDto,
  costPerCall: usd(0.002), // charged once per call; the step records the larger of it and a trusted peer's signed report
  deps: [ExecutionContext],
})
export class OrderDeskA2AAgent extends A2AClient<OrderQuestionDto, OrderDeskReplyDto> {
  constructor(private readonly executionContext: ExecutionContext) {
    super();
  }

  protected override getHeaders(): Promise<Record<string, string>> {
    // what the remote's authenticator decides: never trusted from a body
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
export class AskOrderDeskTool {
  constructor(
    private readonly orderDesk: OrderDeskA2AAgent,
    private readonly executionContext: ExecutionContext,
  ) {}

  execute(question: OrderQuestionDto): Promise<OrderDeskReplyDto> {
    // the input and the output validated, the cost per call recorded
    return this.orderDesk.execute(question, { signal: this.executionContext.signal });
  }
}
```

`execute` returns the `COMPLETED` task's output. `FAILED` and `REJECTED` are `A2ATaskFailedError`, a cancelled task is `A2ATaskCancelledError`, `INPUT_REQUIRED` is `A2ATaskInterruptedError`, a JSON-RPC error is `A2AProtocolError`, and a `401` / `403` is `A2AError.CallerRejected` (`code: "a2a.caller-rejected"`, the server's code in `wireCode`). `send(message)` returns the whole `A2ATaskResult`, and `reply(taskId, answer)`, `getTask`, `cancel(taskId)` and `agentCard()` work on a task. Inside an execution the send is exactly-once: a send of unknown outcome is sent again with the same `messageId` only to an AGBoss peer, never to a foreign agent (`OutboundCallUnreconciledError`).

:::caution[Migrating from 0.1.0]
The 0.1.0 wire is gone, with no shim: `POST <base>/execute`, `/resume` and `/cancel`, the `agboss-mesh` header, `A2ARoute`, `A2AAdapterContract` and `A2AExecutionResponse` are removed; `target: { application, start }` is `target: { application, skill }`, `price` is `costPerCall`, `@A2AExpose` is `@A2AEndpoint`, `A2ACallerResolver` is `@HttpAuthenticator`; `execute(input, { threadId })` takes a `call` with `signal`, `timeout`, `key` and `onEvent`; `cancel` takes a task id. A 0.1.0 client fails against a 0.1.1 server with `-32009`.
:::

In tests, the `a2aServer({ endpoint, authenticator })` fixture of `testWith` serves the app on a loopback listener and returns `{ url }`; any v1.0 client, or a plain JSON-RPC `fetch`, calls it, and `A2AError.CallerRejected` is asserted on `401` / `403` without external network sockets.

## Cross-Service Agent Mesh (the mesh extension, JWS signing, `--federation` & `agboss hub`)

When multiple AGBoss applications call each other over A2A (`A2AClient` to `a2aHttpListener`) or MCP (`@McpServer` to `@McpEndpoint`), AGBoss propagates an **Agent Mesh Envelope** with no code of yours. Over A2A it travels as the [mesh extension](/a2a/mesh/v1/) `https://agboss.dev/a2a/mesh/v1` in `message.metadata`, with `A2A-Extensions` and a W3C `traceparent`; over MCP it is `_meta["agboss.dev/mesh"]`:

- **Propagated context (`MeshEnvelope`):** `origin` (`executionId` / `rootExecutionId`, `parentExecutionId`, `workflow`, `step.idempotencyKey`), `budget.remaining` (a `caller-budget` cap on the downstream execution, so a child hop can never exceed its parent's remaining USD budget), `deadline.remaining` (`DeadlineExceededError` if exhausted) and `callChain` (`readonly MeshHop[]`).
- **Cryptographic peer verification (`@Application({ mesh })` takes a `@Mesh` class):** an application that names its keys signs every outgoing HTTP request (`X-AGBoss-Mesh`, an EdDSA JWS) and every run report it answers with; its `peers` are the applications whose signatures it checks, and `inboundMode: MeshInboundMode.Strict` refuses an unsigned request to a mesh endpoint. A request is trusted only when the authenticator's `peer` is the envelope's verified issuer. The caller records verified remote spend under `a2a:<issuer>` / `mcp:<issuer>` and `ToolCallRecord.remote`, exactly once however many passes replay the call.

<!-- snippet-context
import { Mesh, MeshInboundMode, defineEnv, secret } from "@agboss/core";
import { minutes } from "@agboss/core/units";
// @snippet
-->
```ts title="src/billing.mesh.ts"
const meshEnv = defineEnv({
  signingKey: secret("MESH_SIGNING_KEY"), // an Ed25519 key in PKCS #8 PEM
  ordersKey: secret("ORDERS_PUBLIC_KEY"), // the peer's public key (SPKI)
});

// @Application({ …, mesh: BillingMesh })
@Mesh({
  signingKey: meshEnv.signingKey,
  inboundMode: MeshInboundMode.Strict, // a request to a mesh endpoint must be a peer's, signed
  deduplicationTtl: minutes(30), // above the lease and envelopeTtl + 2 × maxClockSkew
  maxHops: 8,
  peers: [{ application: "orders-application", verifyKeys: [meshEnv.ordersKey] }], // any listed key verifies (a rotation)
})
export class BillingMesh {}
```

- **Distributed cycle & hop protection:** if `callChain` already contains the receiving `(application, skill)` pair (`Service A -> Service B -> Service A`), or is as long as `@Mesh({ maxHops })` (`8`), the A2A server accepts the message as a `REJECTED` task with `limit.mesh-loop` or `limit.hops`, nothing started, and `A2AClient` rethrows it as the typed **`MeshLoopDetectedError`** (catchable via `.onError(MeshLoopDetectedError, ...)`) or **`HopsLimitExceededError`**. An agent that does not support the extension (a foreign one) is called without it, and the call says so (`mesh: false`).
- **Cross-repo contract verification (`--federation`) & AGBoss Mesh Hub (`agboss hub`):** in CI and local operations, verify that all services in an Agent Mesh agree on input/output DTO schemas (an `@A2AAgent` is paired by `(target.application, target.skill)` with the other application's exported skill) and visualize cross-service topology, stitched execution trees (`ExecutionHistoryRepository` + `agboss executions export`), Progressive Crystallization Radar and Blast Radius:

```bash
npx agboss check --federation snapshots/
npx agboss executions export --all-tenants --out .artifacts/records.jsonl
npx agboss hub show snapshots/ .artifacts/records.jsonl --html .artifacts/hub.html
npx agboss hub ui snapshots/ .artifacts/records.jsonl
```

If an upstream service changes an exposed DTO without updating consumers, `npx agboss check --federation` fails before deployment and prints the cross-service blast radius. The extension specifications are [`a2a/mesh/v1`](/a2a/mesh/v1/) and [`a2a/skills/v1`](/a2a/skills/v1/).

---

## Standalone Executable Proofs: [`06-enterprise-agent-mesh`](https://github.com/agbossjs/agboss-examples/tree/main/06-enterprise-agent-mesh) & [`03-support-refund-desk`](https://github.com/agbossjs/agboss-examples/tree/main/03-support-refund-desk)

- **[`06-enterprise-agent-mesh`](https://github.com/agbossjs/agboss-examples/tree/main/06-enterprise-agent-mesh):** Demonstrates a 3-service microservice mesh (`apps/1-order-gateway`, `apps/2-billing-a2a` with an A2A endpoint, and `apps/3-catalog-mcp` with an MCP endpoint), Ed25519 signed mesh envelopes, `MeshLoopDetectedError` / `HopsLimitExceededError` fallback routing, request deduplication, and `agboss check --federation` Blast Radius over `federation/` snapshots.
- **[`03-support-refund-desk`](https://github.com/agbossjs/agboss-examples/tree/main/03-support-refund-desk):** Demonstrates an in-memory BM25/TF-IDF section indexer wired into a `@Rag` knowledge base alongside a `@Memory` (see [7 Verified Examples](/examples/verified-examples/)).
