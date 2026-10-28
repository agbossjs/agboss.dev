---
title: "Showcase: Distributed Agent Recovery (Zombie Worker & LIFO Sagas)"
description: Architectural walkthrough of agbossjs/distributed-agent-recovery — demonstrating multi-process distributed child workflows, LIFO saga compensation, AI recovery planning, checkpoint takeover, and two-layer zombie worker lease fencing in AGBoss.
---

> **Ghost in the Machine: The Zombie AI Worker**  
> *It lost its lease. Another worker took over. Then the zombie came back.*  
> **The worker didn't survive. The workflow did.**

[**`agbossjs/distributed-agent-recovery`**](https://github.com/agbossjs/distributed-agent-recovery) is a standalone, multi-process distributed AI release pipeline built on `@agboss/core@0.1.0` and `@agboss/cli@0.1.0`. It demonstrates how AGBoss coordinates multiple OS worker processes, survives mid-execution worker freezes (`SIGSTOP` / lease expiry), rolls back partial external commits via deterministic LIFO sagas, and delegates root-cause recovery planning to an LLM agent without ever letting a probabilistic model manage distributed locks or cleanup state.

- **GitHub Repository:** [`github.com/agbossjs/distributed-agent-recovery`](https://github.com/agbossjs/distributed-agent-recovery)
- **Recorded Live LLM + Real-Clock `SIGSTOP` Evidence:** [`docs/evidence/live-real-clock-cluster-run.json`](https://github.com/agbossjs/distributed-agent-recovery/blob/main/docs/evidence/live-real-clock-cluster-run.json) (`openai/gpt-4o-mini`, `$0.00036255` total spend, 2 OS worker PIDs, 30s lease takeover `epoch 1 -> 2`, linear unbranched checkpoint chain)
- **Automated CI Gates:** `$0` deterministic offline suite (`testWith` & `mockLlm`), real-clock multi-process POSIX `SIGSTOP`/`SIGCONT` recovery (`--cluster --real-clock`), 4-container Docker Compose + hard worker container death (`exit 137`) failover, and single-node Kubernetes (`kind`).

---

## Why Multi-Worker AI Pipelines Need Deterministic Recovery

When teams move AI workflows from single-process prototypes to multi-worker production clusters, two distributed failure modes appear immediately:

1. **Partial External Commits Before a Gate Failure:** Multiple worker processes concurrently compile and write real artifacts to disk and a shared database, and a downstream integration smoke check fails. Asking an LLM to "clean up whatever failed" via tool calls is non-deterministic and unsafe; orphaned files corrupt the next attempt. AGBoss solves this with statically verified **LIFO Saga Compensation** ([`@Action({ compensateWith })`](/guides/error-handling-and-rollback/)).
2. **The Zombie Worker (GC Pause, I/O Stall, or Container Freeze):** Worker A claims a child task under `leaseEpoch = 1`, commits its Step 1 checkpoint, and freezes during Step 2 until its 30-second execution lease expires. Worker B claims the orphaned child execution under `leaseEpoch = 2`, resumes from Worker A's Step 1 checkpoint (`execution.recovered`), and commits Step 2. **Then Worker A wakes up and attempts to commit its stale continuation.** AGBoss prevents split-brain corruption through **monotonic `leaseEpoch` fencing** at both the external side-effect boundary and the runtime checkpoint saver.

---

## End-to-End 12-Step Execution Architecture

The showcase runs a **two-attempt software release pipeline** for three modules (`auth-service`, `payment-engine`, and `telemetry-collector`) across a **Coordinator** and **two independent Worker OS processes** sharing a SQLite WAL cluster store and external release ledger:

```text
Coordinator                  Worker A (PID 1)         Worker B (PID 2)         Shared SQLite WAL + Ledger
───────────                  ────────────────         ────────────────         ──────────────────────────
ATTEMPT 1: Parallel Staging, Gate Failure, LIFO Saga Rollback & AI Recovery Plan
1. DecomposeReleaseTasks ───────────────────────────────────────────────────►  3 module tasks created
2. toParallelWorkflows(ModuleWorkerWorkflow, ChildPlacement.AnyInstance) ───►  enqueue 3 child runs
                             3a. Claim & stage        3b. Claim & stage
                                 auth-service             telemetry-collector
                                 (+ payment-engine)       (.artifact.json)
4. LockReleaseCandidate (compensateWith: CompensateReleaseCandidateAction) ─►  candidate LOCKED
5. VerifyReleaseSmokeGate ──► throws ReleaseGateFailedError (missing --abi-compat=v2)
6. .onError(ReleaseGateFailedError, ...)
   ├─ CompensateReleaseCandidateAction ─────────────────────────────────────►  deletes 3 staged files,
   │                                                                           marks Attempt 1 COMPENSATED
   └─ ReleaseRecoveryPlannerAgent (openai/gpt-4o-mini)
      └─ calls InspectFailedAttemptTool ────────────────────────────────────►  verifies allCompensated=true,
                                                                               emits RecoveryPlanDto

ATTEMPT 2: Same-Task Checkpoint Takeover & Two-Layer Zombie Worker Fencing
7. Retry with AI-corrected flags (--opt-level=3 --deterministic --abi-compat=v2)
                             8a. Claim payment-engine (executionId E1, leaseEpoch=1)
                                 & commit Step 1 checkpoint (PrepareModuleCandidate)
                             8b. Freeze in Step 2 (SIGSTOP / stall > 30s TTL)
                                                      9a. Reclaim SAME executionId E1
                                                          with leaseEpoch=2 (execution.recovered)
                                                          from Worker A's Step 1 checkpoint
                                                      9b. Commit Step 2 under leaseEpoch=2
                             10. Wake up (SIGCONT) with stale leaseEpoch=1
                             11a. Layer 1 Fence: Ledger rejects epoch 1 < 2
                                  (ZOMBIE_WRITE_REJECTED / StaleLeaseFenceError)
                             11b. Layer 2 Fence: LeasedCheckpointSaver rejects
                                  renew(epoch=1) ──► ExecutionLeaseLostError
12. VerifyReleaseSmokeGate passes ──► PromoteReleaseArtifactsAction ────────►  release-manifest.json
```

---

## How AGBoss Works Under the Hood

### 1. Declarative Distributed Fan-Out, LIFO Saga & AI Error Recovery

`ReleaseCoordinatorWorkflow` expresses the entire distributed release lifecycle in one statically verified HarnessDSL (HDSL) graph:

- **Distributed child fan-out (`ChildPlacement.AnyInstance`):** `.toParallelWorkflows(ModuleWorkerWorkflow, { placement: ChildPlacement.AnyInstance })` writes child workflow tasks to `SqliteChildExecutionQueueRepository` and **yields the parent's own execution lease** while waiting so the coordinator never blocks worker slots.
- **Compile-time compensation enforcement:** Because `LockReleaseCandidateAction` declares `compensateWith: CompensateReleaseCandidateAction`, `agboss check` statically verifies that every `.onError(...)` path leaving `VerifyReleaseSmokeGateAction` invokes `CompensateReleaseCandidateAction` before reaching `ReleaseRecoveryPlannedWorkflowFinish` (otherwise compilation fails with `[flow.uncompensated-action]`).
- **Role segregation (`@Action` vs `@Agent`):** Deterministic steps (`DecomposeReleaseTasksAction`, `CompensateReleaseCandidateAction`, `PromoteReleaseArtifactsAction`) handle filesystem and database mutations, while `ReleaseRecoveryPlannerAgent` (`model: "openai/gpt-4o-mini"`) runs **only after** compensation completes, querying diagnostics via `InspectFailedAttemptTool` to produce a typed `RecoveryPlanDto`.

<!-- snippet-context
import {
  AGBossError,
  Action,
  Agent,
  Tool,
  WorkflowFinish,
  WorkflowStart,
  listOf,
  oneOf,
  type ActionHandler,
  type InputOf,
  type OutputOf,
  type ToolHandler,
} from "@agboss/core";
import { Text } from "@agboss/core/dto";
import {
  PreparedModuleCandidateDto,
  StageModuleArtifactAction,
  StagedModuleArtifactDto,
} from "./stage-module-artifact.action.js";

export class ReleaseRequestDto {
  @Text({ prompt: "Release ID" })
  releaseId!: string;
  @Text({ prompt: "Build flags" })
  buildFlags!: string;
}

export class ModuleTaskDto {
  @Text({ prompt: "Logical task ID" })
  logicalTaskId!: string;
  @Text({ prompt: "Module name" })
  moduleName!: string;
}

export class ModuleFailedDto {
  @Text({ prompt: "Failure reason" })
  reason!: string;
}

export class LockedReleaseCandidateDto {
  @Text({ prompt: "Candidate lock ID" })
  candidateLockId!: string;
}

export class CompensatedReleaseCandidateDto {
  @Text({ prompt: "Diagnostic code" })
  gateFailureDiagnostic!: string;
}

export class RecoveryPlanDto {
  @Text({ prompt: "Corrected build flags" })
  correctedBuildFlags!: string;
}

export class ReleaseSummaryDto {
  @Text({ prompt: "Manifest path" })
  manifestPath!: string;
}

export class InspectAttemptInputDto {
  @Text({ prompt: "Release ID" })
  releaseId!: string;
}

export class InspectAttemptOutputDto {
  @Text({ prompt: "Diagnostic summary" })
  diagnostic!: string;
}

export class ReleaseGateFailedError extends AGBossError {
  static override readonly code = "release.gate_failed";

  constructor(message: string) {
    super(message);
    this.name = "ReleaseGateFailedError";
  }
}

@WorkflowStart({ name: "module-worker-workflow-start", description: "Starts module worker", input: ModuleTaskDto })
export class ModuleWorkerWorkflowStart {}

@WorkflowFinish({ name: "module-worker-workflow-finish", description: "Module staged", output: StagedModuleArtifactDto })
export class ModuleWorkerWorkflowFinish {}

@WorkflowFinish({ name: "module-failed-workflow-finish", description: "Module failed", output: ModuleFailedDto })
export class ModuleFailedWorkflowFinish {}

@Action({ name: "prepare-module-candidate-action", description: "Step 1: compile candidate", input: { task: ModuleTaskDto }, output: PreparedModuleCandidateDto })
export class PrepareModuleCandidateAction implements ActionHandler<PrepareModuleCandidateAction> {
  async execute(input: InputOf<PrepareModuleCandidateAction>): Promise<OutputOf<PrepareModuleCandidateAction>> {
    return { logicalTaskId: input.task.value.logicalTaskId, moduleName: input.task.value.moduleName };
  }
}

@Action({ name: "mark-module-failed-action", description: "Records module failure", input: { task: ModuleTaskDto }, output: ModuleFailedDto })
export class MarkModuleFailedAction implements ActionHandler<MarkModuleFailedAction> {
  async execute(input: InputOf<MarkModuleFailedAction>): Promise<OutputOf<MarkModuleFailedAction>> {
    return { reason: `Failed ${input.task.value.moduleName}` };
  }
}

@WorkflowStart({ name: "release-coordinator-workflow-start", description: "Starts release pipeline", input: ReleaseRequestDto })
export class ReleaseCoordinatorWorkflowStart {}

@WorkflowFinish({ name: "release-coordinator-workflow-finish", description: "Release promoted", output: ReleaseSummaryDto })
export class ReleaseCoordinatorWorkflowFinish {}

@WorkflowFinish({ name: "release-recovery-planned-workflow-finish", description: "Recovery plan ready", output: RecoveryPlanDto })
export class ReleaseRecoveryPlannedWorkflowFinish {}

@Action({ name: "decompose-release-tasks-action", description: "Splits release into module tasks", input: { request: ReleaseRequestDto }, output: listOf(ModuleTaskDto) })
export class DecomposeReleaseTasksAction implements ActionHandler<DecomposeReleaseTasksAction> {
  async execute(input: InputOf<DecomposeReleaseTasksAction>): Promise<OutputOf<DecomposeReleaseTasksAction>> {
    return [
      { logicalTaskId: `${input.request.value.releaseId}:auth-service`, moduleName: "auth-service" },
      { logicalTaskId: `${input.request.value.releaseId}:payment-engine`, moduleName: "payment-engine" },
      { logicalTaskId: `${input.request.value.releaseId}:telemetry-collector`, moduleName: "telemetry-collector" },
    ];
  }
}

@Action({ name: "compensate-release-candidate-action", description: "Deletes staged files and marks candidate COMPENSATED", input: { candidate: LockedReleaseCandidateDto } })
export class CompensateReleaseCandidateAction implements ActionHandler<CompensateReleaseCandidateAction> {
  async execute(input: InputOf<CompensateReleaseCandidateAction>): Promise<void> {
    void input.candidate.value.candidateLockId;
  }
}

@Action({
  name: "lock-release-candidate-action",
  description: "Locks staged artifacts into a release candidate",
  input: {
    releaseRequest: ReleaseRequestDto,
    moduleOutcomes: listOf(oneOf(StagedModuleArtifactDto, ModuleFailedDto)),
  },
  output: LockedReleaseCandidateDto,
  compensateWith: CompensateReleaseCandidateAction,
})
export class LockReleaseCandidateAction implements ActionHandler<LockReleaseCandidateAction> {
  async execute(input: InputOf<LockReleaseCandidateAction>): Promise<OutputOf<LockReleaseCandidateAction>> {
    return { candidateLockId: `lock:${input.releaseRequest.value.releaseId}` };
  }
}

@Action({ name: "verify-release-smoke-gate-action", description: "Verifies ABI compatibility smoke gate", input: { request: ReleaseRequestDto, locked: LockedReleaseCandidateDto } })
export class VerifyReleaseSmokeGateAction implements ActionHandler<VerifyReleaseSmokeGateAction> {
  async execute(input: InputOf<VerifyReleaseSmokeGateAction>): Promise<void> {
    if (!input.request.value.buildFlags.includes("--abi-compat=v2")) {
      throw new ReleaseGateFailedError("ABI v2 smoke check failed: missing --abi-compat=v2");
    }
  }
}

@Action({ name: "summarize-compensated-attempt-action", description: "Summarizes rollback state", input: { locked: LockedReleaseCandidateDto }, output: CompensatedReleaseCandidateDto })
export class SummarizeCompensatedAttemptAction implements ActionHandler<SummarizeCompensatedAttemptAction> {
  async execute(input: InputOf<SummarizeCompensatedAttemptAction>): Promise<OutputOf<SummarizeCompensatedAttemptAction>> {
    return { gateFailureDiagnostic: `Compensated ${input.locked.value.candidateLockId}; missing --abi-compat=v2` };
  }
}

@Tool({ name: "inspect-failed-attempt-tool", description: "Queries SQLite release ledger for compensation verification", input: InspectAttemptInputDto, output: InspectAttemptOutputDto })
export class InspectFailedAttemptTool implements ToolHandler<InspectAttemptInputDto, InspectAttemptOutputDto> {
  async run(input: InspectAttemptInputDto): Promise<InspectAttemptOutputDto> {
    return { diagnostic: `allCompensated=true for ${input.releaseId}; required flag --abi-compat=v2` };
  }
}

@Agent({
  name: "release-recovery-planner-agent",
  description: "Produces a corrected recovery plan after verifying Attempt 1 compensation",
  prompt: "Call inspect-failed-attempt-tool to confirm compensation, then output corrected build flags.",
  model: "openai/gpt-4o-mini",
  tools: [InspectFailedAttemptTool],
  input: {
    releaseRequest: ReleaseRequestDto,
    compensatedCandidate: CompensatedReleaseCandidateDto,
  },
  output: RecoveryPlanDto,
})
export class ReleaseRecoveryPlannerAgent {}

@Action({ name: "promote-release-artifacts-action", description: "Writes final release-manifest.json", input: { locked: LockedReleaseCandidateDto }, output: ReleaseSummaryDto })
export class PromoteReleaseArtifactsAction implements ActionHandler<PromoteReleaseArtifactsAction> {
  async execute(input: InputOf<PromoteReleaseArtifactsAction>): Promise<OutputOf<PromoteReleaseArtifactsAction>> {
    return { manifestPath: `promoted/${input.locked.value.candidateLockId}/release-manifest.json` };
  }
}
// @snippet
-->
```ts title="src/workflows/release-coordinator/release-coordinator.workflow.ts" file=release-coordinator.workflow.ts
import {
  ChildPlacement,
  StepFailedError,
  Workflow,
  action,
  start,
  toAction,
} from "@agboss/core";

@Workflow({
  name: "module-worker-workflow",
  version: "1.0.0",
  flow: [
    start(ModuleWorkerWorkflowStart)
      .returns(ModuleTaskDto)
      .toAction(PrepareModuleCandidateAction)
      .onError(StepFailedError, toAction(MarkModuleFailedAction))
      .returns(PreparedModuleCandidateDto)
      .toAction(StageModuleArtifactAction)
      .onError(StepFailedError, toAction(MarkModuleFailedAction))
      .returns(StagedModuleArtifactDto)
      .toFinish(ModuleWorkerWorkflowFinish),

    action(MarkModuleFailedAction)
      .returns(ModuleFailedDto)
      .toFinish(ModuleFailedWorkflowFinish),
  ],
})
export class ModuleWorkerWorkflow {}

@Workflow({
  name: "release-coordinator-workflow",
  version: "1.0.0",
  flow: [
    start(ReleaseCoordinatorWorkflowStart)
      .returns(ReleaseRequestDto)
      .toAction(DecomposeReleaseTasksAction)
      .returns(listOf(ModuleTaskDto))
      .toParallelWorkflows(ModuleWorkerWorkflow, {
        maxConcurrency: 4,
        maxItems: 8,
        placement: ChildPlacement.AnyInstance,
      })
      .join()
      .returns(listOf(oneOf(StagedModuleArtifactDto, ModuleFailedDto)))
      .toAction(LockReleaseCandidateAction)
      .returns(LockedReleaseCandidateDto)
      .toAction(VerifyReleaseSmokeGateAction)
      .onError(
        ReleaseGateFailedError,
        toAction(CompensateReleaseCandidateAction)
          .toAction(SummarizeCompensatedAttemptAction)
          .returns(CompensatedReleaseCandidateDto)
          .toAgent(ReleaseRecoveryPlannerAgent)
          .returns(RecoveryPlanDto)
          .toFinish(ReleaseRecoveryPlannedWorkflowFinish),
      )
      .toAction(PromoteReleaseArtifactsAction)
      .returns(ReleaseSummaryDto)
      .toFinish(ReleaseCoordinatorWorkflowFinish),
  ],
})
export class ReleaseCoordinatorWorkflow {}
```

---

### 2. Two-Layer Zombie Worker Lease Fencing (`leaseEpoch` + `LeasedCheckpointSaver`)

A critical distributed-systems detail demonstrated by this showcase is **why two fencing layers are required** when an `@Action` mutates external state (such as a database or object store):

1. **Layer 1 — External Side-Effect Boundary (`leaseEpoch` Fencing Token + `step.idempotencyKey`):**  
   AGBoss's runtime `LeasedCheckpointSaver` renews and validates the 30-second execution lease when a step *finishes* and writes its LangGraph checkpoint. However, an `@Action`'s external side effect runs *inside* `execute()`—before returning control to LangGraph. If Worker A freezes inside `execute()` right before writing to the external database, Worker B will reclaim the expired lease with `leaseEpoch = 2`, resume from Worker A's Step 1 checkpoint (`PrepareModuleCandidateAction`), and commit Step 2.  
   To prevent Worker A's delayed write from overwriting Worker B's committed artifact, `StageModuleArtifactAction` captures the active `(instanceId, leaseEpoch)` token at step entry and validates `capturedLeaseEpoch >= activeLeaseEpoch` transactionally inside the SQLite release ledger alongside `executionContext.step.idempotencyKey`. When Zombie Worker A wakes up, `1 < 2` triggers `StaleLeaseFenceError` (`ZOMBIE_WRITE_REJECTED`), and `executionContext.signal.aborted` confirms lease loss.
2. **Layer 2 — AGBoss Runtime Checkpoint Boundary (`LeasedCheckpointSaver`):**  
   After catching `StaleLeaseFenceError` and returning from the action, LangGraph attempts to persist Worker A's checkpoint via `LeasedCheckpointSaver.putWrites()`. That calls `SqliteExecutionLeaseRepository.renew({ leaseEpoch: 1 })`, which returns `false` (`RUNTIME_LEASE_FENCED`) and throws `ExecutionLeaseLostError` (`execution.lease-lost`)—terminating the zombie execution without running `.onError` handlers or touching Worker B's completed state.

<!-- snippet-context
import { Text } from "@agboss/core/dto";

export class PreparedModuleCandidateDto {
  @Text({ prompt: "Logical task ID" })
  logicalTaskId!: string;
  @Text({ prompt: "Module name" })
  moduleName!: string;
}

export class StagedModuleArtifactDto {
  @Text({ prompt: "Logical task ID" })
  logicalTaskId!: string;
  @Text({ prompt: "Artifact ID" })
  artifactId!: string;
}
// @snippet
-->
```ts title="src/actions/stage-module-artifact.action.ts" file=stage-module-artifact.action.ts
import {
  AGBossError,
  Action,
  ApplicationContext,
  ExecutionContext,
  Injectable,
  type ActionHandler,
  type InputOf,
  type OutputOf,
} from "@agboss/core";

export class StaleLeaseFenceError extends AGBossError {
  static override readonly code = "release.stale_lease_fence";

  constructor(executionId: string, capturedEpoch: number, activeEpoch: number) {
    super(
      `Fenced stale write for ${executionId}: epoch ${String(capturedEpoch)} < ${String(activeEpoch)}`,
    );
    this.name = "StaleLeaseFenceError";
  }
}

@Injectable({ deps: [ApplicationContext] })
export class ReleaseLedgerFencingService {
  constructor(private readonly appContext: ApplicationContext) {}

  async captureActiveLease(executionId: string): Promise<{ instanceId: string; leaseEpoch: number }> {
    void executionId;
    return { instanceId: this.appContext.instanceId, leaseEpoch: 1 };
  }

  async commitStagedArtifactFenced(params: {
    logicalTaskId: string;
    executionId: string;
    capturedInstanceId: string;
    capturedLeaseEpoch: number;
    idempotencyKey: string;
    activeLeaseEpoch?: number;
  }): Promise<{ artifactId: string }> {
    const currentEpoch = params.activeLeaseEpoch ?? params.capturedLeaseEpoch;
    if (params.capturedLeaseEpoch < currentEpoch) {
      throw new StaleLeaseFenceError(
        params.executionId,
        params.capturedLeaseEpoch,
        currentEpoch,
      );
    }
    return { artifactId: `art:${params.logicalTaskId}:${params.idempotencyKey}` };
  }
}

@Action({
  name: "stage-module-artifact-action",
  description: "Commits a lease-fenced artifact record using leaseEpoch and step.idempotencyKey",
  input: { preparedCandidate: PreparedModuleCandidateDto },
  output: StagedModuleArtifactDto,
  deps: [ReleaseLedgerFencingService, ExecutionContext],
})
export class StageModuleArtifactAction implements ActionHandler<StageModuleArtifactAction> {
  constructor(
    private readonly ledger: ReleaseLedgerFencingService,
    private readonly executionContext: ExecutionContext,
  ) {}

  async execute(
    input: InputOf<StageModuleArtifactAction>,
  ): Promise<OutputOf<StageModuleArtifactAction>> {
    const candidate = input.preparedCandidate.value;
    const lease = await this.ledger.captureActiveLease(this.executionContext.executionId);

    // Layer 1 Fence: transactional leaseEpoch + step.idempotencyKey check at external DB boundary.
    // Layer 2 Fence: LeasedCheckpointSaver subsequently verifies renew(leaseEpoch) on checkpoint write.
    const staged = await this.ledger.commitStagedArtifactFenced({
      logicalTaskId: candidate.logicalTaskId,
      executionId: this.executionContext.executionId,
      capturedInstanceId: lease.instanceId,
      capturedLeaseEpoch: lease.leaseEpoch,
      idempotencyKey: this.executionContext.step.idempotencyKey,
    });

    return {
      logicalTaskId: candidate.logicalTaskId,
      artifactId: staged.artifactId,
    };
  }
}
```

---

### 3. Deterministic `$0` Offline Testing (`testWith` & `mockLlm`)

Every failure mode in the showcase—smoke gate failure, LIFO saga rollback, tool-assisted AI recovery planning, and multi-instance child takeover—is verified offline in milliseconds with `testWith` and `mockLlm`:

<!-- snippet-context
import { Budget, BudgetPeriod, BudgetScope, type BudgetHandler } from "@agboss/core";
import { usd, type Usd } from "@agboss/core/units";
import {
  CompensateReleaseCandidateAction,
  InspectFailedAttemptTool,
  LockReleaseCandidateAction,
  RecoveryPlanDto,
  ReleaseCoordinatorWorkflow,
  ReleaseCoordinatorWorkflowFinish,
  ReleaseCoordinatorWorkflowStart,
  ReleaseRecoveryPlannedWorkflowFinish,
  ReleaseRecoveryPlannerAgent,
} from "./release-coordinator.workflow.js";

@Budget({ name: "showcase-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class ShowcaseAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(10); } }
@Budget({ name: "showcase-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class ShowcaseTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "showcase-exec-budget", scope: BudgetScope.Execution })
export class ShowcaseExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(1); } }
// @snippet
-->
```ts title="tests/workflows/release-coordinator/release-coordinator.workflow.test.ts" file=release-coordinator.workflow.test.ts
import { Application, EmptyEnvironment } from "@agboss/core";
import { callTool, replyWith, testWith } from "@agboss/core/testing";
import { expect } from "vitest";

@Application({
  name: "distributed-agent-recovery-app",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [ReleaseCoordinatorWorkflow],
  budgets: [ShowcaseAppBudget, ShowcaseTenantBudget, ShowcaseExecBudget],
})
export class DistributedAgentRecoveryApp {}

const test = testWith(DistributedAgentRecoveryApp);

test("compensates Attempt 1 on smoke gate failure, plans AI recovery, and promotes Attempt 2", async ({
  app,
  mockLlm,
}) => {
  const correctedFlags = "--opt-level=3 --deterministic --abi-compat=v2";
  mockLlm(ReleaseRecoveryPlannerAgent).thenReturn(
    callTool(InspectFailedAttemptTool, { releaseId: "rel-2026.10.0" }),
    replyWith(RecoveryPlanDto, {
      correctedBuildFlags: correctedFlags,
    }),
  );

  // Attempt 1 omits --abi-compat=v2 -> triggers LIFO compensation + AI recovery plan
  const attempt1 = await app.execute(
    ReleaseCoordinatorWorkflowStart,
    {
      releaseId: "rel-2026.10.0",
      buildFlags: "--opt-level=3 --deterministic",
    },
    { record: true },
  );
  expect(attempt1).toFinishWith(ReleaseRecoveryPlannedWorkflowFinish, {
    correctedBuildFlags: correctedFlags,
  });
  expect(attempt1).toHaveCompensated(LockReleaseCandidateAction, {
    by: CompensateReleaseCandidateAction,
  });
  expect(attempt1).toHaveCalledTools([InspectFailedAttemptTool]);

  // Attempt 2 applies the AI-corrected flags -> passes smoke gate & promotes release
  const attempt2 = await app.execute(ReleaseCoordinatorWorkflowStart, {
    releaseId: "rel-2026.10.0",
    buildFlags: correctedFlags,
  });
  expect(attempt2.finish).toBe(ReleaseCoordinatorWorkflowFinish);
});
```

---

## Multi-Process Load Balancing & Real 30s Wall-Clock Proof

In addition to fast virtual-clock tests, [`agbossjs/distributed-agent-recovery`](https://github.com/agbossjs/distributed-agent-recovery) runs as a **compiled multi-process OS application** (`node dist/src/demo.js --cluster --real-clock`) spawning independent `node dist/worker/main.js` processes over a shared SQLite WAL database with AGBoss's untouched 30-second sweep timer (`Clock`) and real POSIX `SIGSTOP` / `SIGCONT` process signals:

- **Cross-Process Sibling Fairness (`ClusterSqliteChildExecutionQueueRepository`):** In multi-process clusters, in-memory `EventEmitter` wakeups do not cross OS process boundaries; workers discover queued `ChildPlacement.AnyInstance` tasks on their periodic sweep ticks. By measuring a sibling fairness grace window from `min(claimed_at)` of the batch, the first awakened worker claims its share and yields remaining sibling tasks so peer worker PIDs participate concurrently (`1 / 2` task split across Worker Alpha and Worker Beta in both Attempt 1 and Attempt 2).
- **Expired-Lease `Running` Child Reclamation:** When Worker Alpha freezes (`kill -STOP <pid>`) after checkpointing Step 1 of `payment-engine`, its row in `child_execution_queue` remains `Running` while `execution_leases.expires_at` passes the 30-second wall-clock TTL. On the next sweep, Worker Beta atomically requeues the expired sibling row, acquires `leaseEpoch = 2`, logs `execution.recovered`, loads Worker Alpha's Step 1 checkpoint without re-running Step 1, and commits Step 2.
- **Live OpenRouter Verification (`--live`):** With `OPENROUTER_API_KEY` set, `ReleaseRecoveryPlannerAgent` calls `openai/gpt-4o-mini` live (`~$0.00036` total run cost), invokes `InspectFailedAttemptTool` against SQLite to verify Attempt 1 compensation, and returns the structured `RecoveryPlanDto` that drives Attempt 2 to completion.

---

## The 8 Automated Invariants

Every demo and CI run executes `ReleaseInvariantVerifierService` against both the application's SQLite ledger tables (`release_artifacts`, `release_candidate_locks`, `fencing_tokens`, `ledger_events`), **AGBoss's internal SQLite cluster tables** (`execution_leases`, `checkpoints`, `child_execution_queue`) via `ClusterSnapshotRepository`, and on-disk `*.manifest.json` files, exiting non-zero if any invariant is violated:

| # | Invariant ID | What It Proves |
| :--- | :--- | :--- |
| **1** | `INV-1-ALL-MODULES-COMPLETED` | All 3 expected modules (`auth-service`, `payment-engine`, `telemetry-collector`) reached `PROMOTED` status in Attempt 2. |
| **2** | `INV-2-FINAL-ARTIFACTS-EXIST` | `release-manifest.json` and all 3 promoted `*.manifest.json` files exist on disk and match SQLite ledger records. |
| **3** | `INV-3-NO-FAILED-ATTEMPT-ARTIFACTS-ACTIVE` | Zero Attempt 1 rows remain active in SQLite and zero Attempt 1 `.artifact.json` staging files remain on disk. |
| **4** | `INV-4-SAGA-COMPENSATIONS-RECORDED-AND-APPLIED` | `CompensateReleaseCandidateAction` marked Attempt 1's candidate lock and all 3 module artifacts `COMPENSATED` with its `step.idempotencyKey`. |
| **5** | `INV-5-NO-DUPLICATE-EXTERNAL-COMMITS` | Every committed row carries a unique `step.idempotencyKey` and at most one active artifact exists per `(release_id, attempt_number, logical_task_id)`. |
| **6** | `INV-6-MULTI-INSTANCE-PARTICIPATION` | At least 2 distinct AGBoss worker `instanceId`s executed child workflows across the fixed worker pool. |
| **7** | `INV-7-ZOMBIE-WORKER-FENCED` | Verifies Layer 1 (`ZOMBIE_WRITE_REJECTED`) and Layer 2 (`RUNTIME_LEASE_FENCED` when the zombie resumes, or hard process death) **plus independent verification of AGBoss's `execution_leases` (`lease_epoch >= 2`, `holder_instance_id !== stalledInstanceId`, `released = 1`) and `checkpoints` (strictly linear unbranched `parent_checkpoint_id` chain proving zero split-brain zombie checkpoint writes)**. |
| **8** | `INV-8-ORIGINAL-LOGICAL-TASK-COMPLETED-AFTER-TAKEOVER` | `rel-2026.10.0:payment-engine` preserved the **exact same `childExecutionId` and `idempotencyKey`**, with Step 1 prepared by Worker A (`leaseEpoch = 1`), Step 2 completed by Worker B (`leaseEpoch = 2`), `execution_leases.holder_instance_id` matching the committer, and `0` orphaned rows in `child_execution_queue`. |

:::caution[Verification-only internal schema inspection]
`ClusterSnapshotRepository` queries AGBoss's internal SQLite tables (`execution_leases`, `checkpoints`, `child_execution_queue`) directly so `INV-7` and `INV-8` can audit lease epochs and checkpoint ancestry independently of application event logs. This direct table inspection is a **diagnostic verification dependency coupled to `@agboss/core@0.1.0`'s internal schema**, not a recommended application integration API.
:::

---

## Quickstart Commands

Clone [`agbossjs/distributed-agent-recovery`](https://github.com/agbossjs/distributed-agent-recovery) (requires **Node.js `>= 22.13.0`** for built-in `node:sqlite`):

```bash
git clone https://github.com/agbossjs/distributed-agent-recovery.git
cd distributed-agent-recovery

# 1. Recommended first-time workflow (100% offline default, $0 cost, no API key needed)
npm ci
npm run check
npm test
npx tsx src/demo.ts --cluster
npx tsx src/demo.ts --verify-only

# 2. Optional: Live OpenRouter inference (openai/gpt-4o-mini + InspectFailedAttemptTool)
OPENROUTER_API_KEY="sk-or-v1-..." npx tsx src/demo.ts --live

# 3. Optional: Compiled multi-process OS cluster with untouched 30s lease TTL & POSIX SIGSTOP/SIGCONT
npm run build
node dist/src/demo.js --cluster --real-clock

# 4. Optional: Combine real-clock POSIX SIGSTOP cluster with live OpenRouter inference
OPENROUTER_API_KEY="sk-or-v1-..." node dist/src/demo.js --cluster --live --real-clock

# 5. Optional: 4-container Docker Compose cluster & clean volume teardown
docker compose -f deploy/compose/docker-compose.yml up -d --build --wait worker-alpha worker-beta
docker compose -f deploy/compose/docker-compose.yml run --rm -T --no-deps coordinator node dist/src/demo.js
docker compose -f deploy/compose/docker-compose.yml down -v --remove-orphans
```

---

## Canonical Directory Layout & Guarantee Boundaries

The repository enforces strict `<kind>/<name>.<kind>.<ext>` role separation (`1 class = 1 file`, `< 200` lines per file, Drizzle ORM repositories in `src/repositories/`, Drizzle table schemas in `src/schemas/`, pure `.sql` DDL migrations in `src/sql/`, domain errors in `src/errors/`, stateless `@Injectable` services in `src/services/`, and symmetric `tests/` mirroring `src/`).

:::note[Guarantee boundaries & shared storage scope]
- **Two-Layer Fencing Contract:** AGBoss protects runtime lease ownership, LIFO compensation orchestration, checkpoint recovery, and `LeasedCheckpointSaver` writes; the application's ledger enforces external side-effect fencing (`leaseEpoch` + `step.idempotencyKey`) and physical file cleanup.
- **At-Least-Once Execution with Idempotent Effects (Not "Exactly-Once"):** Lease takeover replays unfinished steps *at-least-once* from the last committed checkpoint; duplicate external commits are prevented by deterministic `step.idempotencyKey` values and monotonic `leaseEpoch` fencing.
- **Reversible Compensation vs. Hard-Kill Recovery:** Saga compensation undoes reversible staging operations in an active workflow before routing `ReleaseGateFailedError`, whereas a hard-killed worker (`SIGKILL` / `exit 137`) does not execute in-process compensation on death—its lease expires and a surviving worker resumes from the last committed checkpoint.
- **Fixed Worker Pool & Single-Host SQLite WAL:** The showcase distributes and recovers work across a fixed pool of workers (not dynamic autoscaling) sharing a local SQLite database in `WAL` mode on a single host (local processes, Docker Compose volume, or single-node `kind`). Multi-node distributed deployments across separate hosts require network-backed storage repositories (such as PostgreSQL) implementing the same monotonic `leaseEpoch` fencing contract (see [Multi-Instance, Leases & SQLite](/guides/persistence-and-recovery/)).
:::
