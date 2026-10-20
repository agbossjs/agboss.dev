---
title: Testing Workflows & Units
description: Test multi-agent workflows and individual components deterministically with agboss/testing — testWith(Application), mockLlm, override, decideWith, TestConcurrency, and 8 unit runners.
---

Testing agent systems in CI should never require live LLM API keys, flaky network calls, or real wall-clock waiting. The `agboss/testing` entry provides a two-tier testing architecture: `testWith(Application)` for full workflow integration tests on a `VirtualClock` with scripted model replies and blocked network calls, plus eight dedicated unit runners for testing individual components in isolation.

## How to test full workflows with `testWith(Application)`

`testWith(Application)` boots your real `@Application` container and infrastructure in each test while scripting model turns via `mockLlm`, action calls via `mockAction`, tool failures via `mockTool`, and service methods via `mockOf`. Parallel branches run one at a time in deterministic order by default (`TestConcurrency.Sequential`), or in a specified completion order using `TestConcurrency.inOrder([step(A), step(B)])`:

<!-- snippet-context
import { ExecutionCancelledError, Injectable, type JudgeHandler, type JudgeInput, type JudgeVerdict } from "agboss";
import { Text } from "agboss/dto";
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
declare class GroundedJudge implements JudgeHandler {
  judge(input: JudgeInput): Promise<JudgeVerdict>;
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
import { decideWith, override, replyWith, testJudge, testTool, testWith, waitFor } from "agboss/testing";
import { seconds, usd } from "agboss/units";

const test = testWith(OfferApplication);

test("reviewer asks for changes, then approves", async ({ app, mockLlm, mockAction }) => {
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
  expect(mockLlm(ReviewerAgent)).toHaveReturned(
    ChangesRequestedDto,
    { notes: "shorter" },
  );
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

  const { output } = await runJudge({
    task: "Find TS jobs",
    reply: "…",
    attempt: 0,
  });

  expect(output.passed).toBe(true);
});
```

```ts title="src/support.workflow.ts" no-check: context tab
import { Agent, Application, Tool, Workflow, WorkflowFinish, WorkflowStart, start } from "agboss";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "agboss/dto";

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

All workflow and unit runners integrate directly with [Vitest](https://vitest.dev/) and standard Node.js test suites with zero external network dependencies.

## What are the 8 unit runners in `agboss/testing`?

When testing a single component's logic — such as a PII policy, a tool's service call, or an arbiter's quorum voting — use the dedicated unit runner for that component type. Each runner builds a minimal container with `overrides: [override(Base, Subclass)]` and returns `{ output, spend }`:

| Unit Runner | Target Component | What It Validates |
| :--- | :--- | :--- |
| `testTool(ToolClass, opts?)` | `@Tool` | Input/output DTO validation, `deps` injection, timeouts, and `run(input)` result |
| `testAction(ActionClass, opts?)` | `@Action` | Deterministic step logic, `SpendRecorder` entries, and `run(input)` output |
| `testRouter(RouterClass, opts?)` | `@Router` | Model or code route selection (`DecidedBy.Model` / `DecidedBy.Code`) |
| `testArbiter(ArbiterClass, opts?)` | `@Arbiter` | Quorum answer acceptance across `@OnAnswer(Agent)` or model criteria |
| `testRag(RagClass, opts?)` | `@Rag` | `retrieve(query, { topK, signal })` results and reported `rag:<name>` spend |
| `testJudge(JudgeClass, opts?)` | `@Judge` | Quality gate `judge({ reply, task, attempt })` with `decideWith` or `replyWith` |
| `testPii(Policies, opts?)` | `@PiiPolicy` | Assembly rule checks, `mask(text)` token generation, and `reveal(text)` restoration |
| `testGuardrail(GuardrailClass, opts?)` | `@Guardrail` | Boundary hook execution (`beforeToolCall`, `afterToolCall`, `beforeAgentAnswer`) |

## Recorded VCR cassettes (`VCRMode`)

Instead of hand-written scripts, `testWith(Application, { vcr: { cassetteName: "onboarding" } })` can record real model calls once to `__snapshots__/onboarding.cassette.json` (`VCRMode.AUTO` locally) and replay them deterministically in milliseconds in CI (`VCRMode.REPLAY`).
