---
title: "@A2AAgent & @A2AExpose"
description: Complete API reference for @A2AAgent, @A2AExpose, a2aHttpListener, A2ACaller, and the Agent Mesh Envelope in agboss/a2a.
---

The `@A2AAgent` and `@A2AExpose` decorators (`"agboss/a2a"`) provide both sides of the Agent-to-Agent (A2A) protocol in AGBoss:
- **`@A2AAgent`** (`a2a/*.a2a.ts`) defines a typed client (`extends A2AClient<TIn, TOut>`) for a remote A2A workflow or agent, registered in `@Workflow({ providers: [RemoteA2AAgent] })` and injected into any `@Tool` or `@Action` via `deps: [RemoteA2AAgent]`.
- **`@A2AExpose`** (`a2a/*.expose.ts`) declares which [`@WorkflowStart`](/reference/workflow-start/) entry points an `@Application({ exposes: [MyA2AExpose] })` exports over HTTP via `a2aHttpListener({ app, expose, base, callerOf })`.

## Complete `@A2AAgent`, `@A2AExpose` & `a2aHttpListener` example

```ts title="src/a2a/billing-specialist.a2a-agent.ts" file=src/a2a/billing-specialist.a2a-agent.ts
import {
  Action,
  ExecutionContext,
  type ActionHandler,
  type InputOf,
  type OutputOf,
} from "agboss";
import { A2AAgent, A2AClient } from "agboss/a2a";
import { Text } from "agboss/dto";

export class TaxAuditInputDto {
  @Text({ prompt: "Invoice ID to audit" })
  invoiceId!: string;
}

export class TaxAuditOutputDto {
  @Text({ prompt: "Remote tax compliance verdict" })
  verdict!: string;
}

// 1. Declare the remote @A2AAgent client (registered in @Workflow({ providers: [RemoteTaxAuditorA2AAgent] })):
@A2AAgent({
  name: "remote-tax-auditor-a2a-agent",
  url: "https://tax-agent.internal.acme.com/a2a",
})
export class RemoteTaxAuditorA2AAgent extends A2AClient {}

// 2. Inject RemoteTaxAuditorA2AAgent into an @Action or @Tool:
@Action({
  name: "delegate-tax-audit-action",
  description: "Delegates invoice tax verification to the remote A2A tax auditor service",
  input: {
    auditRequest: TaxAuditInputDto,
  },
  output: TaxAuditOutputDto,
  deps: [RemoteTaxAuditorA2AAgent, ExecutionContext],
})
export class DelegateTaxAuditAction implements ActionHandler<DelegateTaxAuditAction> {
  constructor(
    private readonly remoteTaxAuditor: RemoteTaxAuditorA2AAgent,
    private readonly executionContext: ExecutionContext,
  ) {}

  async execute(input: InputOf<DelegateTaxAuditAction>): Promise<OutputOf<DelegateTaxAuditAction>> {
    return this.remoteTaxAuditor.execute(
      input.auditRequest.value,
      TaxAuditOutputDto,
      { signal: this.executionContext.signal },
    );
  }
}
```

<!--
```ts file=src/a2a/a2a-ambient.d.ts
import type { IncomingMessage, RequestListener } from "node:http";
import type { Class } from "agboss";

declare module "agboss/a2a" {
  export interface A2AExposeOptions {
    readonly name: string;
    readonly version: string;
    readonly exports: readonly Class[];
  }
  export function A2AExpose(options: A2AExposeOptions): ClassDecorator;

  export enum A2ARejection {
    Unauthenticated = "unauthenticated",
    Forbidden = "forbidden",
  }

  export class A2ACaller {
    readonly accepted: boolean;
    static accepted(options: {
      readonly tenant: { readonly id: string; readonly [key: string]: unknown };
      readonly ownerId?: string;
      readonly peer?: string;
    }): A2ACaller;
    static rejected(options: {
      readonly reason: A2ARejection;
      readonly message?: string;
    }): A2ACaller;
  }

  export function a2aHttpListener(options: {
    readonly app: unknown;
    readonly expose?: Class;
    readonly start?: Class;
    readonly base?: string;
    readonly callerOf: (request: IncomingMessage) => Promise<A2ACaller> | A2ACaller;
  }): RequestListener;
}
```
-->

```ts title="src/a2a/tax-auditor.expose.ts" file=src/a2a/tax-auditor.expose.ts
import {
  A2ACaller,
  A2AExpose,
  A2ARejection,
  a2aHttpListener,
} from "agboss/a2a";
import { TaxAuditWorkflowStart } from "../workflows/support-escalation.workflow.js";

// 3. Expose @WorkflowStart entry points on the remote service with @A2AExpose:
@A2AExpose({
  name: "tax-auditor-a2a-expose",
  version: "1.0.0",
  exports: [TaxAuditWorkflowStart],
})
export class TaxAuditorA2AExpose {}

// 4. Multi-tenant HTTP listener resolving tenant, ownerId, and authenticated peer per request:
export function createTaxA2AListener(app: unknown) {
  return a2aHttpListener({
    app,
    expose: TaxAuditorA2AExpose,
    base: "/a2a",
    callerOf: (request) => {
      const tenantId = request.headers["x-tenant-id"];
      if (typeof tenantId !== "string" || tenantId.length === 0) {
        return A2ACaller.rejected({
          reason: A2ARejection.Unauthenticated,
          message: "Missing x-tenant-id header",
        });
      }
      return A2ACaller.accepted({
        tenant: { id: tenantId },
        ownerId:
          typeof request.headers["x-user-id"] === "string"
            ? request.headers["x-user-id"]
            : undefined,
        peer: "support-escalation-application",
      });
    },
  });
}
```

```ts title="src/workflows/support-escalation.workflow.ts" file=src/workflows/support-escalation.workflow.ts
import { Workflow, WorkflowFinish, WorkflowStart, start } from "agboss";
import {
  DelegateTaxAuditAction,
  RemoteTaxAuditorA2AAgent,
  TaxAuditInputDto,
  TaxAuditOutputDto,
} from "../a2a/billing-specialist.a2a-agent.js";

@WorkflowStart({
  name: "tax-audit-workflow-start",
  description: "Starts remote tax audit delegation",
  input: TaxAuditInputDto,
})
export class TaxAuditWorkflowStart {}

@WorkflowFinish({
  name: "tax-audit-workflow-finish",
  description: "Returns remote tax compliance verdict",
  output: TaxAuditOutputDto,
})
export class TaxAuditWorkflowFinish {}

@Workflow({
  name: "support-escalation-workflow",
  version: "1.0.0",
  providers: [RemoteTaxAuditorA2AAgent],
  flow: [
    start(TaxAuditWorkflowStart)
      .returns(TaxAuditInputDto)
      .toAction(DelegateTaxAuditAction)
      .returns(TaxAuditOutputDto)
      .toFinish(TaxAuditWorkflowFinish),
  ],
})
export class SupportEscalationWorkflow {}
```

<!--
```ts file=src/escalation.application.ts
import { Application, Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, type BudgetHandler } from "agboss";
import { usd, type Usd } from "agboss/units";
import { SupportEscalationWorkflow } from "./workflows/support-escalation.workflow.js";

@Budget({ name: "a2a-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class A2AAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(20); } }
@Budget({ name: "a2a-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class A2ATenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "a2a-exec-budget", scope: BudgetScope.Execution })
export class A2AExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }

@Application({
  name: "support-escalation-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [SupportEscalationWorkflow],
  budgets: [A2AAppBudget, A2ATenantBudget, A2AExecBudget],
})
export class SupportEscalationApplication {}
```
-->

```ts title="test/billing-specialist.a2a.test.ts" file=test/billing-specialist.a2a.test.ts
import { expect, it } from "vitest";
import type { DtoClass } from "agboss/dto";
import { override, testAction } from "agboss/testing";
import {
  DelegateTaxAuditAction,
  RemoteTaxAuditorA2AAgent,
} from "../src/a2a/billing-specialist.a2a-agent.js";
import { TaxAuditWorkflowStart } from "../src/workflows/support-escalation.workflow.js";

class FakeTaxAuditorA2AAgent extends RemoteTaxAuditorA2AAgent {
  override execute<T extends object>(_input: unknown, _output: DtoClass<T>): Promise<T> {
    return Promise.resolve({ verdict: "Invoice #INV-9102 compliant." } as unknown as T);
  }
}

it("delegates tax audit task to remote A2A agent deterministically", async () => {
  const runAction = testAction(DelegateTaxAuditAction, {
    overrides: [override(RemoteTaxAuditorA2AAgent, FakeTaxAuditorA2AAgent)],
  });
  const { output } = await runAction({
    auditRequest: {
      producer: TaxAuditWorkflowStart,
      value: { invoiceId: "INV-9102" },
    },
  });
  expect(output.verdict).toContain("INV-9102");
});
```

## What options do `@A2AAgent` and `@A2AExpose` accept?

| Decorator | Option | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `@A2AAgent` | `name` | `string` | **Yes** | Unique kebab-case identifier ending with `-a2a-agent` (class name ending with `A2AAgent`, `[name.kind-suffix]`). |
| `@A2AAgent` | `url` | `string` | **Yes** | Base URL or `AppEnvironment` field name of the remote A2A endpoint (`"https://billing.internal.example.com/a2a"`). |
| `@A2AAgent` | `target` | `{ application: string; start: string }` | No | Remote application and `@WorkflowStart` contract coordinates verified across repositories by `$ agboss check --federation`. |
| `@A2AAgent` | `input` / `output` | `DtoClass` | No | Typed request and response DTO contracts compiled into the application's contract passport (`agboss describe --json`). |
| `@A2AAgent` | `deps` | `readonly Token[]` | No | Constructor dependencies (`ApplicationContext`, `ExecutionContext`, or `@Injectable` auth services). |
| `@A2AExpose` | `name` | `string` | **Yes** | Unique kebab-case identifier ending with `-a2a-expose` (`"tax-auditor-a2a-expose"`). |
| `@A2AExpose` | `version` | `string` | **Yes** | Semantic version of the exposed A2A boundary (`"1.0.0"`). |
| `@A2AExpose` | `exports` | `readonly Class[]` | **Yes** | Array of [`@WorkflowStart`](/reference/workflow-start/) classes exposed over A2A and recorded in `agboss describe --json`. |

## Multi-tenant `a2aHttpListener` & the Agent Mesh Envelope

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `a2aHttpListener({ app, expose, base, callerOf })` | `"agboss/a2a"` | Creates a Node `http.RequestListener` serving Agent Card discovery (`GET <base>/.well-known/agent.json`), `POST <base>/execute`, and `POST <base>/stream`. Never defaults to an implicit tenant; every request is authenticated via `callerOf(request)`. |
| `A2ACaller.accepted(...)` / `A2ACaller.rejected(...)` | `"agboss/a2a"` | Returned by `callerOf(request)` to bind the verified `tenant`, `ownerId`, and authenticated `peer` (or reject with HTTP `401` `A2ARejection.Unauthenticated` / HTTP `403` `A2ARejection.Forbidden`). |
| **Agent Mesh Envelope (`agboss-mesh`)** | `"agboss/a2a"` | JWS EdDSA-signed envelope header (plus W3C `traceparent`) carrying `origin` (`rootExecutionId`, `executionId`, `tenantId`, `step.idempotencyKey`), `budget.remaining`, `deadline.remaining`, and `callChain` across service hops. |
| `MeshLoopDetectedError` & `HopsLimitExceededError` | `"agboss"` | Thrown before executing a step when `callChain` contains the current service/workflow (cross-service cycle) or exceeds `@Application({ maxMeshHops })` (`6` by default). |
| `$ agboss check --federation <dir>` | CLI | Verifies cross-repository `@A2AAgent` / `@McpServer` imports against `@A2AExpose` / `@McpExpose` `schemaHash` snapshots from `agboss describe --json`. |
