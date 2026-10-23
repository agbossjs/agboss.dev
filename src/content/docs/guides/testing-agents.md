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
| `testTool(ToolClass, opts?)` | [`@Tool`](/reference/tool/) | Input/output DTO validation, `deps` injection, timeouts, and `run(input)` result |
| `testToolInterceptor(InterceptorClass, opts?)` | [`@ToolInterceptor`](/reference/tool-interceptor/) | `before(call)` (`ToolCallDecision`) and `after(call)` output transformation with DI `overrides` |
| `testAction(ActionClass, opts?)` | [`@Action`](/reference/action/) | Deterministic step logic, `SpendRecorder` entries, and `execute(input)` output |
| `testRouter(RouterClass, opts?)` | [`@Router`](/reference/router/) | Model or code route selection (`DecidedBy.Model` / `DecidedBy.Code`) |
| `testArbiter(ArbiterClass, opts?)` | [`@Arbiter`](/reference/arbiter/) | Quorum answer acceptance across `@OnAnswer(Agent)` or model criteria |
| `testRag(RagClass, opts?)` | [`@Rag`](/reference/rag/) | `retrieve(query, { topK, signal })` results and reported `rag:<name>` spend |
| `testJudge(JudgeClass, opts?)` | [`@Judge`](/reference/judge/) | Quality gate `judge({ reply, task, attempt, toolCalls })` with `decideWith`, `replyWith`, or `DecidedBy.Code` |
| `testCompaction(CompactionClass, opts?)` | [`@Compaction`](/reference/compaction/) | `CompactionStrategy.SummaryQueue`, `SingleSummary`, or `Custom` (`CompactionHandler.compact(input)`) |
| `testPii(Policies, opts?)` | [`@PiiPolicy`](/reference/pii-policy/) | Assembly rule checks, `mask(text)` token generation, and `reveal(text)` restoration |
| `testGuardrail(GuardrailClass, opts?)` | [`@InputGuardrail` / `@OutputGuardrail`](/reference/guardrail/) | Pre-model and post-model safety refusal checks (`DecidedBy.Model` with `decideWith` or `DecidedBy.Code`) |

---

## Tool-Call Trajectories (`ToolCallRecord`) & Trajectory Matchers

Every `ExecutionOutput` (`result.toolCalls`) and `ExecutionRecord` (`result.record.toolCalls`) includes the ordered list of `ToolCallRecord` entries (`{ tool, callId, input, output, isError, isResultTruncated }`) produced during the execution. In Vitest tests, `agboss/testing` registers first-class trajectory matchers and schema-violation fault injectors:

- **`expect(result).toHaveCalledTools([GetOrderTool, CheckPolicyTool])`:** Asserts the ordered sequence of tools invoked by the execution.
- **`expect(result).not.toHaveCalledTools([DeleteOrderTool])`:** Asserts that a forbidden tool was never called on any step.
- **`expect(result).toHaveToolCallMatching(GetOrderTool, { orderId: "ORD-42" })`:** Asserts that at least one call to `GetOrderTool` matched the partial input or predicate `(input, output) => boolean`.
- **`failWith(ModelFailure.InvalidOutput)` & `failWith(ModelFailure.InvalidToolArguments)`:** Simulates truncated JSON or schema-violating tool arguments from an LLM so you can test retry and `.onError()` recovery paths deterministically.

---

## Recorded VCR Cassettes & Stale-Cassette Guard (`[vcr.stale-cassette]`)

Between scripted unit tests and live evaluation sits **VCR recording**: `testWith(Application, { vcr: { cassetteName: "onboarding" } })` records real model calls once to `__snapshots__/onboarding.cassette.json` (`VcrMode.Auto` locally) and replays them deterministically in milliseconds in CI (`VcrMode.Replay`).

Each recorded cassette entry embeds the step's **`promptHash`** and **`schemaHash`**. If an engineer or coding agent edits an `@Agent`'s prompt or changes a `@Dto` / `@Tool` schema without re-recording the cassette, `VcrMode.Replay` (and `$ agboss check --cassettes tests/cassettes`) fails immediately with **`[vcr.stale-cassette]`** instead of silently passing against an outdated prompt snapshot.
