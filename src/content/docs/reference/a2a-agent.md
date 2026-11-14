---
title: "@A2AAgent, @A2AExpose, a2aHttpListener & A2ACallerResolver"
description: "Reference for A2A v1.0 in AGBoss: @A2AAgent clients, @A2AExpose skills and the Agent Card, a2aHttpListener JSON-RPC tasks, caller resolvers, file parts with the SSRF guard, direct replies, streaming and the mesh and skills extensions."
---

`@agboss/core/a2a` speaks **A2A v1.0** ([specification](https://a2a-protocol.org/v1.0.0/specification/)) in both directions, on the official `@a2a-js/sdk`: an AGBoss application serves its workflows as an A2A agent that any v1.0 client can call, and calls any v1.0 agent, another AGBoss application or a foreign one, as a typed contract.

- **`@A2AAgent`** (`a2a/*.a2a-agent.ts`) declares a remote agent: a class that `extends A2AClient<In, Out>`, registered in `providers` and injected into a `@Tool` or an `@Action`. `execute(input, call?)` sends the input and returns the remote output, both validated by the contract's DTOs.
- **`@A2AExpose`** (`a2a/*.a2a-expose.ts`) lists the `@WorkflowStart` classes (the **skills**) an `@Application({ exposes })` serves, and is listed in `agboss describe --json` for `agboss check --federation`.
- **`a2aHttpListener(app, { expose, callerResolver, publicUrl, base? })`** serves it: the Agent Card at `<base>/.well-known/agent-card.json` and the JSON-RPC 2.0 binding at `POST <base>`. A caller resolver (`A2ACallerResolver`) says who calls, for every request.
- Two profile extensions ride on top: the [mesh extension](/a2a/mesh/v1/) (`https://agboss.dev/a2a/mesh/v1`: call chain, budget, deadline, signed run report) and the [skills extension](/a2a/skills/v1/) (`https://agboss.dev/a2a/skills/v1`: each skill's JSON Schemas, reply mode, file fields).

:::caution[Breaking in 0.1.1]
The 0.1.0 wire is gone, with no shim: `POST <base>/execute`, `/resume` and `/cancel`, the `agboss-mesh` request header, `A2ARoute`, `A2AAdapterContract` and `A2AExecutionResponse` no longer exist, and `target: { application, start }` is now `target: { application, skill }`. A caller that spoke the 0.1.0 wire fails against a 0.1.1 server with `-32009` (no `A2A-Version: 1.0`). See the [guide](/guides/mcp-rag-and-a2a/) for the migration notes.
:::

## Calling a remote agent: `@A2AAgent`

The contract of an order desk: its input and output DTOs, the client class, and a tool that hands the model the call.

```ts file=src/support/dto/order-question.dto.ts
import { Text } from "@agboss/core/dto";

export class OrderQuestionDto {
  @Text({ prompt: "the question for the order desk" })
  question!: string;
}
```

```ts file=src/support/dto/order-desk-reply.dto.ts
import { Text } from "@agboss/core/dto";

export class OrderDeskReplyDto {
  @Text({ prompt: "the order desk's answer" })
  text!: string;
}
```

```ts file=src/support/a2a/order-desk.a2a-agent.ts
// a2a/order-desk.a2a-agent.ts — an A2A v1.0 agent as a declared contract (#809): whom it calls, what
// it sends, gets back and costs; per-call headers from the execution
import { ExecutionContext } from "@agboss/core";
import { A2AAgent, A2AClient } from "@agboss/core/a2a";
import { usd } from "@agboss/core/units";
import { OrderDeskReplyDto } from "../dto/order-desk-reply.dto.js";
import { OrderQuestionDto } from "../dto/order-question.dto.js";

@A2AAgent({
  name: "order-desk-a2a-agent",
  url: "https://orders.example/a2a", // its card: <url>/.well-known/agent-card.json
  target: { application: "orders-application", skill: "order-desk-workflow-start" },
  input: OrderQuestionDto, // the target skill's input
  output: OrderDeskReplyDto, // its finish's output
  price: usd(0.002), // per call: the step records the larger of it and a trusted peer's report
  deps: [ExecutionContext],
})
export class OrderDeskA2AAgent extends A2AClient<OrderQuestionDto, OrderDeskReplyDto> {
  constructor(private readonly executionContext: ExecutionContext) {
    super();
  }

  protected override getHeaders(): Promise<Record<string, string>> {
    // what the remote's caller resolver authenticates (a token, mTLS): never trusted from a body
    return Promise.resolve({ "x-tenant-id": this.executionContext.tenant.tenantId });
  }
}
```

```ts file=src/support/tools/ask-order-desk.tool.ts
// tools/ask-order-desk.tool.ts — an agent delegates to the remote workflow through a tool
import { ExecutionContext, Tool, type ToolHandler } from "@agboss/core";
import { seconds } from "@agboss/core/units";
import { OrderDeskReplyDto } from "../dto/order-desk-reply.dto.js";
import { OrderQuestionDto } from "../dto/order-question.dto.js";
import { OrderDeskA2AAgent } from "../a2a/order-desk.a2a-agent.js";

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
    private readonly orderDeskA2AAgent: OrderDeskA2AAgent,
    private readonly executionContext: ExecutionContext,
  ) {}

  run(question: OrderQuestionDto): Promise<OrderDeskReplyDto> {
    // typed by the contract: the input and the output validated, the price recorded
    return this.orderDeskA2AAgent.execute(question, { signal: this.executionContext.signal });
  }
}
```

```ts file=src/support/agents/support/support.agent.ts
import { Agent } from "@agboss/core";
import { AskOrderDeskTool } from "../../tools/ask-order-desk.tool.js";

@Agent({
  name: "support-agent",
  description: "Answers questions, asking the order desk about orders",
  prompt: "Answer the question. Ask the order desk about orders with ask-order-desk-tool.",
  model: "moonshotai/kimi-k2.6",
  tools: [AskOrderDeskTool],
  maxToolCalls: 5,
})
export class SupportAgent {}
```

`url` is the agent's base URL. Its card is read from `<url>/.well-known/agent-card.json` on first use and kept for `cardTtl` (5 minutes). Before anything is sent the card is checked, and a failure is an `A2AContractError` or `A2AProtocolError`:

- an A2A 1.0 interface on JSON-RPC or HTTP+JSON (a v0.3-only card is `A2AProtocolError` naming `0.3.0`);
- the named `target.skill` among its skills (`[a2a.unknown-skill]`; optional when the agent has one skill);
- when an AGBoss peer declares the skill's schemas (the skills extension), the skill's input must accept the input DTO and the output DTO every finish output (`[a2a.schema-mismatch]`);
- every interface the card names is on the `url`'s origin or one of `allowedOrigins`, else `A2AOriginError` (`a2a.origin-refused`): no request goes elsewhere, so the client's headers never leave its origins, and a redirect off them is refused.

| Option | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Required. Kebab-case, ends with `-a2a-agent` (`[name.kind-suffix]`); the class ends with `A2AAgent`. |
| `url` | `string` | Required. Base URL of the remote agent. |
| `target` | `{ application?, skill?, finishes? }` | `application` names an AGBoss peer (verified by `agboss check --federation`; the mesh is required by default); without it the agent is **foreign**. `skill` is the start's name (optional with one skill). `finishes` limits which finishes the typed `output` covers (below). |
| `input` / `output` | `DtoClass` | The typed contract: validated on `execute` and exported with their `schemaHash` in `agboss describe --json`. Without both, `execute` throws `[a2a.no-contract]` (use `send`). |
| `price` | `Usd` | Fallback cost per call. The step records the larger of `price` and a trusted peer's signed run report. A foreign agent without a `price` is `[a2a.unpriced-foreign-peer]`. |
| `mesh` | `A2AMesh` | `A2AMesh.Required` (default with a `target.application`) or `A2AMesh.IfSupported`. |
| `allowedOrigins` | `string[]` | Extra origins the card's interfaces may name. |
| `deps` | `readonly Token[]` | Constructor dependencies, used inside `getHeaders()`. |

The methods: `execute(input, call?)` (typed; one `data` part, or one `text` part for a `WorkflowStartTextDto` start, naming the skill in `message.metadata["https://agboss.dev/a2a/skills/v1"]`); `send(message, call?)` (a text, `{ data }` or parts, returning an `A2ATaskResult` with `task`, `message`, `text`, `data`, `files`, `peer`); `reply(taskId, answer)` for a task that waits for input; `getTask(taskId)`; `cancel(taskId)`; `agentCard()`; `downloadFile(file, { maxSize?, signal? })`. `call.onEvent` receives each event of the remote task while the call waits; pass `executionContext.signal` so a cancel or a timeout aborts the HTTP call.

**Outcomes.** A `COMPLETED` task gives its output, read from the artifact an AGBoss finish marks, else from every artifact in order (none readable: `A2ARemoteCallError`). `FAILED` or `REJECTED` is `A2ATaskFailedError`; an AGBoss peer's `limit.mesh-loop` and `limit.hops` come back as the same `MeshLoopDetectedError` and `HopsLimitExceededError`. `CANCELED` is `A2ATaskCanceledError`. `INPUT_REQUIRED` is `A2ATaskInterruptedError` from `execute` (a remote pause is not a local one yet) and the task from `send`. A JSON-RPC error is `A2AProtocolError` (`rpcCode`); a `401` or `403` is `A2ACallerRejectedError` (`code: "a2a.caller-rejected"`, `httpStatus`, the server's `wireCode`). Only codes are kept: an agent's own message, status text or body never is.

**Sending is exactly-once inside an execution.** The accept is one `SendMessage` with `returnImmediately`, run through the outbound-calls ledger, its `messageId` derived from the step's key. A send of unknown outcome (no answer, a 5xx) is sent again with the same `messageId` only to an AGBoss peer whose card declares an idempotency retention, within it; to a foreign agent it is never sent again: `OutboundCallUnreconciledError`. Two calls of one step with different messages need their own `call.key` (`[a2a.repeated-call]`). The wait is a pure read (`SubscribeToTask` when the card streams, else `GetTask` polled) up to the execution's deadline or `call.timeout`, then a best-effort `CancelTask` and `A2ACallDeadlineError`. A step of no composed application (a unit runner's) is `[a2a.outside-application]`: mock the client there.

### Some finishes only, mesh and origins

By default a typed client's `output` covers every finish of its skill. `target.finishes` names the ones it takes; a task that ends at another finish fails the call with `A2AUnexpectedFinishError`, which a step's side path takes with `.onError(...)`:

```ts file=src/support/a2a/answer-desk.a2a-agent.ts
import { A2AAgent, A2AClient, A2AMesh } from "@agboss/core/a2a";
import { OrderDeskReplyDto } from "../dto/order-desk-reply.dto.js";
import { OrderQuestionDto } from "../dto/order-question.dto.js";

@A2AAgent({
  name: "answer-desk-a2a-agent",
  url: "https://orders.example/a2a",
  allowedOrigins: ["https://rpc.orders.example"], // the card may name this origin too
  target: {
    application: "orders-application",
    skill: "order-desk-workflow-start",
    finishes: ["order-desk-workflow-finish"], // only this finish's output is read
  },
  input: OrderQuestionDto,
  output: OrderDeskReplyDto,
  mesh: A2AMesh.IfSupported, // a card without the mesh extension is called without it
})
export class AnswerDeskA2AAgent extends A2AClient<OrderQuestionDto, OrderDeskReplyDto> {}
```

## Serving: `@A2AExpose` and `a2aHttpListener`

### Who calls: the caller resolver

The framework never guesses a tenant from a request. The host says who calls, for every request, with an ordinary `@Injectable` that `implements A2ACallerResolver<typeof Start>`, listed in `providers` and created by the container like any service (its services through `deps`, its environment, a test's `override(...)` apply; never `new`).

```ts file=src/support/services/api-key-directory.service.ts
// services/api-key-directory.service.ts — the host's own service (a database, a KMS, …)
import { Injectable } from "@agboss/core";

export interface ApiKeyGrant {
  readonly clientId: string;
  readonly tenantId: string;
  readonly canAnswerPauses: boolean;
}

@Injectable()
export class ApiKeyDirectory {
  grantOf(apiKey: string): Promise<ApiKeyGrant | undefined> {
    return Promise.resolve(apiKey === "key-acme" ? { clientId: "client-acme", tenantId: "acme", canAnswerPauses: true } : undefined);
  }
}
```

```ts file=src/support/a2a/support.a2a-caller-resolver.ts
// a2a/support.a2a-caller-resolver.ts — who calls: decided by the host, the tenant never guessed
import { Injectable } from "@agboss/core";
import { A2ACallerResolution, A2AOperation, type A2ACallerRequest, type A2ACallerResolver } from "@agboss/core/a2a";
import type { SupportWorkflowStart } from "../workflows/support/support.workflow-start.js";
import { ApiKeyDirectory, type ApiKeyGrant } from "../services/api-key-directory.service.js";

@Injectable({ deps: [ApiKeyDirectory] }) // created by the container, never `new`
export class SupportA2aCallerResolver implements A2ACallerResolver<typeof SupportWorkflowStart> {
  constructor(private readonly apiKeyDirectory: ApiKeyDirectory) {}

  async resolveCaller(request: A2ACallerRequest): Promise<A2ACallerResolution<typeof SupportWorkflowStart>> {
    const header: string = request.http.headers.authorization ?? ""; // headers, socket, operation, task
    if (!header.startsWith("Bearer ")) {
      return A2ACallerResolution.unauthenticated({ reason: "no API key", challenge: 'Bearer realm="a2a"' });
    }
    const grant: ApiKeyGrant | undefined = await this.apiKeyDirectory.grantOf(header.slice("Bearer ".length));
    if (grant === undefined) return A2ACallerResolution.unauthenticated({ reason: "unknown API key" });
    const isResume = request.operation === A2AOperation.SendMessage && request.taskId !== undefined;
    if (isResume && !grant.canAnswerPauses) {
      return A2ACallerResolution.forbidden({ reason: "this key may not answer pauses" });
    }
    return A2ACallerResolution.resolved({ tenant: { tenantId: grant.tenantId }, ownerId: grant.clientId });
  }
}
```

`resolveCaller({ operation, taskId?, http })` gets the JSON-RPC method as an `A2AOperation` (`SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`), the task it names (a `SendMessage` with a `taskId` answers a task's pause), and the raw `IncomingMessage` (headers; the socket, for a client certificate). The body is read first (up to `maxBodySize`, default 1 MB, else `413`) and decoded once, for the operation and the task only: nothing of it runs before the resolver answers. It answers with an `A2ACallerResolution` only (branded: a plain object does not compile):

| The resolver returns | The caller gets |
| :--- | :--- |
| `resolved({ tenant, ownerId, execution, peer? })` | the operation, for that tenant and owner (its tasks only) |
| `unauthenticated({ reason, challenge? })` | `401`, `WWW-Authenticate: <challenge>`, `{ "code": "a2a.caller-unauthenticated", "error": reason }` |
| `forbidden({ reason })` | `403`, `{ "code": "a2a.caller-forbidden", "error": reason }` |
| it throws | `500`, `{ "code": "a2a.caller-resolution-failed" }`, never the error's text |

A refused request **runs nothing**: no task, no thread, no record, no model call, and never as a default tenant. `resolved` is typed by the start's application: with a declared `TenantContext` its values are required; a single-tenant host returns `A2ACallerResolution.resolved({})`, never implied. `peer` is the application your transport proved (mTLS, a token): a mesh request is trusted only when it matches the envelope's verified issuer.

### The workflow, the expose and the listener

```ts file=src/support/workflows/support/support.workflow-start.ts
import { WorkflowStart } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";

@WorkflowStart({ name: "support-workflow-start", description: "A question", input: WorkflowStartTextDto })
export class SupportWorkflowStart {}
```

```ts file=src/support/workflows/support/support.workflow-finish.ts
import { WorkflowFinish } from "@agboss/core";
import { WorkflowFinishTextDto } from "@agboss/core/dto";

@WorkflowFinish({ name: "support-workflow-finish", description: "The answer", output: WorkflowFinishTextDto })
export class SupportWorkflowFinish {}
```

```ts file=src/support/workflows/support/support.workflow.ts
import { Workflow, start } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
import { OrderDeskA2AAgent } from "../../a2a/order-desk.a2a-agent.js";
import { SupportA2aCallerResolver } from "../../a2a/support.a2a-caller-resolver.js";
import { SupportAgent } from "../../agents/support/support.agent.js";
import { ApiKeyDirectory } from "../../services/api-key-directory.service.js";
import { SupportWorkflowFinish } from "./support.workflow-finish.js";
import { SupportWorkflowStart } from "./support.workflow-start.js";

@Workflow({
  name: "support-workflow",
  version: "1.0.0",
  flow: [
    start(SupportWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toAgent(SupportAgent)
      .toFinish(SupportWorkflowFinish),
  ],
  // an A2A client and the caller resolver are providers like any service
  providers: [OrderDeskA2AAgent, ApiKeyDirectory, SupportA2aCallerResolver],
})
export class SupportWorkflow {}
```

```ts file=src/support/a2a/support.a2a-expose.ts
// what the application serves over A2A (#398 PR 3): the starts a caller may run
import { A2AExpose, A2ASecurity } from "@agboss/core/a2a";
import { SupportWorkflowStart } from "../workflows/support/support.workflow-start.js";

@A2AExpose({
  name: "support-a2a-expose",
  version: "1.0.0",
  description: "Answers support questions",
  exports: [SupportWorkflowStart],
  security: [A2ASecurity.bearer()], // the card's securitySchemes; the resolver enforces it
})
export class SupportA2AExpose {}
```

<!--
```ts file=src/support/budgets/application-daily.budget.ts
import { Budget, BudgetPeriod, BudgetScope, type BudgetHandler } from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";

@Budget({ name: "application-daily-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class ApplicationDailyBudget implements BudgetHandler {
  maxSpend(): Usd {
    return usd(5);
  }
}
```

```ts file=src/support/budgets/tenant-daily.budget.ts
import { Budget, BudgetPeriod, BudgetScope, type BudgetHandler } from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";

@Budget({ name: "tenant-daily-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class TenantDailyBudget implements BudgetHandler {
  maxSpend(): Usd {
    return usd(1);
  }
}
```

```ts file=src/support/budgets/execution.budget.ts
import { Budget, BudgetScope, type BudgetHandler } from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";

@Budget({ name: "execution-budget", scope: BudgetScope.Execution })
export class ExecutionBudget implements BudgetHandler {
  maxSpend(): Usd {
    return usd(0.1);
  }
}
```
-->

```ts file=src/support.application.ts
import { Application, EmptyEnvironment } from "@agboss/core";
import { SupportA2AExpose } from "./support/a2a/support.a2a-expose.js";
import { ApplicationDailyBudget } from "./support/budgets/application-daily.budget.js";
import { ExecutionBudget } from "./support/budgets/execution.budget.js";
import { TenantDailyBudget } from "./support/budgets/tenant-daily.budget.js";
import { SupportWorkflow } from "./support/workflows/support/support.workflow.js";

@Application({
  name: "support-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [SupportWorkflow],
  budgets: [ApplicationDailyBudget, TenantDailyBudget, ExecutionBudget],
  exposes: [SupportA2AExpose], // describe --json lists it among the exported contracts
})
export class SupportApplication {}
```

<!-- snippet-context
import { createApp } from "@agboss/core";
import { SupportApplication } from "./src/support.application.js";
import { SupportA2AExpose } from "./src/support/a2a/support.a2a-expose.js";
import { SupportA2aCallerResolver } from "./src/support/a2a/support.a2a-caller-resolver.js";
-->

```ts
import { createServer } from "node:http";
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

The listener takes the resolver's instance from the application's container when it is built. A class neither the application nor any workflow lists stops it there (`[a2a.caller-resolver-not-listed]`), an expose the application does not list is `[application.expose-unlisted]`, and a `publicUrl` that is no absolute http(s) URL is `[a2a.public-url-invalid]`. `app` is an `A2AApp`: `createApp`'s app and `testWith`'s `app` both fit. Other options: `maxBodySize`, `maxTaskDuration` (an execution deadline for every task), `fileFetchTimeout` (10 s).

### The Agent Card

`GET <base>/.well-known/agent-card.json`, with `ETag`, `Last-Modified` and `Cache-Control: max-age=300`:

- the expose's `name`, `description` (required: `[a2a.expose-description-required]`), `version` and `provider`;
- **one skill per exported start**: its id the start's name, its description the start's, `tags` from `@A2AExpose({ skills })` (default the application's name; no tags is `[a2a.skill-tags]`), `inputModes` `text/plain` for a `WorkflowStartTextDto` start, else `application/json`;
- `capabilities.streaming: true`, no push notifications;
- the [skills extension](/a2a/skills/v1/) with each skill's input JSON Schema, its `schemaHash`, each finish's output schema, its reply mode and file fields;
- the [mesh extension](/a2a/mesh/v1/) with the idempotency retentions;
- `securitySchemes` from `@A2AExpose({ security: [A2ASecurity.bearer()] })` (`.apiKey({ header })`, `.oauth2ClientCredentials({ tokenUrl, scopes })`, `.mtls()`): described only, the resolver enforces it;
- one interface `{ url: publicUrl + base, protocolBinding: "JSONRPC", protocolVersion: "1.0" }`.

### The JSON-RPC binding

`POST <base>` with `A2A-Version: 1.0` required (none, or `0.3`, is `-32009`):

| Method | What it does |
| :--- | :--- |
| `SendMessage` | A new task (no `taskId`), or a follow-up answering one. Blocks until the task is over or waits for its caller, or returns at once with `configuration.returnImmediately`. |
| `SendStreamingMessage` | The same, its changes as server-sent events (below). |
| `GetTask` / `ListTasks` | The caller's tasks only (another's is `-32001`), newest status first, paged, by context, state and `statusTimestampAfter`; `totalSize` counts every task the filters match. |
| `CancelTask` | That task only; one not started yet is fenced and `CANCELED` at once; one that is over is `-32002`. |
| `SubscribeToTask` | The task first, then its changes until it is over. |
| push methods, `GetExtendedAgentCard` | `-32003` / `-32004`: the card declares neither. |

- **A message** names its skill in `metadata["https://agboss.dev/a2a/skills/v1"].skill` (optional with one export or a `defaultSkill`, else `-32602` listing the ids) and carries text parts (a text start) or one `data` part, checked against the start's input before anything is kept (`-32602`, `dto.invalid`). Its `contextId` is the task's thread.
- **One task is one root execution**, under the task's id, kept in `A2ATaskRepository`. The same `messageId` from the same tenant and owner gets the same task, never a second run, on any instance; with other content it is `-32602 a2a.message-id-reused`.
- **A task outlives its connection**: a caller that disconnects never cancels it; it reads it again with `GetTask` or `SubscribeToTask`.
- **Pauses.** A pause the caller answers is `TASK_STATE_INPUT_REQUIRED`, its pauses (`pauseId`, `kind`, `ask`) in the status message's `data` part. A follow-up `SendMessage` with the same `taskId` answers it: one `data` part `{ pauseId?, decision }` or a text reply. A pause only its channel answers is `TASK_STATE_WORKING`, "awaiting <channel> out of band". A pause that a cancel or another answer took first is `-32004 a2a.pause-closed`, with the `reason` in the error metadata.
- **Ends.** A finish is `COMPLETED` with one artifact named by the finish (a text part for a `WorkflowFinishTextDto` output, else a `data` part, or file parts). A failure is `FAILED` with its stable code in `status.message.metadata["https://agboss.dev/a2a/mesh/v1"].code` and that code's fixed text, never the error's own text, which may carry PII; an unexpected failure of the server is `-32603`.

### Streaming carries the agent's answer only

`SendStreamingMessage` answers the task first, then status updates (an agent's tool call as it starts is `WORKING` with the text `calling <tool>`), then the **agent's answer text** as chunks of one artifact, then the finish's output and the last status. Only the answering agent's text streams: never a judge's, a router's or another internal model's (#1004). The artifact is `<taskId>:output`: the stream's first chunk has `append: false`, the next of the same step `append: true`; a retry or another step starts it anew, a retracted step empties it, and a task that ends `FAILED`, `CANCELED` or `REJECTED` after text ends with an empty `lastChunk: true` before its last status (#1006). The finish's output replaces the streamed text (`append: false`, `lastChunk: true`), so a client that applies every event as A2A v1.0 says ends with the artifacts `GetTask` returns, and one that joins the artifacts' text reads the answer once.

### Where the tasks live

| Store | Holds | Retention (default) | Built in |
| :--- | :--- | :--- | :--- |
| `A2ATaskRepository` | one task per root execution, its messages' ids | `a2aTasks` (`hours(24)`) | in memory, `SqliteA2ATaskRepository`, `@agboss/postgres`, `@agboss/mongodb`; suite `a2aTaskContract` |
| `A2ADirectMessageRepository` | a direct reply, by `(tenant, owner, messageId)` | `a2aMessages` (`minutes(15)`) | in memory, SQLite, PostgreSQL, MongoDB; suite `a2aDirectMessageContract` |
| `A2AFileRepository` | a task's files | `a2aFiles` (`a2aTasks`) | inline, in memory, `LocalDiskA2AFileRepository`, `S3A2AFileRepository`; suite `a2aFileContract` |

`@Application({ retention: { a2aTasks, a2aMessages, a2aFiles } })` sets them; an unfinished task is never removed. An application whose instances share leases (any backend but `in-memory`) must list stores they share, else it does not assemble: `[a2a.task-store-not-shared]`, `[a2a.message-store-not-shared]`, `[a2a.file-store-not-shared]`.

## File parts and the SSRF guard

A skill takes files when its start's input DTO has `A2AFileDto` fields (`@Nested(A2AFileDto)` for one, `@ListOf(A2AFileDto)` for several). A file is filled from a `raw` (inline bytes) or `url` part, never from a data part (`-32602 a2a.file-field-in-data`), and a finish's file fields leave as file parts of its artifact. A step reads and writes them through `A2AFiles`:

```ts file=src/support/dto/review-request.dto.ts
import { A2AFileDto } from "@agboss/core/a2a";
import { Nested, Text } from "@agboss/core/dto";

export class ReviewRequestDto {
  @Nested(A2AFileDto, { prompt: "the document to review" })
  document!: A2AFileDto;

  @Text({ prompt: "a note to the reviewer", optional: true })
  note?: string;
}
```

```ts file=src/support/services/document-reader.service.ts
import { Injectable } from "@agboss/core";
import { A2AFileDto, A2AFiles } from "@agboss/core/a2a";
import { ReviewRequestDto } from "../dto/review-request.dto.js";

@Injectable({ deps: [A2AFiles] })
export class DocumentReader {
  constructor(private readonly a2aFiles: A2AFiles) {}

  async report(request: ReviewRequestDto): Promise<A2AFileDto> {
    const bytes = await this.a2aFiles.read(request.document); // checked against its sha256
    return this.a2aFiles.save({
      bytes: new TextEncoder().encode(`read ${String(bytes.byteLength)} bytes`),
      mediaType: "text/plain",
      filename: "report.txt",
    });
  }
}
```

| Rule | What happens |
| :--- | :--- |
| where a file goes | into the field its part names in `metadata["https://agboss.dev/a2a/skills/v1"].field`; unnamed ones in order |
| limits | `@A2AExpose({ skills: { [id]: { files } } })` over `@Application({ a2aFiles })`: `maxFileSize` (64 KB), `maxTotalFileSize` (64 KB), `maxFiles` (5) |
| media types | `allowedMediaTypes` (PNG, JPEG, WebP, GIF, PDF, plain text, Markdown, CSV, JSON); the bytes are checked against the declared type (`a2a.media-type-mismatch`) |
| a follow-up | text or data only: a file is `-32005`; a pause's decision never carries a file |
| a resend | the same `messageId` with the same bytes gets the same task, nothing fetched again |
| nesting | a file below the top level of a DTO is `[a2a.nested-file-field]` |

**A file by `url` is fetched once, by the server, at the admission**, before the task is kept; no step fetches it. The guard:

- `https:` only, on an origin of `@Application({ a2aFiles: { allowedFileOrigins } })` (none listed: `a2a.file-url-not-allowed`; another: `a2a.file-origin-denied`); `GET`; at most 3 redirects, followed by hand and each target's origin checked;
- never an address that is not globally reachable: loopback, private, link-local, CGNAT, documentation, reserved, multicast, unique-local and the rest of the IANA special-purpose registries, nor an IPv6 address carrying such an IPv4 (mapped, translated, NAT64, 6to4); the lookup's answer is checked (`a2a.file-address-denied`);
- never a url with a user or a password, never through a proxy: the fetch has its own connection, a raw socket connected to a checked address, so **no byte goes to a denied peer**; a deployment whose egress must go through a proxy takes no file by url;
- the read stops at `maxFileSize` and is bound by `fileFetchTimeout` (`a2a.file-fetch-failed`); the same url sent concurrently is fetched once.

With no `A2AFileRepository` listed, a file rides inline in its task's records: silently up to 64 KB, with the warning `[a2a.inline-files-without-store]` up to 256 KB, above it `[a2a.file-store-required]`. A task's files are its own, kept while it waits (however long an `INPUT_REQUIRED` task is paused) and removed `retention.a2aFiles` after it is over. The card lists what a skill takes in `inputModes` and in the skills extension's `files` and `outputFiles` (`@A2AExpose({ cardFileFields })`). The client sends `A2AClientFile.fromBytes(bytes, { mediaType, filename })` or `A2AClientFile.fromUrl(url, ...)` in an input's file fields and reads an answer's files with `downloadFile`.

## Direct replies: `A2AReply.Message`

A skill that needs no task, a lookup or a classification, answers `SendMessage` with a `Message` directly. `defaultSkill` is the skill a message that names none runs (a foreign caller that knows nothing of the skills extension):

```ts file=src/support/workflows/lookup/lookup.workflow-start.ts
import { WorkflowStart } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";

@WorkflowStart({ name: "lookup-workflow-start", description: "A lookup", input: WorkflowStartTextDto })
export class LookupWorkflowStart {}
```

```ts file=src/support/a2a/lookup.a2a-expose.ts
import { A2AExpose, A2AReply } from "@agboss/core/a2a";
import { LookupWorkflowStart } from "../workflows/lookup/lookup.workflow-start.js";
import { SupportWorkflowStart } from "../workflows/support/support.workflow-start.js";

@A2AExpose({
  name: "support-a2a-expose",
  version: "1.1.0",
  description: "Answers support questions",
  exports: [SupportWorkflowStart, LookupWorkflowStart],
  skills: {
    "lookup-workflow-start": { reply: A2AReply.Message, tags: ["lookup"] }, // a Message, no task
    "support-workflow-start": { tags: ["support"] },
  },
  defaultSkill: LookupWorkflowStart,
})
export class LookupA2AExpose {}
```

- The reply is the finish's output as a text, data or file parts, with `metadata[skills-uri].finish`, and for a trusted caller the signed run report in `metadata[mesh-uri].report`. `returnImmediately` changes nothing; `SendStreamingMessage` is one frame; `GetTask` of it, or a follow-up naming the skill with a `taskId`, is `-32001`.
- **The workflow must be stateless**, checked at assembly on every node: no pause (`[a2a.message-skill-pause]`), no fenced effect, `OutboundCalls` or `@A2AAgent` (`-effect`), only `@Tool({ readOnly: true })` tools (`-tool`), no compensation (`-compensation`), no child workflow (`-child`). A `reply` for no export or a `defaultSkill` that is none: `[a2a.unknown-skill-option]`.
- **Once per `messageId`.** The reply is kept in `A2ADirectMessageRepository` for `retention.a2aMessages` (default 15 minutes, published on the card as `messageIdempotencyRetention`): a resend gets the same message, a concurrent duplicate waits for it, so the model is called and charged once. One id is one message across both reply modes (`-32602 a2a.message-id-reused`).
- **Bounded attempts.** An attempt stops at 25 s, and when its caller disconnects; a recovery never continues it. An instance that died mid-call records one call of unknown cost (`CostSource.Unknown`) and a later resend runs it once.

## The mesh and skills extensions

Calls between AGBoss applications carry an envelope of the [mesh extension](/a2a/mesh/v1/) in `message.metadata["https://agboss.dev/a2a/mesh/v1"].envelope`, with `A2A-Extensions` and a W3C `traceparent`; no code of yours. It holds the `origin` (execution ids, workflow, step key), the `budget.remaining` and `deadline.remaining` of the caller, and the `callChain`. It is signed (JWS `EdDSA`, Ed25519) when the application names its keys in `@Application({ mesh })`, and its `bodyHash` binds it to the message (`meshBodyHashOf`).

| Receiver step | Outcome |
| :--- | :--- |
| audience | an envelope addressed to another application is `401 mesh.audience-mismatch`; a signed one addressed to none `401 mesh.audience-missing` |
| signature of a known peer | `401 mesh.signature-invalid`, `mesh.envelope-expired`, `mesh.body-mismatch` |
| caller resolved | trusted only when the resolver's `peer` is the envelope's verified issuer |
| chain | one that already passed through this skill, or is as long as `@Application({ maxMeshHops })` (8), is accepted as a `REJECTED` task with `limit.mesh-loop` or `limit.hops`, nothing started; the client rebuilds `MeshLoopDetectedError` / `HopsLimitExceededError` |
| run | the execution gets a trusted caller's origin, a `caller-budget` and the deadline; a completed task carries the signed run report |

A mesh call is charged exactly once: the `price` at the accept and a verified run report's spend above it, under the call's own ledger identity, however many passes replay it. A call the agent refused before anything ran (a mesh loop) is charged nothing. A foreign agent that does not echo the extension is called without the mesh, said in the tool call's record (`remote: { mesh: false }`) and in `agboss describe`. The [skills extension](/a2a/skills/v1/) carries each skill's schemas, which both `a2aHttpListener` (for the card) and `A2AClient` (for the contract check) use.

## Testing: the `a2aServer` fixture

`testWith`'s `a2aServer({ expose, callerResolver, base? })` serves the test's `app` through `a2aHttpListener` on `127.0.0.1:0` and returns `{ url }`; the loopback is open for it (no `allowNetwork`) and it closes at the test's end. The resolver comes from the test app's container, so `override(ApiKeyDirectory, ...)` reaches it. Any v1.0 client calls it; a plain JSON-RPC `SendMessage` is the smallest:

```ts file=tests/support/a2a/support.a2a-caller-resolver.test.ts
import { expect } from "vitest";
import { Injectable } from "@agboss/core";
import { override, testWith } from "@agboss/core/testing";
import { ApiKeyDirectory, type ApiKeyGrant } from "../../../src/support/services/api-key-directory.service.js";
import { SupportA2aCallerResolver } from "../../../src/support/a2a/support.a2a-caller-resolver.js";
import { SupportA2AExpose } from "../../../src/support/a2a/support.a2a-expose.js";
import { SupportAgent } from "../../../src/support/agents/support/support.agent.js";
import { SupportApplication } from "../../../src/support.application.js";

@Injectable()
class NoKeysDirectory extends ApiKeyDirectory {
  override grantOf(): Promise<ApiKeyGrant | undefined> {
    return Promise.resolve(undefined); // every key unknown
  }
}

const test = testWith(SupportApplication, { overrides: [override(ApiKeyDirectory, NoKeysDirectory)] });

test("an unknown key is 401 and never runs", async ({ a2aServer, mockLlm }) => {
  const { url } = await a2aServer({ expose: SupportA2AExpose, callerResolver: SupportA2aCallerResolver });

  // any A2A v1.0 client calls the listener; a plain JSON-RPC `SendMessage` is the smallest one
  const sent = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "a2a-version": "1.0", authorization: "Bearer key-x" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "SendMessage",
      params: { message: { messageId: "m-1", role: "ROLE_USER", parts: [{ text: "hi" }] } },
    }),
  });

  expect(sent.status).toBe(401);
  expect(await sent.json()).toMatchObject({ code: "a2a.caller-unauthenticated" });
  expect(mockLlm(SupportAgent)).toHaveBeenCalledTimes(0);
});
```

## Federation by skill

`agboss describe --json` lists every `@A2AAgent` under `application.contracts.imports` (target, `usedBy`, input and output with their `schemaHash`, price) and every listed `@A2AExpose` under `exports`, an A2A export by its `skill`. Save each neighbour's snapshot as a file and run:

```bash
npx agboss check --federation snapshots/
```

No network; every consumed contract whose target is among the snapshots is compared field by field, an `@A2AAgent` paired by `(target.application, target.skill)` with the export `skill` of that application: `[federation.missing-target]`, `[federation.incompatible-schema]`, each with the consumer's workflows it affects. An `@A2AAgent` without `target.application` (a foreign agent) is listed with `foreign: true` and never compared. A snapshot saved by 0.1.0 (exports and targets named `start`) is still read.

## Assembly rules of an A2A side

| Rule | When |
| :--- | :--- |
| `[a2a.expose-description-required]` | an `@A2AExpose` with a blank `description` |
| `[a2a.skill-tags]` (warning) | an exported skill with no `tags` |
| `[a2a.unpriced-foreign-peer]` (warning) | an `@A2AAgent` without `target.application` and without `price` |
| `[a2a.task-store-not-shared]`, `[a2a.message-store-not-shared]`, `[a2a.file-store-not-shared]` | shared leases, a store that is not |
| `[a2a.file-store-required]`, `[a2a.inline-files-without-store]` (warning) | where files may live |
| `[a2a.message-skill-*]`, `[a2a.unknown-skill-option]` | a direct reply |
| `[a2a.unknown-finish]`, `[a2a.nested-file-field]`, `[a2a.file-options-invalid]` | `target.finishes`; a file below the top level; a size or media type of `a2aFiles` |

A warning is an error under `agboss check --strict`.
