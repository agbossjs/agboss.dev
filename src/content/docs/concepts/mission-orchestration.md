---
title: Digital & Physical AI Missions (System-2 Planner)
description: How AGBoss orchestrates complex digital workflows and acts as the System-2 high-level mission planner for Physical AI, robotics, and devices.
---

AGBoss is a strictly typed TypeScript application framework designed for **complex multi-agent workflows and long-running autonomous missions** on top of [LangGraph](https://www.langchain.com/langgraph). While lightweight prompt chains and untyped graphs suffice for conversational chatbots, production digital operations and physical autonomous systems require static graph and saga verification (`agboss check`), automatic LIFO side-effect compensation (`compensateWith` / `committedBy`), pre-call FinOps budget reservations, multi-instance lease work-stealing, and two-phase human-in-the-loop pauses with automatic button withdrawal (`ChannelHandler.withdraw`).

## Why do high-consequence digital and physical AI systems need a System-2 orchestrator?

One unified `@Application` architecture in AGBoss governs both long-running enterprise backend pipelines and high-level physical autonomy:

| Capability | Digital Autonomous Missions (FinTech, SecOps, Enterprise Ops) | Physical AI, Robotics & Smart Devices (System-2 Mission Planner) |
| :--- | :--- | :--- |
| **Execution Horizon** | Runs lasting minutes to days across distributed child workflows (`.toParallelWorkflows`) claimed by idle Kubernetes pods via `ExecutionLeaseRepository`. | Deliberative mission planning (1–10 Hz) layered above 100–1000 Hz real-time hardware controllers, motor drivers, and local safety reflexes. |
| **Multimodal & Multi-Agent Quorum** | Parallel specialist agents (risk, compliance, fraud) joined via `.acceptedBy(Arbiter).joinQuorum({ min, max, deadline })` with instant `AbortSignal` cancellation of stragglers. | Multiple multimodal vision/spatial models cross-checked by a deterministic `@Arbiter` before executing an irreversible physical maneuver. |
| **Human-in-the-Loop & Withdrawal** | Two-phase `@ChannelRole` pauses (`Pending → Resolved` CAS) in Slack/Teams; `ChannelHandler.withdraw` removes stale buttons when quorum or `FailFast` resolves early. | Safe mission hold requesting operator confirmation with camera/sensor telemetry; `withdraw` dismisses the operator prompt if a sibling branch or abort resolves first. |
| **Static Verification (`agboss check`)** | Compile-time Path Scope proof (`[input.outdated-on-path]`), DTO validation, and static saga verification (`[flow.uncompensated-action]`). | Strict coordinate, velocity, and torque bounds verified via DTO schemas and `agboss check` before any command reaches the hardware bridge. |
| **Automatic LIFO Saga Compensation** | Reverses external API/database mutations (`ReleaseEscrowAction`, `RevokeOfferAction`) in reverse order on `app.cancel`, `FailFast`, `Surplus`, or `@Budget` breach. | Executes deterministic compensating `@Action` nodes (`ReturnToSafeHoldAction`, `DisarmGripperAction`) in LIFO order under a dedicated `compensationTimeout` cleanup window. |

## How does AGBoss orchestrate long-running digital missions with transactional sagas?

In enterprise backend, FinTech, and incident-response pipelines, workflows mutate external systems over hours or days while fanning out into child workflows and waiting on human approvals. AGBoss ensures that every uncommitted external mutation declares its `compensateWith` rollback action and optional `committedBy` commit boundary, unwinding side effects in reverse completion order (LIFO) if the mission is cancelled or aborted:

<!--
```ts file=src/missions/escrow.dto.ts
import { Decimal, Text } from "@agboss/core/dto";

export class TransferRequestDto { @Decimal() amountUsd!: number; }
export class EscrowHoldDto { @Text() holdId!: string; @Decimal() amountUsd!: number; }
export class LedgerEntryDto { @Text() entryId!: string; }
export class ComplianceClearanceDto { @Text() region!: string; }
```
-->
<!-- snippet-context
import { Agent, WorkflowFinish, WorkflowStart } from "@agboss/core";
import { ComplianceClearanceDto, EscrowHoldDto, LedgerEntryDto, TransferRequestDto } from "./escrow.dto.js";
@WorkflowStart({ name: "settlement-workflow-start", description: "Start", input: TransferRequestDto })
export class SettlementStart {}
@WorkflowFinish({ name: "settlement-workflow-finish", description: "Finish", output: EscrowHoldDto })
export class SettlementFinish {}
@WorkflowFinish({ name: "settlement-rolled-back-workflow-finish", description: "Rolled back", output: TransferRequestDto })
export class SettlementRolledBackFinish {}
@WorkflowStart({ name: "compliance-check-workflow-start", description: "Child start", input: LedgerEntryDto })
export class ComplianceCheckStart {}
@WorkflowFinish({ name: "compliance-check-workflow-finish", description: "Child finish", output: ComplianceClearanceDto })
export class ComplianceCheckFinish {}
@Agent({ name: "compliance-check-agent", description: "Checks entry", model: "moonshotai/kimi-k2.6", prompt: "Check.", input: { entry: LedgerEntryDto }, output: ComplianceClearanceDto })
export class ComplianceCheckAgent {}
@Workflow({
  name: "compliance-check-workflow",
  version: "1.0.0",
  flow: [start(ComplianceCheckStart).returns(LedgerEntryDto).toAgent(ComplianceCheckAgent).returns(ComplianceClearanceDto).toFinish(ComplianceCheckFinish)],
})
export class ComplianceCheckWorkflow {}
// @snippet
-->
```ts title="src/missions/escrow-settlement.workflow.ts" file=src/missions/escrow-settlement.workflow.ts
import { StepFailedError, Workflow, listOf, start, toAction } from "@agboss/core";
import {
  CommitSettlementAction,
  HoldEscrowFundsAction,
  ProvisionLedgerEntryAction,
  ReleaseEscrowFundsAction,
  ReverseLedgerEntryAction,
} from "./escrow.actions.js";

@Workflow({
  name: "escrow-settlement-workflow",
  version: "1.0.0",
  maxConcurrentExecutions: 12,
  flow: [
    start(SettlementStart)
      .returns(TransferRequestDto)
      .toAction(HoldEscrowFundsAction)
      .returns(EscrowHoldDto)
      .toAction(ProvisionLedgerEntryAction)
      .returns(listOf(LedgerEntryDto))
      // Distributed child workflows work-stolen across cluster instances:
      .toParallelWorkflows(ComplianceCheckWorkflow, {
        maxItems: 6,
        maxConcurrency: 4,
      })
      .join()
      .onJoinError(
        StepFailedError,
        toAction(ReverseLedgerEntryAction)
          .toAction(ReleaseEscrowFundsAction)
          .toFinish(SettlementRolledBackFinish),
      )
      .returns(listOf(ComplianceClearanceDto))
      // Commit boundary: marks both HoldEscrowFundsAction and ProvisionLedgerEntryAction committed
      .toAction(CommitSettlementAction)
      .toFinish(SettlementFinish),
  ],
})
export class EscrowSettlementWorkflow {}
```

<!-- snippet-context
import { listOf } from "@agboss/core";
import { ComplianceClearanceDto, EscrowHoldDto, LedgerEntryDto, TransferRequestDto } from "./escrow.dto.js";
// @snippet
@Action({
  name: "reverse-ledger-entry-action",
  description: "Reverses provisional ledger entries",
  input: { entries: listOf(LedgerEntryDto) },
})
export class ReverseLedgerEntryAction implements ActionHandler<ReverseLedgerEntryAction> {
  async execute(): Promise<void> {}
}
@Action({
  name: "provision-ledger-entry-action",
  description: "Creates provisional ledger entries",
  input: { hold: EscrowHoldDto },
  output: listOf(LedgerEntryDto),
  compensateWith: ReverseLedgerEntryAction,
  committedBy: CommitSettlementAction,
})
export class ProvisionLedgerEntryAction implements ActionHandler<ProvisionLedgerEntryAction> {
  execute(): Promise<OutputOf<ProvisionLedgerEntryAction>> {
    return Promise.resolve([{ entryId: "led_1" }]);
  }
}
-->
```ts title="src/missions/escrow.actions.ts" file=src/missions/escrow.actions.ts
import { Action, ExecutionContext, type ActionHandler, type InputOf, type OutputOf } from "@agboss/core";

@Action({
  name: "release-escrow-funds-action",
  description: "Compensates HoldEscrowFundsAction by releasing reserved funds back to the source account",
  input: { hold: EscrowHoldDto },
  deps: [ExecutionContext],
})
export class ReleaseEscrowFundsAction implements ActionHandler<ReleaseEscrowFundsAction> {
  constructor(private readonly executionContext: ExecutionContext) {}

  async execute(input: InputOf<ReleaseEscrowFundsAction>): Promise<void> {
    // Runs automatically in LIFO order on app.cancel, FailFast, quorum Surplus, or @Budget breach
    void input.hold.value.holdId;
    void this.executionContext.step.idempotencyKey;
  }
}

@Action({
  name: "commit-settlement-action",
  description: "Finalizes settlement; once completed, earlier compensators are marked committed",
  input: { hold: EscrowHoldDto, clearances: listOf(ComplianceClearanceDto) },
})
export class CommitSettlementAction implements ActionHandler<CommitSettlementAction> {
  async execute(): Promise<void> {}
}

@Action({
  name: "hold-escrow-funds-action",
  description: "Places an external escrow hold that must be released if settlement does not commit",
  input: { request: TransferRequestDto },
  output: EscrowHoldDto,
  compensateWith: ReleaseEscrowFundsAction,
  committedBy: CommitSettlementAction,
  deps: [ExecutionContext],
})
export class HoldEscrowFundsAction implements ActionHandler<HoldEscrowFundsAction> {
  constructor(private readonly executionContext: ExecutionContext) {}

  async execute(input: InputOf<HoldEscrowFundsAction>): Promise<OutputOf<HoldEscrowFundsAction>> {
    return { holdId: `hold_${this.executionContext.step.idempotencyKey}`, amountUsd: input.request.value.amountUsd };
  }
}
```

```ts title="test/escrow-settlement.test.ts" file=test/escrow-settlement.test.ts
import { expect, it } from "vitest";
import { testAction } from "@agboss/core/testing";
import { HoldEscrowFundsAction } from "../src/missions/escrow.actions.js";
import { SettlementStart } from "../src/missions/escrow-settlement.workflow.js";

it("creates an idempotent escrow hold from TransferRequestDto", async () => {
  const runHold = testAction(HoldEscrowFundsAction);
  const { output } = await runHold({
    request: {
      value: { amountUsd: 25_000 },
      producer: SettlementStart,
    },
  });
  expect(output.amountUsd).toBe(25_000);
  expect(output.holdId).toContain("hold_");
});
```

## How does the dual-loop architecture work for Physical AI and robotics?

Autonomous robots, drones, and smart industrial devices separate control into two distinct loops:
1. **System 1 — Real-Time Hardware Control Loop (100–1000 Hz):** Low-level firmware, PID/MPC controllers, actuator drivers, and hardware safety interlocks handle sub-millisecond stabilization, collision reflexes, and emergency stops.
2. **System 2 — Deliberative Mission Orchestrator (`agboss`):** Runs as the high-level "cerebral cortex" that sequences multi-stage physical missions, fuses multimodal VLM/LLM assessments via `.joinQuorum()` and `@Arbiter`, pauses for remote human tele-supervision via `@ChannelRole` (with `withdraw` when resolved), verifies all target coordinates through typed DTOs, and triggers deterministic LIFO compensating actions (`SafeParkManipulatorAction`) whenever a mission is aborted:

<!--
```ts file=src/robotics/robotics.dto.ts
import { Decimal, Integer, Text } from "@agboss/core/dto";

export class MissionTargetDto { @Text() valveId!: string; }
export class SensorFrameDto { @Text() frameId!: string; }
export class PoseAssessmentDto { @Decimal() confidence!: number; @Integer() obstacleClearanceCm!: number; }
export class ValveTurnReceiptDto { @Text() status!: string; }
export class ValveTurnCommandDto { @Text() valveId!: string; }
```
-->
<!-- snippet-context
import { ActionFailedError, Agent, WorkflowFinish, WorkflowStart, toAction } from "@agboss/core";
import { MissionTargetDto, PoseAssessmentDto, SensorFrameDto, ValveTurnReceiptDto } from "./robotics.dto.js";
@WorkflowStart({ name: "mission-workflow-start", description: "Start", input: MissionTargetDto })
export class MissionStart {}
@WorkflowFinish({ name: "mission-completed-workflow-finish", description: "Finish", output: ValveTurnReceiptDto })
export class MissionCompletedFinish {}
@WorkflowFinish({ name: "mission-aborted-workflow-finish", description: "Aborted", output: MissionTargetDto })
export class MissionAbortedFinish {}
@Agent({ name: "primary-spatial-vlm-agent", description: "Primary VLM", model: "moonshotai/kimi-k2.6", prompt: "Assess pose.", input: { frame: SensorFrameDto }, output: PoseAssessmentDto })
export class PrimarySpatialVlmAgent {}
@Agent({ name: "backup-spatial-vlm-agent", description: "Backup VLM", model: "moonshotai/kimi-k2.6", prompt: "Assess pose.", input: { frame: SensorFrameDto }, output: PoseAssessmentDto })
export class BackupSpatialVlmAgent {}
@Agent({ name: "thermal-vlm-agent", description: "Thermal VLM", model: "moonshotai/kimi-k2.6", prompt: "Assess thermal.", input: { frame: SensorFrameDto }, output: PoseAssessmentDto })
export class ThermalVlmAgent {}
// @snippet
-->
```ts title="src/robotics/inspection-mission.workflow.ts" file=src/robotics/inspection-mission.workflow.ts
import { Arbiter, DecidedBy, OnAnswer, Workflow, listOf, start } from "@agboss/core";
import { seconds } from "@agboss/core/units";
import {
  AcquireTelemetryAction,
  ArmManipulatorAction,
  ExecuteValveTurnAction,
  SafeParkManipulatorAction,
} from "./robotics.actions.js";

@Arbiter({
  name: "pose-consensus-arbiter",
  decidedBy: DecidedBy.Code,
})
export class PoseConsensusArbiter {
  @OnAnswer(PrimarySpatialVlmAgent)
  fromPrimarySpatialVlm(answer: PoseAssessmentDto): boolean {
    return answer.confidence >= 0.92 && answer.obstacleClearanceCm >= 15;
  }

  @OnAnswer(BackupSpatialVlmAgent)
  fromBackupSpatialVlm(answer: PoseAssessmentDto): boolean {
    return answer.confidence >= 0.92 && answer.obstacleClearanceCm >= 15;
  }

  @OnAnswer(ThermalVlmAgent)
  fromThermalVlm(answer: PoseAssessmentDto): boolean {
    return answer.confidence >= 0.92 && answer.obstacleClearanceCm >= 15;
  }
}

@Workflow({
  name: "valve-inspection-mission-workflow",
  version: "1.0.0",
  maxSteps: 16,
  flow: [
    start(MissionStart)
      .returns(MissionTargetDto)
      .toAction(AcquireTelemetryAction)
      .returns(SensorFrameDto)
      // 1. Multimodal perception quorum: 2-of-3 vision models must agree via PoseConsensusArbiter
      .toParallelAgents(PrimarySpatialVlmAgent, BackupSpatialVlmAgent, ThermalVlmAgent)
      .acceptedBy(PoseConsensusArbiter)
      .joinQuorum({
        min: 2,
        max: 3,
        deadline: seconds(8),
      })
      .returns(listOf(PoseAssessmentDto))
      // 2. Compensatable hardware state transition: automatically parked in LIFO order on abort
      .toAction(ArmManipulatorAction)
      .toAction(ExecuteValveTurnAction)
      .onError(
        ActionFailedError,
        toAction(SafeParkManipulatorAction)
          .toFinish(MissionAbortedFinish),
      )
      .returns(ValveTurnReceiptDto)
      .toFinish(MissionCompletedFinish),
  ],
})
export class ValveInspectionMissionWorkflow {}
```

<!-- snippet-context
import { Injectable, listOf, type OutputOf } from "@agboss/core";
import { MissionTargetDto, PoseAssessmentDto, SensorFrameDto, ValveTurnReceiptDto } from "./robotics.dto.js";
@Injectable()
export class HardwareBridgeService {
  transitionToSafeHold(_opts: { idempotencyKey: string; signal: AbortSignal }): Promise<void> {
    return Promise.resolve();
  }
  moveToPreGrasp(_poses: readonly PoseAssessmentDto[], _opts: { signal: AbortSignal }): Promise<void> {
    return Promise.resolve();
  }
}
@Action({
  name: "acquire-telemetry-action",
  description: "Reads camera and thermal frame",
  input: { target: MissionTargetDto },
  output: SensorFrameDto,
})
export class AcquireTelemetryAction implements ActionHandler<AcquireTelemetryAction> {
  execute(): Promise<OutputOf<AcquireTelemetryAction>> {
    return Promise.resolve({ frameId: "frm_1" });
  }
}
@Action({
  name: "execute-valve-turn-action",
  description: "Turns the target valve and commits manipulator arm action",
  input: { target: MissionTargetDto },
  output: ValveTurnReceiptDto,
})
export class ExecuteValveTurnAction implements ActionHandler<ExecuteValveTurnAction> {
  execute(): Promise<OutputOf<ExecuteValveTurnAction>> {
    return Promise.resolve({ status: "turned" });
  }
}
// @snippet
-->
```ts title="src/robotics/robotics.actions.ts" file=src/robotics/robotics.actions.ts
import { Action, ExecutionContext, type ActionHandler, type InputOf } from "@agboss/core";

@Action({
  name: "safe-park-manipulator-action",
  description: "Returns the robotic arm to locked safe-hold posture when a mission aborts before completion",
  input: { poses: listOf(PoseAssessmentDto) },
  deps: [ExecutionContext, HardwareBridgeService],
})
export class SafeParkManipulatorAction implements ActionHandler<SafeParkManipulatorAction> {
  constructor(
    private readonly executionContext: ExecutionContext,
    private readonly hardwareBridgeService: HardwareBridgeService,
  ) {}

  async execute(): Promise<void> {
    // Invoked with a live cleanup signal bounded by @Application({ compensationTimeout: seconds(15) })
    await this.hardwareBridgeService.transitionToSafeHold({
      idempotencyKey: this.executionContext.step.idempotencyKey,
      signal: this.executionContext.signal,
    });
  }
}

@Action({
  name: "arm-manipulator-action",
  description: "Unlocks and positions the manipulator arm; compensated by SafeParkManipulatorAction",
  input: { poses: listOf(PoseAssessmentDto) },
  compensateWith: SafeParkManipulatorAction,
  committedBy: ExecuteValveTurnAction,
  deps: [ExecutionContext, HardwareBridgeService],
})
export class ArmManipulatorAction implements ActionHandler<ArmManipulatorAction> {
  constructor(
    private readonly executionContext: ExecutionContext,
    private readonly hardwareBridgeService: HardwareBridgeService,
  ) {}

  async execute(input: InputOf<ArmManipulatorAction>): Promise<void> {
    await this.hardwareBridgeService.moveToPreGrasp(
      input.poses.map((p) => p.value),
      { signal: this.executionContext.signal },
    );
  }
}
```

<!-- snippet-context
import { Agent, Injectable, Tool, Workflow, WorkflowFinish, WorkflowStart, start, type ToolHandler } from "@agboss/core";
import { ValveTurnCommandDto, ValveTurnReceiptDto } from "./robotics.dto.js";
@Injectable()
export class OperatorConsoleService {
  showPrompt(_pauseId: string, _args: ValveTurnCommandDto): Promise<void> { return Promise.resolve(); }
  dismissPrompt(_pauseId: string, _resolution: string): Promise<void> { return Promise.resolve(); }
}
// @snippet
@Tool({
  name: "actuate_valve",
  description: "Actuates high-torque valve with operator confirmation",
  input: ValveTurnCommandDto,
  output: ValveTurnReceiptDto,
  channel: TeleopSafetyChannel,
})
export class ActuateValveTool implements ToolHandler<ValveTurnCommandDto, ValveTurnReceiptDto> {
  run(): Promise<ValveTurnReceiptDto> { return Promise.resolve({ status: "ok" }); }
}
@Agent({
  name: "teleop-valve-agent",
  description: "Executes operator-approved valve actuation",
  model: "moonshotai/kimi-k2.6",
  prompt: "Actuate valve.",
  tools: [ActuateValveTool],
  input: { cmd: ValveTurnCommandDto },
  output: ValveTurnReceiptDto,
})
export class TeleopValveAgent {}
@WorkflowStart({ name: "teleop-workflow-start", description: "Start", input: ValveTurnCommandDto })
export class TeleopStart {}
@WorkflowFinish({ name: "teleop-workflow-finish", description: "Finish", output: ValveTurnReceiptDto })
export class TeleopFinish {}
@Workflow({
  name: "teleop-valve-workflow",
  version: "1.0.0",
  flow: [start(TeleopStart).returns(ValveTurnCommandDto).toAgent(TeleopValveAgent).returns(ValveTurnReceiptDto).toFinish(TeleopFinish)],
})
export class TeleopValveWorkflow {}
-->
```ts title="src/robotics/teleop-approval.channel.ts" file=src/robotics/teleop-approval.channel.ts
import {
  Channel,
  ChannelOf,
  ChannelOutcome,
  ChannelRole,
  PauseAnswerer,
  type ChannelAsk,
  type ChannelWithdrawal,
} from "@agboss/core";

@ChannelRole({
  name: "teleop-safety-channel",
  description: "Requests human operator confirmation with camera frame before high-torque actuation",
  approves: ValveTurnCommandDto,
  answeredBy: PauseAnswerer.Channel,
})
export abstract class TeleopSafetyChannel extends ChannelOf<TeleopSafetyChannel> {}

@Channel({
  name: "console-teleop-safety-channel",
  description: "Publishes interactive approval card to operator console and withdraws on abort/surplus",
  deps: [OperatorConsoleService],
})
export class ConsoleTeleopSafetyChannel extends TeleopSafetyChannel {
  constructor(private readonly operatorConsole: OperatorConsoleService) {
    super();
  }

  async send(ask: ChannelAsk<TeleopSafetyChannel>): Promise<ChannelOutcome<TeleopSafetyChannel>> {
    await this.operatorConsole.showPrompt(ask.pauseId, ask.value.arguments);
    return ChannelOutcome.awaitReply();
  }

  override async withdraw(withdrawal: ChannelWithdrawal<TeleopSafetyChannel>): Promise<void> {
    // Immediately dismisses the operator prompt if mission is cancelled or quorum resolved
    await this.operatorConsole.dismissPrompt(withdrawal.pauseId, withdrawal.resolution);
  }
}
```

```ts title="test/inspection-mission.test.ts" file=test/inspection-mission.test.ts
import { expect, it } from "vitest";
import { testArbiter } from "@agboss/core/testing";
import {
  PoseConsensusArbiter,
  PrimarySpatialVlmAgent,
} from "../src/robotics/inspection-mission.workflow.js";

it("accepts pose assessments only when confidence and obstacle clearance meet safety bounds", async () => {
  const runArbiter = testArbiter(PoseConsensusArbiter);

  const safePose = await runArbiter(PrimarySpatialVlmAgent, {
    confidence: 0.96,
    obstacleClearanceCm: 22,
  });
  expect(safePose.output).toBe(true);

  const tooClose = await runArbiter(PrimarySpatialVlmAgent, {
    confidence: 0.96,
    obstacleClearanceCm: 8,
  });
  expect(tooClose.output).toBe(false);
});
```
