---
title: Changelog & Release Notes
description: Release history, architectural milestones, and npm package versioning (@agboss/core and @agboss/cli) for the AGBoss TypeScript agent framework.
---

This page tracks releases and architectural milestones of the AGBoss framework. Every code snippet in the AGBoss documentation is compiled and verified against the current public package exports by `check:docs` in CI.

## What shipped in AGBoss v0.0.2 (Latest)

`v0.0.2` is the first public release of AGBoss (`v0.0.1` was published solely to reserve the `@agboss/core` and `@agboss/cli` package names on the npm registry). It ships the complete production runtime:

| Area | Shipped in v0.0.2 |
| :--- | :--- |
| **Application Root (`#261`)** | `@Application` (`*.application.ts`) wires `workflows`, typed `environment` (`secret()`, `env()`, `env.optional()`), `providers`, mandatory `@Budget` classes, `piiPolicies`, `observers`, and `@HealthCheck` |
| **Path Scope Flow DSL (`#272`, `#289`)** | One-call-per-line paths (`start(Start).returns(Dto).toAgent(Agent).toFinish(Finish)`), `.chooseOne(route())`, `.switch(caseOf())`, and compile-time Path Scope verification |
| **Review Loops & Provenance (`#271`)** | `.returns(Dto, { about })`, `caseOf(Dto, { about })`, `optional(Dto)`, `historyOf(Dto, { limit })`, and runtime `outdatedValues` cascades |
| **Parallel & Quorums (`#273`, `#279`)** | `.toParallelAgents()`, `.toParallelWorkflows()`, `SpawnPolicy.Always` / `OnDemand`, `.joinQuorum({ min, max, deadline })`, `.joinQuorumGroups()`, and `@Arbiter` (`.acceptedBy()`) |
| **Child & Recursive Flows (`#263`)** | `.toWorkflow(ChildWorkflow)` and recursive `ThisWorkflow` with `maxDepth` and `maxConcurrentExecutions` |
| **Channels & Two-Phase Pauses (`#267`)** | `@ChannelRole` + `@Channel` (`ChannelOutcome.awaitReply()`), concurrent `result.pending` pause list, and atomic two-phase `app.resume({ pauseId, decision })` |
| **Model Providers & FinOps (`#202`, `#261`)** | `@ModelProvider` pools (`RateLimitPolicy.of()`, `TenantRoundRobin`, circuit breaker) and pre-call `@Budget` reservation across `Application`, `Tenant`, and `Execution` scopes |
| **Durability & Multi-Instance (`#265`)** | 7 repository contracts (`Sqlite*Repository`), 30s execution-tree leases (`ExecutionLeaseLostError`), CAS completion (`completeIfStatus`), and 30s recovery sweeps |
| **Testing (`#262`, `#297`)** | `testWith(Application, { instances, overrides, concurrency: TestConcurrency.inOrder(...) })`, `VirtualClock`, and 8 unit runners (`testTool`, `testAction`, `testRouter`, `testArbiter`, `testRag`, `testJudge`, `testPii`, `testGuardrail`) |
| **Built-in AI Skills (`#305`)** | Auto-scaffolded `AGENTS.md`, `CLAUDE.md`, and `.claude/skills/agboss/SKILL.md` kept in sync by `agboss migrate` |

## Why does versioning start at v0.0.2?

On the public npm registry (`registry.npmjs.org`), `@agboss/core@0.0.1` and `@agboss/cli@0.0.1` were published on October 11, 2026 as initial name-reservation placeholders. Because npm permanently locks any published version number (even if a version is later unpublished), `0.0.1` cannot be reused — making **`v0.0.2`** the first functional release.
