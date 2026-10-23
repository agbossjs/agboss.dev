---
title: "Loop 0–1: Deterministic Harness, 10 Unit Runners & VCR Lock"
description: "Verify Graph & Mesh Contracts in Loop 0 (agboss check --federation) and Harness Code in Loop 1 (npm test) for $0 in seconds using agboss/testing — testWith(Application), 10 isolated unit runners, VirtualClock, TestConcurrency.inOrder, ModelFailure chaos, and [vcr.stale-cassette] hash locks."
---

In the AGBoss [5-Loop Cost & Determinism Verification Funnel](/concepts/verification-funnel/), **Loop 0 (`$ agboss check --federation`, `< 1s`, `$0`)** proves graph topology and cross-service mesh contracts at compile time, while **Loop 1 (`npm test`, `~3s`, `$0`)** tests your entire TypeScript harness (`@Action`, `@Tool`, `@ToolInterceptor`, `DecidedBy.Code` `@Router` and `@Arbiter`, `@PiiPolicy`, `@Compaction`, queues, retries, and LIFO sagas) without calling a live LLM. Together, `agboss/testing` provides `testWith(Application)` on a deterministic `VirtualClock`, ten isolated component runners, `ModelFailure` chaos injection, and VCR cassettes locked to [Loop 2 live PR evals](/guides/evaluation-and-profiles/) via `promptHash` and `schemaHash` (`[vcr.stale-cassette]`).

---

## How do Loop 0 (`agboss check`) and Loop 1 (`npm test`) fit into the 5-Loop Funnel?

| Loop | Command | Latency & Cost | Objects Verified | Lock to Next Loop |
| :--- | :--- | :--- | :--- | :--- |
| **Loop 0: Static Proof** | `$ agboss check --federation` | `< 1s` · **`$0`** (every save & first CI step) | **Object 1 (Topology & Mesh Contracts):** Path Scope dominance (`[input.missing-on-path]`), `{ about }` staleness (`[input.outdated-on-path]`), LIFO saga compensations (`[flow.uncompensated-action]`), and Agent Mesh schemas | Emits `.agboss/types.d.ts` required for Loop 1 |
| **Loop 1: Deterministic Harness & Chaos** | `npm test` (`agboss/testing` + VCR) | `~3s` · **`$0`** (every commit; no live LLM) | **Object 2 (Harness Code):** 10 unit runners, full-graph `testWith(App)` with `mockLlm`, `ModelFailure` chaos (`429`, timeouts, truncated JSON), `TestConcurrency.inOrder`, and multi-pod `{ instances: 2 }` leases | **`[vcr.stale-cassette]`** (`promptHash` + `schemaHash`) triggers [Loop 2 PR Smoke Gate](/guides/evaluation-and-profiles/) whenever a prompt or DTO schema changes |

---

## Complete example: `testWith(Application)`, `testTool` & `testJudge`

`testWith(Application)` boots your real `@Application` container and infrastructure in each test while scripting model turns via `mockLlm`, action calls via `mockAction`, tool failures via `mockTool`, and service methods via `mockOf`:

<!-- snippet-context
import { Tool, WorkflowFinish, WorkflowStart, type ToolHandler } from "agboss";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "agboss/dto";
@Tool({ name: "lookup_order", description: "Looks up order", input: WorkflowStartTextDto, output: WorkflowFinishTextDto })
export class LookupOrderTool implements ToolHandler<WorkflowStartTextDto, WorkflowFinishTextDto> {
  run({ text }: WorkflowStartTextDto): Promise<WorkflowFinishTextDto> { return Promise.resolve({ text }); }
}
@WorkflowStart({ name: "support-workflow-start", description: "Start", input: WorkflowStartTextDto })
export class SupportWorkflowStart {}
@WorkflowFinish({ name: "support-workflow-finish", description: "Finish", output: WorkflowFinishTextDto })
export class SupportWorkflowFinish {}
// @snippet
-->
```ts title="src/support.workflow.ts" file=src/support.workflow.ts
import { Agent, Workflow, start } from "agboss";

@Agent({
  name: "support-agent",
  description: "Answers support questions using LookupOrderTool",
  model: "moonshotai/kimi-k2.6",
  prompt: "Look up the order and answer the customer.",
  tools: [LookupOrderTool],
})
export class SupportAgent {}

@Workflow({
  name: "support-workflow",
  version: "1.0.0",
  flow: [
    start(SupportWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toAgent(SupportAgent)
      .toFinish(SupportWorkflowFinish),
  ],
})
export class SupportWorkflow {}
```

<!-- snippet-context
import { ExecutionCancelledError, Injectable, type JudgeHandler, type JudgeInput, type JudgeVerdict } from "agboss";
import { PlainTextDto, Text } from "agboss/dto";
export class ChangesRequestedDto {
  @Text({ prompt: "what to change" })
  notes!: string;
}
export class DraftApprovedDto {}
declare class OfferApplication {}
declare class OfferWorkflowStart {}
declare class ReviewerAgent {}
declare class EditorAgent {}
declare class SendOfferAction {}
declare class SearchJobsTool {
  run(input: { readonly query: string }): Promise<{ readonly jobs: string }>;
}
declare class GroundedJudge implements JudgeHandler<PlainTextDto> {
  judge(input: JudgeInput<PlainTextDto>): Promise<JudgeVerdict>;
}
@Injectable()
export class JobBoardService {
  search(query: string): Promise<readonly string[]> {
    return Promise.resolve([query]);
  }
}
@Injectable()
export class FakeJobBoardService extends JobBoardService {}
declare const shortlist: never;
-->
```ts title="test/support.workflow.test.ts"
import { expect, it } from "vitest";
import {
  decideWith,
  override,
  replyWith,
  testJudge,
  testTool,
  testWith,
  waitFor,
} from "agboss/testing";
import { seconds, usd } from "agboss/units";

const test = testWith(OfferApplication);

test("reviewer asks for changes, then approves", async ({
  app,
  mockLlm,
  mockAction,
}) => {
  mockLlm(ReviewerAgent)
    .when({ draft: { text: "v1" } })
    .thenReturn(replyWith(ChangesRequestedDto, { notes: "shorter" }));
  mockLlm(ReviewerAgent)
    .when({ draft: { text: "v2" } })
    .thenReturn(
      waitFor(seconds(1)),
      replyWith(DraftApprovedDto, {}, { cost: usd(0.01) }),
    );
  mockLlm(EditorAgent).thenReturn(replyWith("v2"));

  await app.execute(OfferWorkflowStart, shortlist);

  expect(mockLlm(ReviewerAgent)).toHaveBeenCalledTimes(2);
  expect(mockLlm(ReviewerAgent)).toHaveReturned(ChangesRequestedDto, {
    notes: "shorter",
  });
  expect(mockAction(SendOfferAction)).toHaveBeenCalledWith({
    draft: { text: "v2" },
  });
});

it("searches the board it is given in isolation", async () => {
  const runSearch = testTool(SearchJobsTool, {
    overrides: [override(JobBoardService, FakeJobBoardService)],
  });

  const { output, spend } = await runSearch(
    { query: "TS" },
    { timeout: seconds(1) },
  );

  expect(output.jobs).toContain("TS");
  expect(spend.totalUsd).toBe(0);
});

it("a grounded reply passes the decision judge", async () => {
  const runJudge = testJudge(GroundedJudge, {
    model: decideWith({ grounded: 0.9 }),
  });

  const reply = { text: "Acme hires TS engineers [acme.example]" };
  const { output } = await runJudge({
    variant: PlainTextDto,
    reply,
    task: "Find TS jobs",
    attempt: 0,
  });

  expect(output.passed).toBe(true);
});
```

---

## Core principles of testing AGBoss applications

1. **Test your graph code in `npm test`, and test prompt behavior in Evals:**
   A scripted `mockLlm(Agent)` reply proves that **your workflow graph, DTO contracts, error edges, and compensators** behave deterministically given any sequence of model decisions. Never assert what a real LLM "would answer" inside a unit test; instead, assert what your step **sent** to the model (`mockLlm(Agent).requests`, `toHaveBeenAskedWith`) and use [Evals & Golden Sets](/guides/evaluation-and-profiles/) (`agboss eval`, `agboss compare`) to evaluate prompt changes on real models.
2. **Deterministic parallel ordering (`TestConcurrency`):**
   Parallel branches (`.toParallelAgents()`, `.toParallelWorkflows()`) run one at a time in declaration order by default (`TestConcurrency.Sequential`). To reproduce a specific parallel race or quorum arrival order without flaky `setTimeout` sleeps, pass `concurrency: TestConcurrency.inOrder([step(FastAgent), step(SlowAgent)])` to `testWith`.
3. **Zero wall-clock waits (`VirtualClock`):**
   Every timeout (`seconds(10)`), quorum `deadline`, retry backoff, and 30-second execution lease runs on the test's shared `clock` (`VirtualClock`). Calling `await clock.advance(seconds(31))` lets started steps reach their next wait point and advances virtual time instantaneously.
4. **Multi-instance cluster testing (`{ instances: 2 }`):**
   Passing `testWith(App, { instances: 2 })` boots two independent application containers (`apps[0]` and `apps[1]`) sharing the same stores and `VirtualClock` so you can test cross-pod `app.resume()`, `app.cancel()`, and 30-second lease recovery in milliseconds.

---

## All 10 isolated unit runners in `agboss/testing`

When testing a single component's logic — such as a PII policy, a tool interceptor, a custom compaction handler, or an arbiter's quorum voting — use the dedicated unit runner for that component type. Each runner builds a minimal container with `overrides: [override(Base, Subclass)]` and returns `{ output, spend }`:

| Unit Runner | Target Component | What It Validates |
| :--- | :--- | :--- |
| `testTool(ToolClass, opts?)` | [`@Tool`](/reference/tool/) | Input/output DTO validation, `deps` injection, timeouts (`clock.advance`), and `run(input)` result |
| `testToolInterceptor(InterceptorClass, opts?)` | [`@ToolInterceptor`](/reference/tool-interceptor/) | `beforeToolCall(ToolClass, input)` (`ToolCallDecision`) and `afterToolCall(ToolClass, input, output)` DTO-validated transformation |
| `testAction(ActionClass, opts?)` | [`@Action`](/reference/action/) | Deterministic step logic, `SpendRecorder` entries, and `execute(input)` output |
| `testRouter(RouterClass, opts?)` | [`@Router`](/reference/router/) | Model or code route selection (`DecidedBy.Model` with `routeTo` / `DecidedBy.Code`) |
| `testArbiter(ArbiterClass, opts?)` | [`@Arbiter`](/reference/arbiter/) | Quorum answer acceptance across `@OnAnswer(Agent)` or `decideWith` model criteria |
| `testRag(RagClass, opts?)` | [`@Rag`](/reference/rag/) | `retrieve(query, { topK, signal })` results and reported `rag:<name>` spend |
| `testJudge(JudgeClass, opts?)` | [`@Judge`](/reference/judge/) | Quality gate `judge({ reply, task, attempt, toolCalls })` with `decideWith`, `replyWith`, or `DecidedBy.Code` |
| `testCompaction(CompactionClass, opts?)` | [`@Compaction`](/reference/compaction/) | Single-step memory compaction (`CompactionInput` $\to$ `{ summaries, requests }`) across `SummaryQueue`, `SingleSummary`, or `CompactionStrategy.Custom`, verifying that critical constraints are passed and preserved |
| `testPii(Policies, opts?)` | [`@PiiPolicy`](/reference/pii-policy/) | Assembly rule checks, `mask(text)` token generation, and `reveal(text)` restoration |
| `testGuardrail(GuardrailClass, opts?)` | [`@InputGuardrail` / `@OutputGuardrail`](/reference/guardrail/) | Pre-model and post-model safety refusal checks (`DecidedBy.Model` with `decideWith` or `DecidedBy.Code` with `GuardrailHandler`) |

---

## Tool-Call Trajectories (`ToolCallRecord`), Order-Independent Matchers & Silent Failure Detection

### Why you should never test a rigid sequence of tool calls

In an agentic tool loop, an LLM often has two or more independent lookup tools (for example, `GetOrderTool` and `CheckPolicyTool`). Whether the model calls `GetOrderTool` before `CheckPolicyTool`, calls `CheckPolicyTool` first, or calls both in the same turn is an irrelevant execution detail. Asserting `calls[0] === "get_order" && calls[1] === "check_policy"` creates brittle tests that break whenever a model update reorders independent lookups.

Instead, AGBoss verifies **trajectory invariants** over sets and argument predicates:

- **`expect(result).toHaveCalledTools([GetOrderTool, CheckPolicyTool])`:** Verifies the **required tool set** — every listed tool was called at least once, regardless of call order.
- **`expect(result).not.toHaveCalledTools([DeleteOrderTool])`:** Verifies the **forbidden tool set** — none of the listed tools were invoked at any point in the execution.
- **`expect(result).toHaveToolCallMatching(GetOrderTool, (input) => input.orderId === "555")`:** Verifies **argument invariants** (accepts either a predicate `(input) => boolean` or a partial object `{ orderId: "555" }`).
- **`StepRecord.toolCalls` & `JudgeInput.toolCalls` (`ReadonlyArray<ToolCallRecord>`):** Every `ExecutionOutput`, `StepRecord`, and `JudgeInput<TReply>` carries the full `readonly toolCalls: readonly ToolCallRecord[]` trajectory (narrowable by tool via `toolCallsOf(GetOrderTool, input.toolCalls)`). This allows a `@Judge` to catch **"silent failures"** inside the agent loop — such as an agent calling `GetOrderTool` on another customer's order (`orderId: "999"`), reading their private data into context, and then answering the current customer (`orderId: "555"`) politely.

---

## Chaos & Invalid-Turn Scripting (`callToolWithInvalidArguments`, `replyWithInvalidAnswer`, `ModelFailure`)

Real language models occasionally emit malformed JSON, truncated tool arguments, schema-violating answers, or HTTP `429` / timeout failures. `agboss/testing` lets you script these exact faults in `Loop 1` (`$0`) to prove your harness self-corrects:

- **`callToolWithInvalidArguments(ToolClass, invalidFields)`:** Scripts a tool call whose arguments violate the tool's input `@Dto` (`ToolCallStatus.InvalidArguments`), verifying that the agent loop feeds the validation error back to the model and succeeds on the next turn.
- **`callToolWithTruncatedArguments(ToolClass, partialArgs)`:** Simulates a tool call cut off mid-stream (`maxOutputTokens` truncation) so you can verify retry recovery.
- **`replyWithInvalidAnswer(DtoClass, invalidFields)`:** Scripts an invalid structured final answer, incrementing `step.validationAttempts` on the `StepRecord` and throwing `AgentAnswerInvalidError` once retries are exhausted.
- **`failWith(ModelFailure.RateLimited)` / `Timeout` / `ServerError` / `NetworkError`:** Simulates transport-level provider failures to test retry backoff on `VirtualClock` and `.onError()` workflow recovery edges.
- **`a2aServer({ start, callerResolver })`:** Boots an in-process loopback HTTP server for your `@Application` inside `testWith` so you can test `A2AClient` calls, `A2ACallerResolver` `401`/`403` rejections (`A2ACallerRejectedError`), and signed `MeshEnvelope` propagation without opening external sockets.

<!-- snippet-context
import { DecidedBy, Judge, JudgeVerdict, Tool, ToolCallStatus, toolCallsOf, type JudgeHandler, type JudgeInput, type ToolHandler } from "agboss";
import { Text } from "agboss/dto";
export class OrderIdDto {
  @Text({ prompt: "Order ID" })
  orderId!: string;
}
@Tool({ name: "get-order-tool", description: "Gets order", input: OrderIdDto, output: OrderIdDto })
export class GetOrderTool implements ToolHandler<OrderIdDto, OrderIdDto> {
  run(input: OrderIdDto): Promise<OrderIdDto> { return Promise.resolve(input); }
}
@Tool({ name: "check-policy-tool", description: "Checks policy", input: OrderIdDto, output: OrderIdDto })
export class CheckPolicyTool implements ToolHandler<OrderIdDto, OrderIdDto> {
  run(input: OrderIdDto): Promise<OrderIdDto> { return Promise.resolve(input); }
}
@Tool({ name: "delete-order-tool", description: "Deletes order", input: OrderIdDto, output: OrderIdDto })
export class DeleteOrderTool implements ToolHandler<OrderIdDto, OrderIdDto> {
  run(input: OrderIdDto): Promise<OrderIdDto> { return Promise.resolve(input); }
}
declare class SupportTestApp {}
declare class OrderSupportStart {}
declare class OrderSupportAgent {}
declare const orderStartInput: never;
-->
```ts title="test/trajectory-and-chaos.test.ts"
import { expect } from "vitest";
import {
  callTool,
  callToolWithInvalidArguments,
  replyWith,
  replyWithInvalidAnswer,
  testWith,
} from "agboss/testing";

// Code @Judge inspecting JudgeInput.toolCalls to catch silent cross-order reads:
@Judge({
  name: "no-cross-order-read-judge",
  description: "Fails if the agent inspected any order other than 555 during its tool loop",
  decidedBy: DecidedBy.Code,
  reply: OrderIdDto,
})
export class NoCrossOrderReadJudge implements JudgeHandler<OrderIdDto> {
  judge(input: JudgeInput<OrderIdDto>): Promise<JudgeVerdict> {
    const orderCalls = toolCallsOf(GetOrderTool, input.toolCalls);
    const leaked = orderCalls.some(
      (call) => call.status === ToolCallStatus.Succeeded && call.input.orderId !== "555",
    );
    return Promise.resolve(
      leaked
        ? JudgeVerdict.failed({ reason: "Agent read an unauthorized order ID during tool loop." })
        : JudgeVerdict.passed(),
    );
  }
}

const test = testWith(SupportTestApp);

test("verifies trajectory invariants and self-correction after invalid tool args & answer", async ({
  app,
  mockLlm,
}) => {
  mockLlm(OrderSupportAgent).thenReturn(
    callToolWithInvalidArguments(GetOrderTool, { orderId: 12345 }),
    callTool(CheckPolicyTool, { orderId: "555" }),
    callTool(GetOrderTool, { orderId: "555" }),
    replyWithInvalidAnswer(OrderIdDto, { orderId: null }),
    replyWith(OrderIdDto, { orderId: "555" }),
  );

  const result = await app.execute(OrderSupportStart, orderStartInput);

  expect(result).toHaveCalledTools([GetOrderTool, CheckPolicyTool]);
  expect(result).not.toHaveCalledTools([DeleteOrderTool]);
  expect(result).toHaveToolCallMatching(GetOrderTool, (input) => input.orderId === "555");
});
```

---

## Recorded VCR Cassettes & Stale-Cassette Guard (`[vcr.stale-cassette]`)

Between scripted unit tests and live evaluation sits **VCR recording**: `testWith(Application, { vcr: { cassetteName: "onboarding", mode: process.env.CI ? VCRMode.REPLAY : VCRMode.AUTO } })` records real model calls once to `__snapshots__/onboarding.cassette.json` and replays them deterministically in milliseconds in CI (`VCRMode.REPLAY`).

Each recorded cassette (version 2) embeds the component's **`promptHash`** and **`schemaHash`**. If an engineer or coding agent edits an `@Agent`'s prompt or changes a `@Dto` / `@Tool` schema:

1. **`npx agboss check --cassettes` (in Loop 0) and `VCRMode.REPLAY` (in Loop 1)** fail immediately with `StaleCassetteError` (**`[vcr.stale-cassette]`**, reporting `CassetteChange.Prompt`, `Schema`, or `Removed`) instead of silently passing against an outdated prompt snapshot.
2. **Surgical re-recording (`VCRMode.RECORD_STALE`):** Run `AGBOSS_VCR_MODE=RECORD_STALE npm test` to replay all unchanged steps from the cassette while re-recording **only** the components whose `promptHash` or `schemaHash` changed, then trigger [Loop 2 (`agboss eval run`)](/guides/evaluation-and-profiles/) to verify the updated behavior.
