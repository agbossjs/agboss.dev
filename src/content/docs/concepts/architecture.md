---
title: Distributed-Systems Architecture (7 Core Invariants)
description: How AGBoss (Agent Graph Builder Open Source System) and its built-in HarnessDSL (HDSL) grammar enforce 7 distributed-systems architectural invariants at compile time so Senior/Staff/Principal engineers and AI coding agents can scale LangGraph graphs to hundreds of nodes without structural entropy.
---

**AGBoss** (**Agent Graph Builder Open Source System**) is built on a foundational premise: **a multi-agent system that scales to hundreds of nodes is a distributed dataflow system, not a prompt script.** In this engineering model (much like React and JSX, or Prisma and PSL), **AGBoss** is the TypeScript framework, static graph compiler (`agboss check`), and production runtime on top of LangGraph (`npm i agboss`), while **HarnessDSL (`HDSL`)** is the declarative graph grammar and verification specification **inside `AGBoss`** — defining how `*.workflow.ts` `flow` chains and contract decorators express narrow `@Dto` handoffs, `Path Scope`, `in-degree = 1` vs `in-degree >= 2` canonical topology, `{ about }` staleness tracking, quorums, and `compensateWith` / `committedBy` sagas. Furthermore, in modern engineering organizations, the bulk of orchestration code is generated and refactored by **AI coding agents (Codex, Cursor, Windsurf, Copilot, Gemini CLI, Claude Code)** under the architectural direction of a Senior, Staff, or Principal engineer.

When coding agents operate on unconstrained graph libraries (raw `Annotation.Root` state bags, untyped `(state) => string` edges, and imperative `Promise.all` loops), small local edits silently corrupt downstream branches, destroy LLM KV-cache hit rates, or leave uncommitted side effects dangling on failure.

AGBoss replaces convention with **7 compile-time and runtime architectural invariants**. Every invariant is verified by `npx agboss check` before a single LLM token is spent.

---

## Overview of the 7 Architectural Invariants

| # | Architectural Principle | Core Primitives & Compiler Rules | Failure Mode Prevented |
| :--- | :--- | :--- | :--- |
| **1** | **Computational Role Segregation** | [`@Agent`](/reference/agent/), [`@Router`](/reference/router/), [`@Arbiter`](/reference/arbiter/), [`@Action`](/reference/action/), `[graph.limit-handler-uses-model]`, `[router.spawn-required]`, `[router.prompt-on-always]`, `agboss/no-component-state` | Monolithic "god nodes" that mix LLM reasoning, routing conditionals, consensus voting, and stateful side effects |
| **2** | **Path-Scoped SSA Dataflow** | [`.returns(Dto, { about })`](/concepts/path-scope/), `caseOf(Dto, { about })`, `historyOf(Dto)`, `.agboss/types.d.ts`, `Produced<Dto, P>`, `[input.missing-on-path]`, `[input.never-produced]`, `[flow.unused-output]`, `[input.outdated-on-path]`, `[launch.branch-outdates-sibling]` | Reading unpopulated fields, dead outputs, or stale loop artifacts from a shared mutable God State Object |
| **3** | **Canonical Topology Isomorphism** | `in-degree = 1` inline vs `in-degree >= 2` top-level entry (`[flow.shared-node-inline]`, `[flow.single-entry-own-path]`), 1 call/line, depth $\le 4$ (`[flow.path-too-deep]`), `ThisWorkflow` | Coding agents formatting identical graphs ten different ways, deep nesting pyramids, and unreviewable git diffs |
| **4** | **Prompt Prefix Cache Invariance** | `[prompt.input-in-instructions]`, sorted `@Tool` & `@Dto` JSON Schemas, deterministic HMAC-SHA256 [`replaceWithToken()`](/reference/pii-policy/) | Dynamic strings or random PII UUIDs invalidating the LLM KV prefix cache on every turn (10x token cost explosion) |
| **5** | **Transactional LIFO Sagas & Idempotency** | `ExecutionContext.step.idempotencyKey`, `compensateWith` / `committedBy`, `[flow.uncompensated-action]`, `[flow.uncommitted-action]`, `[flow.compensation-out-of-order]`, `[action.committer-without-compensator]`, `@agboss/unwinding` | Duplicate side effects on crash-recovery or dangling uncommitted writes on quorum `Surplus` / budget abort |
| **6** | **Zero-Leakage DI & 4-Stage Scaling** | [`@Application`](/concepts/application/), `[di.instance-provider]`, `OnInit..OnDestroy`, `app.close()` drain, 7 `Sqlite*` WAL stores, [`@HealthCheck`](/reference/health-check/) | Global singletons leaking across tests, split-brain multi-pod execution, or rewriting code to move from tests to Kubernetes |
| **7** | **Progressive Crystallization & AI Skills** | `agboss describe --json` (`configHash`, `promptHash`, `schemaHash`), [`AGENTS.md` & 12 Skill Modules](/concepts/ai-coding-skills/) | Keeping settled Desire Paths on expensive LLM calls forever, or coding agents hallucinating legacy APIs |

---

## 1. Computational Role Segregation

In raw orchestration libraries, every node is an arbitrary `async (state) => Partial<State>` function. Under iterative prompting, AI coding agents take the path of least resistance: they stuff LLM calls, `if/else` routing, parallel quorum checks, and database mutations into the same function.

AGBoss enforces **strict role segregation** at the decorator and compiler level (`[graph.limit-handler-uses-model]`, `[router.spawn-required]`, `[router.prompt-on-always]`, and the ESLint rule `agboss/no-component-state` forbidding mutable instance fields on components):

- **[`@Agent`](/reference/agent/) (Stochastic Reasoning & Tool Loops):** Calls a language model with a static system prompt, typed `input` DTOs, optional [`@Tool`](/reference/tool/) (bounded by `maxToolCalls`) / [`@Rag`](/reference/rag/) bindings, and [`@Judge`](/reference/judge/) quality gates. An `@Agent` class body is empty (`export class ScoutAgent {}`) — it cannot contain imperative routing or direct database writes.
- **[`@Router`](/reference/router/) (Branch Selection):** Chooses the next step (`chooseOne` or `chooseAtLeastOne`, requiring `[router.spawn-required]` and `[router.prompt-on-always]` on conditional model routes) either via a calibrated decision model (`DecidedBy.Model`), deterministic TypeScript (`DecidedBy.Code` implementing `RouterHandler<Self>` in `0ms`), or direct `oneOf` + `.switch(caseOf(...))` branching.
- **[`@Arbiter`](/reference/arbiter/) (Parallel Quorum Consensus):** Filters parallel branch answers inside `.toParallelAgents()` or `.toParallelWorkflows()` waves (`DecidedBy.Model` `criteria` or `DecidedBy.Code` `@OnAnswer(AgentClass)` methods) before the `.joinQuorum()` barrier.
- **[`@Action`](/reference/action/) (Deterministic Graph Step):** Runs pure, idempotent TypeScript with constructor DI (`ActionHandler<Self>`) and zero LLM access — ideal for external side effects, state transformations, and limit-error recovery paths.

<!-- snippet-context
import { Workflow, WorkflowFinish, WorkflowStart, route, start } from "agboss";
import { seconds } from "agboss/units";
// @snippet
@WorkflowStart({ name: "settlement-workflow-start", description: "Start", input: OrderDto })
export class SettlementStart {}
@WorkflowFinish({ name: "settlement-workflow-finish", description: "Finish", output: ReceiptDto })
export class SettlementFinish {}
@Workflow({
  name: "settlement-workflow",
  version: "1.0.0",
  flow: [
    start(SettlementStart)
      .returns(OrderDto)
      .toParallelAgents(FraudAnalystAgent, SecondaryFraudAgent)
      .acceptedBy(LowRiskArbiter)
      .joinQuorum({ min: 1, deadline: seconds(10) })
      .returns(listOf(RiskScoreDto))
      .toRouter(SettlementRouter)
      .chooseOne(
        route(CapturePaymentAction)
          .returns(ReceiptDto)
          .toFinish(SettlementFinish),
        route(DirectCaptureAction)
          .returns(ReceiptDto)
          .toFinish(SettlementFinish),
      ),
  ],
})
export class SettlementWorkflow {}
-->
```ts title="src/settlement/settlement.components.ts" file=src/settlement/settlement.components.ts
import {
  Action,
  Agent,
  Arbiter,
  DecidedBy,
  OnAnswer,
  Router,
  listOf,
  type ActionHandler,
  type InputOf,
  type OutputOf,
  type Route,
  type RouterHandler,
} from "agboss";
import { Integer, Text } from "agboss/dto";

export class OrderDto {
  @Text()
  orderId!: string;

  @Integer({ min: 1 })
  amountCents!: number;
}

export class RiskScoreDto {
  @Integer({ min: 0, max: 100 })
  score!: number;
}

export class ReceiptDto {
  @Text()
  txId!: string;
}

@Agent({
  name: "fraud-analyst-agent",
  description: "Evaluates order risk from signals",
  prompt: "Score the fraud risk of the order from 0 to 100.",
  model: "moonshotai/kimi-k2.6",
  input: { order: OrderDto },
  output: RiskScoreDto,
})
export class FraudAnalystAgent {}

@Agent({
  name: "secondary-fraud-agent",
  description: "Independent backup fraud model for quorum consensus",
  prompt: "Score the fraud risk of the order from 0 to 100.",
  model: "moonshotai/kimi-k2.6",
  input: { order: OrderDto },
  output: RiskScoreDto,
})
export class SecondaryFraudAgent {}

@Arbiter({
  name: "low-risk-arbiter",
  decidedBy: DecidedBy.Code,
})
export class LowRiskArbiter {
  @OnAnswer(FraudAnalystAgent)
  fromFraudAnalyst(answer: RiskScoreDto): boolean {
    return answer.score < 25;
  }

  @OnAnswer(SecondaryFraudAgent)
  fromSecondaryFraud(answer: RiskScoreDto): boolean {
    return answer.score < 25;
  }
}

@Action({
  name: "capture-payment-action",
  description: "Captures payment deterministically after fraud quorum",
  input: { order: OrderDto, risks: listOf(RiskScoreDto) },
  output: ReceiptDto,
})
export class CapturePaymentAction implements ActionHandler<CapturePaymentAction> {
  execute(
    input: InputOf<CapturePaymentAction>,
  ): Promise<OutputOf<CapturePaymentAction>> {
    return Promise.resolve({
      txId: `tx_${input.order.value.orderId}_${String(input.risks[0]?.value.score ?? 0)}`,
    });
  }
}

@Action({
  name: "direct-capture-action",
  description: "Captures low-value order directly without invoking an LLM",
  input: { order: OrderDto },
  output: ReceiptDto,
})
export class DirectCaptureAction implements ActionHandler<DirectCaptureAction> {
  execute(
    input: InputOf<DirectCaptureAction>,
  ): Promise<OutputOf<DirectCaptureAction>> {
    return Promise.resolve({
      txId: `tx_${input.order.value.orderId}`,
    });
  }
}

@Router({
  name: "settlement-router",
  description: "Routes high-value orders to fraud analysis before capture",
  decidedBy: DecidedBy.Code,
  input: { order: OrderDto },
  routes: [{ target: CapturePaymentAction }, { target: DirectCaptureAction }],
})
export class SettlementRouter implements RouterHandler<SettlementRouter> {
  route(input: InputOf<SettlementRouter>): Route<SettlementRouter> {
    return input.order.value.amountCents > 100_000
      ? CapturePaymentAction
      : DirectCaptureAction;
  }
}
```

```ts title="test/settlement.components.test.ts" file=test/settlement.components.test.ts
import { expect, it } from "vitest";
import { testAction, testArbiter, testRouter } from "agboss/testing";
import {
  CapturePaymentAction,
  DirectCaptureAction,
  FraudAnalystAgent,
  LowRiskArbiter,
  SettlementRouter,
  SettlementStart,
} from "../src/settlement/settlement.components.js";

it("verifies segregated @Arbiter, @Router, and @Action roles in isolation", async () => {
  const runArbiter = testArbiter(LowRiskArbiter);
  const verdict = await runArbiter(FraudAnalystAgent, { score: 12 });
  expect(verdict.output).toBe(true);

  const runRouter = testRouter(SettlementRouter);
  const { output: selectedRoute } = await runRouter({
    order: {
      value: { orderId: "ORD-9", amountCents: 250_000 },
      producer: SettlementStart,
    },
  });
  expect(selectedRoute).toBe(CapturePaymentAction);

  const runAction = testAction(DirectCaptureAction);
  const { output } = await runAction({
    order: {
      value: { orderId: "ORD-1", amountCents: 5_000 },
      producer: SettlementStart,
    },
  });
  expect(output).toEqual({ txId: "tx_ORD-1" });
});
```

---

## 2. Path-Scoped SSA Dataflow & Provenance

In a graph with hundreds of nodes, branches, and review loops, a shared mutable state object (`Annotation.Root`) makes it impossible to know at compile time whether `state.draft` was actually populated on *every* path reaching `SendOfferAction`, or whether `state.approval` still holds a stale verdict from iteration #1 after `EditorAgent` produced draft v2.

AGBoss models workflow state using **Static Single Assignment (SSA) dominance** and **explicit artifact provenance** ([Path Scope](/concepts/path-scope/)):

1. **Dominator Availability & Chained Outputs (`[input.missing-on-path]`, `[input.never-produced]`, `[flow.unused-output]`):** Every step consumes and returns narrow immutable `@Dto` payloads. Multiple outputs of a step or join are declared strictly by chaining `.returns(DtoA).returns(DtoB)` (never multi-argument `.returns(A, B)`). A step can declare `input: { draft: OfferDraftDto }` only if `OfferDraftDto` is guaranteed to be produced on *every* incoming path that can reach that step (unless wrapped in `optional(OfferDraftDto)`), and every `.returns(Dto)` must be consumed downstream.
2. **Artifact Provenance (`{ about }` & `[input.outdated-on-path]`, `[launch.branch-outdates-sibling]`):** Provenance `{ about: TargetDto | [DtoA, DtoB] }` is declared on a single output `.returns(CritiqueDto, { about: PlanDto })` or on a specific union branch `caseOf(ChangesRequestedDto, { about: OfferDraftDto })` (never on `.returns(oneOf(...))` and never as a positional function). When `EditorAgent` produces a new `OfferDraftDto`, all prior DTOs that were `{ about: OfferDraftDto }` automatically cascade into `outdatedValues`.
3. **Loop Iteration Versioning (`historyOf`):** Steps that inspect prior loop iterations declare `historyOf(OfferDraftDto, { limit?: number })` in `input` to receive `{ current, previous: [...] }` (legacy string tags `{ as: "before" }` do not exist).
4. **Compiler-Generated Narrowed Producer Types (`.agboss/types.d.ts`):** Running `npx agboss check` analyzes every `@Workflow` and writes `.agboss/types.d.ts`. Code nodes that read from Path Scope (`@Action`, `DecidedBy.Code` `@Router`, and `FinishHandler` `@WorkflowFinish`) receive `Produced<Dto, ProducerUnion>` (`{ value: Dto, producer: typeof StepA | typeof StepB }`), whereas fixed-source handlers (`@OnAnswer(Agent)`, `ToolHandler.run`, `ChannelAsk.value`, `ReplyInterpreterHandler.interpret({ ask, reply })`) receive the bare DTO directly.

---

## 3. Canonical Topology Isomorphism

When multiple engineers and coding agents edit a large workflow graph, structural consistency is critical. AGBoss enforces a **canonical 1-to-1 isomorphism** between the directed graph topology and the TypeScript source code in `*.workflow.ts`:

- **Single incoming edge (`in-degree = 1`):** The step **must** be chained inline (`.toAgent(Next)`). Splitting a single-incoming-edge node into a separate top-level `flow` entry is rejected by `agboss check` (`[flow.single-entry-own-path]`).
- **Convergence node (`in-degree >= 2`):** When two or more branches converge on the same node (such as a review loop target or post-branch merge), that node **must** be declared as a top-level entry (`agent(Node)` / `router(Node)` / `action(Node)` / `workflow(Child)`) in the `flow: [...]` array (`[flow.shared-node-inline]`).
- **One chained call per line (`@stylistic/newline-per-chained-call`):** Every builder call (`start()`, `.returns()`, `.toAgent()`, `.switch()`, `.toFinish()`) occupies its own line.
- **Bounded inline depth (`[flow.path-too-deep]`) & `ThisWorkflow` soft stop:** Inline branch nesting is capped at depth $\le 4$ (`[flow.path-too-deep]`); deeper sub-flows are decomposed into a child [`@Workflow`](/reference/workflow/) (`.toWorkflow(ChildWorkflow)`). For self-recursive workflows (`ThisWorkflow`), reaching `depth === maxDepth` softly strips recursive variants from the model's JSON Schema (warming at most two KV-cache prefixes: `depth < maxDepth` and `depth === maxDepth`) without crashing the branch.

---

## 4. Prompt Prefix Cache Invariance & Boundary PII

In multi-turn and tool-calling agents, prompt tokens dominate LLM spend. Modern model providers cache the **KV prefix** of a request, cutting input token cost and time-to-first-token by up to 80–90% — *provided the prefix remains byte-for-byte identical across turns*.

Two common mistakes destroy KV prefix caching in production:
1. Interpolating per-request user inputs (`{{input.query}}`) directly into the system prompt.
2. Masking PII with random per-request UUIDs (`<email:uuid-v4>`), which mutates historical messages on every turn.

AGBoss enforces **Prompt Prefix Cache Invariance** across a two-part byte-stable prefix (Part 1: static system prompt + deterministically sorted `@Tool` schemas and output `@Dto` JSON Schemas; Part 2: completed `threadId` turns):
- **Static System Prompts (`[prompt.input-in-instructions]`):** `agboss check` verifies every prompt template (`prompt` and `promptUrls`). System instructions may only interpolate static [`AppEnvironment`](/concepts/application/) variables (never `{{input.*}}`); dynamic step inputs are appended strictly in the user/turn message frame.
- **Deterministic HMAC-SHA256 Pseudonymization ([`@PiiPolicy`](/reference/pii-policy/)):** `@PiiPolicy` classes and `sensitive: PiiAction.replaceWithToken()` on `@Dto` fields hash each sensitive match with `@Application({ pseudonymKey })` (`secret("PII_PSEUDONYM_KEY")`). The email `jane@acme.com` always maps to the exact same token (`<email:7f3a91>`) across turns, preserving 100% of your KV prefix cache, while AGBoss transparently restores `jane@acme.com` inside `@Tool` arguments before calling your database or API.

---

## 5. Transactional LIFO Sagas & Idempotent Execution

Multi-agent workflows frequently perform external side effects across multiple steps (reserving inventory, creating a provisional ATS offer, posting an approval message). If a later step fails, a parallel branch triggers `FailurePolicy.FailFast`, a quorum cancels slower branches as `BranchVerdict.Surplus`, or a [`@Budget`](/reference/budget/) cap trips, those external writes must be unwound cleanly.

AGBoss provides three layered guarantees:
- **Deterministic Step Idempotency (`this.executionContext.step.idempotencyKey`):** [`ExecutionContext`](/concepts/application/) provides a deterministic key (`${executionId}:${nodeId}:${visitNumber}[:${itemIndex}][:${callId}]`) and end-to-end `signal` that remain stable across crash-recovery sweeps and retries, allowing external APIs to deduplicate retried calls safely.
- **Declarative `@Action` Sagas & Static Verification:** Side-effecting `@Action` nodes declare `@Action({ compensateWith: UndoAction, committedBy?: CommitAction })`. `agboss check` statically verifies saga completeness and ordering across all paths via `[flow.uncompensated-action]`, `[flow.uncommitted-action]`, `[flow.compensation-out-of-order]`, and `[action.committer-without-compensator]`. At runtime, open saga records are automatically unwound in **reverse completion order (LIFO)** on `app.cancel`, `FailurePolicy.FailFast`, `BranchVerdict.Surplus`, `BudgetExceededError`, or `join` failure, with crash recovery of incomplete rollbacks persisted under `@agboss/unwinding`.
- **Zero-Model Limit Recovery (`[graph.limit-handler-uses-model]`):** When a `.onError()` handler catches `LimitExceededError` (`BudgetExceededError`, `StepsLimitExceededError`, `VisitsLimitExceededError`, `DepthLimitExceededError`) or base `AGBossError`, invoking an `@Agent` or `DecidedBy.Model` `@Router` is statically forbidden — only free deterministic `@Action` and `@WorkflowFinish` nodes are permitted.

---

## 6. Zero-Leakage DI & 4-Stage Infrastructure Scaling

AGBoss eliminates global singletons and string-token DI magic. Every infrastructure service is wired inside [`@Application({ providers })`](/concepts/application/) by **class inheritance** (`SqliteCheckpointSaver extends CheckpointSaver`; passing a class to `provide(Class, instance)` is rejected by `[di.instance-provider]`) and managed through four deterministic lifecycle phases (`OnInit -> OnStart -> OnStop -> OnDestroy`). During `await app.close()`, the container first drains in-flight steps within the `shutdownTimeout` budget before running `onDestroy` and releasing active leases.

Because infrastructure is injected by contract, the exact same `@Workflow` and `@Agent` classes scale across **4 operational stages** without changing a single line of business logic:

1. **Stage 1 — Local Dev & Isolated Tests:** Default `InMemory*` stores, [`testWith(App, { instances: 2 })`](/guides/testing-agents/), `VirtualClock`, `TestConcurrency.inOrder([step(A), step(B)])`, and the 8 unit runners (`testTool`, `testAction`, `testRouter`, `testArbiter`, `testRag`, `testJudge`, `testPii`, `testGuardrail`).
2. **Stage 2 — Single-Node Durable Production (`node:sqlite` WAL):** Drop in the 7 built-in zero-dependency `Sqlite*` providers (`SqliteCheckpointSaver`, `SqliteExecutionRecordRepository`, `SqlitePausedExecutionRepository`, `SqliteCostLedgerRepository`, `SqliteExecutionLeaseRepository`, `SqliteExecutionTreeRepository`, `SqliteRateLimitRepository`) for crash-safe persistence and two-phase [`app.resume()`](/guides/channels-and-pauses/).
3. **Stage 3 — Multi-Pod Cluster & Kubernetes Probes:** Horizontal worker replicas coordinate via 30-second execution-tree leases (`ExecutionLeaseRepository`, `ExecutionLeaseLostError` aborting lost steps mid-tool-loop), 30-second orphan recovery sweeps, `maxConcurrentSteps` and `maxInstanceConcurrency` backpressure, and [`@HealthCheck`](/reference/health-check/) probes (`await app.checkLiveness()`, `await app.checkReadiness()`).
4. **Stage 4 — Custom Enterprise Backends (Postgres / Redis):** Subclass any of the 7 repository contracts (`export class PostgresCheckpointSaver extends CheckpointSaver`) and register it in `@Application({ providers })`.

---

## 7. Progressive Crystallization & Universal Coding Skills

An agentic workflow should not remain 100% stochastic forever. Early in a product's lifecycle, engineers use [`DecidedBy.Model`](/reference/router/) routers and flexible multi-tool [`@Agent`](/reference/agent/) loops to handle ambiguous real-world inputs. As production traffic accumulates, stabilized **Desire Paths** emerge.

AGBoss is designed for **[Progressive Crystallization](/concepts/progressive-crystallization/)**:
- `npx agboss describe --json` exports the complete static revision snapshot of your application, including content-addressed `configHash` (workflow topology), `promptHash` (per-agent/router prompt), and `schemaHash` (per-DTO schema) for every node.
- Correlating this snapshot with `ExecutionRecord` and spans in Langfuse / OpenTelemetry exposes settled paths so you can crystallize `DecidedBy.Model` $\to$ `DecidedBy.Code`, repetitive `@Tool` chains $\to$ `@Action`, and `ChannelOutcome.awaitReply()` $\to$ `ChannelOutcome.decided(...)` without changing neighbor contracts in the graph.
- Using **[`AGENTS.md` and the 13 offline-synced skill modules](/concepts/ai-coding-skills/)**, an engineer can instruct Codex, Cursor, Windsurf, Copilot, or Claude Code to perform this crystallization and immediately prove equivalence on golden datasets via `npx agboss compare`.
