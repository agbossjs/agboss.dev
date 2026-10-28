---
title: "Examples: 7 Verified Applications (01–07), flow-patterns & job-scout"
description: Explore the 7 standalone verified examples in agbossjs/agboss-examples (01–07) alongside examples/flow-patterns and examples/job-scout in agbossjs/agboss.
---

AGBoss provides three complementary repositories of runnable, CI-verified examples so you can prove compile-time and runtime guarantees in seconds for `$0` and inspect production-grade reference architectures.

1. **7 Standalone Verified Examples ([`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples)):** Seven self-contained applications (`01-hello-agboss` through `07-langgraph-migration`) following the **`Promise → Failure Injection → Reproducible Proof`** discipline — each with its own `package.json`, canonical `1 class = 1 file` component subfolder layout, symmetric Spring-style `tests/` mirroring `src/`, `.claude/skills/agboss/`, `npx agboss check`, and `$0` offline test & demo suites.
2. **Distributed Agent Recovery Showcase ([`agbossjs/distributed-agent-recovery`](https://github.com/agbossjs/distributed-agent-recovery) · [Architectural Walkthrough →](/examples/distributed-agent-recovery/)):** A multi-process distributed AI release pipeline ("Ghost in the Machine: The Zombie AI Worker") proving `ChildPlacement.AnyInstance` cross-process load balancing, LIFO `compensateWith` saga rollback, live `openai/gpt-4o-mini` recovery planning, same-task checkpoint takeover after 30s lease expiration, and two-layer zombie worker lease fencing across 8 automated invariants.
3. **In-Repository Examples (`examples/flow-patterns` & `examples/job-scout` in [`agbossjs/agboss`](https://github.com/agbossjs/agboss)):** `examples/flow-patterns` verifies loops, code/model routers, parallel waves, and `ThisWorkflow` recursion in `< 5 seconds` for `$0`, alongside the interactive `examples/job-scout` career assistant.

---

## The 7 Verified Examples in [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples)

| Example | Architectural Proof & Capabilities Demonstrated | Key Primitives & CLI Commands |
| :--- | :--- | :--- |
| **[`01-hello-agboss`](https://github.com/agbossjs/agboss-examples/tree/main/01-hello-agboss)** | **First-run, real HTTP service DI, web server & CLI scaffolding:** Demonstrates `PricingCatalogService` (`async onInit()`, `fetch` with `ExecutionContext.signal` + `step.idempotencyKey`), `src/http/server.ts` (multi-tenant headers, `202 Accepted` on pauses, `/api/pauses/:pauseId/resume`, `/health/live`, `/health/ready`), and canonical `1 class = 1 file` + symmetric `tests/` layout. | `@Application`, `@Workflow`, `@Agent`, `@Router`, `@Tool`, `@Injectable`, `testWith`, `mockOf` |
| **[`02-path-scope-proof`](https://github.com/agbossjs/agboss-examples/tree/main/02-path-scope-proof)** | **Compile-time Path Scope vs raw LangGraph:** Proves 4 structural graph bug classes (`01-missing-input`, `02-outdated-data`, `03-parallel-invalidation`, `04-uncompensated-action`) that pass `tsc --noEmit` in raw LangGraph `Annotation.Root` (`langgraph-broken/`) and are caught before runtime by `agboss check` (`agboss-broken/` vs `agboss-fixed/`). | `[input.missing-on-path]`, `[input.outdated-on-path]`, `[launch.branch-outdates-sibling]`, `[flow.uncompensated-action]` |
| **[`03-support-refund-desk`](https://github.com/agbossjs/agboss-examples/tree/main/03-support-refund-desk)** | **PII roundtrip, tool interception, in-memory BM25 RAG, compaction & 5-layer evals:** Reversible HMAC `@PiiPolicy` (`replaceWithToken`, `revealPii: true`, `PiiRefusedError`), `@ToolInterceptor` (`replyToModel`, `block`), `@InputGuardrail` (`DecidedBy.Code`), `@OutputGuardrail`, `InMemoryKnowledgeIndexService` + `RefundPolicyRetriever` (`@Rag`), `PolicyAwareCompaction`, and `@EvalSuite` with compact git-tracked `eval/baseline/main-baseline.json` and `agboss eval calibrate` (Cohen's $\kappa$). | `@PiiPolicy`, `@ToolInterceptor`, `@InputGuardrail`, `@OutputGuardrail`, `@Rag`, `@Compaction`, `@EvalSuite`, `agboss eval` |
| **[`04-travel-booking-saga`](https://github.com/agbossjs/agboss-examples/tree/main/04-travel-booking-saga)** | **Transactional LIFO sagas, idempotency, quorums, HITL withdrawal & HTTP server:** Reverse-order LIFO compensation across `payment-saga`, `budget-saga`, `quorum-saga` (`.joinQuorum({ min: 2, max: 2 })`), and `hitl-hold-saga` (`Channel.withdraw()`, `NotPausedError`), idempotent external ledgers (`step.idempotencyKey`), SQLite WAL crash recovery, and `src/http/server.ts`. | `@Action({ compensateWith, committedBy })`, `.toParallelAgents().acceptedBy().joinQuorum()`, `@ChannelRole`, `@Channel` |
| **[`05-cluster-work-stealing`](https://github.com/agbossjs/agboss-examples/tree/main/05-cluster-work-stealing)** | **Distributed scheduling, 30s leases, fencing & backpressure:** Parent `CoordinatorWorkflow` fans out `ChunkWorkerWorkflow` with `ChildPlacement.AnyInstance` over `SqliteChildExecutionQueueRepository`, runs bounded recursive `ThisWorkflow` (`maxDepth: 2`), enforces 30s SQLite leases & fencing (`ExecutionLeaseLostError`), `maxConcurrentSteps: 2` backpressure (`HealthComponentKind.StepSlots`), `@HealthCheck`, and `IncompatibleResumeError`. | `ChildPlacement.AnyInstance`, `SqliteChildExecutionQueueRepository`, `ThisWorkflow`, `@HealthCheck`, `SqliteExecutionLeaseRepository` |
| **[`06-enterprise-agent-mesh`](https://github.com/agbossjs/agboss-examples/tree/main/06-enterprise-agent-mesh)** | **3-service A2A + MCP mesh, Ed25519 envelopes, loop guard & federation Blast Radius:** Connects `apps/1-order-gateway`, `apps/2-billing-a2a` (`@A2AExpose`), and `apps/3-catalog-mcp` (`@McpExpose`) with Ed25519-signed `agboss-mesh` JWS envelopes, `MeshLoopDetectedError` / `HopsLimitExceededError`, MCP `_meta.callId` deduplication (`SqliteMeshRequestRepository`), and `agboss check --federation` (`federation/`). | `@A2AExpose`, `@A2AAgent`, `@McpExpose`, `@McpTool`, `SqliteMeshRequestRepository`, `agboss check --federation`, `agboss hub` |
| **[`07-langgraph-migration`](https://github.com/agbossjs/agboss-examples/tree/main/07-langgraph-migration)** | **Side-by-side comparison (`before-langgraph/` vs `after-agboss/`):** Compares a raw 15-field LangGraph `Annotation.Root` God State (`before-langgraph/support.graph.ts`) with the migrated AGBoss implementation (`after-agboss/src/` + `after-agboss/tests/`) using 10 narrow `@Dto`s, `DecidedBy.Model` & `DecidedBy.Code` `@Router`s, bounded `.toParallelAgents()`, idempotent `@Action`, typed `@Channel`, and co-located `.prompt.md` files. | `@Dto`, `@Router`, `.switch(caseOf())`, `.toParallelAgents()`, `@Action`, `@Channel`, `13-migrating-from-langgraph.md` |

### Canonical Project Layout (`1 class = 1 file` & Symmetric `tests/`)

Every project in [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples) enforces a clean, navigable folder convention:
- **1 class per file** with kind-suffixed filenames (`*.application.ts`, `*.workflow.ts`, `*.workflow-start.ts`, `*.workflow-finish.ts`, `*.agent.ts`, `*.router.ts`, `*.action.ts`, `*.tool.ts`, `*.service.ts`, `*.dto.ts`).
- **Component subfolders** grouping each workflow (`src/workflows/<name>/` with its workflow, start, and finishes) and each model-driven component (`src/agents/<name>/` and `src/routers/<name>/` co-locating the `.ts` class with its immutable `.prompt.md` file).
- **Symmetric Spring-style `tests/` directory** mirroring `src/` 1-to-1 (`tests/services/`, `tests/tools/`, `tests/actions/`, `tests/routers/`, `tests/guardrails/`, `tests/interceptors/`, `tests/http/`, `tests/workflows/<name>/`) so coding agents and engineers know immediately where unit and workflow tests belong.

### Spotlight: `02-path-scope-proof` (4 Graph Bugs Caught Before Runtime)

In [`02-path-scope-proof`](https://github.com/agbossjs/agboss-examples/tree/main/02-path-scope-proof), four structural bug cases (`cases/01-missing-input`, `cases/02-outdated-data`, `cases/03-parallel-invalidation`, `cases/04-uncompensated-action`) are each implemented in three variants — `langgraph-broken/` (compiles with `tsc --noEmit` yet fails or corrupts state at runtime), `agboss-broken/` (rejected before runtime by `agboss check --json` with an exact rule code and witness path), and `agboss-fixed/` (passes `agboss check` and executes cleanly):

1. **Missing input on a conditional route (`01-missing-input` → `[input.missing-on-path]`):** The `fast-track` branch of a router skips `ComplianceReview` (`ComplianceApprovalDto`), yet `PublishContract` requires `approval`. Raw LangGraph silently receives `undefined` at runtime; `agboss check` halts at compile time.
2. **Stale data after a revision cycle (`02-outdated-data` → `[input.outdated-on-path]`):** `QualityReviewer` emits `RevisionRequested` (`{ about: ContractDraftDto }`) and `RevisionWriter` replaces `ContractDraftDto`, making the earlier `LegalSignoffDto` stale. Skipping `LegalCheck` on the second pass is rejected by `agboss check`.
3. **Parallel sibling invalidation (`03-parallel-invalidation` → `[launch.branch-outdates-sibling]`):** Inside a parallel launch, `PricingRewriter` replaces `QuoteSheetDto` while its sibling `TaxAudit` concurrently audits the pre-launch `QuoteSheetDto`. `agboss check` rejects the race condition statically.
4. **Uncompensated side effect on an error path (`04-uncompensated-action` → `[flow.uncompensated-action]`):** `ReserveInventory` (`compensateWith: ReleaseInventory`) is followed by `ChargeCard`, whose `.onError(...)` path reaches `OrderFailedFinish` without invoking `ReleaseInventory`. `agboss check` refuses to compile the uncompensated path.

---

## Detailed Guide to All 7 Standalone Examples (`01–07`)

> **Setup (`v0.1.0`):** `@agboss/core@0.1.0` and `@agboss/cli@0.1.0` are published on `registry.npmjs.org`. Run `npm install` inside any example directory (or `node ./scripts/install-published.mjs --live-registry --version 0.1.0` from the [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples) repository root) before running per-project commands.

### 1. [`01-hello-agboss`](https://github.com/agbossjs/agboss-examples/tree/main/01-hello-agboss) — Starter, Constructor DI, Budgets & HTTP Server (`P0`)

- **Problem statement:** First-time multi-agent setups often mix business logic, HTTP transport calls, and prompt strings inside untyped node functions without budget ceilings or cancellation signals.
- **Architecture overview:** `HelloAgbossWorkflow` starts at `HelloWorkflowStart` (`HelloQuestionDto`), routes via `IntentRouter` (`DecidedBy.Model`) to either `SupportSpecialistAgent` or `QuoteAdvisorAgent` (which invokes `CalculateTierQuoteTool` backed by `PricingCatalogService`), and finishes at `HelloWorkflowFinish` (`HelloAnswerDto`).
- **Main mechanisms demonstrated:** `@Application`, `@Workflow`, `@Router`, `@Agent`, `@Tool`, `@Injectable` (`PricingCatalogService` with `async onInit()`, `ExecutionContext.signal`, and `step.idempotencyKey`), `@Budget` (`Application`, `Tenant`, and `Execution` scopes), `SqliteCostLedgerRepository`, and `src/http/server.ts`.
- **Representative code:** `start(HelloWorkflowStart).returns(HelloQuestionDto).toRouter(IntentRouter).chooseOne(route("support").toAgent(SupportSpecialistAgent).toFinish(HelloWorkflowFinish), route("pricing").toAgent(QuoteAdvisorAgent).toFinish(HelloWorkflowFinish))`
- **Quickstart commands:**
  ```bash
  cd 01-hello-agboss
  npm run check && npm test && npx tsx src/demo.ts
  ```
- **Expected proof output:** `npx tsx src/demo.ts` executes both `"support"` and `"pricing"` routes offline against the local pricing HTTP stub server and prints JSON confirming `supportBranch.status: "finished"`, `pricingBranch.status: "finished"`, and `pricingApiRequestsCount: 1`.
- **Failure scenario tested:** `tests/workflows/hello-agboss/hello-agboss.workflow.test.ts` injects a low execution budget ceiling and verifies `BudgetExceededError` aborts execution before overspending.
- **Guarantee boundary:**
  - *Verified:* Static workflow assembly, constructor DI lifecycle (`onInit`), tool schema validation, budget enforcement, and deterministic offline execution.
  - *Not verified by default offline run:* Live OpenRouter model quality or network latency (requires `npx tsx src/demo.ts --live` with `OPENROUTER_API_KEY`).
- **Repository directory:** [`agbossjs/agboss-examples/01-hello-agboss`](https://github.com/agbossjs/agboss-examples/tree/main/01-hello-agboss)

### 2. [`02-path-scope-proof`](https://github.com/agbossjs/agboss-examples/tree/main/02-path-scope-proof) — Static Graph Safety & Provenance (`P0`)

- **Problem statement:** In shared-state graph libraries (`Annotation.Root`), conditional branches that skip required producers, revision loops that leave stale approvals active, parallel branches that overwrite shared slots, and error handlers that bypass compensation all compile under `tsc --noEmit` and fail only at runtime.
- **Architecture overview:** Four self-contained case directories (`cases/01-missing-input`, `02-outdated-data`, `03-parallel-invalidation`, `04-uncompensated-action`), each containing `langgraph-broken/`, `agboss-broken/`, and `agboss-fixed/`.
- **Main mechanisms demonstrated:** `agboss check --json` static dominance analysis (`[input.missing-on-path]`, `[input.outdated-on-path]`, `[launch.branch-outdates-sibling]`, `[flow.uncompensated-action]`), `.agboss/types.d.ts` `Produced<Dto, Producer>` narrowing, `{ about }` provenance invalidation, and `compensateWith`.
- **Representative code:** `caseOf(ChangesRequestedDto, { about: ContractDraftDto }).toAgent(RevisionWriterAgent).returns(ContractDraftDto).toAgent(LegalCheckAgent)`
- **Quickstart commands:**
  ```bash
  cd 02-path-scope-proof
  npm run check && npm test && npx tsx src/demo.ts
  ```
- **Expected proof output:** `npx tsx src/demo.ts` runs all 4 cases and outputs JSON proving that `langgraph-broken` passes `tsc` (`passedTsc: true`) and fails at runtime, `agboss-broken` is rejected before runtime with the exact diagnostic code, and `agboss-fixed` finishes cleanly.
- **Failure scenario tested:** All four `agboss-broken/*.workflow.ts` fixtures are intentionally broken workflows verified to fail `agboss check --json` with exit code `1` and exact witness paths.
- **Guarantee boundary:**
  - *Verified:* Static path-dominance of declared `@Dto` slots, `{ about }` invalidation along cyclic/parallel paths, and presence of `compensateWith` along declared error paths.
  - *Not verified:* Arbitrary imperative mutations inside custom `@Injectable` services or external databases outside AGBoss DTO handoffs.
- **Repository directory:** [`agbossjs/agboss-examples/02-path-scope-proof`](https://github.com/agbossjs/agboss-examples/tree/main/02-path-scope-proof)

### 3. [`03-support-refund-desk`](https://github.com/agbossjs/agboss-examples/tree/main/03-support-refund-desk) — PII Masking, Guardrails, RAG, Compaction & Evals (`P0`)

- **Problem statement:** Customer support agents handle sensitive PII (emails, phone numbers, payment cards), face prompt-injection and policy-violation risks, suffer context drift over multi-turn conversations, and require reproducible regression gating.
- **Architecture overview:** `SupportRefundWorkflow` wraps `RefundSupportAgent` with `CustomerContactPiiPolicy` + `SupportTicketIdPiiPolicy`, `PromptInjectionGuardrail` (`@InputGuardrail`) + `UnauthorizedPayoutGuardrail` (`@OutputGuardrail`), `RefundPolicyToolInterceptor` + `AuditTrailToolInterceptor`, `RefundPolicyRetriever` (`@Rag`), `PolicyAwareCompaction` (`@Compaction`), and `RefundDeskEvalSuite` (`@EvalSuite`).
- **Main mechanisms demonstrated:** Reversible HMAC `@PiiPolicy` (`replaceWithToken`, `revealPii: true` on `IssueRefundTool`, `PiiRefusedError` on card numbers, masked OTel/Langfuse spans), `@InputGuardrail`, `@OutputGuardrail`, `@ToolInterceptor` (`ToolCallDecision.replyToModel` & `block`), `@Rag`, `@Compaction`, and `@EvalSuite` (`pass@k`, `pass^k`, `--baseline`, Cohen's $\kappa$ calibration, `--chaos`, `--metamorphic`, incident-to-eval drafting).
- **Representative code:** `@PiiPolicy({ name: "customer-contact-pii-policy", match: [PiiKind.Email, PiiKind.Phone], action: PiiAction.ReplaceWithToken })`
- **Quickstart commands:**
  ```bash
  cd 03-support-refund-desk
  npm run check && npm test && npx tsx src/demo.ts
  ```
- **Expected proof output:** `npx tsx src/demo.ts` prints JSON verifying `pii.modelSawMaskedEmailToken: true`, `pii.modelSawRawEmail: false`, `pii.toolReceivedRealEmail: "alice.synth@example.com"`, `pii.langfuseOtelSpansMaskedPii: true`, `policy.overCapFinalDecision: "escalated"`, `memoryDrift.preservedOrderFact: true`, and `evals.calibration.kappaJudgeAnna: 1`.
- **Failure scenarios tested:** Raw credit card refusal (`PiiRefusedError`), over-cap refund interception (`ToolCallDecision.replyToModel`), cross-tenant tool block, prompt-injection input guardrail block, unauthorized settlement output guardrail block, and baseline regression detection (`pass^k` drop under `--chaos`).
- **Guarantee boundary:**
  - *Verified:* Deterministic regex/field PII pseudonymization, tool interceptor policy gates, compaction fact retention, and offline `@EvalSuite` statistical calculations (`pass@k`, `pass^k`, Cohen's $\kappa$).
  - *Not verified by default offline run:* Open-ended adversarial jailbreak resilience on live frontier models (requires live model evaluation runs).
- **Repository directory:** [`agbossjs/agboss-examples/03-support-refund-desk`](https://github.com/agbossjs/agboss-examples/tree/main/03-support-refund-desk)

### 4. [`04-travel-booking-saga`](https://github.com/agbossjs/agboss-examples/tree/main/04-travel-booking-saga) — Transactional LIFO Sagas, Quorums, HITL & Crash Recovery (`P0`)

- **Problem statement:** Multi-step workflows that reserve flights, book hotels, and charge cards leave orphaned reservations when a downstream step fails, a budget limit triggers, a user cancels a paused approval, or a process crashes mid-flight.
- **Architecture overview:** Four workflows in `TravelBookingSagaApplication` (`PaymentSagaWorkflow`, `BudgetSagaWorkflow`, `HitlHoldSagaWorkflow`, and `QuorumSagaWorkflow`) backed by `SqliteCheckpointSaver`, `SqlitePausedExecutionRepository`, and `SqliteExecutionLeaseRepository`.
- **Main mechanisms demonstrated:** `@Action({ compensateWith, committedBy })`, `step.idempotencyKey` deduplication, automatic reverse-order (LIFO) compensation on step failure / `BudgetExceededError` / `app.cancel()`, two-phase `@ChannelRole` + `@Channel` (`withdraw` on cancel, `NotPausedError` on late resume), `.toParallelAgents().acceptedBy(QuorumVoteArbiter).joinQuorum({ min: 2, max: 2 })`, and SQLite crash recovery.
- **Representative code:** `@Action({ name: "reserve-flight-action", input: TravelRequestDto, output: FlightReservationDto, compensateWith: ReleaseFlightAction, committedBy: IssueFinalItineraryAction })`
- **Quickstart commands:**
  ```bash
  cd 04-travel-booking-saga
  npm run check && npm test && npx tsx src/demo.ts
  ```
- **Expected proof output:** `npx tsx src/demo.ts` outputs JSON confirming `scenarioA_PaymentDeclined.compensationOrder: ["release-hotel-action", "release-flight-action"]`, `scenarioB_BudgetExceeded.flightState: "RELEASED"`, `scenarioC_CancelAndRollback.withdrawnResolution: "cancelled"`, `scenarioD_RollbackCrashAndSqliteRecovery.sqliteResumedOutputStatus: "CONFIRMED"`, and `scenarioE_QuorumApproval.outcomeStatus: "CONFIRMED_BY_QUORUM"`.
- **Failure scenarios tested:** Payment gateway decline (`PaymentGatewayDeclinedError`), mid-flight `BudgetExceededError`, concurrent `app.cancel()` vs `app.resume()` race, crash inside a compensation handler (`CompensationFailedError`) followed by idempotent recovery replay, and rejected branch inside a 2-of-3 quorum.
- **Guarantee boundary:**
  - *Verified:* Single-node SQLite WAL durability, deterministic LIFO compensation ordering, idempotent `step.idempotencyKey` propagation to external ledgers, and lease-fenced recovery within the configured SQLite store.
  - *Not verified:* Multi-datacenter distributed consensus or compensation when an external third-party API permanently rejects its own refund/release endpoint without an idempotency contract.
- **Repository directory:** [`agbossjs/agboss-examples/04-travel-booking-saga`](https://github.com/agbossjs/agboss-examples/tree/main/04-travel-booking-saga)

### 5. [`05-cluster-work-stealing`](https://github.com/agbossjs/agboss-examples/tree/main/05-cluster-work-stealing) — Distributed Child Work-Stealing, Leases & Backpressure (`P1`)

- **Problem statement:** Fan-out and recursive workflows executing on a single Node.js instance bottleneck CPU/concurrency and lose progress if a worker crashes mid-batch.
- **Architecture overview:** `CoordinatorWorkflow` fans out `ChunkWorkerWorkflow` across cluster instances via `.toParallelWorkflows(ChunkWorkerWorkflow, { placement: ChildPlacement.AnyInstance })`, alongside `RecursiveDecomposerWorkflow` (`ThisWorkflow`, `maxDepth: 2`), coordinated through shared SQLite WAL repositories (`SqliteChildExecutionQueueRepository`, `SqliteExecutionLeaseRepository`, `SqliteExecutionTreeRepository`, `SqliteRateLimitRepository`).
- **Main mechanisms demonstrated:** `ChildPlacement.AnyInstance` work-stealing, parent lease yielding while waiting for children, 30s lease heartbeat & stale-lease reclamation (`recoverApp`), `ExecutionLeaseLostError` split-brain fencing, `maxConcurrentSteps: 2` backpressure (`HealthComponentKind.StepSlots`), `@HealthCheck` (`checkLiveness`, `checkReadiness`), and `IncompatibleResumeError`.
- **Representative code:** `.toParallelWorkflows(ChunkWorkerWorkflow, { placement: ChildPlacement.AnyInstance, maxItems: 8, onBranchError: ParallelErrorPolicy.CollectAll })`
- **Quickstart commands:**
  ```bash
  cd 05-cluster-work-stealing
  npm run check && npm test && npx tsx src/demo.ts
  ```
- **Expected proof output:** `npx tsx src/demo.ts` runs a 2-instance cluster over shared SQLite and prints JSON with `workStealing.batchSummary.succeededCount: 4`, `committedChunkEffects: 4`, `recursiveStatus: "finished"`, and `health.readinessStatus: "healthy"`.
- **Failure scenarios tested:** Worker crash mid-batch with 30s lease expiry and takeover by a surviving instance, zombie worker split-brain write fenced by `ExecutionLeaseLostError`, `maxConcurrentSteps` saturation flipping readiness to `unhealthy` while liveness stays `healthy`, and `IncompatibleResumeError` on workflow version drift.
- **Guarantee boundary:**
  - *Verified:* Multi-instance coordination over shared SQLite WAL storage (single host or shared POSIX/local disk), lease fencing, and step-slot backpressure.
  - *Not verified:* Distributed network database backends (PostgreSQL/Redis adapters are on the roadmap and not shipped in `0.1.0`).
- **Repository directory:** [`agbossjs/agboss-examples/05-cluster-work-stealing`](https://github.com/agbossjs/agboss-examples/tree/main/05-cluster-work-stealing)

### 6. [`06-enterprise-agent-mesh`](https://github.com/agbossjs/agboss-examples/tree/main/06-enterprise-agent-mesh) — Multi-Service A2A + MCP Mesh & Federation Check (`P1`)

- **Problem statement:** When independent microservices expose agents (`A2A`) and tools (`MCP`), untyped payloads, missing authentication, circular cross-service loops, duplicate retries, and breaking schema changes cause cascading outages.
- **Architecture overview:** Three separate AGBoss applications in one workspace — `apps/1-order-gateway` (`TriageGatewayApplication`), `apps/2-billing-a2a` (`BillingApplication` exposing `@A2AExpose`), and `apps/3-catalog-mcp` (`CatalogApplication` exposing `@McpExpose`).
- **Main mechanisms demonstrated:** `@A2AExpose` + `a2aHttpListener(app, { expose, callerResolver })`, `@A2AAgent`, `@McpExpose` + `@McpServer` + `@McpTool`, Ed25519-signed `agboss-mesh` JWS envelope propagation (`origin`, `budget.remaining`, `deadline.remaining`, `callChain`), `MeshLoopDetectedError` / `HopsLimitExceededError`, `SqliteMeshRequestRepository` idempotency deduplication, `agboss check --federation`, and `agboss hub`.
- **Representative code:** `@A2AAgent({ name: "remote-billing-agent", description: "Calls Billing service over A2A", target: "billing-application/billing-workflow", url: "billingA2aUrl", input: BillingInquiryDto, output: BillingResolutionDto, price: usd(0.05) })`
- **Quickstart commands:**
  ```bash
  cd 06-enterprise-agent-mesh
  npm run check && npm test && npx tsx apps/1-order-gateway/src/demo.ts
  ```
- **Expected proof output:** `npx tsx apps/1-order-gateway/src/demo.ts` boots the A2A + MCP services on loopback HTTP ports and prints JSON confirming `a2aResolution.creditedUsd: 45`, `federationProof.compatibleOk: true`, `federationProof.breakingExitCode: 3`, and `federationProof.breakingCodes: ["federation.incompatible-schema", "federation.missing-target"]`.
- **Failure scenarios tested:** Unauthenticated A2A caller rejection (`A2ACallerRejectedError`), cross-service call-chain cycle (`MeshLoopDetectedError`), hop limit exhaustion (`HopsLimitExceededError`), and breaking cross-service contract drift caught by `agboss check --federation`.
- **Guarantee boundary:**
  - *Verified:* Cross-service contract verification (`agboss check --federation`), Ed25519 JWS mesh envelope verification, loop/hop guards, and MCP/A2A request deduplication.
  - *Not verified:* External service mesh mTLS/ingress infrastructure or non-AGBoss third-party A2A implementations.
- **Repository directory:** [`agbossjs/agboss-examples/06-enterprise-agent-mesh`](https://github.com/agbossjs/agboss-examples/tree/main/06-enterprise-agent-mesh)

### 7. [`07-langgraph-migration`](https://github.com/agbossjs/agboss-examples/tree/main/07-langgraph-migration) — Deterministic Reference Migration (`before-langgraph/` vs `after-agboss/`) (`P0`)

- **Problem statement:** Raw LangGraph workflows often accumulate a 15+ field mutable `Annotation.Root` God State where optional fields are read before they are initialized, stale loop critiques persist across iterations, and side effects lack idempotency keys.
- **Architecture overview:** Side-by-side implementation of the same customer support & refund workflow in `before-langgraph/` (raw `@langchain/langgraph` `StateGraph` with a 15-field `Annotation.Root`) and `after-agboss/` (canonical AGBoss application with 10 narrow `@Dto` classes, `@Router`, `@Agent`, `@Action`, and `@Channel`).
- **Main mechanisms demonstrated:** Migrating `Annotation.Root` to narrow `@Dto` handoffs, replacing conditional edges with `.toRouter().chooseOne()` and `.switch(caseOf(..., { about }))`, replacing parallel node fan-out with `.toParallelAgents()`, and adding `step.idempotencyKey` to `@Action`.
- **Representative code:** `agent(ReplyReviewerAgent).returns(oneOf(ReplyApprovedDto, CritiqueNotesDto)).switch(caseOf(ReplyApprovedDto, { about: DraftReplyDto }).toRouter(RefundSizeRouter), caseOf(CritiqueNotesDto, { about: DraftReplyDto }).toAgent(ReplyWriterAgent))`
- **Quickstart commands:**
  ```bash
  cd 07-langgraph-migration
  npm run check && npm test && npx tsx after-agboss/src/demo.ts
  ```
- **Expected proof output:** `npx tsx after-agboss/src/demo.ts` runs both `before-langgraph` and `after-agboss` deterministically and outputs JSON comparing `beforeLangGraph.godStateFieldsCount: 15`, `firstWriteSawUndefinedDraft: true`, and `unusedFieldPersistedInState: true` against `afterAgboss.status: "finished"` and `afterAgboss.path`.
- **Failure scenario tested:** `tests/migration-comparison.test.ts` proves that the raw LangGraph state exposes uninitialized `undefined` fields on first pass and retains dead state fields, whereas the AGBoss workflow enforces strict Path Scope provenance and `maxVisits` bounds.
- **Guarantee boundary:**
  - *Verified:* Deterministic structural comparison between a representative shared-state `StateGraph` and its narrow-DTO AGBoss counterpart.
  - *Not verified:* This is a **deterministic reference migration**, not a universal benchmark across all possible LangGraph coding styles.
- **Repository directory:** [`agbossjs/agboss-examples/07-langgraph-migration`](https://github.com/agbossjs/agboss-examples/tree/main/07-langgraph-migration)

---

## How the `examples/job-scout` application works

`examples/job-scout` reads a candidate's resume from disk, proposes a structured search brief, fetches live openings from public Greenhouse boards, ranks every match using the Jev decision model (`JobFitJudge`), explains why top matches fit using a SQLite FTS5 `@Rag` knowledge base (`company_notes`), and saves selected jobs through the official filesystem `@McpServer` after pausing for user approval (`TerminalUserChannel`):

<!-- snippet-context
import {
  ChatWorkflowFinish,
  ChatWorkflowStart,
  JobFitJudge,
  MainRouter,
  ProfilerAgent,
  ScoutAgent,
  ShortlistAgent,
} from "./job-scout.components.js";
-->
```ts title="src/job-scout.workflow.ts" file=job-scout.workflow.ts
import { Workflow, route, start } from "@agboss/core";
import { WorkflowStartTextDto } from "@agboss/core/dto";

@Workflow({
  name: "job-scout-workflow",
  version: "1.0.0",
  flow: [
    start(ChatWorkflowStart)
      .returns(WorkflowStartTextDto)
      .toRouter(MainRouter)
      .chooseOne(
        route(ProfilerAgent)
          .toFinish(ChatWorkflowFinish),
        route(ScoutAgent)
          .toFinish(ChatWorkflowFinish),
        route(ShortlistAgent)
          .toFinish(ChatWorkflowFinish),
      ),
  ],
  defaults: {
    models: { temperature: 0 },
    router: { model: "typesafe/jev-1.13" },
    tools: { maxToolCalls: 8 },
  },
  providers: [JobFitJudge],
})
export class JobScout {}
```

```ts title="src/job-scout.components.ts" file=job-scout.components.ts
import { Agent, DecidedBy, Injectable, Router, WorkflowFinish, WorkflowStart } from "@agboss/core";
import { WorkflowFinishTextDto, WorkflowStartTextDto } from "@agboss/core/dto";

@WorkflowStart({ name: "chat-workflow-start", description: "A message", input: WorkflowStartTextDto })
export class ChatWorkflowStart {}

@WorkflowFinish({ name: "chat-workflow-finish", description: "The answer", output: WorkflowFinishTextDto })
export class ChatWorkflowFinish {}

@Agent({ name: "profiler-agent", description: "Reads the resume", prompt: "Read the resume.", model: "moonshotai/kimi-k2.6" })
export class ProfilerAgent {}

@Agent({ name: "scout-agent", description: "Finds jobs", prompt: "Find jobs.", model: "moonshotai/kimi-k2.6" })
export class ScoutAgent {}

@Agent({ name: "shortlist-agent", description: "Saves jobs", prompt: "Save shortlist.", model: "moonshotai/kimi-k2.6" })
export class ShortlistAgent {}

@Router({
  name: "main-router",
  description: "Sends the message to the agent that answers it",
  decidedBy: DecidedBy.Model,
  prompt: "Pick the agent that answers the message.",
  input: { message: WorkflowStartTextDto },
  routes: [
    { prompt: "Reading the resume", target: ProfilerAgent },
    { prompt: "Finding jobs", target: ScoutAgent },
    { prompt: "Managing the shortlist", target: ShortlistAgent },
  ],
})
export class MainRouter {}

@Injectable()
export class JobFitJudge {}
```

<!-- snippet-context
import { Budget, BudgetPeriod, BudgetScope, type BudgetHandler } from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";
@Budget({ name: "js-ex-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class JsExAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(50); } }
@Budget({ name: "js-ex-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class JsExTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "js-ex-exec-budget", scope: BudgetScope.Execution })
export class JsExExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }
// @snippet
-->
```ts title="test/job-scout.workflow.test.ts" file=job-scout.workflow.test.ts
import { Application, EmptyEnvironment } from "@agboss/core";
import { expect } from "vitest";
import { replyWith, routeTo, testWith } from "@agboss/core/testing";
import { JobScout } from "./job-scout.workflow.js";
import {
  ChatWorkflowFinish,
  ChatWorkflowStart,
  MainRouter,
  ScoutAgent,
} from "./job-scout.components.js";

@Application({
  name: "job-scout-example-app",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [JobScout],
  budgets: [JsExAppBudget, JsExTenantBudget, JsExExecBudget],
})
export class JobScoutExampleApp {}

const test = testWith(JobScoutExampleApp);

test("routes job search queries through MainRouter to ScoutAgent", async ({
  app,
  mockLlm,
}) => {
  mockLlm(MainRouter).thenReturn(routeTo(ScoutAgent));
  mockLlm(ScoutAgent).thenReturn(
    replyWith("Found 2 matching Staff TypeScript roles."),
  );

  const result = await app.execute(ChatWorkflowStart, {
    text: "Find Staff TypeScript roles",
  });
  expect(result.finish).toBe(ChatWorkflowFinish);
  expect(result.output).toEqual({
    text: "Found 2 matching Staff TypeScript roles.",
  });
});
```

Run `examples/job-scout` from the repository root:

```bash
npm install && npm run build
cd examples/job-scout
npm run chat
npm run describe
```

## What patterns are demonstrated in `examples/flow-patterns`?

`examples/flow-patterns` (`src/flow-patterns.application.ts`) demonstrates four advanced AGBoss workflow patterns tested 100% offline with `testWith` and `agboss check`:

- **`src/offer/` (Review loop with `{ about }`):** `draft-agent` → `reviewer-agent` returning `oneOf(ChangesRequestedDto, DraftApprovedDto)`. When changes are requested, `caseOf(ChangesRequestedDto, { about: OfferDraftDto })` routes to `editor-agent` (`maxVisits: 2`), with `.onError(VisitsLimitExceededError, ...)` handling exhausted review cycles.
- **`src/credit/` (Code router beside model router):** Combines a Jev model router with `credit-limit-router` (`DecidedBy.Code`), routing small orders to `charge-card-action` and larger orders to `approval-agent`.
- **`src/review/` (Parallel launches in waves):** Runs a reviewer per document section via `.toParallelAgents(...)`, joins their outputs, and launches a second wave with a critic alongside parallel fact-checker copies.
- **`src/topic/` (Recursive `ThisWorkflow`):** Researches broad topics by launching `.toParallelWorkflows(ThisWorkflow, { maxItems })` with `@Workflow({ maxDepth: 3 })`.

Inspect the pattern application directly with the CLI:

```bash
cd examples/flow-patterns
npx agboss describe --application src/flow-patterns.application.ts
npm test
```
