---
title: About AGBoss
description: What AGBoss is, why it layers an application framework on top of LangGraph in TypeScript, and how its open-source model works.
---

AGBoss (Agent Graph Builder, Open-Source Software) is an Apache 2.0 licensed TypeScript application framework layered on top of [LangGraph](https://www.langchain.com/langgraph). It gives engineering teams a strict, compiler-verified architecture for building, testing, and operating multi-agent systems inside their own Node.js backend without vendor lock-in.

## Why AGBoss exists

Raw orchestration graphs give developers low-level state machines, while hosted agent platforms lock prompts, execution state, and observability inside third-party cloud infrastructure. Engineering teams running agents in production need a third option: an application layer that runs inside their existing perimeter with compile-time safety, dependency injection, and predictable cost controls.

AGBoss brings the proven architectural patterns of Spring, Angular, and NestJS to TypeScript agent workflows:

- **Single `@Application` assembly root:** Workflows, typed `Environment` contracts (`secret()`, `env()`, `env.optional()`), `@ModelProvider` classes, `@Budget` ceilings, `@PiiPolicy` rules, `ExecutionObserver` hooks, and storage repositories are wired in one place.
- **Compile-time Path Scope Flow DSL:** Every workflow path (`*.workflow.ts`) is written with one chained call per line (`start().returns().toAgent().toFinish()`), and `agboss check` generates `.agboss/types.d.ts` so missing or outdated inputs fail at build time.
- **Multi-instance durability:** Seven repository contracts with built-in SQLite WAL implementations (`SqliteCheckpointSaver`, `SqliteExecutionLeaseRepository`, and others) coordinate 30-second execution tree leases, crash recovery sweeps, and two-phase `app.resume()` across horizontal replicas.
- **Deterministic offline testing:** `testWith(App)` and the 8 isolated unit runners (`testTool`, `testAction`, `testRouter`, `testArbiter`, `testRag`, `testJudge`, `testPii`, `testGuardrail`) verify every branch and race condition with zero network calls.

## How AGBoss relates to LangGraph

AGBoss complements LangGraph rather than replacing it. Every `@Workflow` compiles down to a standard `@langchain/langgraph` state graph, and each `@Agent` runs its tool-calling loop as a compiled subgraph. You can inspect any AGBoss workflow in LangGraph Studio while keeping strict TypeScript DTO boundaries, constructor dependency injection, and built-in FinOps accounting.

## Open-source governance and licensing

The entire AGBoss framework (`agboss`), CLI (`agboss-cli`), documentation verification suite, and built-in AI coding skills (`AGENTS.md` and `.claude/skills/agboss/`) are published under the [Apache License 2.0](https://github.com/agbossjs/agboss/blob/main/LICENSE).

| Component | Package / Location | License | Purpose |
| --- | --- | --- | --- |
| Core Framework | `agboss` | Apache-2.0 | Decorators, Flow DSL, DI container, FinOps, PII, SQLite stores, `agboss/testing` |
| Command-Line Interface | `agboss-cli` | Apache-2.0 | `agboss create`, `generate`, `check`, `describe`, `chat`, `run`, `eval`, `compare` |
| Reference Examples | `examples/job-scout`, `examples/flow-patterns` | Apache-2.0 | End-to-end multi-agent workflows and flow pattern blueprints |
| Documentation Site | [agboss.dev](https://agboss.dev) | Apache-2.0 | Compiler-checked guides, API reference, `/llms.txt`, and `/llms-full.txt` |
