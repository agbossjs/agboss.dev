---
title: Introduction
description: Learn what AGBoss is, why it exists, and how it brings dependency injection, static graph checks, and FinOps to LangGraph agents in TypeScript.
---

AGBoss — short for **A**gent **G**raph **B**uilder, **O**pen-**S**ource **S**oftware — is a TypeScript application framework for building, testing, and operating [LangGraph](https://www.langchain.com/langgraph) agent workflows in production Node.js services. Think of it as Angular or NestJS for multi-agent systems: agents, tools, routers, MCP servers, and knowledge bases are decorated classes wired by a `@Workflow` module and assembled into a single `@Application` container.

## Why build on AGBoss instead of raw graph primitives?

Building a prototype agent takes an afternoon, but running multi-agent workflows in production introduces architectural challenges that raw prompt chains do not solve out of the box:

- **Explicit path-based flow DSL:** The `@Workflow` `flow` array declares paths as readable sentences (`start(ChatWorkflowStart)` → `.returns(WorkflowStartTextDto)` → `.toRouter(MainRouter)` → `.chooseOne(...)`), with one chained method call per line.
- **Compile-time DTO contracts:** Step inputs and outputs are TypeScript DTO classes (`@Text`, `@ListOf`, `oneOf`, `optional` from `agboss/dto`) checked by `npx agboss check --workflow src/job-scout.workflow.ts`.
- **Single `@Application` assembly root:** Typed environment contracts (`AppEnvironment`, `secret()`, `env()`, `env.optional()`), shared `@ModelProvider` pools (`agboss/models`), `@Budget` spend limits, `@PiiPolicy` masking, `@Channel` pause transports, and observers are wired in one place.
- **Deterministic testing (`agboss/testing`):** Boot the real application container with `testWith(Application)`, script model turns with `mockLlm` / `replyWith` / `routeTo` / `decideWith`, advance time on `VirtualClock`, and test single components with eight unit runners (`testTool`, `testAction`, `testRouter`, `testArbiter`, `testRag`, `testJudge`, `testPii`, `testGuardrail`).
- **Operational resilience:** Built-in `@Budget` ceilings across execution, tenant, and application scopes, provider rate-limiting with `QueueBalancingStrategy`, SQLite WAL state repositories, and 30-second execution leases with automatic crash recovery.

## How AGBoss is organized

| Layer | Public Entry | Key Primitives |
| :--- | :--- | :--- |
| **Application & Flow** | `agboss` | `@Application`, `createApp`, `@Workflow`, `@WorkflowStart`, `@WorkflowFinish`, `start`, `route`, `caseOf` |
| **Components & DI** | `agboss` | `@Agent`, `@Action`, `@Router`, `@Arbiter`, `@Tool`, `@Injectable`, `ExecutionContext`, `Clock`, `Logger` |
| **Data Contracts & Units** | `agboss/dto`, `agboss/units` | `@Text`, `@ListOf`, `oneOf`, `listOf`, `optional`, `usd()`, `seconds()`, `minutes()` |
| **Models & Integrations** | `agboss/models`, `agboss/mcp`, `agboss/rag` | `@ModelProvider`, `RateLimitPolicy`, `@McpServer`, `@McpTool`, `@McpExpose`, `@Rag` |
| **Testing Harness** | `agboss/testing` | `testWith`, `TestConcurrency`, `VirtualClock`, `testTool`, `testAction`, `testRouter`, `testArbiter`, `testRag`, `testJudge`, `testPii`, `testGuardrail` |

## Where to go next

1. [Install the AGBoss CLI and runtime](/getting-started/installation/) in a new or existing TypeScript project.
2. Follow the [Quick start](/getting-started/quick-start/) to build and run your first typed workflow and `@Application`.
3. Explore the [Job Scout example](/examples/job-scout/) to see a complete multi-agent system with decision routing, MCP tools, RAG, and scripted tests.
