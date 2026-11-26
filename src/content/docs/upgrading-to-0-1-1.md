---
title: What's New in 0.1.1 & Upgrading from 0.1.0
description: The AGBoss 0.1.1 API is a hard break from 0.1.0 with no compatibility layer. What was removed, what replaced it, and the order to migrate an application, its stores and its A2A peers.
---

AGBoss `0.1.1` reworks the public API end to end. It is a **hard break**: there is no compatibility layer, no deprecated alias and no shim for `0.1.0`. A name that was removed does not compile, and a stored row written under an old name is refused, never guessed. Everything on this site is written against `0.1.1`, and every code sample is compiled against the `0.1.1` packages by `check:docs`.

Two things make a migration mechanical. `npx agboss check` names every rule an old shape breaks, with a stable code, and the table below maps each removed name to its replacement. Migrate in this order: the flow and the DTOs first (the compiler guides you), then providers and storage (they are now explicit), then pauses, then your stores and A2A peers.

## What 0.1.1 adds

- **A new flow grammar**: sources `onStart`, `onAgent`, `onRouter`, `onAction`, `onWorkflow`, `onExternalTask`; a router's `.onRoute(...)`; `.toOneOf([...])`; `.inParallel([...])` and `.forEachItem(step, { takeFirst, maxConcurrency })` closed by `.join()`; `toWorkflow(() => Self)` recursion. Nothing is declared on an edge any more: what a step gives to the path is derived from its declaration. See [Workflow](/concepts/workflow/).
- **Tracked DTOs and provenance**: a tracked input field is the DTO itself; a producer is stated with `Metadata`; test inputs are plain DTO literals. See [Path Scope](/concepts/path-scope/).
- **Explicit models and storage**: a `@ModelProvider` takes a driver and a required `timeout`; there are no built-in providers. State lives in a `@DatabaseStorage`, `@ClusterStorage` or `@ObjectStorage` with a driver. See [Model providers](/reference/model-provider/) and [`@DatabaseStorage`](/reference/database-storage/).
- **Pauses with targets**: `@ToolApproval` and `@ExternalTask` say what is asked and who may answer; a `@Channel` only carries it. See [Pause targets](/reference/pause-target/) and [Channels & pauses](/guides/channels-and-pauses/).
- **Control of running executions**: `app.stop`, `app.pause`, `app.unpause`, `app.extendPause`, `app.reassignPause`, `app.listPauses`, `app.getExecution`, `app.listExecutions`; cancel and stop are outcomes, not thrown errors; a cancel is a hard fence for effects; a tenant gate refuses a call without a `tenantId` when a `tenantContext` is declared.
- **Surfaces**: `@McpEndpoint`, `@A2AEndpoint` on the real A2A v1.0 wire, `@HttpAuthenticator`, `@Mesh`. See [MCP, RAG & A2A](/guides/mcp-rag-and-a2a/).
- **New components**: `@Memory` (replaces `@Compaction`), `@Observer` with a method per hook, `DecisionModel`, `Idempotency`, `defineEnv`.

## Removed names and their replacements

### Flow

| 0.1.0 | 0.1.1 |
| :--- | :--- |
| `start(S)`, `agent(A)`, `router(R)`, `action(X)` as sources | `onStart(S)`, `onAgent(A)`, `onRouter(R)`, `onAction(X)`, plus `onWorkflow` and `onExternalTask` |
| `.returns(Dto)` and `{ about }` on an edge | removed: a step's output is what its declaration says; a loop's old values are `OutdatedReason.Replaced` / `BuiltFromReplaced` |
| `.chooseOne(route(X)...)` | `.onRoute(toX(...))`, exactly one per route of the router |
| `.switch(caseOf(Dto)...)` | `.toOneOf([...])` on a `oneOf(...)` output |
| `.toParallelAgents(...)`, `.toParallelWorkflows(...)` | `.inParallel([...])`, `.forEachItem(step, { takeFirst, maxConcurrency })`, then `.join()` |
| `.acceptedBy(Arbiter)` | `.arbitratedBy(Arbiter)` |
| `.onJoinError(...)` | `.onError(...)` right after the join |
| `ThisWorkflow` | `toWorkflow(() => Self)` |
| `SpawnPolicy`, `FailurePolicy`, `anyOf(...)` | removed |
| `listOf(oneOf(A, B))` | `listOf(A, B)` (variadic), with a typed slice per class |
| `placement` on a flow step | `@Workflow({ placement })` on the child (or `defaults`); `ChildPlacement.AnyInstance` is `AnyWorker` |

### Data and DTOs

| 0.1.0 | 0.1.1 |
| :--- | :--- |
| `Produced<Dto, Producer>` and `{ value, producer }` inputs | `Tracked<Dto, Producer>`: the field is the DTO itself; a producer is stated with `Metadata.with(dto, { createdBy })` |
| `historyOf(Dto, { limit })` | `historyOf(Dto, { maxPrevious })` |
| `@Flag`, `@Decimal`, `@ListOf`, `@OneOf({ values })`, `@Date` | `@Bool`, `@Float`, `@List`, `@Enum([...], options)`, `@IsoDate` |
| `oneOf`, `listOf`, `optional`, `historyOf` from a DTO entry | all from `@agboss/core` |
| `@WorkflowFinish` with a `FinishHandler` | a pure port: assemble the output in an `@Action` and finish with it |

### Components

| 0.1.0 | 0.1.1 |
| :--- | :--- |
| `run()` of a tool, `@BindTool`, `@McpTool` | `execute()`; a tool lists an `@McpServer` in `deps`; `@Tool({ approval })` for an approval |
| a string `prompt` on an agent, router, judge or arbiter | a `PromptSource`: `"./file.md"` or `inline("...")` (route prompts and DTO field prompts stay plain strings) |
| flat `maxSteps`, `maxDepth`, `maxToolCalls`, `maxVisits`, `maxConcurrentExecutions`, `maxConcurrentSteps` | `executionLimits: { ... }` on a workflow, an application or an agent |
| no `historyTtl` | `historyTtl` is required on every `@Workflow` (`Ttl.Forever` keeps it) |
| judges and guardrails with `decidedBy` | judges read `output` and return `JudgeVerdict.failed(reason)`; guardrails take no `decidedBy` (a code guardrail has `check(content)`) |
| `@Compaction`, `uncompactedTurns` on an application or agent | `@Memory`; see [Memory](/reference/memory/) |
| `@Observer`-less `implements OnExecutionEnd` | `@Observer` with `onExecutionEnd(event)` and the other hooks; `workflows` and `agents` filter events |
| `@RagConnector`, `RagMode`, `rag: [{ use, mode }]` | a `RagSource` (or `SqliteFtsRagSource`) with a `RagScope`; `rag: [Source]` |
| `override(Base, Fake)` in tests | `testWith(App, { services: [Fake] })`; a fake is an `@Injectable` with the same deps |
| ten named unit runners | `testUnit(Component)` for every kind |
| `Decision.boolean` without a probability | `Decision.boolean` with `.probability` |

### Models, storage and environments

| 0.1.0 | 0.1.1 |
| :--- | :--- |
| built-in `OpenRouterModelProvider`, `DecisionsModelProvider` | none: `@ModelProvider({ driver: OpenRouterDriver \| OpenAiCompatibleDriver \| DecisionsDriver, timeout, ... })`, or a transport class with `complete()`; `[model.missing-provider]` when a model has none |
| `Sqlite*Repository` classes in `providers` | `@DatabaseStorage({ driver: SqliteDriver(...), auditLogTtl, ledgerEntriesTtl })` in `@Application({ storage })`; `[storage.providers-conflict]` for both |
| `SqliteConnection` from the root | `@agboss/core/stores` |
| no storage TTLs | `auditLogTtl` and `ledgerEntriesTtl` are required on a storage; `piiSecret` and `idempotencySecret` are supplied by you |
| scattered `process.env` reads | `defineEnv({ ... })` with `env`, `env.integer`, `env.duration`, `secret`; lint rule `agboss/no-process-env` |
| profile `.yaml` under `profiles/<workflow>/` | `src/config/<name>.config.ts` or `.yaml` with `defineConfig`; `--profile a,b` layers them |

### Pauses and channels

| 0.1.0 | 0.1.1 |
| :--- | :--- |
| `@ChannelRole`, `@Channel` that `extends` it | `@ToolApproval` or `@ExternalTask` (the target) and `@Channel({ target, ttl })` without `extends` |
| `PauseAnswerer.Channel` / `.ThreadOwner` | `PauseRespondent.Delegate` / `.Owner` |
| `withdraw(...)` on a channel | `onPauseClosed(event)`: called at least once for every close; deduplicate by `event.deliveryId` |
| `@ReplyInterpreter`, `@PauseListener` | `@ChannelInterpreter`, `@ChannelListener`; `@ChannelSelector` picks one of several channels |
| `ChannelOf`, `ChannelQuestionOf`, `ChannelAnswerOf` | `ChannelAsk<Target>`, `ChannelOutcome<Target>` |
| `@Tool({ channel, expiresIn })` | `@Tool({ approval: Target })`; the deadline is the target's `timeout` |
| `app.listPauses({ role })` | `app.listPauses({ target })` |
| `app.cancel` throwing `ExecutionCancelledError` out of `execute` | an outcome: `ExecutionStatus.Cancelled` / `Stopped`; `app.stop`, `app.pause`, `app.unpause` are new |

A stored pause, run or answer entry written under `0.1.0` has no `target` and is refused with `StoreError.UnreadableRecord`, never read. Finish or drain such executions before the upgrade.

### Errors and test fixtures

Every error class below is gone from `@agboss/core` (no alias). Catch the variant, or its family for all of them; a variant is a sibling of the others of its family, never their subclass. `ExecutionFencedError`, `ExecutionLeaseLostError`, `ApplicationStoppingError` and `ToolTimeoutError` stay classes.

| 0.1.0 | 0.1.1 |
| :--- | :--- |
| `StepFailedError`, `PaidStepError` | `StepError` |
| `AgentFailedError`, `AgentAnswerInvalidError`, `QualityGateError` | `StepError.Agent`, `StepError.AgentAnswerInvalid`, `StepError.QualityGate` |
| `ActionFailedError`, `QuestionFailedError`, `GuardFailedError` | `StepError.Action`, `StepError.ExternalTask`, `StepError.Guardrail` |
| `RouterFailedError`, `RouterDecisionError`, `ArbiterError` | `StepError.Router`, `StepError.RouterDecision`, `StepError.Arbiter` |
| `QuorumNotReachedError`, `ChildExecutionFailedError`, `PauseExpiredError`, `ToolBlockedError` | `StepError.QuorumNotReached`, `.Child`, `.PauseExpired`, `.ToolBlocked` |
| `GuardrailBlockedError`, `PiiRefusedError`, `PiiDetectionFailedError` | `GuardrailError.Blocked`, `PiiError.Refused`, `PiiError.DetectionFailed` |
| `LimitExceededError`, `BudgetExceededError`, `DeadlineExceededError` | `LimitError`, `LimitError.Budget`, `LimitError.Deadline` |
| `StepsLimitExceededError`, `VisitsLimitExceededError`, `DepthLimitExceededError`, `HopsLimitExceededError`, `MeshLoopDetectedError` | `LimitError.Steps`, `.Visits`, `.Depth`, `.Hops`, `.MeshLoop` |
| `GraphRuleError`, `ConfigurationError`, `EnvironmentError`, `ModelKindError` | `ConfigError.GraphRules`, `.ModelSettings`, `.Environment`, `.ModelKind` |
| `UnknownThreadError`, `ThreadOwnerError`, `IncompatibleResumeError`, `CompensationFailedError` | `ExecutionError.UnknownThread`, `.ThreadOwnerMismatch`, `.IncompatibleResume`, `.CompensationFailed` |
| `PauseClosedError`, `UnknownPauseError`, `UninterpretableReplyError`, `PauseExtensionContendedError` | `PauseError.Closed`, `.UnknownPause`, `.UninterpretableReply`, `.UpdateContended` |
| `StoreOutcomeUnknownError`, `StoreCallTimeoutError`, `StoredNamesUnreadableError` | `StoreError.OutcomeUnknown`, `.CallTimeout`, `.UnreadableRecord` (from `@agboss/core/stores`) |
| `A2ARemoteError`, `A2ACallerRejectedError` and the other `A2A*Error` of the client | `A2AError.Remote`, `A2AError.CallerRejected`, `A2AError.*` |
| `mockLlm(X)`, `mockOf(S)`, `mcpOf(S)` fixtures | `mockModel(X)`, `mockService(S)`, `mockMcp(S)` |
| `.thenAnswer(handler)` on a model script | `.respondWith(handler)`; every script has `reset()` |
| `mcpServerStub(Server, handlers)` | `mockMcp(Server).thenReturn({ ... })` |
| `testTool`, `testAction`, `testRouter`, `testArbiter`, `testRag`, `testJudge`, `testPii`, `testGuardrail`, `testToolInterceptor`, `testCompaction` | `testUnit(Component)` |

A record's code line is `[variant code, family code, "agboss"]`; for example a budget stop is `limit.budget`, `limit`, `agboss`.

### Surfaces, PII, CLI

| 0.1.0 | 0.1.1 |
| :--- | :--- |
| `@McpExpose` and `createMcpService` | `@McpEndpoint({ tools })` with `connectMcpStdio`, `connectMcp` or `mcpHttpListener` |
| `@A2AExpose`, `A2ACallerResolver`, `callerResolver` | `@A2AEndpoint({ name, version, description, ttl, skills })`, `@HttpAuthenticator`, `authenticator` |
| `@A2AAgent({ price })`, `target.start` | `costPerCall`, `target.skill` |
| `application.mesh` options of a signing key | a `@Mesh({ signingKey, inboundMode, deduplicationTtl, maxHops, peers: [{ application, verifyKeys }] })` class |
| `pii(PiiKind.Email, PiiAction.replaceWithKind())` and the other `replace...` names | `PiiKind.Email.mask()`, `.tokenize()`, `.block("...")`; `@PiiPolicy({ secret })` |
| the `records export` command | `agboss executions export` |
| a tenant passed implicitly | with a declared `tenantContext` a call needs `{ tenantId }` (the tenant gate) |

## The stores: stop the old version first

A durable store has its own upgrade step, and the upgrade is **not rolling**:

1. **Stop every instance of the old version.** A pod that stays up writes the old shape into the database you are about to migrate.
2. **Run the migration**: `npx agboss migrate db` brings an application's database to the build's schema (it refuses while execution leases are live, unless you pass `--allow-live-leases`). The Postgres and MongoDB packages also ship their own `migrate` commands.
3. **Start the new version.**

A `0.1.0` SQLite file is not migrated in place: recreate it. A new file is stamped with the `0.1.1` schema when the first process opens it, and a later build that finds a newer stamp refuses the file at open.

A custom store is a **storage driver** now: `defineStorageDriver({ ... })` from `@agboss/core/stores`, with each store class extending its contract. A custom `ExecutionLeaseRepository` adds `requestCancel`, and the contract suites in `@agboss/core/testing/contracts` prove the rest. See [Persistence & recovery](/guides/persistence-and-recovery/).

## A2A: one wire change, upgrade both sides together

`@A2AEndpoint` and `a2aHttpListener` serve **A2A v1.0**, and `@A2AAgent` calls any v1.0 agent. The `0.1.0` wire is gone with no shim: `POST <base>/execute`, `/resume` and `/cancel`, the `agboss-mesh` header, `A2ARoute` and `A2AExecutionResponse`. A `0.1.0` client fails against a `0.1.1` server, so redeploy both sides of an A2A call together. MCP keeps its wire. See [`@A2AEndpoint`](/reference/a2a-endpoint/) and the [mesh extension](/a2a/mesh/v1/).

## PII tokens change once

Every use of the PII key has a key of its own, so the same value has a different `<email:...>` token under `0.1.1`. Stores need no migration: a paused execution's token map is read as it is. A log or trace search that joins `0.1.0` tokens with `0.1.1` tokens finds no match across the upgrade, and during a rolling redeploy one value has two tokens (both revealed). A child workflow is now masked by the union of its chain's policies, so a value its parent masks reaches the child's models masked; where an agent must see the value, name the policy in `excludePiiPolicies`.

## Where to read next

- [Quick start](/getting-started/quick-start/) for a `0.1.1` project from scratch.
- [Workflow](/concepts/workflow/) for the new flow grammar.
- [Changelog](/changelog/) for the release summary, and the [CLI reference](/cli/) for `agboss migrate db`.
