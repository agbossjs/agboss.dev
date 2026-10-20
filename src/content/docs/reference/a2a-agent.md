---
title: "@A2AAgent"
description: Complete API reference for the @A2AAgent decorator in AGBoss — Agent-to-Agent (A2A) protocol clients, A2AClient, and remote workflow delegation.
---

The `@A2AAgent` decorator (`a2a/*.a2a.ts`) defines a typed client for a remote agent or workflow exposed over the Agent-to-Agent (A2A) HTTP protocol. An `@A2AAgent` class extends `A2AClient`, is registered in `@Workflow({ providers: [RemoteAgent] })`, and can be injected into any `@Tool` or `@Action` via constructor DI (`deps: [RemoteAgent]`).

## What options does `@A2AAgent` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique identifier for the remote A2A peer (`"billing-specialist-a2a"`). |
| `url` | `string` | Yes | Base URL of the remote A2A endpoint (`"https://billing.internal.example.com/a2a"`); calls `<url>/execute`. |
| `deps` | `readonly Token[]` | No | Constructor dependencies (`AppEnvironment`, `ExecutionContext`, or `@Injectable` auth services) verified against constructor parameters. |

## Complete `@A2AAgent` example with `@Action` delegation

```ts title="src/a2a/billing-specialist.a2a-agent.ts" no-check: reference example
import { A2AAgent, Action, ExecutionContext, type ActionHandler, type InputOf, type OutputOf } from "agboss";
import { A2AClient } from "agboss/a2a";
import { Text } from "agboss/dto";

export class TaxAuditInputDto {
  @Text({ prompt: "Invoice ID to audit" })
  invoiceId!: string;
}

export class TaxAuditOutputDto {
  @Text({ prompt: "Remote tax compliance verdict" })
  verdict!: string;
}

// 1. Declare the remote @A2AAgent client (registered in @Workflow({ providers: [RemoteTaxAuditorA2A] })):
@A2AAgent({
  name: "remote-tax-auditor-a2a",
  url: "https://tax-agent.internal.acme.com/a2a",
})
export class RemoteTaxAuditorA2A extends A2AClient {}

// 2. Inject RemoteTaxAuditorA2A into an @Action or @Tool:
@Action({
  name: "delegate-tax-audit-action",
  description: "Delegates invoice tax verification to the remote A2A tax auditor service",
  input: {
    auditRequest: TaxAuditInputDto,
  },
  output: TaxAuditOutputDto,
  deps: [RemoteTaxAuditorA2A, ExecutionContext],
})
export class DelegateTaxAuditAction implements ActionHandler<DelegateTaxAuditAction> {
  constructor(
    private readonly remoteTaxAuditor: RemoteTaxAuditorA2A,
    private readonly executionContext: ExecutionContext,
  ) {}

  async execute(input: InputOf<DelegateTaxAuditAction>): Promise<OutputOf<DelegateTaxAuditAction>> {
    const response = await this.remoteTaxAuditor.execute({
      input: `Audit invoice ${input.auditRequest.invoiceId}`,
      threadId: this.executionContext.threadId,
      signal: this.executionContext.signal,
    });
    return {
      verdict: response.output,
    };
  }
}
```

```ts title="src/workflows/support-escalation.workflow.ts" no-check: reference example
import { Workflow, start } from "agboss";
import { WorkflowStartTextDto, WorkflowFinishTextDto } from "agboss/dto";
import { BillingSpecialistA2AAgent, DelegateToBillingAction } from "../a2a/billing-specialist.a2a-agent.js";

@Workflow({
  name: "support-escalation-workflow",
  version: "1.0.0",
  flow: [
    start(EscalationStart)
      .returns(WorkflowStartTextDto)
      .toAction(DelegateToBillingAction)
      .toFinish(EscalationFinish),
  ],
})
export class SupportEscalationWorkflow {}
```

```ts title="test/billing-specialist.a2a.test.ts" no-check: reference example
import { expect, it } from "vitest";
import { override, testAction } from "agboss/testing";
import { A2AClient } from "agboss/a2a";
import { DelegateToBillingAction } from "../src/a2a/billing-specialist.a2a-agent.js";

class FakeA2AClient extends A2AClient {
  override async send() {
    return { status: "completed", text: "Invoice #9102 credited." };
  }
}

it("delegates billing task to remote A2A agent deterministically", async () => {
  const res = await testAction(
    DelegateToBillingAction,
    { question: { text: "Refund invoice #9102" } },
    { overrides: [override(A2AClient, FakeA2AClient)] },
  );
  expect(res.output.answer).toContain("Invoice #9102");
});
```

## What related entities work with `@A2AAgent`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `A2AClient` | `"agboss/a2a"` | Base class extended by `@A2AAgent` classes; provides `execute()` and streaming `stream()` over the A2A protocol. |
| `A2ARequestSchema`, `A2AResponseSchema`, `A2AEventSchema` | `"agboss/a2a"` | Wire-format schemas validating requests, responses, and streaming SSE events between A2A peers. |
| `override(RemoteA2AClass, FakeA2AClass)` | `"agboss/testing"` | Replaces a remote `@A2AAgent` client with a deterministic local stub in `testWith()`, `testAction()`, or `testTool()`. |
