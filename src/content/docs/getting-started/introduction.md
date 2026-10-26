---
title: Introduction
description: "Spring-style architecture for LangGraph AI agents — build reliable, testable AI agents in TypeScript with dependency injection, static workflow validation, and deterministic testing."
---

**AGBoss** — short for **A**gent **G**raph **B**uilder **O**pen **S**ource **S**ystem — is an open-source, Spring-style TypeScript framework for building reliable, testable AI agents and multi-agent workflows on top of [LangGraph](https://www.langchain.com/langgraph).

While LangGraph provides the underlying graph execution runtime and checkpointing engine, AGBoss provides the application architecture layer: declarative component decorators (`@Application`, `@Workflow`, `@Agent`, `@Router`, `@Arbiter`, `@Action`, `@Tool`), constructor dependency injection (`@Injectable`), explicit `@Dto` data contracts, a declarative workflow DSL (**HarnessDSL**), a build-time workflow verifier (`agboss check`), and a deterministic offline testing harness (`@agboss/core/testing`).

It is published on npm as two complementary Apache-2.0 packages:
- **[`@agboss/core`](https://www.npmjs.com/package/@agboss/core)** (`dependencies`) — the production runtime, decorators, DI container, storage repositories, testing/evaluation subpaths, and bundled AI coding skills.
- **[`@agboss/cli`](https://www.npmjs.com/package/@agboss/cli)** (`devDependencies`) — the project scaffolder (`agboss create`), code generator (`agboss generate`), static workflow compiler (`agboss check`), and local developer/evaluation UIs.

## Why build with AGBoss on LangGraph?

As a multi-agent system grows beyond a small prototype—especially when maintained alongside AI coding assistants (Claude Code, Cursor, Codex, Windsurf, Copilot)—raw shared-state graphs (`Annotation.Root`) and untyped string edges become difficult to validate and test. AGBoss addresses this through [7 architectural principles](/concepts/architecture/):

- **Computational Role Segregation:** Distinct decorators ([`@Agent`](/reference/agent/), [`@Router`](/reference/router/), [`@Arbiter`](/reference/arbiter/), [`@Action`](/reference/action/), [`@Tool`](/reference/tool/)) separate LLM reasoning, routing decisions, quorum consensus, and external side effects into focused component classes.
- **Static Workflow Validation (`agboss check` & Path Scope):** The `@Workflow` `flow` array declares paths with one chained method call per line (`start(ChatWorkflowStart)` &rarr; `.returns(WorkflowStartTextDto)` &rarr; `.toRouter(MainRouter)` &rarr; `.chooseOne(...)`). `npx agboss check` runs static path-dominance analysis, generates `.agboss/types.d.ts` with narrowed `Produced<Dto, Producer>` types, and rejects missing inputs (`[input.missing-on-path]`), stale loop data (`[input.outdated-on-path]`), or uncompensated actions (`[flow.uncompensated-action]`) before runtime.
- **Constructor Dependency Injection & Single `@Application` Root:** Wire typed environment contracts (`AppEnvironment`, `secret()`, `env()`, `env.optional()`), shared [`@ModelProvider`](/reference/model-provider/) pools, [`@Budget`](/reference/budget/) ceilings, [`@ChannelRole`](/reference/channel-role/) pauses, [`@HealthCheck`](/reference/health-check/) probes, and replaceable `InMemory*` or `Sqlite*` WAL repositories in one container—and swap implementations or test doubles cleanly in tests.
- **Deterministic Offline Testing (`@agboss/core/testing`):** Boot the application container with `testWith(Application)`, control concurrent interleavings and virtual time (`VirtualClock`), and test any component in isolation offline without live LLM calls using 10 dedicated unit runners (`testTool`, `testToolInterceptor`, `testAction`, `testRouter`, `testArbiter`, `testRag`, `testJudge`, `testCompaction`, `testPii`, `testGuardrail`).
- **Prompt Prefix Cache Invariance & Boundary PII:** Static system prompt verification (`[prompt.input-in-instructions]`) and deterministic HMAC pseudonymization ([`PiiAction.replaceWithToken()`](/reference/pii-policy/)) preserve LLM KV-cache prefixes across turns while restoring real values only inside authorized `@Tool` calls.
- **Built-in AI Coding Skills & Progressive Crystallization:** Every scaffolded project includes `AGENTS.md` and offline-synced [`.claude/skills/agboss/`](/concepts/ai-coding-skills/) reference guides, plus `agboss describe --json` (`configHash`, `promptHash`, `schemaHash`) for [crystallizing](/concepts/progressive-crystallization/) settled LLM paths into deterministic TypeScript.

## How AGBoss is organized

| Layer | Public Entry | Key Primitives |
| :--- | :--- | :--- |
| **Application & Flow** | `agboss` | `@Application`, `createApp`, `@Workflow`, `@WorkflowStart`, `@WorkflowFinish`, `start`, `route`, `caseOf`, `ThisWorkflow` |
| **Components & DI** | `agboss` | `@Agent`, `@Action`, `@Router`, `@Arbiter`, `@Tool`, `@ToolInterceptor`, `@Judge`, `@InputGuardrail`, `@OutputGuardrail`, `@Compaction`, `@Injectable`, `ExecutionContext`, `ApplicationContext`, `Clock`, `Logger` |
| **Data Contracts & Units** | `@agboss/core/dto`, `@agboss/core/units` | `@Text`, `@Integer`, `@Decimal`, `@Flag`, `@OneOf`, `@ListOf`, `@Nested`, `oneOf`, `listOf`, `optional`, `historyOf`, `usd()`, `seconds()`, `minutes()`, `hours()` |
| **Models & Integrations** | `@agboss/core/models`, `@agboss/core/mcp`, `@agboss/core/rag`, `@agboss/core/a2a` | `@ModelProvider`, `RateLimitPolicy`, `PromptCaching`, `@McpServer`, `@McpTool`, `@McpExpose`, `@Rag`, `SqliteFtsConnector`, `@A2AAgent`, `@A2AExpose` |
| **Testing & Evaluation** | `@agboss/core/testing`, `@agboss/core/eval` | `testWith`, `TestConcurrency`, `VirtualClock`, `testTool`, `testToolInterceptor`, `testAction`, `testRouter`, `testArbiter`, `testRag`, `testJudge`, `testCompaction`, `testPii`, `testGuardrail`, `@EvalSuite` |

## Where to go next

1. [Install `agboss` and `@agboss/cli` from npm](/getting-started/installation/) and follow the [Quick start](/getting-started/quick-start/) to scaffold, statically verify, and test your first workflow.
2. Explore the 7 standalone, runnable applications in [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples) (documented in the [Examples guide](/examples/job-scout/)).
3. Read the [7 Architectural Principles](/concepts/architecture/) and [AI Coding Skills (`AGENTS.md`)](/concepts/ai-coding-skills/).
