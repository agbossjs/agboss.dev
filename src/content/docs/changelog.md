---
title: Changelog & Release Notes
description: Release history, architectural milestones, and npm package versioning (agboss and agboss-cli) for the AGBoss TypeScript agent framework.
---

This page tracks releases and architectural milestones of the AGBoss framework. Every code snippet in the AGBoss documentation is compiled and verified against the current public package exports by `check:docs` in CI.

## What shipped in AGBoss (Latest)

AGBoss ships as two Apache 2.0 packages on the npm registry — `agboss` (the core runtime, decorators, **HarnessDSL (`HDSL`)** flow syntax, SQLite stores, testing harness, and bundled coding-agent skills) and `agboss-cli` (the `agboss` / `agb` CLI). Key capabilities include:

| Area | Shipped Capabilities |
| :--- | :--- |
| **Application Root & Governance (`#261`, `#300`, `#388`, `#389`)** | `@Application` (`*.application.ts`) wires `workflows`, typed `environment` (`secret()`, `env()`, `env.optional()`), `providers`, mandatory `@Budget` classes, `piiPolicies`, `guardrails`, `toolInterceptors`, `exposes`, `observers`, `@HealthCheck` (`checkLiveness()`, `checkReadiness()`), `maxConcurrentSteps`, `agboss/eslint` flat config, and `[name.kind-suffix]` enforcement on both `name` and class identifiers |
| **Path Scope HDSL (`#272`, `#289`)** | One-call-per-line `HarnessDSL` paths (`start(Start).returns(Dto).toAgent(Agent).toFinish(Finish)`), `.chooseOne(route())`, `.switch(caseOf())`, and compile-time Path Scope verification via generated `.agboss/types.d.ts` (`Produced<Dto, Producer>`) |
| **Review Loops & Provenance (`#271`)** | `.returns(Dto, { about })`, `caseOf(Dto, { about })`, `optional(Dto)`, `historyOf(Dto, { limit })`, and runtime `outdatedValues` cascades (`[input.outdated-on-path]`) |
| **Parallel & Quorums (`#273`, `#279`)** | `.toParallelAgents()`, `.toParallelWorkflows()`, `SpawnPolicy.Always` / `OnDemand`, `.acceptedBy().joinQuorum({ min, max, deadline })`, `.joinQuorumGroups(group(...).priority(1))`, and `.onJoinError()` |
| **Child, Recursive & Federated Mesh Flows (`#263`, `#387`, `#398`)** | `.toWorkflow(ChildWorkflow)`, recursive `ThisWorkflow` (`maxDepth`), multi-tenant `a2aHttpListener(app, { start, callerResolver })` (`A2ACallerResolver`), typed `@A2AAgent`, signed Agent Mesh Envelope (`agboss-mesh` JWS propagating `origin`, `budget.remaining`, `deadline.remaining`, `callChain`), and `$ agboss check --federation` |
| **Channels, Guardrails & Tool Interceptors (`#267`, `#383`, `#384`)** | `@ChannelRole`, `@ReplyInterpreter`, `@Channel`, atomic two-phase `app.resume({ pauseId, reply })`, `DecidedBy.Code` `@InputGuardrail` / `@OutputGuardrail` (`GuardrailHandler`, `GuardrailDecision`), and cascading `@ToolInterceptor` (`BeforeToolCall` / `AfterToolCall`, `ToolCallDecision.replyToModel`) |
| **Model Providers, Custom Compaction & FinOps (`#202`, `#261`, `#266`, `#382`, `#385`, `#395`)** | `@ModelProvider` pools (`OpenRouterProvider` with host/quantization pinning, `OpenAiCompatibleProvider`, and custom `ModelProviderHandler.complete(request)` transports), `CompactionStrategy.Custom` (`CompactionHandler`), KV-cache prefix invariance (`[prompt.input-in-instructions]`), and pre-call `@Budget` reservation |
| **Durability & Multi-Instance (`#265`, `#268`)** | 7 repository contracts (`Sqlite*Repository`), 30s execution-tree leases (`ExecutionLeaseLostError`), CAS completion (`completeIfStatus`), 30s recovery sweeps, and `agboss describe --json` (`configHash`, `promptHash`, `schemaHash`) |
| **Testing, Trajectories & Evals (`#262`, `#297`, `#395`, `#396`, `#397`)** | `testWith(Application)`, `VirtualClock`, 10 unit runners (`testTool`, `testToolInterceptor`, `testAction`, `testRouter`, `testArbiter`, `testRag`, `testJudge`, `testCompaction`, `testPii`, `testGuardrail`), trajectory matchers (`toHaveCalledTools`, `toHaveToolCallMatching`), VCR `[vcr.stale-cassette]`, `@EvalSuite` (`pass@k` / `pass^k`, `--baseline --fail-on-regression`, Cohen's $\kappa$ calibration, `--chaos`, `--metamorphic`, and `$ agboss eval ui`) |
| **Built-in AI Skills (`#305`)** | `agboss create` scaffolds committed `AGENTS.md` and `CLAUDE.md` (`@AGENTS.md`), while `npm install` (`postinstall`), `agboss check`, and `agboss generate` auto-sync gitignored `.claude/skills/agboss/` (`SKILL.md` + 13 reference guides, including `13-migrating-from-langgraph.md`) offline from `node_modules/agboss/skills/agboss/` |

## Package naming and version history

AGBoss is published under the unscoped `agboss` and `agboss-cli` package names on `registry.npmjs.org` (`v0.0.1` was used only as an initial placeholder during repository setup, followed by `v0.0.2` and `v0.1.0`). When upgrading from earlier pre-release layouts that imported subpath entry points such as `agboss/core` or `agboss/graph`, run `npx agboss migrate imports` to rewrite imports to the canonical entry points (`agboss`, `agboss/dto`, `agboss/models`, `agboss/units`, `agboss/rag`, `agboss/mcp`, `agboss/a2a`, `agboss/testing`).
