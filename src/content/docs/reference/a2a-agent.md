---
title: "@A2AAgent, @A2AExpose, a2aHttpListener & A2ACallerResolver"
description: "Complete API reference for @A2AAgent, @A2AExpose, A2AClient, a2aHttpListener, A2ACallerResolver, and wireCode error handling in the AGBoss Agent Mesh."
---

The `@A2AAgent` and `@A2AExpose` decorators, `a2aHttpListener`, and `A2ACallerResolver` (`"agboss/a2a"`) provide both the client and server sides of the multi-tenant Agent-to-Agent (A2A) and federated Agent Mesh protocol in AGBoss, enabling strongly typed cross-service workflow calls with signed `MeshEnvelope` budget, deadline, and call-chain propagation:
- **`@A2AAgent`** (`a2a/*.a2a-agent.ts`) defines a typed contract client (`extends A2AClient<InDto, OutDto>`) for a remote A2A workflow (`target: { application, start }`, `input`, `output`, `price?`), registered in `@Workflow({ providers: [RemoteA2AAgent] })` and injected into any `@Tool` or `@Action` via `deps: [RemoteA2AAgent]`.
- **`@A2AExpose`** (`a2a/*.a2a-expose.ts`) declares the `@WorkflowStart` entry points (`exports: [Start]`) that an `@Application({ exposes: [AppA2AExpose] })` serves over A2A and exports in `agboss describe --json` for `agboss check --federation`.
- **`a2aHttpListener(app, { expose, callerResolver, meshVerifier?, base })`** and **`A2ACallerResolver<typeof StartClass>`** (`a2a/*.a2a-caller-resolver.ts`) serve an `@A2AExpose` contract over HTTP (`POST <base>/execute`, `/resume`, `/cancel`), resolving the authenticated `tenant`, `ownerId`, `execution`, and `peer` from an `@Injectable()` resolver in the DI container before reading any request body.

## Complete `@A2AAgent`, `@A2AExpose`, `A2ACallerResolver`, `a2aHttpListener` & `a2aServer` example

```ts title="src/a2a/billing-specialist.a2a-agent.ts" file=src/a2a/billing-specialist.a2a-agent.ts
import {
  Action,
  ExecutionContext,
  type ActionHandler,
  type InputOf,
  type OutputOf,
} from "agboss";
import { A2AAgent, A2AClient, type A2ACallOptions } from "agboss/a2a";
import { Text } from "agboss/dto";
import { usd } from "agboss/units";

export class TaxAuditInputDto {
  @Text({ prompt: "Invoice ID to audit" })
  invoiceId!: string;
}

export class TaxAuditOutputDto {
  @Text({ prompt: "Remote tax compliance verdict" })
  verdict!: string;
}

// 1. Declare the remote @A2AAgent contract (registered in @Workflow({ providers: [RemoteTaxAuditorA2AAgent] })):
@A2AAgent({
  name: "remote-tax-auditor-a2a-agent",
  url: "https://tax-agent.internal.acme.com/a2a",
  target: {
    application: "support-escalation-application",
    start: "tax-audit-workflow-start",
  },
  input: TaxAuditInputDto,
  output: TaxAuditOutputDto,
  price: usd(0.002),
  deps: [ExecutionContext],
})
export class RemoteTaxAuditorA2AAgent extends A2AClient<TaxAuditInputDto, TaxAuditOutputDto> {
  constructor(private readonly executionContext: ExecutionContext) {
    super();
  }

  protected override getHeaders(): Promise<Record<string, string>> {
    return Promise.resolve({
      "idempotency-key": this.executionContext.step.idempotencyKey,
      "x-tenant-id": this.executionContext.tenant.tenantId,
    });
  }
}

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
    const call: A2ACallOptions = { signal: this.executionContext.signal };
    return this.remoteTaxAuditor.execute(input.auditRequest.value, call);
  }
}
```

```ts title="src/a2a/tax-auditor.a2a-caller-resolver.ts" file=src/a2a/tax-auditor.a2a-caller-resolver.ts
import { Injectable } from "agboss";
import {
  A2ACallerResolution,
  A2ARoute,
  type A2ACallerRequest,
  type A2ACallerResolver,
} from "agboss/a2a";
import type { TaxAuditWorkflowStart } from "../workflows/support-escalation.workflow.js";

// 3. @Injectable() caller resolver registered in @Workflow({ providers: [ShopA2aCallerResolver] }):
@Injectable()
export class ShopA2aCallerResolver implements A2ACallerResolver<typeof TaxAuditWorkflowStart> {
  resolveCaller(
    request: A2ACallerRequest,
  ): A2ACallerResolution<typeof TaxAuditWorkflowStart> {
    const auth = request.http.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ")) {
      return A2ACallerResolution.unauthenticated({
        reason: "Missing Bearer token",
        challenge: 'Bearer realm="a2a"',
      });
    }
    const tenantId = request.http.headers["x-tenant-id"];
    if (typeof tenantId !== "string" || tenantId.length === 0) {
      return A2ACallerResolution.unauthenticated({ reason: "Missing x-tenant-id header" });
    }
    if (request.route === A2ARoute.Resume && auth === "Bearer read-only-key") {
      return A2ACallerResolution.forbidden({
        reason: "Read-only key cannot answer workflow pauses",
      });
    }
    return A2ACallerResolution.resolved({
      tenant: { tenantId },
      ownerId: `client-${tenantId}`,
      peer: request.signedBy,
    });
  }
}
```

```ts title="src/workflows/support-escalation.workflow.ts" file=src/workflows/support-escalation.workflow.ts
import { Workflow, WorkflowFinish, WorkflowStart, start } from "agboss";
import { A2AExpose, a2aHttpListener, type A2AAdapter, type A2AApp } from "agboss/a2a";
import {
  DelegateTaxAuditAction,
  RemoteTaxAuditorA2AAgent,
  TaxAuditInputDto,
  TaxAuditOutputDto,
} from "../a2a/billing-specialist.a2a-agent.js";
import { ShopA2aCallerResolver } from "../a2a/tax-auditor.a2a-caller-resolver.js";

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
  providers: [RemoteTaxAuditorA2AAgent, ShopA2aCallerResolver],
  flow: [
    start(TaxAuditWorkflowStart)
      .returns(TaxAuditInputDto)
      .toAction(DelegateTaxAuditAction)
      .returns(TaxAuditOutputDto)
      .toFinish(TaxAuditWorkflowFinish),
  ],
})
export class SupportEscalationWorkflow {}

// 4. Declare the @A2AExpose contract (listed in @Application({ exposes: [TaxAuditA2AExpose] })):
@A2AExpose({
  name: "tax-audit-a2a-expose",
  version: "1.0.0",
  exports: [TaxAuditWorkflowStart],
})
export class TaxAuditA2AExpose {}

// 5. Multi-tenant HTTP listener resolving ShopA2aCallerResolver from the app container:
export function createTaxA2AListener(app: A2AApp, _adapter?: A2AAdapter) {
  return a2aHttpListener(app, {
    expose: TaxAuditA2AExpose,
    callerResolver: ShopA2aCallerResolver,
    base: "/a2a",
  });
}
```

<!--
```ts file=src/escalation.application.ts
import { Application, Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, type BudgetHandler } from "agboss";
import { usd, type Usd } from "agboss/units";
import { SupportEscalationWorkflow, TaxAuditA2AExpose } from "./workflows/support-escalation.workflow.js";

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
  exposes: [TaxAuditA2AExpose],
  budgets: [A2AAppBudget, A2ATenantBudget, A2AExecBudget],
})
export class SupportEscalationApplication {}
```
-->

```ts title="test/billing-specialist.a2a.test.ts" file=test/billing-specialist.a2a.test.ts
import { expect } from "vitest";
import { A2ACallerRejectedError, A2AClient } from "agboss/a2a";
import { override, testAction, testWith } from "agboss/testing";
import {
  DelegateTaxAuditAction,
  RemoteTaxAuditorA2AAgent,
  type TaxAuditInputDto,
  type TaxAuditOutputDto,
} from "../src/a2a/billing-specialist.a2a-agent.js";
import { ShopA2aCallerResolver } from "../src/a2a/tax-auditor.a2a-caller-resolver.js";
import { SupportEscalationApplication } from "../src/escalation.application.js";
import {
  TaxAuditA2AExpose,
  TaxAuditWorkflowStart,
} from "../src/workflows/support-escalation.workflow.js";

class FakeTaxAuditorA2AAgent extends RemoteTaxAuditorA2AAgent {
  override execute(_input: TaxAuditInputDto): Promise<TaxAuditOutputDto> {
    return Promise.resolve({ verdict: "Invoice #INV-9102 compliant." });
  }
}

const test = testWith(SupportEscalationApplication, {
  overrides: [override(RemoteTaxAuditorA2AAgent, FakeTaxAuditorA2AAgent)],
});

test("rejects unauthenticated A2A requests via a2aServer and delegates when authenticated", async ({
  a2aServer,
}) => {
  const { url } = await a2aServer({
    expose: TaxAuditA2AExpose,
    callerResolver: ShopA2aCallerResolver,
  });

  // 1. Unauthenticated caller receives 401 A2ACallerRejectedError before any workflow step runs:
  const unauthed = new A2AClient({ url }).send({ invoiceId: "INV-9102" });
  await expect(unauthed).rejects.toFailWith(A2ACallerRejectedError, {
    httpStatus: 401,
    code: "a2a.caller-rejected",
    wireCode: "a2a.caller-unauthenticated",
  });

  // 2. Unit-test the delegating @Action in isolation:
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

## What options do `@A2AAgent`, `@A2AExpose`, and `a2aHttpListener` accept?

| API / Decorator | Option | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `@A2AAgent` | `name` | `string` | **Yes** | Unique kebab-case identifier ending with `-a2a-agent` (`[name.kind-suffix]`). |
| `@A2AAgent` | `url` | `string` | **Yes** | Base URL of the remote A2A endpoint (`"https://billing.internal.example.com/a2a"`), serving `POST <url>/execute`, `/resume`, and `/cancel`. |
| `@A2AAgent` | `target` | `{ application: string; start: string }` | **Yes** | Declared contract target (`[a2a.target-required]`), verified against peer snapshots by `agboss check --federation`. |
| `@A2AAgent` | `input` / `output` | `DtoClass` | **Yes** | Request and response DTO contracts validated on `execute(input, call?)` and exported with `schemaHash` in `agboss describe --json`. |
| `@A2AAgent` | `price` | `Usd` | No | Declared fallback cost per remote call (`usd(0.002)`); the step records the larger of `price` and a trusted peer's signed `MeshRunReport`. |
| `@A2AAgent` | `deps` | `readonly Token[]` | No | Constructor dependencies (`ExecutionContext`, `TenantContext`, or `@Injectable` auth services) used inside `protected override getHeaders()`. |
| `@A2AExpose` | `name` / `version` / `exports` | `string` / `readonly StartClass[]` | **Yes** | Declares the `@WorkflowStart` classes (`-a2a-expose`) that `@Application({ exposes })` serves over A2A (`[application.expose-unknown-start]`, `[application.expose-unlisted]`). |
| `a2aHttpListener(app, options)` | `expose` | `Class` | **Yes** | The `@A2AExpose` class listed in `@Application({ exposes })` served at this A2A endpoint. |
| `a2aHttpListener(app, options)` | `callerResolver` | `Class<A2ACallerResolver<TStart>>` | **Yes** | An `@Injectable()` class listed in `@Application({ providers })` or `@Workflow({ providers })` (`[a2a.caller-resolver-not-listed]` if omitted). |
| `a2aHttpListener(app, options)` | `meshVerifier` | `Class<MeshVerifier>` | No | Optional `@Injectable()` service implementing `verifyKeyOf(issuer)` to resolve peer Ed25519 SPKI public keys dynamically alongside `@Application({ mesh: { peers } })`. |
| `a2aHttpListener(app, options)` | `base` | `string` | No | URL path prefix (`"/a2a"` by default). |

## `A2ACallerResolution`, `A2ACallerRejectedError`, `a2aServer` & the Signed Agent Mesh Envelope

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `A2ACallerResolution.resolved({ tenant, ownerId, execution, peer })` | `"agboss/a2a"` | Returned by `resolveCaller(request: A2ACallerRequest)` to bind the verified `tenant`, `ownerId` (thread ownership), `execution` context values, and trusted `peer`. |
| `A2ACallerResolution.unauthenticated({ reason, challenge? })` / `.forbidden({ reason })` | `"agboss/a2a"` | Rejects the request before reading the body or starting an execution with HTTP `401` (`a2a.caller-unauthenticated`) or HTTP `403` (`a2a.caller-forbidden`), thrown on the client as `A2ACallerRejectedError`. |
| `A2ACallerRejectedError` | `"agboss/a2a"` | Thrown by `A2AClient` on `401` / `403`: `err.code` is always `"a2a.caller-rejected"`, `err.httpStatus` is `401` or `403`, and `err.wireCode` carries the server's specific rejection code (`"a2a.caller-unauthenticated"` or `"a2a.caller-forbidden"`). |
| `a2aServer({ expose, callerResolver, meshVerifier? })` | `"agboss/testing"` | `testWith` fixture that serves the test's `app` on `127.0.0.1:0` and returns `{ url }` for `new A2AClient({ url, headers })`. |
| **Agent Mesh Envelope (`MeshEnvelope`, `agboss-mesh`)** | `"agboss"` | JWS EdDSA (Ed25519) envelope header (`_meta["agboss.dev/mesh"]` over MCP, plus W3C `traceparent`) carrying `origin` (`executionId`, `parentExecutionId`, `workflow`, `step.idempotencyKey`), `budget.remaining`, `deadline.remaining`, and `callChain` (`MeshHop[]`), plus signed `MeshRunReport` spend attribution (`ToolCallRecord.remote`). |
| `MeshLoopDetectedError` & `HopsLimitExceededError` | `"agboss"` | Thrown before executing a step when `callChain` contains the current `(application, start)` pair (`limit.mesh-loop`) or reaches `@Application({ maxMeshHops })` (`8` by default, `limit.hops`). |
| `$ agboss check --federation <path...>` & `$ agboss hub` | CLI | Verifies cross-repository `@A2AAgent` / `@McpServer` contracts against `agboss describe --json` snapshots (`--federation`) and renders the global Agent Mesh graph, cross-service execution trees, Progressive Crystallization Radar, and Blast Radius (`agboss hub show --html` / `agboss hub ui`). |
