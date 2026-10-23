---
title: Testing Workflows & the 10 Unit Runners
description: Test multi-agent workflows and components deterministically with agboss/testing — testWith(Application), mockLlm, tool trajectory matchers (toHaveCalledTools, toHaveToolCallMatching), TestConcurrency.inOrder, VirtualClock, VCR stale-cassette checks, and 10 isolated unit runners.
---

Testing agent systems in CI should never require live LLM API keys, flaky network calls, or real wall-clock waiting. The `agboss/testing` entry provides a deterministic testing architecture: `testWith(Application)` for full workflow integration tests on a `VirtualClock` with scripted model replies, tool-call trajectory assertions (`toHaveCalledTools`, `toHaveToolCallMatching`), and blocked network calls, plus ten dedicated unit runners for testing individual components in isolation.

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
