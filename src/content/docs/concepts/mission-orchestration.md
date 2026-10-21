---
title: Digital & Physical AI Missions (System-2 Planner)
description: How AGBoss orchestrates mission-critical digital workflows and acts as the System-2 high-level mission planner for Physical AI, robotics, and devices.
---

AGBoss is a strictly typed TypeScript application framework designed for **mission-critical multi-agent systems and long-running autonomous missions** on top of [LangGraph](https://www.langchain.com/langgraph). While lightweight prompt chains and untyped graphs suffice for conversational chatbots, production digital operations and physical autonomous systems require static graph and saga verification (`agboss check`), automatic LIFO side-effect compensation (`compensateWith` / `committedBy`), pre-call FinOps budget reservations, multi-instance lease work-stealing, and two-phase human-in-the-loop pauses with automatic button withdrawal (`ChannelHandler.withdraw`).

## Why do mission-critical digital and physical AI systems need a System-2 orchestrator?

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

```ts title="src/missions/escrow-settlement.workflow.ts" no-check: digital mission example
import { FailurePolicy, StepFailedError, Workflow, start, toAction } from "agboss";
import { listOf } from "agboss/dto";
import {
  CommitSettlementAction,
  HoldEscrowFundsAction,
  ProvisionLedgerEntryAction,
  ReleaseEscrowFundsAction,
  ReverseLedgerEntryAction,
} from "./escrow.actions.js";
import { ComplianceCheckWorkflow } from "./compliance-check.workflow.js";
import {
  ComplianceClearanceDto,
  EscrowHoldDto,
  LedgerEntryDto,
  SettlementFinish,
  SettlementRolledBackFinish,
  SettlementStart,
  TransferRequestDto,
} from "./escrow.dto.js";

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
      .returns(LedgerEntryDto)
      // Distributed child workflows work-stolen across cluster instances:
      .toParallelWorkflows(ComplianceCheckWorkflow, {
        maxItems: 6,
        maxConcurrency: 4,
        failurePolicy: FailurePolicy.FailFast,
      })
      .join()
      .returns(listOf(ComplianceClearanceDto))
      // Commit boundary: marks both HoldEscrowFundsAction and ProvisionLedgerEntryAction committed
      .toAction(CommitSettlementAction)
      .onError(
        StepFailedError,
        toAction(ReverseLedgerEntryAction)
          .toAction(ReleaseEscrowFundsAction)
          .toFinish(SettlementRolledBackFinish),
      )
      .toFinish(SettlementFinish),
  ],
})
export class EscrowSettlementWorkflow {}
```

```ts title="src/missions/escrow.actions.ts" no-check: digital mission example
import { Action, ExecutionContext, type ActionHandler, type InputOf, type OutputOf } from "agboss";
import { EscrowHoldDto, LedgerEntryDto, TransferRequestDto } from "./escrow.dto.js";

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
  input: { hold: EscrowHoldDto, ledger: LedgerEntryDto },
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

## How does the dual-loop architecture work for Physical AI and robotics?

Autonomous robots, drones, and smart industrial devices separate control into two distinct loops:
1. **System 1 — Real-Time Hardware Control Loop (100–1000 Hz):** Low-level firmware, PID/MPC controllers, actuator drivers, and hardware safety interlocks handle sub-millisecond stabilization, collision reflexes, and emergency stops.
2. **System 2 — Deliberative Mission Orchestrator (`agboss`):** Runs as the high-level "cerebral cortex" that sequences multi-stage physical missions, fuses multimodal VLM/LLM assessments via `.joinQuorum()` and `@Arbiter`, pauses for remote human tele-supervision via `@ChannelRole` (with `withdraw` when resolved), verifies all target coordinates through typed DTOs, and triggers deterministic LIFO compensating actions (`SafeParkManipulatorAction`) whenever a mission is aborted:

```ts title="src/robotics/inspection-mission.workflow.ts" no-check: physical AI mission example
import { Arbiter, DecidedBy, OnAnswer, Verdict, Workflow, start, type AnswerInput } from "agboss";
import { listOf } from "agboss/dto";
import { seconds } from "agboss/units";
import {
  AcquireTelemetryAction,
  ArmManipulatorAction,
  ExecuteValveTurnAction,
  SafeParkManipulatorAction,
} from "./robotics.actions.js";
import { SpatialVlmAgentA, SpatialVlmAgentB, ThermalVlmAgent } from "./perception.agents.js";
import {
  MissionCompletedFinish,
  MissionStart,
  MissionTargetDto,
  PoseAssessmentDto,
  SensorFrameDto,
  ValveTurnReceiptDto,
} from "./robotics.dto.js";

@Arbiter({
  name: "pose-consensus-arbiter",
  description: "Accepts a multimodal pose estimate only when confidence >= 0.92 and clearance is safe",
  decidedBy: DecidedBy.Code,
})
export class PoseConsensusArbiter {
  @OnAnswer(SpatialVlmAgentA)
  @OnAnswer(SpatialVlmAgentB)
  @OnAnswer(ThermalVlmAgent)
  checkPose({ answer }: AnswerInput<PoseConsensusArbiter, typeof SpatialVlmAgentA>): Verdict {
    return answer.confidence >= 0.92 && answer.obstacleClearanceCm >= 15
      ? Verdict.Accept
      : Verdict.Reject;
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
      .toParallelAgents(SpatialVlmAgentA, SpatialVlmAgentB, ThermalVlmAgent)
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
      .returns(ValveTurnReceiptDto)
      .toFinish(MissionCompletedFinish),
  ],
})
export class ValveInspectionMissionWorkflow {}
```

```ts title="src/robotics/robotics.actions.ts" no-check: physical AI mission example
import { Action, ExecutionContext, type ActionHandler, type InputOf } from "agboss";
import { PoseAssessmentDto } from "./robotics.dto.js";

@Action({
  name: "safe-park-manipulator-action",
  description: "Returns the robotic arm to locked safe-hold posture when a mission aborts before completion",
  input: { poses: PoseAssessmentDto },
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
  input: { poses: PoseAssessmentDto },
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
    await this.hardwareBridgeService.moveToPreGrasp(input.poses.value, {
      signal: this.executionContext.signal,
    });
  }
}
```

```ts title="src/robotics/teleop-approval.channel.ts" no-check: physical AI mission example
import {
  Channel,
  ChannelOf,
  ChannelOutcome,
  ChannelRole,
  PauseAnswerer,
  type ChannelAsk,
  type ChannelWithdrawInfo,
} from "agboss";
import { ValveTurnCommandDto } from "./robotics.dto.js";

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
})
export class ConsoleTeleopSafetyChannel extends TeleopSafetyChannel {
  async send(ask: ChannelAsk<TeleopSafetyChannel>): Promise<ChannelOutcome<TeleopSafetyChannel>> {
    await this.operatorConsole.showPrompt(ask.pauseId, ask.value.arguments);
    return ChannelOutcome.awaitReply();
  }

  async withdraw(info: ChannelWithdrawInfo<ChannelAsk<TeleopSafetyChannel>>): Promise<void> {
    // Immediately dismisses the operator prompt if mission is cancelled or quorum resolved
    await this.operatorConsole.dismissPrompt(info.pauseId, info.resolution);
  }
}
```
