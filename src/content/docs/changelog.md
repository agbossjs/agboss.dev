---
title: Changelog & Release Notes
description: Release history, architectural milestones, and npm package versioning (@agboss/core and @agboss/cli) for the AGBoss TypeScript agent framework.
---

This page tracks releases and architectural milestones of the AGBoss framework. Every code snippet in the AGBoss documentation is compiled and verified against the current public package exports by `check:docs` in CI.

## What is in AGBoss `v0.1.1` (Latest Release)

> **Release status:** `@agboss/core@0.1.1` and `@agboss/cli@0.1.1` are published on the public npm registry (`registry.npmjs.org`) under the `latest` dist-tag.

AGBoss is organized as two Apache 2.0 packages — `@agboss/core` (the core runtime, decorators, **HarnessDSL (`HDSL`)** flow syntax, SQLite stores, testing harness, and bundled coding-agent skills) and `@agboss/cli` (the `agboss` / `agb` CLI). Key capabilities in `v0.1.1` include:

`0.1.1` is a **hard break** from `0.1.0`: the public API was reworked end to end, with no compatibility layer and no deprecation aliases. Read [What's new in 0.1.1](/upgrading-to-0-1-1/) for the removed names, their replacements and the migration order.

| Area | What `0.1.1` ships |
| :--- | :--- |
| **HarnessDSL flow forms** | Sources `onStart` / `onAgent` / `onRouter` / `onAction` / `onWorkflow` / `onExternalTask`; steps `.toAgent` / `.toRouter` / `.toAction` / `.toWorkflow` / `.toExternalTask` / `.toFinish`; a router's `.onRoute(subPath)`; `.toOneOf([…])`; `.inParallel([…])` and `.forEachItem(step, { takeFirst, maxConcurrency })` closed by `.join()`; `.arbitratedBy(Arbiter)`, `.joinQuorum` and `.joinQuorumGroups`; `.toWorkflow(() => Self)` recursion. `start`, `route`, `caseOf`, `.returns`, `{ about }`, `ThisWorkflow` and `toParallel*` are gone |
| **Data and provenance** | Tracked DTOs: a tracked input field is the DTO itself, with `Metadata.createdBy`, `historyOf(Dto, { maxPrevious })` and `OutdatedReason`; plain DTO literals in tests; DTO decorators `@Bool`, `@Float`, `@List`, `@Enum`, `@IsoDate`, `@File`, `@KeyText`; `listOf(A, B)` is variadic |
| **Prompts, limits and models** | `PromptSource` (`./file.md` or `inline()`), required `historyTtl`, `executionLimits` on workflows, applications and agents, and explicit driver-based `@ModelProvider` (`OpenRouterDriver`, `OpenAiCompatibleDriver`, `DecisionsDriver`, or a transport class) with a required `timeout`; there are no built-in providers |
| **Storage** | `@DatabaseStorage`, `@ClusterStorage` and `@ObjectStorage` with drivers (`SqliteDriver` built in; Postgres, MongoDB, Redis and S3 as store packages), required `auditLogTtl` and `ledgerEntriesTtl`, `agboss migrate db` |
| **Pauses and execution control** | `@ToolApproval` and `@ExternalTask` targets with `PauseRespondent`, `@Channel({ target, ttl })`, `@ChannelInterpreter`, `@ChannelSelector`, `@ChannelListener`; `app.stop`, `app.pause`, `app.unpause`, `app.extendPause`, `app.reassignPause`, `app.listPauses`, `app.getExecution`, `app.listExecutions`; cancel and stop are outcomes; hard cancel fence; the tenant gate |
| **Surfaces and federation** | `@McpEndpoint` with `connectMcpStdio` / `connectMcp` / `mcpHttpListener`, `@A2AEndpoint` on the A2A v1.0 wire, `@HttpAuthenticator`, `@Mesh`, `@A2AAgent` with `costPerCall` |
| **Testing and evaluation** | `testUnit` for every unit runner with `services: [Fake]`, `testWith`, `mockModel`; judges read `output`; `@EvalSuite` with `judges`; profiles as `src/config/<name>.config.ts`; `agboss executions export` |
| **Other** | `@Memory` replaces `@Compaction`; `DecisionModel`; `Idempotency` (`runOnce`, `sendOnce`); `@Observer` with per-hook methods; PII verbs `mask` / `tokenize` / `block`; `RagSource` with `RagScope` |

## Package naming and version history

AGBoss publishes the official scoped [`@agboss/core`](https://www.npmjs.com/package/@agboss/core) and [`@agboss/cli`](https://www.npmjs.com/package/@agboss/cli) packages under the `agboss` npm organization on `registry.npmjs.org`:

- **`0.1.1` (Latest Published Release):** The API rework of `@agboss/core` and `@agboss/cli` on `registry.npmjs.org`, a hard break from `0.1.0` with no compatibility layer; see [What's new in 0.1.1](/upgrading-to-0-1-1/).
- **`0.0.1` (Historical npm Placeholder):** Initial package-name reservation published during repository setup; superseded by `0.1.0` and `0.1.1`.
- **`0.1.0` (Previous Release):** First public release of the framework and the CLI; its API is not supported by `0.1.1`.

When upgrading from earlier pre-release layouts that imported deprecated subpath entry points such as `@agboss/core/graph` or `@agboss/core/memory`, run `npx agboss migrate imports` to rewrite imports to the canonical entry points (`@agboss/core`, `@agboss/core/dto`, `@agboss/core/models`, `@agboss/core/units`, `@agboss/core/rag`, `@agboss/core/mcp`, `@agboss/core/a2a`, `@agboss/core/testing`, `@agboss/core/eval`, `@agboss/core/eslint`).
