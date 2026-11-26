---
title: "@A2AEndpoint, a2aHttpListener & @HttpAuthenticator"
description: "Reference for serving A2A v1.0 from AGBoss: @A2AEndpoint skills and the Agent Card, a2aHttpListener JSON-RPC tasks, @HttpAuthenticator, ttl and rows, file parts with the SSRF guard, direct replies, streaming, the @Mesh component and the skills extension."
---

`@A2AEndpoint` (`@agboss/core/a2a`, `a2a/*.a2a-endpoint.ts`) declares what an application serves over **A2A v1.0** ([specification](https://a2a-protocol.org/v1.0.0/specification/)), on the official `@a2a-js/sdk`: an AGBoss application serves its workflows as an A2A agent that any v1.0 client can call. The endpoint lists the `@WorkflowStart` classes (the **skills**) callers may run, and the **`ttl`** of its tasks and direct replies. It is listed in `@Application({ endpoints })` (was `exposes`) and served by `a2aHttpListener(app, { endpoint, authenticator, publicUrl, base? })` (was `expose`): the Agent Card at `<base>/.well-known/agent-card.json` and the JSON-RPC 2.0 binding at `POST <base>`. Who calls is an [`@HttpAuthenticator`](#who-calls-an-httpauthenticator). Calling another agent is [`@A2AAgent`](/reference/a2a-agent/). Two profile extensions ride on top: the [mesh extension](/a2a/mesh/v1/) and the [skills extension](/a2a/skills/v1/).

:::caution[Breaking in 0.1.1]
`@A2AExpose` is gone: use `@A2AEndpoint({ name, version, description, ttl: { tasks, messages }, skills, defaultSkill?, cardFileFields? })`. Its `exports` list and the map of `skills` by the start's name are one `skills` list of starts or `{ start, tags?, examples?, filePolicy?, reply?, cardFileFields? }`; `security` and `provider` left it (the schemes are the authenticator's, the `provider` the listener's); `A2ACallerResolver` is `@HttpAuthenticator`; `@Application({ retention: { a2aTasks, a2aMessages, a2aFiles } })` is the endpoint's `ttl` and the workflow's `@FilePolicy`; `a2aHttpListener({ maxTaskDuration })` is gone.
:::

## Complete example: an authenticator, an endpoint, a listener

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

### Who calls: an `@HttpAuthenticator`

The framework never guesses a tenant from a request. The host says who calls, for every request, with an **`@HttpAuthenticator`**: a class with `authenticate(request)` (sync or async, no `implements`, no `<typeof Start>` generic), listed in `@Application({ services })` (or `providers`) and created by the application's container like any service — its own services through `deps`, a test's fake classes apply; never `new`.

```ts file=src/support/a2a/support.http-authenticator.ts
// a2a/support.http-authenticator.ts — who calls: decided by the host, the tenant never guessed
import { HttpAuthenticator, HttpAuthResult, HttpSecurity, type HttpAuthRequest } from "@agboss/core";
import { A2AOperation } from "@agboss/core/a2a";
import { ApiKeyDirectory, type ApiKeyGrant } from "../services/api-key-directory.service.js";

@HttpAuthenticator({ deps: [ApiKeyDirectory], schemes: [HttpSecurity.bearer()] }) // the card's securitySchemes
export class SupportHttpAuthenticator {
  constructor(private readonly apiKeyDirectory: ApiKeyDirectory) {}

  async authenticate(request: HttpAuthRequest): Promise<HttpAuthResult> {
    const header: string = request.http.headers.authorization ?? ""; // headers, socket, operation, task
    if (!header.startsWith("Bearer ")) {
      return HttpAuthResult.unauthenticated("no API key", { challenge: 'Bearer realm="a2a"' });
    }
    const grant: ApiKeyGrant | undefined = await this.apiKeyDirectory.grantOf(header.slice("Bearer ".length));
    if (grant === undefined) return HttpAuthResult.unauthenticated("unknown API key");
    const isResume = request.operation === A2AOperation.SendMessage && request.taskId !== undefined;
    if (isResume && !grant.canAnswerPauses) {
      return HttpAuthResult.forbidden("this key may not answer pauses");
    }
    return HttpAuthResult.authenticated({ tenant: { tenantId: grant.tenantId }, ownerId: grant.clientId });
  }
}
```

`authenticate({ operation, taskId?, http })` gets the JSON-RPC method as an `A2AOperation` (`SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`), the task it names (a `SendMessage` with a `taskId` answers a task's pause), and the raw `IncomingMessage` (headers; the socket, for a client certificate). The body is read first (up to `maxBodySize`, default 1 MB, else `413`) and decoded once, for the operation and the task only: nothing of it runs before the authenticator answers. It answers with an `HttpAuthResult` only (`HttpAuthKind`, branded: a plain object does not compile):

| The authenticator returns | The caller gets |
| :--- | :--- |
| `authenticated(caller)` — `{ tenant, ownerId, execution, peer?, rateLimitKey? }` | the operation, for that tenant and owner (its tasks only) |
| `unauthenticated(reason, { challenge? })` | `401`, `WWW-Authenticate: <challenge>`, `{ "code": "a2a.caller-unauthenticated", "error": reason }` |
| `forbidden(reason)` | `403`, `{ "code": "a2a.caller-forbidden", "error": reason }` |
| it throws | `500`, `{ "code": "a2a.caller-resolution-failed" }`, never the error's text |

A refused request **runs nothing**: no task, no thread, no record, no model call, and never as a default tenant. The caller's tenant is typed by the application: with a declared `TenantContext` its values are required; a single-tenant host returns `HttpAuthResult.authenticated({})`, never implied. The security schemes live on the authenticator: `HttpSecurity.bearer()`, `.apiKey({ header })`, `.oauth2ClientCredentials({ tokenUrl, scopes })`, `.mtls()` — described in the card, enforced by `authenticate`.

**Anonymous access is opt-in and token-bound.** The `authenticator` is required unless `allowAnonymous: true` (default `false`; only in an application with no `tenantContext` of its own, and not beside an authenticator) or only signed peers call (`@Mesh({ inboundMode: Strict })` with a peer that propagates its tenant). A listener made with neither fails its creation with `ConfigError` (`[http.authenticator-required-for-tenant-context]`). Nothing is bound to the TCP connection: a caller that names no owner owns no task of a fixed identity — each new task has an owner of its own, the task's unpredictable id is the right to get, continue and cancel it, and `ListTasks` is `403 a2a.list-forbidden`.

### The workflow, the endpoint and the listener

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

```ts file=src/support/agents/support/support.agent.ts
import { Agent, inline } from "@agboss/core";

@Agent({
  name: "support-agent",
  description: "Answers support questions",
  prompt: inline("Answer the question."),
  model: "moonshotai/kimi-k2.6",
})
export class SupportAgent {}
```

```ts file=src/support/workflows/support/support.workflow.ts
import { Workflow, onStart, Ttl } from "@agboss/core";
import { SupportAgent } from "../../agents/support/support.agent.js";
import { SupportWorkflowFinish } from "./support.workflow-finish.js";
import { SupportWorkflowStart } from "./support.workflow-start.js";

@Workflow({
  name: "support-workflow",
  version: "1.0.0",
  historyTtl: Ttl.Forever,
  flow: [
    onStart(SupportWorkflowStart)
      .toAgent(SupportAgent)
      .toFinish(SupportWorkflowFinish),
  ],
})
export class SupportWorkflow {}
```

```ts file=src/support/a2a/support.a2a-endpoint.ts
// what the application serves over A2A: the starts a caller may run, and how long its rows live
import { A2AEndpoint } from "@agboss/core/a2a";
import { hours, minutes } from "@agboss/core/units";
import { SupportWorkflowStart } from "../workflows/support/support.workflow-start.js";

@A2AEndpoint({
  name: "support", // kebab-case, no suffix needed
  version: "1.0.0",
  description: "Answers support questions", // required: [a2a.endpoint-description-required]
  ttl: { tasks: hours(24), messages: minutes(15) }, // required: a finished task is kept this long after its last change; a direct reply and its messageId this long
  skills: [{ start: SupportWorkflowStart, tags: ["support"] }], // a start, or { start, tags?, examples?, filePolicy?, reply?, cardFileFields? }
})
export class SupportA2AEndpoint {}
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

```ts file=src/support/model-providers/openrouter.model-provider.ts
import { secret } from "@agboss/core";
import { ModelCost, ModelProvider, OpenRouterDriver } from "@agboss/core/models";
import { minutes } from "@agboss/core/units";

@ModelProvider({
  name: "openrouter-model-provider",
  description: "OpenRouter — every chat model of the application",
  driver: OpenRouterDriver({ apiKey: secret("OPENROUTER_API_KEY") }),
  timeout: minutes(2),
  cost: ModelCost.fromResponse(),
})
export class OpenRouterModelProvider {}
```
-->

```ts file=src/support.application.ts
import { Application, EmptyEnvironment } from "@agboss/core";
import { SupportA2AEndpoint } from "./support/a2a/support.a2a-endpoint.js";
import { SupportHttpAuthenticator } from "./support/a2a/support.http-authenticator.js";
import { ApplicationDailyBudget } from "./support/budgets/application-daily.budget.js";
import { ExecutionBudget } from "./support/budgets/execution.budget.js";
import { TenantDailyBudget } from "./support/budgets/tenant-daily.budget.js";
import { OpenRouterModelProvider } from "./support/model-providers/openrouter.model-provider.js";
import { ApiKeyDirectory } from "./support/services/api-key-directory.service.js";
import { SupportWorkflow } from "./support/workflows/support/support.workflow.js";

@Application({
  name: "support-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [SupportWorkflow],
  modelProvider: OpenRouterModelProvider,
  providers: [OpenRouterModelProvider, ApiKeyDirectory],
  services: [SupportHttpAuthenticator],
  budgets: [ApplicationDailyBudget, TenantDailyBudget, ExecutionBudget],
  endpoints: [SupportA2AEndpoint], // describe --json lists it among the exported contracts
})
export class SupportApplication {}
```

<!-- snippet-context
import { createApp } from "@agboss/core";
import { SupportApplication } from "./src/support.application.js";
import { SupportA2AEndpoint } from "./src/support/a2a/support.a2a-endpoint.js";
import { SupportHttpAuthenticator } from "./src/support/a2a/support.http-authenticator.js";
-->

```ts
import { createServer } from "node:http";
import { a2aHttpListener } from "@agboss/core/a2a";

const app = await createApp(SupportApplication, { env: "prod" });
createServer(
  a2aHttpListener(app, {
    endpoint: SupportA2AEndpoint, // listed in @Application({ endpoints })
    authenticator: SupportHttpAuthenticator, // the class: its instance is the container's
    publicUrl: "https://support.example", // where callers reach it: the card's interface URL (or a function, asked at the first request)
    base: "/a2a",
  }),
).listen(8080);
```

The listener takes the authenticator's instance from the application's container when it is built. A class without `@HttpAuthenticator` stops it there (`[http.not-an-authenticator]`), an endpoint the application does not list is `[application.endpoint-unlisted]`, and a `publicUrl` that is no absolute http(s) URL is `[a2a.public-url-invalid]`. `app` is an `A2AApp`: `createApp`'s app and `testWith`'s `app` both fit. Other options: `maxBodySize`, `provider` (the card's), `onError(error, req)`, `allowAnonymous`, `fileFetchTimeout` (10 s). Rules of the endpoint: `[a2a.ttl-invalid]`, `[a2a.duplicate-skill]`, `[application.not-an-endpoint]`, `[application.duplicate-endpoint]`, `[application.endpoint-unknown-start]`.

### The Agent Card

`GET <base>/.well-known/agent-card.json`, with `ETag`, `Last-Modified` and `Cache-Control: max-age=300`:

- the endpoint's `name`, `description` (required: `[a2a.endpoint-description-required]`), `version` and the listener's `provider`;
- **one skill per listed start**: its id the start's name, its description the start's, `tags` from `skills: [{ start, tags }]` (default the application's name; no tags is `[a2a.skill-tags]`), `inputModes` `text/plain` for a `WorkflowStartTextDto` start, else `application/json`;
- `capabilities.streaming: true`, no push notifications;
- the [skills extension](/a2a/skills/v1/) with each skill's input JSON Schema, its `schemaHash`, each finish's output schema, its reply mode and file fields;
- the [mesh extension](/a2a/mesh/v1/) with the endpoint's own retentions (`ttl.messages` as `messageIdempotencyRetention`);
- `securitySchemes` from `@HttpAuthenticator({ schemes: [HttpSecurity.bearer()] })` (`.apiKey({ header })`, `.oauth2ClientCredentials({ tokenUrl, scopes })`, `.mtls()`): described only, the authenticator enforces it;
- one interface `{ url: publicUrl + base, protocolBinding: "JSONRPC", protocolVersion: "1.0" }`.

### The JSON-RPC binding

`POST <base>` with `A2A-Version: 1.0` required (none, or `0.3`, is `-32009`):

| Method | What it does |
| :--- | :--- |
| `SendMessage` | A new task (no `taskId`), or a follow-up answering one. Blocks until the task is over or waits for its caller, or returns at once with `configuration.returnImmediately`. |
| `SendStreamingMessage` | The same, its changes as server-sent events (below). |
| `GetTask` / `ListTasks` | The caller's tasks only (another's is `-32001`), newest status first, paged, by context, state and `statusTimestampAfter`; `totalSize` counts every task the filters match. |
| `CancelTask` | That task only; one not started yet is fenced and cancelled at once; one that is over is `-32002`. |
| `SubscribeToTask` | The task first, then its changes until it is over. |
| push methods, `GetExtendedAgentCard` | `-32003` / `-32004`: the card declares neither. |

- **A message** names its skill in `metadata["https://agboss.dev/a2a/skills/v1"].skill` (optional with one skill or a `defaultSkill`, else `-32602` listing the ids) and carries text parts (a text start) or one `data` part, checked against the start's input before anything is kept (`-32602`, `dto.invalid`). Its `contextId` is the task's thread.
- **One task is one root execution**, under the task's id, kept in `A2ATaskRepository`. The same `messageId` from the same tenant and owner gets the same task, never a second run, on any instance; with other content it is `-32602 a2a.message-id-reused`.
- **A task outlives its connection**: a caller that disconnects never cancels it; it reads it again with `GetTask` or `SubscribeToTask`.
- **Pauses.** A pause the caller answers is `TASK_STATE_INPUT_REQUIRED`, its pauses (`pauseId`, `kind`, `ask`) in the status message's `data` part. A follow-up `SendMessage` with the same `taskId` answers it: one `data` part `{ pauseId?, decision }` or a text reply. A pause only its channel answers is `TASK_STATE_WORKING`, "awaiting <channel> out of band". A pause that a cancel or another answer took first is `-32004 a2a.pause-closed`, with the `reason` in the error metadata.
- **Ends.** A finish is `COMPLETED` with one artifact named by the finish (a text part for a `WorkflowFinishTextDto` output, else a `data` part, or file parts). A failure is `FAILED` with its stable code in `status.message.metadata["https://agboss.dev/a2a/mesh/v1"].code` and that code's fixed text, never the error's own text, which may carry PII; an unexpected failure of the server is `-32603`.

### Streaming carries the agent's answer only

`SendStreamingMessage` answers the task first, then status updates (an agent's tool call as it starts is `WORKING` with the text `calling <tool>`), then the **agent's answer text** as chunks of one artifact, then the finish's output and the last status. Only the answering agent's text streams: never a judge's, a router's or another internal model's (#1004). The artifact is `<taskId>:output`: the stream's first chunk has `append: false`, the next of the same step `append: true`; a retry or another step starts it anew, a retracted step empties it, and a task that ends `FAILED`, cancelled or `REJECTED` after text ends with an empty `lastChunk: true` before its last status (#1006). The finish's output replaces the streamed text (`append: false`, `lastChunk: true`), so a client that applies every event as A2A v1.0 says ends with the artifacts `GetTask` returns, and one that joins the artifacts' text reads the answer once.

### Where the tasks live: `ttl` and the endpoint's own rows

| Store | Holds | Kept for | Built in |
| :--- | :--- | :--- | :--- |
| `A2ATaskRepository` | one task per root execution, its messages' ids | the endpoint's `ttl.tasks` after its last status change (`Ttl.Forever` keeps it) | in memory, SQLite, `@agboss/postgres`, `@agboss/mongodb`; suite `a2aTaskContract` |
| `A2ADirectMessageRepository` | a direct reply, by `(tenant, owner, messageId)` | the endpoint's `ttl.messages` (above the 30 s lease) | in memory, SQLite, PostgreSQL, MongoDB; suite `a2aDirectMessageContract` |

Both repositories are in `@agboss/core/stores`, no longer in the root or `/a2a`, and the stores come from the application's `storage` drivers. Each endpoint's rows are its own: `A2ATaskRecord`, `A2AMessageRecord` and `A2ADirectMessageRecord` name their `endpoint`, the sweep of one endpoint never removes another's, and a task or a message id of one endpoint is "not found" or "reused" at another that shares its store. An unfinished task is never removed. An application whose instances share leases must keep its tasks on a store they share: `[a2a.task-store-not-shared]`, `[a2a.message-store-not-shared]`.


## File parts and the SSRF guard

A skill takes files when its start's input DTO has `FileDto` fields — `@File()` for one, `@List(FileDto)` for several (`@agboss/core/dto`). The A2A prefix is gone from the file names: `FileDto` (was `A2AFileDto`; `FileDto.fromBytes` / `FileDto.fromUrl` replace `A2AClientFile`), `@File`, the `Files` service, `FileRepository` and one `FileError`. A step holds a file as a descriptor (`mediaType`, `filename`, `sha256`, `sizeBytes`, and where its bytes are: `fileId` in the store, `inline` base64, or `url`) and reads its bytes with the `Files` service (`deps: [Files]`, `read(file)`); it makes one with `save({ bytes, mediaType, filename })`. A file is filled from a `raw` (inline bytes) or `url` part, never from a data part (`-32602 a2a.file-field-in-data`), and a finish whose output holds files (`WorkflowFinishFileDto`, `WorkflowFinishFilesDto`, or any DTO with file fields) answers with one file part per file.

```ts file=src/support/dto/review-request.dto.ts
import { File, Text } from "@agboss/core/dto";
import type { FileDto } from "@agboss/core/dto";

export class ReviewRequestDto {
  @File({ prompt: "the document to review" })
  document!: FileDto;

  @Text({ prompt: "a note to the reviewer", optional: true })
  note?: string;
}
```

```ts file=src/support/services/document-reader.service.ts
import { Files, Injectable } from "@agboss/core";
import type { FileDto } from "@agboss/core/dto";
import { ReviewRequestDto } from "../dto/review-request.dto.js";

@Injectable({ deps: [Files] })
export class DocumentReader {
  constructor(private readonly files: Files) {}

  async report(request: ReviewRequestDto): Promise<FileDto> {
    const bytes = await this.files.read(request.document); // checked against its sha256
    return this.files.save({
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
| limits | the workflow's **`@FilePolicy`** is the one place its files are bounded (a skill's `filePolicy` only tightens it): `maxFiles` (5), `maxFileSize` (64 KB), `maxTotalFileSize` (64 KB), `allowedMediaTypes` (PNG, JPEG, WebP, GIF, PDF, plain text, Markdown, CSV, JSON), `allowedOrigins`, `ttl`; `[file-policy.invalid]`, `[a2a.skill-file-policy-exceeds-workflow]` at assembly. The `a2aFiles` option of `@Application` is gone. |
| media types | the bytes are checked against the declared type (`a2a.media-type-mismatch`) |
| a follow-up | text or data only: a file is `-32005`; a pause's decision never carries a file |
| a resend | the same `messageId` with the same bytes gets the same task, nothing fetched again |
| nesting | a file below the top level of a DTO is `[a2a.nested-file-field]` |

**A file by `url` is fetched once, by the server, at the admission**, before the task is kept; no step fetches it. The guard:

- `https:` only, on an origin of the policy's `allowedOrigins` (none listed: `a2a.file-url-not-allowed`; another: `a2a.file-origin-denied`); `GET`; at most 3 redirects, followed by hand and each target's origin checked; only a `200` is a file;
- never an address that is not globally reachable: loopback, private, link-local, CGNAT, documentation, reserved, multicast, unique-local and the rest of the IANA special-purpose registries, nor an IPv6 address carrying such an IPv4 (mapped, translated, NAT64, 6to4); the lookup's answer is checked (`a2a.file-address-denied`);
- never a url with a user or a password, never through a proxy: the fetch has its own connection, a raw socket connected to a checked address, so **no byte goes to a denied peer**; a deployment whose egress must go through a proxy takes no file by url;
- the read stops at `maxFileSize` and is bound by `fileFetchTimeout` (`a2a.file-fetch-failed`); the same url sent concurrently is fetched once.

**Where the bytes are.** With no `FileRepository` in the application's storage, a file rides inline in its task's records: silently up to 64 KB, with the warning `[a2a.inline-files-without-store]` up to 256 KB, above it `[a2a.file-store-required]`. An `@ObjectStorage` (`S3Driver`, `LocalDiskDriver`) keeps files under the task. A task's files are its own, kept while it waits and removed `@FilePolicy({ ttl })` after its execution has ended (`hours(24)` by default, `Ttl.Forever`: never). The card lists what a skill takes in `inputModes` and in the skills extension's `files` and `outputFiles` (`cardFileFields`).

## Direct replies: `A2AReply.Message`

A skill that needs no task, a lookup or a classification, answers `SendMessage` with a `Message` directly. `defaultSkill` is the skill a message that names none runs (a foreign caller that knows nothing of the skills extension):

```ts file=src/support/workflows/lookup/lookup.workflow-start.ts
import { WorkflowStart } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";

@WorkflowStart({ name: "lookup-workflow-start", description: "A lookup", input: WorkflowStartTextDto })
export class LookupWorkflowStart {}
```

```ts file=src/support/a2a/lookup.a2a-endpoint.ts
import { A2AEndpoint, A2AReply } from "@agboss/core/a2a";
import { hours, minutes } from "@agboss/core/units";
import { LookupWorkflowStart } from "../workflows/lookup/lookup.workflow-start.js";
import { SupportWorkflowStart } from "../workflows/support/support.workflow-start.js";

@A2AEndpoint({
  name: "support-lookup",
  version: "1.1.0",
  description: "Answers support questions",
  ttl: { tasks: hours(24), messages: minutes(15) },
  skills: [
    { start: LookupWorkflowStart, reply: A2AReply.Message, tags: ["lookup"] }, // a Message, no task
    { start: SupportWorkflowStart, tags: ["support"] },
  ],
  defaultSkill: LookupWorkflowStart, // a message that names no skill runs it
})
export class LookupA2AEndpoint {}
```

- The reply is the finish's output as a text, data or file parts, with `metadata[skills-uri].finish`, and for a trusted caller the signed run report in `metadata[mesh-uri].report`. `returnImmediately` changes nothing; `SendStreamingMessage` is one frame; `GetTask` of it, or a follow-up naming the skill with a `taskId`, is `-32001`.
- **The workflow must be stateless**, checked at assembly on every node: no pause (`[a2a.message-skill-pause]`), no `Idempotency` or `@A2AAgent` (`-effect`), only `@Tool({ readOnly: true })` tools (`-tool`), no compensation (`-compensation`), no child workflow (`-child`). A `reply` for no export or a `defaultSkill` that is none: `[a2a.unknown-skill-option]`.
- **Once per `messageId`.** The reply is kept in `A2ADirectMessageRepository` for the endpoint's `ttl.messages` (published on the card as `messageIdempotencyRetention`): a resend gets the same message, a concurrent duplicate waits for it, so the model is called and charged once. One id is one message across both reply modes (`-32602 a2a.message-id-reused`).
- **Bounded attempts.** An attempt stops at 25 s, and when its caller disconnects; a recovery never continues it. An instance that died mid-call records one call of unknown cost (`CostSource.Unknown`) and a later resend runs it once.

## The mesh

Calls between AGBoss applications carry an envelope of the [mesh extension](/a2a/mesh/v1/) in `message.metadata["https://agboss.dev/a2a/mesh/v1"].envelope`, with `A2A-Extensions` and a W3C `traceparent`; no code of yours. It holds the `origin` (execution ids, workflow, step key), the `budget.remaining` and `deadline.remaining` of the caller, and the `callChain`. `@Application({ mesh })` takes a **`@Mesh`** component: `@Mesh({ signingKey, inboundMode, deduplicationTtl, maxHops, envelopeTtl?, maxClockSkew?, peers })`. Keys are `defineEnv` references (`secret(…)`); a peer lists `verifyKeys` (any of them verifies, for a rotation), `allowEndpoints` and `propagateTenant`. `maxMeshHops`, `retention.meshAnswers`, the field-name `signingKey` and a peer's `verifyKey` of 0.1.0 are gone.

Every HTTP request of an `A2AClient` and an `@McpServer` carries `X-AGBoss-Mesh` (an EdDSA JWS over issuer, audience, origin, method, path, body hash, dates, a one-time `jti` and the tenant), signed even for the handshakes before any step runs. A receiver verifies the signature first, then audience, origin, the date window (`maxClockSkew`, `envelopeTtl` as the cap) and that it is this request, and admits each `jti` once (the shared `MeshRequestRepository`; unavailable means refused). Refusals are typed codes (`mesh.peer-unknown`, `mesh.signature-missing`, `mesh.request-mismatch`, `mesh.replayed`, `mesh.replay-check-unavailable`, `mesh.endpoint-forbidden`, `mesh.tenant-mismatch`), never a peer's text. A verified peer's tasks are owned by `mesh:<peer>`. With a `@Mesh`, every HTTP request to an A2A or MCP endpoint goes through the same gate: an unsigned request to a `Strict` endpoint, an endpoint outside `allowEndpoints`, a replay are refused.

| Receiver step | Outcome |
| :--- | :--- |
| audience | an envelope addressed to another application is `401 mesh.audience-mismatch`; a signed one addressed to none `401 mesh.audience-missing` |
| signature of a known peer | `401 mesh.signature-invalid`, `mesh.envelope-expired`, `mesh.body-mismatch` |
| caller | trusted only when the authenticator's `peer` is the envelope's verified issuer |
| chain | one that already passed through this skill, or is as long as `@Mesh({ maxHops })` (8), is accepted as a `REJECTED` task with `limit.mesh-loop` or `limit.hops`, nothing started; the client rebuilds `LimitError.MeshLoop` / `LimitError.Hops` |
| run | the execution gets a trusted caller's origin, a `caller-budget` and the deadline; a completed task carries the signed run report |

A mesh call is charged exactly once: the caller's `costPerCall` at the accept and a verified run report's spend above it. The [skills extension](/a2a/skills/v1/) carries each skill's schemas, which both `a2aHttpListener` (for the card) and `A2AClient` (for the contract check) use.

## Testing: the `a2aServer` fixture

`testWith`'s `a2aServer({ endpoint, authenticator, base? })` serves the test's `app` through `a2aHttpListener` on `127.0.0.1:0` and returns `{ url }`; the loopback is open for it (no `allowNetwork`) and it closes at the test's end. The authenticator comes from the test app's container, so a fake `ApiKeyDirectory` reaches it. Any v1.0 client calls it; a plain JSON-RPC `SendMessage` is the smallest:

```ts file=tests/support/a2a/support.http-authenticator.test.ts
import { expect } from "vitest";
import { Injectable } from "@agboss/core";
import { testWith } from "@agboss/core/testing";
import { ApiKeyDirectory, type ApiKeyGrant } from "../../../src/support/services/api-key-directory.service.js";
import { SupportHttpAuthenticator } from "../../../src/support/a2a/support.http-authenticator.js";
import { SupportA2AEndpoint } from "../../../src/support/a2a/support.a2a-endpoint.js";
import { SupportAgent } from "../../../src/support/agents/support/support.agent.js";
import { SupportApplication } from "../../../src/support.application.js";

@Injectable()
class NoKeysDirectory extends ApiKeyDirectory {
  override grantOf(): Promise<ApiKeyGrant | undefined> {
    return Promise.resolve(undefined); // every key unknown
  }
}

const test = testWith(SupportApplication, { services: [NoKeysDirectory] });

test("an unknown key is 401 and never runs", async ({ a2aServer, mockModel }) => {
  const { url } = await a2aServer({ endpoint: SupportA2AEndpoint, authenticator: SupportHttpAuthenticator });

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
  expect(mockModel(SupportAgent)).toHaveBeenCalledTimes(0);
});
```

## Assembly rules of the serving side

| Rule | When |
| :--- | :--- |
| `[a2a.endpoint-description-required]` | an `@A2AEndpoint` with a blank `description` |
| `[a2a.ttl-invalid]`, `[a2a.duplicate-skill]` | a `ttl` that is out of range; one start listed twice |
| `[a2a.skill-tags]` (warning) | a listed skill with no `tags` |
| `[http.not-an-authenticator]`, `[http.authenticator-required-for-tenant-context]` | the authenticator class; an anonymous listener beside a `tenantContext` |
| `[a2a.task-store-not-shared]`, `[a2a.message-store-not-shared]` | shared leases, a store that is not |
| `[a2a.file-store-required]`, `[a2a.inline-files-without-store]` (warning) | where files may live |
| `[a2a.message-skill-*]`, `[a2a.unknown-skill-option]` | a direct reply |
| `[a2a.nested-file-field]`, `[a2a.file-options-invalid]` | a file below the top level; an invalid `cardFileFields` or file policy |
| `[mesh.not-a-mesh]`, `[mesh.limit-invalid]`, `[mesh.peer-without-keys]`, `[mesh.unknown-endpoint]` | the `@Mesh` component |

A warning is an error under `agboss check --strict`.
