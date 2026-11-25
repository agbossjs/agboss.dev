---
title: "@A2AAgent & A2AClient"
description: "Reference for calling an A2A v1.0 agent from AGBoss: @A2AAgent clients, A2AClient typed contracts, costPerCall, origins, outcomes and exactly-once sends. Serving is @A2AEndpoint."
---

`@agboss/core/a2a` speaks **A2A v1.0** ([specification](https://a2a-protocol.org/v1.0.0/specification/)) in both directions, on the official `@a2a-js/sdk`: an AGBoss application serves its workflows as an A2A agent that any v1.0 client can call, and calls any v1.0 agent, another AGBoss application or a foreign one, as a typed contract.

- **`@A2AAgent`** (`a2a/*.a2a-agent.ts`) declares a remote agent: a class that `extends A2AClient<In, Out>`, registered in `providers` and injected into a `@Tool` or an `@Action`. `execute(input, call?)` sends the input and returns the remote output, both validated by the contract's DTOs.
- **[`@A2AEndpoint`](/reference/a2a-endpoint/)** (`a2a/*.a2a-endpoint.ts`) lists the `@WorkflowStart` classes (the **skills**) an `@Application({ endpoints })` serves, and is listed in `agboss describe --json` for `agboss check --federation`.
- **`a2aHttpListener(app, { endpoint, authenticator, publicUrl, base? })`** serves it: the Agent Card at `<base>/.well-known/agent-card.json` and the JSON-RPC 2.0 binding at `POST <base>`. An `@HttpAuthenticator` says who calls, for every request.
- Two profile extensions ride on top: the [mesh extension](/a2a/mesh/v1/) (`https://agboss.dev/a2a/mesh/v1`: call chain, budget, deadline, signed run report) and the [skills extension](/a2a/skills/v1/) (`https://agboss.dev/a2a/skills/v1`: each skill's JSON Schemas, reply mode, file fields).

:::caution[Breaking in 0.1.1]
The 0.1.0 wire is gone, with no shim: `POST <base>/execute`, `/resume` and `/cancel`, the `agboss-mesh` request header, `A2ARoute`, `A2AAdapterContract` and `A2AExecutionResponse` no longer exist, `target: { application, start }` is now `target: { application, skill }`, `price` is `costPerCall`, and `@A2AExpose`, `A2ACallerResolver` and the `Canceled` spellings are gone (`@A2AEndpoint`, `@HttpAuthenticator`, `Cancelled`). A caller that spoke the 0.1.0 wire fails against a 0.1.1 server with `-32009` (no `A2A-Version: 1.0`). See the [guide](/guides/mcp-rag-and-a2a/) for the migration notes.
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
  costPerCall: usd(0.002), // per call, charged once (a failure after the send too): the step records the larger of it and a trusted peer's report
  deps: [ExecutionContext],
})
export class OrderDeskA2AAgent extends A2AClient<OrderQuestionDto, OrderDeskReplyDto> {
  constructor(private readonly executionContext: ExecutionContext) {
    super();
  }

  protected override getHeaders(): Promise<Record<string, string>> {
    // what the remote's authenticator decides (a token, mTLS): never trusted from a body
    return Promise.resolve({ "x-tenant-id": this.executionContext.tenant.tenantId });
  }
}
```

```ts file=src/support/tools/ask-order-desk.tool.ts
// tools/ask-order-desk.tool.ts — an agent delegates to the remote workflow through a tool
import { ExecutionContext, Tool } from "@agboss/core";
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
export class AskOrderDeskTool {
  constructor(
    private readonly orderDeskA2AAgent: OrderDeskA2AAgent,
    private readonly executionContext: ExecutionContext,
  ) {}

  execute(question: OrderQuestionDto): Promise<OrderDeskReplyDto> {
    // typed by the contract: the input and the output validated, the price recorded
    return this.orderDeskA2AAgent.execute(question, { signal: this.executionContext.signal });
  }
}
```

```ts file=src/support/agents/support/support.agent.ts
import { Agent, inline } from "@agboss/core";
import { AskOrderDeskTool } from "../../tools/ask-order-desk.tool.js";

@Agent({
  name: "support-agent",
  description: "Answers questions, asking the order desk about orders",
  prompt: inline("Answer the question. Ask the order desk about orders with ask-order-desk-tool."),
  model: "moonshotai/kimi-k2.6",
  tools: [AskOrderDeskTool],
  executionLimits: { maxToolCalls: 5 },
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
| `name` | `string` | Optional kebab-case name (the class name by default; the `-a2a-agent` suffix is no longer required). |
| `url` | `string \| EnvRef` | Required. Base URL of the remote agent: a text or a `defineEnv` reference, read once from the application's environment (a missing variable is named, never a value). |
| `headers` | `Record` | Headers as texts, references, secrets or `bearer(secret)`; they merge with the class's `getHeaders()` (a record or a promise) without regard to case, the last winning. `X-AGBoss-Mesh` is never a client's. |
| `timeout` | `Milliseconds` | How long a call waits for the task unless the call says. |
| `target` | `{ application?, skill?, finishes? }` | `application` names an AGBoss peer (verified by `agboss check --federation`; the mesh is required by default); without it the agent is **foreign**. `skill` is the start's name (optional with one skill). `finishes` limits which finishes the typed `output` covers (below). |
| `input` / `output` | `DtoClass` | The typed contract: validated on `execute` and exported with their `schemaHash` in `agboss describe --json`. Without both, `execute` throws `[a2a.no-contract]` (use `send`). |
| `costPerCall` | `Usd` | Cost per call, charged to the calling step once per call under the call's ledger identity, even when the call fails after the accept. The step records the larger of it and a trusted peer's signed run report. A foreign agent without a `costPerCall` is `[a2a.unpriced-foreign-peer]` (`[a2a.cost-per-call-invalid]` for a bad value). |
| `mesh` | `A2AMesh` | `A2AMesh.Required` (default with a `target.application`) or `A2AMesh.IfSupported`. |
| `allowedOrigins` | `string[] \| EnvRef` | Extra origins the card's interfaces may name. |
| `deps` | `readonly Token[]` | Constructor dependencies, used inside `getHeaders()`. |

The methods: `execute(input, call?)` (typed; one `data` part, or one `text` part for a `WorkflowStartTextDto` start, naming the skill in `message.metadata["https://agboss.dev/a2a/skills/v1"]`); `send(message, call?)` (a text, `{ data }` or parts, returning an `A2ATaskResult` with `task`, `message`, `text`, `data`, `files`, `peer`); `reply(taskId, answer)` for a task that waits for input; `getTask(taskId)`; `cancel(taskId)`; `agentCard()`; `downloadFile(file, { maxSize?, signal? })`. `call.onEvent` receives each event of the remote task while the call waits; a call without a `signal` ends with the running step's; pass `executionContext.signal` explicitly when you want a different one. Every public method of `A2AClient` rejects, never throws before its promise.

**Outcomes.** A `COMPLETED` task gives its output, read from the artifact an AGBoss finish marks, else from every artifact in order (none readable: `A2ARemoteCallError`). `FAILED` or `REJECTED` is `A2ATaskFailedError`; an AGBoss peer's `limit.mesh-loop` and `limit.hops` come back as the same `MeshLoopDetectedError` and `HopsLimitExceededError`. A cancelled task (`TASK_STATE_CANCELED` on the wire) is `A2ATaskCancelledError`. `INPUT_REQUIRED` is `A2ATaskInterruptedError` from `execute` (a remote pause is not a local one yet) and the task from `send`. A JSON-RPC error is `A2AProtocolError` (`rpcCode`); a `401` or `403` is `A2AError.CallerRejected` (`code: "a2a.caller-rejected"`, `httpStatus`, the server's `wireCode`). Only codes are kept: an agent's own message, status text or body never is.

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

## Types, stores and errors of the client

`@agboss/core/a2a` no longer re-exports the official SDK's generated types. It gives its own types, discriminated by `kind`, with `Date` times: `A2APart` (`text`, `data`, `raw`, `url`, `A2APart.fromFile`), `A2AMessage`, `A2AArtifact`, `A2ATask`, `A2AAgentCard`, `A2AAgentSkill` and `A2AStreamEvent`. `send` and `reply` take `A2AMessageInput` — a text, `{ text?, data?, files? }` with at least one of them, or parts — and read a stored file (`fileId`) before sending it. `A2ATaskState` gains `AuthRequired` and `Unspecified` (a remote agent's). `A2ATaskRepository` and `A2ADirectMessageRepository` are in `@agboss/core/stores`. The files an input carries are `FileDto` (the A2A prefix is gone): the client sends `FileDto.fromBytes(bytes, { mediaType, filename })` or `FileDto.fromUrl(url, …)` and reads an answer's files with `downloadFile`.

## The mesh and skills extensions

Calls between AGBoss applications carry an envelope of the [mesh extension](/a2a/mesh/v1/) in `message.metadata["https://agboss.dev/a2a/mesh/v1"].envelope`, with `A2A-Extensions` and a W3C `traceparent`; no code of yours. Every HTTP request of an `A2AClient` and an `@McpServer` also carries `X-AGBoss-Mesh` when the application has a [`@Mesh`](/reference/a2a-endpoint/#the-mesh) component, signed even for the handshakes before any step runs. A mesh call is charged exactly once: `costPerCall` at the accept and a verified run report's spend above it, however many passes replay it. A call the agent refused before anything ran (a mesh loop) is charged nothing. A foreign agent that does not echo the extension is called without the mesh, said in the tool call's record (`remote: { mesh: false }`) and in `agboss describe`.

## Federation by skill

`agboss describe --json` lists every `@A2AAgent` under `application.contracts.imports` (target, `usedBy`, input and output with their `schemaHash`, `costPerCall`) and every listed `@A2AEndpoint` under `exports`, an A2A export by its `skill`. Save each neighbour's snapshot as a file and run:

```bash
npx agboss check --federation snapshots/
```

No network; every consumed contract whose target is among the snapshots is compared field by field, an `@A2AAgent` paired by `(target.application, target.skill)` with the export `skill` of that application: `[federation.missing-target]`, `[federation.incompatible-schema]`, each with the consumer's workflows it affects. An `@A2AAgent` without `target.application` (a foreign agent) is listed with `foreign: true` and never compared. A snapshot saved by 0.1.0 (exports and targets named `start`) is still read.

## Assembly rules of the client side

| Rule | When |
| :--- | :--- |
| `[a2a.unpriced-foreign-peer]` (warning) | an `@A2AAgent` without `target.application` and without `costPerCall` |
| `[a2a.cost-per-call-invalid]` | a `costPerCall` that is no amount |
| `[a2a.unknown-skill]`, `[a2a.schema-mismatch]`, `[a2a.no-contract]` | the card does not match the declared contract |
| `[a2a.unknown-finish]`, `[a2a.nested-file-field]` | `target.finishes`; a file below the top level of a DTO |

A warning is an error under `agboss check --strict`.
