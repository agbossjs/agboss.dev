---
title: Contexts & Authorization
description: Understand the three-level AGBoss context hierarchy (ApplicationContext, TenantContext, ExecutionContext), ownerId/tenantId authorization, and step idempotency keys.
---

AGBoss strictly separates **domain state** (DTOs carried in the Path Scope and persisted in checkpoints) from **runtime identity and metadata** (injected via three hierarchical context classes). Exactly three context tokens exist — `ApplicationContext`, `TenantContext`, and `ExecutionContext` — forming a parent-linked chain inspired by Spring's context hierarchy.

## How the three context levels are structured

Each level links upward to its parent, so a component injecting `ExecutionContext` can reach `executionContext.tenant` and `executionContext.tenant.application`, and `ApplicationContext.environment` provides typed access to the application's environment contract:

| Context Class | Lifecycle Scope | Key Properties | Typical Consumers |
| :--- | :--- | :--- | :--- |
| `ApplicationContext` | Singleton per booted `App` instance | `name`, `version`, `instanceId`, `startedAt`, `environmentName`, `environment`, `host` (`hostname`, `pid`, `platform`, `runtimeVersion`) | Startup `@Injectable` services, `@Budget` (`Application` scope), observers |
| `TenantContext` | Per organization / tenant | `tenantId` (`"default"` when omitted), `weight` (positive integer for fair `@ModelProvider` queuing), `application`, plus custom subclass fields | `@Budget` (`Tenant` scope), tenant-aware services |
| `ExecutionContext` | Per workflow execution pass | `executionId`, `threadId`, `ownerId`, `tenant`, `signal` (`AbortSignal`), `workflow`, `step` (`nodeId`, `visitNumber`, `idempotencyKey`, `callId`, `itemIndex`, `copyNumber`) | `@Tool`, `@Action`, `@Router`, `@Arbiter`, `@Judge`, `@Guardrail`, `@Channel` |

```ts title="src/config/support-contexts.ts" no-check: reference example
import { ExecutionContext, TenantContext, Tool, type ToolHandler } from "agboss";
import { Integer, Text } from "agboss/dto";

export class SupportTenantContext extends TenantContext {
  @Text()
  planTier!: string;

  @Integer()
  monthlyQuotaCents!: number;
}

export class SupportExecutionContext extends ExecutionContext<SupportTenantContext> {
  @Text()
  requestTraceId!: string;
}

@Tool({
  name: "issue_credit",
  description: "Issues a tenant-scoped credit using ExecutionContext idempotencyKey",
  input: CreditRequestDto,
  output: CreditReceiptDto,
  deps: [SupportExecutionContext],
})
export class IssueCreditTool implements ToolHandler<CreditRequestDto, CreditReceiptDto> {
  constructor(private readonly ctx: SupportExecutionContext) {}

  async run(input: CreditRequestDto): Promise<CreditReceiptDto> {
    this.ctx.signal.throwIfAborted();
    return {
      receiptId: `cr_${this.ctx.step.idempotencyKey}`,
      tenantId: this.ctx.tenant.tenantId,
      planTier: this.ctx.tenant.planTier,
      traceId: this.ctx.requestTraceId,
      amountCents: input.amountCents,
    };
  }
}
```

```ts title="src/support.application.ts" no-check: reference example
import { Application } from "agboss";
import { AppEnvironment } from "./environments/app.environment.js";
import { SupportTenantContext, SupportExecutionContext } from "./config/support-contexts.js";
import { SupportWorkflow } from "./workflows/support.workflow.js";

@Application({
  name: "support-application",
  version: "1.0.0",
  environment: AppEnvironment,
  tenantContext: SupportTenantContext,
  executionContext: SupportExecutionContext,
  workflows: [SupportWorkflow],
})
export class SupportApplication {}
```

```ts title="test/support-contexts.test.ts" no-check: reference example
import { expect, it } from "vitest";
import { testTool } from "agboss/testing";
import { IssueCreditTool } from "../src/config/support-contexts.js";

it("injects custom TenantContext and ExecutionContext fields into tools", async () => {
  const res = await testTool(
    IssueCreditTool,
    { amountCents: 25 },
    {
      tenant: { tenantId: "acme", weight: 4, planTier: "enterprise", monthlyQuotaCents: 50 },
      context: { requestTraceId: "req_9" },
    },
  );
  expect(res.output.planTier).toBe("enterprise");
});
```

## How `tenantId` and `ownerId` authorization protects threads and pauses

When an execution starts with `tenant: { tenantId: "acme" }` and `ownerId: "user-42"`, AGBoss records ownership on the thread and every pause record:

- **Cross-tenant isolation:** Calling `app.execute`, `app.resume`, or `app.cancel` with a mismatched `tenantId` throws `UnauthorizedExecutionAccessError` and fires `OnExecutionRejected` before loading any checkpoint state.
- **Owner vs. channel responder:** A user-owned thread (`ownerId`) can only be continued or cancelled by that `ownerId`, while out-of-process `@Channel` approvals record `answeredBy` in the audit trail.
