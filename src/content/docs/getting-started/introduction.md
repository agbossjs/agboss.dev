---
title: Introduction
description: Learn what AGBoss (Agent Graph Builder Open Source System) and HarnessDSL are, why they exist, and how their 7 distributed-systems invariants, compile-time Path Scope, and built-in AI coding skills keep LangGraph systems scaling to hundreds of nodes deterministic in TypeScript.
---

**AGBoss** — short for **A**gent **G**raph **B**uilder **O**pen **S**ource **S**ystem — is the TypeScript framework, static graph compiler (`agboss check`), and production runtime for building, testing, and operating [LangGraph](https://www.langchain.com/langgraph) multi-agent systems (`npm i agboss`). Inside AGBoss, **HarnessDSL (`HDSL`)** is the built-in declarative graph grammar and verification specification (analogous to JSX in React or PSL in Prisma) — defining how `*.workflow.ts` `flow` chains and contract decorators express narrow `@Dto` contracts, `Path Scope`, `in-degree = 1` vs `in-degree >= 2` topology rules, `{ about }` staleness tracking, quorums, and `compensateWith` / `committedBy` sagas.

It is engineered for **Senior, Staff, and Principal engineers and CTOs** who build multi-agent graphs — from a few steps to hundreds of nodes — alongside **AI coding agents (Codex, Cursor, Windsurf, Copilot, Gemini CLI, Claude Code)**. Instead of unconstrained state bags and untyped graph edges that degrade as coding agents iterate, AGBoss and HarnessDSL enforce [7 distributed-systems invariants](/concepts/architecture/) at compile time via `agboss check`.

## Why build on AGBoss instead of raw graph primitives?

Building a 3-node prototype takes an afternoon, but scaling to a production graph with hundreds of nodes maintained by coding agents introduces failure modes that raw orchestration libraries do not prevent:

- **Computational Role Segregation:** Distinct decorators ([`@Agent`](/reference/agent/), [`@Router`](/reference/router/), [`@Arbiter`](/reference/arbiter/), [`@Action`](/reference/action/), [`@Tool`](/reference/tool/)) prevent coding agents from creating monolithic "god nodes" that mix LLM calls, routing branches, consensus rules, and database writes.
- **Canonical Topology Isomorphism & Path Scope SSA Dataflow:** The `@Workflow` `flow` array declares paths with strictly one chained method call per line (`start(ChatWorkflowStart)` &rarr; `.returns(WorkflowStartTextDto)` &rarr; `.toRouter(MainRouter)` &rarr; `.chooseOne(...)`). `npx agboss check` runs static dominance analysis, generates `.agboss/types.d.ts` with narrowed `Produced<Dto, Producer>` types, and rejects missing (`[input.missing-on-path]`) or stale loop artifacts (`[input.outdated-on-path]`).
- **Prompt Prefix Cache Invariance & Boundary PII:** Static system prompt verification (`[prompt.input-in-instructions]`) and deterministic HMAC pseudonymization ([`PiiAction.replaceWithToken()`](/reference/pii-policy/)) preserve LLM KV-cache hit rates across turns while transparently restoring real values inside `@Tool` calls.
- **Single `@Application` Assembly Root & 4-Stage Scaling:** Typed environment contracts (`AppEnvironment`, `secret()`, `env()`, `env.optional()`), shared [`@ModelProvider`](/reference/model-provider/) pools, mandatory [`@Budget`](/reference/budget/) ceilings, [`@ChannelRole`](/reference/channel-role/) pauses, [`@HealthCheck`](/reference/health-check/) probes, and 7 `Sqlite*` WAL storage repositories are wired in one place.
- **Deterministic Offline Testing (`agboss/testing`):** Boot the real application container across multiple virtual instances with `testWith(Application, { instances: 2, concurrency: TestConcurrency.inOrder([...]) })`, advance time on `VirtualClock`, and test any component in isolation with 8 unit runners (`testTool`, `testAction`, `testRouter`, `testArbiter`, `testRag`, `testJudge`, `testPii`, `testGuardrail`).
- **Built-in AI Coding Skills & Progressive Crystallization:** Every project ships with committed `AGENTS.md` rules and offline-synced [`skills/agboss/`](/concepts/ai-coding-skills/) references, plus `agboss describe --json` (`configHash`, `promptHash`, `schemaHash`) for [crystallizing](/concepts/progressive-crystallization/) settled LLM paths into deterministic TypeScript.

## How AGBoss is organized

| Layer | Public Entry | Key Primitives |
| :--- | :--- | :--- |
| **Application & Flow** | `agboss` | `@Application`, `createApp`, `@Workflow`, `@WorkflowStart`, `@WorkflowFinish`, `start`, `route`, `caseOf`, `ThisWorkflow` |
| **Components & DI** | `agboss` | `@Agent`, `@Action`, `@Router`, `@Arbiter`, `@Tool`, `@Judge`, `@InputGuardrail`, `@OutputGuardrail`, `@Compaction`, `@Injectable`, `ExecutionContext`, `ApplicationContext`, `Clock`, `Logger` |
| **Data Contracts & Units** | `agboss/dto`, `agboss/units` | `@Text`, `@Integer`, `@Decimal`, `@Flag`, `@OneOf`, `@ListOf`, `@Nested`, `oneOf`, `listOf`, `optional`, `historyOf`, `usd()`, `seconds()`, `minutes()`, `hours()` |
| **Models & Integrations** | `agboss/models`, `agboss/mcp`, `agboss/rag`, `agboss/a2a` | `@ModelProvider`, `RateLimitPolicy`, `PromptCaching`, `@McpServer`, `@McpTool`, `@McpExpose`, `@Rag`, `SqliteFtsConnector`, `@A2aAgent` |
| **Testing Harness** | `agboss/testing` | `testWith`, `TestConcurrency`, `VirtualClock`, `testTool`, `testAction`, `testRouter`, `testArbiter`, `testRag`, `testJudge`, `testPii`, `testGuardrail` |

## Where to go next

1. Read [Distributed-Systems Architecture (7 Core Invariants)](/concepts/architecture/) for the technical design behind AGBoss.
2. [Install the AGBoss CLI and runtime](/getting-started/installation/) and follow the [Quick start](/getting-started/quick-start/) to run your first workflow.
3. Explore [AI-Assisted Engineering & Skills](/concepts/ai-coding-skills/) and the [Job Scout example](/examples/job-scout/).
