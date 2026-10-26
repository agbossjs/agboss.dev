---
title: "@WorkflowFinish"
description: Complete API reference for the @WorkflowFinish decorator in AGBoss — pass-through finishes, FinishHandler<Self> transformations, and DI support.
---

The `@WorkflowFinish` decorator defines a terminal node (`workflows/<workflow-name>/<finish-name>.workflow-finish.ts`) where a `@Workflow` path completes and returns a typed `output` DTO to the caller of `app.execute()` (or to a parent workflow calling `.toWorkflow(Child)`). A finish can be a **pass-through** (returning the latest `output` DTO already in Path Scope) or a **handled finish** implementing `FinishHandler<Self>` to assemble its `output` from multiple scoped DTOs and injected services.

## Complete `@WorkflowFinish` examples (pass-through and `FinishHandler`)

```ts title="src/workflows/offer-package/offer-package.workflow-finish.ts" file=src/workflows/offer-package/offer-package.workflow-finish.ts
import {
  Clock,
  ExecutionContext,
  WorkflowFinish,
  listOf,
  type FinishHandler,
  type InputOf,
  type OutputOf,
} from "@agboss/core";
import { Integer, Text, WorkflowFinishTextDto } from "@agboss/core/dto";

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
    // Single-value inputs in InputOf<Self> are wrapped in Produced<Dto, Producer> ({ value, producer }):
    return {
      executionId: this.executionContext.executionId,
      letterText: input.draft.value.letterText,
      signOffCount: input.verdicts.length,
      completedAt: this.clock.now().toISOString(),
    };
  }
}
```

```ts title="src/workflows/offer-package/offer-package.workflow.ts" file=src/workflows/offer-package/offer-package.workflow.ts
import { Agent, Workflow, WorkflowStart, listOf, start } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";
import {
  AuditVerdictDto,
  OfferDraftDto,
  OfferSummaryWorkflowFinish,
} from "./offer-package.workflow-finish.js";

@WorkflowStart({
  name: "offer-workflow-start",
  description: "Starts offer workflow",
  input: WorkflowStartTextDto,
})
export class OfferStart {}

@Agent({
  name: "offer-drafter-agent",
  description: "Drafts offer letter",
  model: "moonshotai/kimi-k2.6",
  prompt: "Draft the offer letter.",
  input: { req: WorkflowStartTextDto },
  output: OfferDraftDto,
})
export class OfferDrafterAgent {}

@Agent({
  name: "offer-auditor-agent",
  description: "Audits offer letter",
  model: "moonshotai/kimi-k2.6",
  prompt: "Audit the offer letter.",
  input: { draft: OfferDraftDto },
  output: listOf(AuditVerdictDto),
})
export class OfferAuditorAgent {}

@Workflow({
  name: "offer-package-workflow",
  version: "1.0.0",
  flow: [
    start(OfferStart)
      .returns(WorkflowStartTextDto)
      .toAgent(OfferDrafterAgent)
      .returns(OfferDraftDto)
      .toAgent(OfferAuditorAgent)
      .returns(listOf(AuditVerdictDto))
      .toFinish(OfferSummaryWorkflowFinish),
  ],
})
export class OfferPackageWorkflow {}
```

<!--
```ts file=src/offer.application.ts
import { Application, Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, type BudgetHandler } from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";
import { OfferPackageWorkflow } from "./workflows/offer-package/offer-package.workflow.js";

@Budget({ name: "wf-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class WfAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(20); } }
@Budget({ name: "wf-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class WfTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "wf-exec-budget", scope: BudgetScope.Execution })
export class WfExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "offer-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [OfferPackageWorkflow],
  budgets: [WfAppBudget, WfTenantBudget, WfExecBudget],
})
export class OfferApplication {}
```
-->

```ts title="test/offer-package.workflow-finish.test.ts" file=test/offer-package.workflow-finish.test.ts
import { expect } from "vitest";
import { ExecutionStatus } from "@agboss/core";
import { replyWith, testWith } from "@agboss/core/testing";
import { OfferApplication } from "../src/offer.application.js";
import {
  AuditVerdictDto,
  OfferDraftDto,
} from "../src/workflows/offer-package/offer-package.workflow-finish.js";
import {
  OfferAuditorAgent,
  OfferDrafterAgent,
  OfferStart,
} from "../src/workflows/offer-package/offer-package.workflow.js";

const test = testWith(OfferApplication);

test("assembles final OfferSummaryDto in OfferSummaryWorkflowFinish", async ({ app, mockLlm }) => {
  mockLlm(OfferDrafterAgent).thenReturn(
    replyWith(OfferDraftDto, { letterText: "Welcome to Acme as Staff Engineer!" }),
  );
  mockLlm(OfferAuditorAgent).thenReturn(
    replyWith(AuditVerdictDto, [{ auditor: "comp-committee" }]),
  );
  const res = await app.execute(OfferStart, { text: "Prepare Staff Engineer offer" });
  expect(res.status).toBe(ExecutionStatus.Finished);
});
```

## What options does `@WorkflowFinish` accept?

Every `@WorkflowFinish` class name ends with `WorkflowFinish` and its `name` option ends with `-workflow-finish`:

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier ending with `-workflow-finish` (e.g., `"offer-sent-workflow-finish"`). |
| `description` | `string` | Yes | Description of this terminal outcome; also used by `agboss describe` and studio visualizations. |
| `output` | `DtoClass` | Yes | The DTO class returned in `result.output` when execution ends at this finish node. |
| `input` | `InputFields` | No | Map of DTOs read from Path Scope. When omitted, the finish is a pass-through; when set, the class must implement `FinishHandler<Self>`. |
| `deps` | `readonly Token[]` | No | Constructor dependencies (`ExecutionContext`, `Clock`, `@Injectable` services) injected into a handled finish. |

## What related entities work with `@WorkflowFinish`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `FinishHandler<Self>` | `"@agboss/core"` | Interface implemented by `@WorkflowFinish` classes that declare `input` (`finish(input): OutputOf<Self> \| Promise<OutputOf<Self>>`). |
| `WorkflowFinishTextDto` | `"@agboss/core/dto"` | Standard built-in output DTO (`{ text: string }`) for text-returning workflows. |
| `.toFinish(FinishClass)` | Flow chain | Terminates a path in `@Workflow({ flow })` after the compiler verifies `FinishClass`'s required DTOs exist on the path. |
| `result.finish` & `result.output` | `"@agboss/core"` | On `ExecutionStatus.Finished`, `result.finish.name` identifies which `@WorkflowFinish` ended the run and `result.output` holds the validated DTO. |
