---
title: "@WorkflowFinish"
description: Complete API reference for the @WorkflowFinish decorator in AGBoss — pass-through finishes, FinishHandler<Self> transformations, and DI support.
---

The `@WorkflowFinish` decorator defines a terminal node (`workflow-finishes/*.workflow-finish.ts`) where a `@Workflow` path completes and returns a typed `output` DTO to the caller of `app.execute()` (or to a parent workflow calling `.toWorkflow(Child)`). A finish can be a **pass-through** (returning the latest `output` DTO already in Path Scope) or a **handled finish** implementing `FinishHandler<Self>` to assemble its `output` from multiple scoped DTOs and injected services.

## What options does `@WorkflowFinish` accept?

Every `@WorkflowFinish` class name ends with `WorkflowFinish` and its `name` option ends with `-workflow-finish`:

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier ending with `-workflow-finish` (e.g., `"offer-sent-workflow-finish"`). |
| `description` | `string` | Yes | Description of this terminal outcome; also used by `agboss describe` and studio visualizations. |
| `output` | `DtoClass` | Yes | The DTO class returned in `result.output` when execution ends at this finish node. |
| `input` | `InputFields` | No | Map of DTOs read from Path Scope. When omitted, the finish is a pass-through; when set, the class must implement `FinishHandler<Self>`. |
| `deps` | `readonly Token[]` | No | Constructor dependencies (`ExecutionContext`, `Clock`, `@Injectable` services) injected into a handled finish. |

## Complete `@WorkflowFinish` examples (pass-through and `FinishHandler`)

```ts title="src/workflow-finishes/offer-package.workflow-finish.ts" no-check: reference example
import { Clock, ExecutionContext, WorkflowFinish, listOf, optional, type FinishHandler, type InputOf, type OutputOf } from "agboss";
import { Boolean, Integer, Text, WorkflowFinishTextDto } from "agboss/dto";

export class OfferDraftDto {
  @Text({ prompt: "Final approved offer letter text" })
  letterText!: string;
}

export class AuditVerdictDto {
  @Text({ prompt: "Auditor name" })
  auditor!: string;
}

export class OfferSummaryDto {
  @Text({ prompt: "Execution ID for audit trail" })
  executionId!: string;

  @Text({ prompt: "Approved offer letter" })
  letterText!: string;

  @Integer({ prompt: "Number of audit sign-offs collected" })
  signOffCount!: number;

  @Text({ prompt: "ISO timestamp when the workflow finished" })
  completedAt!: string;
}

// 1. Pass-through finish (no input option, no finish() method — passes WorkflowFinishTextDto through):
@WorkflowFinish({
  name: "chat-reply-workflow-finish",
  description: "Returns the agent's text reply directly to the caller",
  output: WorkflowFinishTextDto,
})
export class ChatReplyWorkflowFinish {}

// 2. Handled finish (declares input + deps and implements FinishHandler<Self>):
@WorkflowFinish({
  name: "offer-summary-workflow-finish",
  description: "Assembles the final offer summary from the approved draft and quorum verdicts",
  input: {
    draft: OfferDraftDto,
    verdicts: listOf(AuditVerdictDto),
  },
  output: OfferSummaryDto,
  deps: [ExecutionContext, Clock],
})
export class OfferSummaryWorkflowFinish implements FinishHandler<OfferSummaryWorkflowFinish> {
  constructor(
    private readonly executionContext: ExecutionContext,
    private readonly clock: Clock,
  ) {}

  finish(
    input: InputOf<OfferSummaryWorkflowFinish>,
  ): OutputOf<OfferSummaryWorkflowFinish> {
    return {
      executionId: this.executionContext.executionId,
      letterText: input.draft.letterText,
      signOffCount: input.verdicts.length,
      completedAt: this.clock.now().toISOString(),
    };
  }
}
```

```ts title="src/workflows/offer-package.workflow.ts" no-check: reference example
import { Workflow, start } from "agboss";
import { OfferPackageWorkflowFinish, OfferDraftDto } from "../workflow-finishes/offer-package.workflow-finish.js";

@Workflow({
  name: "offer-package-workflow",
  version: "1.0.0",
  flow: [
    start(OfferStart)
      .toAgent(OfferDrafterAgent)
      .returns(OfferDraftDto)
      .toFinish(OfferPackageWorkflowFinish),
  ],
})
export class OfferPackageWorkflow {}
```

```ts title="test/offer-package.workflow-finish.test.ts" no-check: reference example
import { expect } from "vitest";
import { replyWith, testWith } from "agboss/testing";
import { OfferApplication } from "../src/offer.application.js";
import { OfferDraftDto } from "../src/workflow-finishes/offer-package.workflow-finish.js";

const test = testWith(OfferApplication);

test("assemblers final OfferPackageDto in OfferPackageWorkflowFinish", async ({ app, mockLlm }) => {
  mockLlm(OfferDrafterAgent).thenReturn(
    replyWith(OfferDraftDto, { title: "Staff Engineer", salaryUsd: 225_000 }),
  );
  const res = await app.execute(OfferStart, { text: "Prepare Staff Engineer offer" });
  expect(res.isFinished()).toBe(true);
});
```

## What related entities work with `@WorkflowFinish`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `FinishHandler<Self>` | `"agboss"` | Interface implemented by `@WorkflowFinish` classes that declare `input` (`finish(input): OutputOf<Self> \| Promise<OutputOf<Self>>`). |
| `WorkflowFinishTextDto` | `"agboss/dto"` | Standard built-in output DTO (`{ text: string }`) for text-returning workflows. |
| `.toFinish(FinishClass)` | Flow chain | Terminates a path in `@Workflow({ flow })` after the compiler verifies `FinishClass`'s required DTOs exist on the path. |
| `result.finish` & `result.output` | `"agboss"` | On `ExecutionStatus.Finished`, `result.finish.name` identifies which `@WorkflowFinish` ended the run and `result.output` holds the validated DTO. |
