---
title: "@Guardrail"
description: Complete API reference for the @Guardrail decorator in AGBoss — beforeToolCall, afterToolCall, onChannelDecision, beforeAgentAnswer hooks, and testGuardrail().
---

The `@Guardrail` decorator (`guardrails/*.guardrail.ts`) defines a programmable policy interceptor that inspects and validates tool calls, channel approval decisions, and agent answers at runtime. Guardrails can be attached at the `@Workflow`, `@Agent`, or `@Tool` level, receive constructor dependencies via `deps: [...]`, and can either mutate tool arguments (`{ overrideArguments }`) or throw to block execution.

## What options and lifecycle hooks does `@Guardrail` support?

| Option / Hook | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique kebab-case identifier for the guardrail (`"sql-read-only-guardrail"`). |
| `deps` | `readonly Token[]` | No | Constructor dependencies (`ExecutionContext`, `TenantContext`, `@Injectable` services). |
| `beforeToolCall?(ctx)` | `(ctx: GuardrailContext) => Promise<void \| { overrideArguments?: unknown }>` | No | Runs before a tool executes; can throw to block the call or return `{ overrideArguments }` to sanitize inputs. |
| `afterToolCall?(ctx)` | `(ctx: GuardrailContext) => Promise<void>` | No | Runs after a tool returns; can inspect results and throw to abort if sensitive or invalid data was returned. |
| `onChannelDecision?(decision, ctx)` | `(decision: unknown, ctx: GuardrailContext) => Promise<void \| { overrideArguments?: unknown }>` | No | Runs when a human channel decision arrives before the paused tool runs. |
| `beforeAgentAnswer?(ctx)` | `(ctx: GuardrailContext) => Promise<void>` | No | Runs on the agent's final reply (`ctx.replyWith`) before the node completes. |

## Complete `@Guardrail` example with all hooks

```ts title="src/guardrails/refund-safety.guardrail.ts" no-check: reference example
import { ExecutionContext, Guardrail, type GuardrailContext } from "agboss";
import { TenantPolicyService } from "../services/tenant-policy.service.js";

@Guardrail({
  name: "refund-safety-guardrail",
  deps: [ExecutionContext, TenantPolicyService],
})
export class RefundSafetyGuardrail implements Guardrail {
  constructor(
    private readonly executionContext: ExecutionContext,
    private readonly policyService: TenantPolicyService,
  ) {}

  async beforeToolCall(ctx: GuardrailContext): Promise<void | { overrideArguments?: unknown }> {
    const maxCents = await this.policyService.maxRefundCents(this.executionContext.ownerId);
    if (ctx.call?.name === "refund_card_payment" && ctx.call.args.amountCents > maxCents) {
      throw new Error(`Refund ${String(ctx.call.args.amountCents)}c exceeds policy limit ${String(maxCents)}c`);
    }
  }

  async onChannelDecision(
    decision: { approved: boolean; maxOverrideCents?: number },
    ctx: GuardrailContext,
  ): Promise<void | { overrideArguments?: unknown }> {
    if (decision.approved && decision.maxOverrideCents !== undefined) {
      return {
        overrideArguments: {
          ...ctx.call?.args,
          amountCents: decision.maxOverrideCents,
        },
      };
    }
  }

  async beforeAgentAnswer(ctx: GuardrailContext): Promise<void> {
    if (ctx.replyWith?.includes("INTERNAL_SECRET")) {
      throw new Error("Blocked internal secret leakage in agent answer");
    }
  }
}
```

```ts title="src/services/tenant-policy.service.ts" no-check: reference example
import { Injectable } from "agboss";

@Injectable()
export class TenantPolicyService {
  maxRefundCents(tenantId = "default"): number {
    return tenantId === "enterprise" ? 100_000 : 25_000;
  }
}
```

```ts title="src/workflows/refund.workflow.ts" no-check: reference example
import { Workflow, start } from "agboss";
import { RefundSafetyGuardrail } from "../guardrails/refund-safety.guardrail.js";

@Workflow({
  name: "refund-workflow",
  version: "1.0.0",
  guardrails: [RefundSafetyGuardrail],
  flow: [
    start(RefundStart)
      .toAgent(RefundAgent)
      .toFinish(RefundFinish),
  ],
})
export class RefundWorkflow {}
```

## What related entities work with `@Guardrail`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `Guardrail` & `GuardrailContext` | `"agboss"` | Interface implemented by `@Guardrail` classes and context object (`{ agent, call, replyWith, runId }`). |
| `overrideGuardrails` & `disableGuardrails` | `@Agent` / `@Tool` options | Allows an individual agent or tool to replace or disable specific workflow-level guardrails. |
| `GuardrailBlockedError` | `"agboss"` | Error thrown when a workflow guard or guardrail rejects an input or output. |
| `testGuardrail(GuardrailClass, options?)` | `"agboss/testing"` | Isolated unit runner that tests `beforeToolCall`, `afterToolCall`, `onChannelDecision`, and `beforeAgentAnswer` with DI overrides. |

### Unit-testing a `@Guardrail` with `testGuardrail`

```ts title="test/refund-safety.guardrail.test.ts" no-check: reference example
import { expect, it } from "vitest";
import { override, testGuardrail } from "agboss/testing";
import { RefundSafetyGuardrail } from "./refund-safety.guardrail.js";
import { TenantPolicyService } from "../services/tenant-policy.service.js";

class StrictPolicyService extends TenantPolicyService {
  override async maxRefundCents(): Promise<number> {
    return 10_000;
  }
}

it("blocks tool calls exceeding the tenant policy ceiling", async () => {
  const guardrail = testGuardrail(RefundSafetyGuardrail, {
    overrides: [override(TenantPolicyService, StrictPolicyService)],
  });

  await expect(
    guardrail.beforeToolCall({
      agent: "refund-agent",
      call: { name: "refund_card_payment", args: { orderId: "ORD-1", amountCents: 25_000 } },
    }),
  ).rejects.toThrow("exceeds policy limit");
});
```

```ts title="src/agents/refund.agent.ts" no-check: reference example
import { Agent } from "agboss";
import { RefundSafetyGuardrail } from "../guardrails/refund-safety.guardrail.js";

@Agent({
  name: "refund-agent",
  description: "Processes customer refund requests within guardrail limits",
  model: "moonshotai/kimi-k2.6",
  prompt: "Verify eligibility before issuing a refund.",
  guardrails: [RefundSafetyGuardrail],
})
export class RefundAgent {}
```
