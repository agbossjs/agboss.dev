---
title: About AGBoss
description: What AGBoss (Agent Graph Builder Open Source System) and its built-in HarnessDSL (HDSL) grammar are, why they bring distributed-systems invariants and compiler-verified Path Scope to LangGraph in TypeScript, and how the Apache 2.0 open-source model works.
---

**AGBoss** (**Agent Graph Builder Open Source System**) is an Apache 2.0 licensed TypeScript framework, static graph compiler (`agboss check`), and production runtime layered on top of [LangGraph](https://www.langchain.com/langgraph) (`npm i agboss`). Inside AGBoss, **HarnessDSL (`HDSL`)** is the declarative graph grammar and verification specification (much like JSX in React or PSL in Prisma) that defines how `*.workflow.ts` `flow` chains and contract decorators specify narrow `@Dto` handoffs, `Path Scope`, `in-degree = 1` vs `in-degree >= 2` canonical topology, `{ about }` staleness tracking, quorums, and `compensateWith` / `committedBy` sagas.

It is designed for Senior, Staff, and Principal engineers and CTOs who build multi-agent systems scaling to hundreds of nodes with AI coding agents (Codex, Cursor, Windsurf, Copilot, Gemini CLI, Claude Code) and require compile-time guarantees, predictable token economics, and zero vendor lock-in.

## Why AGBoss & HarnessDSL (HDSL) exist

Engineering teams building production multi-agent systems face a fundamental architectural gap:

1. **Raw graph libraries are too unconstrained for AI coding agents at scale.** When a coding agent modifies a 50-node graph built around a shared mutable state bag (`Annotation.Root`) and arbitrary `(state) => string` edges, it cannot statically prove which upstream fields are populated, whether a review loop is reading stale state from a previous iteration, or whether an error branch bypassed a mandatory rollback action.
2. **Hosted agent SaaS platforms break enterprise data perimeters.** Routing proprietary prompts, customer PII, and durable execution state through a third-party cloud creates compliance blockers and vendor lock-in.

**AGBoss** (the framework, static compiler, and runtime) and its built-in **HarnessDSL (`HDSL`)** grammar solve both problems by bringing the compiler rigor of distributed-systems engineering and structured frameworks (Spring, Angular, NestJS) directly into your Node.js 22+ backend through [7 architectural principles](/concepts/architecture/):

- **Computational Role Segregation:** Distinct, single-responsibility decorators (`@Agent`, `@Router`, `@Arbiter`, `@Action`, `@Tool`, `@ToolInterceptor`) replace monolithic "god agents".
- **Path-Scoped SSA Dataflow:** Every workflow path (`*.workflow.ts`) is verified by `agboss check`, which generates `.agboss/types.d.ts` with narrowed `Produced<Dto, Producer>` inputs and rejects missing (`[input.missing-on-path]`), dead (`[flow.unused-output]`), or stale (`[input.outdated-on-path]`) state at build time.
- **Canonical Topology Isomorphism:** A strict 1-to-1 mapping between graph topology and code formatting (`in-degree = 1` inline chain, `in-degree >= 2` top-level `agent()`/`router()`/`action()` entry, one chained call per line) eliminates merge conflicts and structural entropy.
- **Prompt Prefix Cache Invariance:** Static system prompt verification (`[prompt.input-in-instructions]`) and deterministic HMAC pseudonymization (`PiiAction.replaceWithToken()`) preserve LLM KV-cache hit rates across turns while keeping raw PII out of external model providers.
- **Transactional LIFO Sagas & Idempotency:** Compensatable `@Action` nodes (`compensateWith`, `committedBy`) and deterministic `step.idempotencyKey` propagation guarantee clean rollback across errors, quorum `Surplus` aborts, and budget cutoffs.
- **Zero-Leakage DI & 4-Stage Scaling:** Class-inheritance DI inside a single `@Application` root scales seamlessly from in-memory unit/integration tests (`testWith(App)`, 10 unit runners) to SQLite WAL durability and multi-pod 30-second execution lease handoff.
- **Progressive Crystallization & Built-in Coding Skills:** Content-addressed revision snapshots (`agboss describe --json` with `configHash`, `promptHash`, `schemaHash`) let teams crystallize settled `DecidedBy.Model` paths into deterministic `DecidedBy.Code` and `@Action` nodes, while offline-synced `AGENTS.md` + 13 skill modules keep every coding agent aligned with the compiler.

## How AGBoss relates to LangGraph

AGBoss complements LangGraph rather than replacing it. Every `@Workflow` compiles down to a standard `@langchain/langgraph` state graph, and each `@Agent` runs its tool-calling loop as a compiled subgraph. You can inspect any AGBoss workflow in LangGraph Studio while keeping strict TypeScript DTO boundaries, constructor dependency injection, and built-in FinOps accounting.

## Open-source governance and licensing

The entire AGBoss framework (`agboss`), CLI (`agboss-cli`), documentation verification suite, and built-in AI coding skills (`AGENTS.md`, `CLAUDE.md`, and `.claude/skills/agboss/`) are published under the [Apache License 2.0](https://github.com/agbossjs/agboss/blob/main/LICENSE).

| Component | Package / Location | License | Purpose |
| --- | --- | --- | --- |
| Core Framework | `agboss` | Apache-2.0 | Decorators, HarnessDSL (`HDSL`) flow syntax, DI container, FinOps, PII, SQLite stores, `agboss/testing`, offline skills (`skills/agboss/`) |
| Command-Line Interface | `agboss-cli` | Apache-2.0 | `agboss create`, `generate`, `check`, `describe`, `chat`, `run`, `eval`, `replay`, `golden`, `compare` |
| Reference Examples | `examples/job-scout`, `examples/flow-patterns` | Apache-2.0 | End-to-end multi-agent workflows and flow pattern blueprints |
| Documentation Site | [agboss.dev](https://agboss.dev) | Apache-2.0 | Compiler-checked guides, API reference, `/llms.txt`, and `/llms-full.txt` |
