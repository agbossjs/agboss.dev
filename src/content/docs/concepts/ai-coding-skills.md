---
title: AI-Assisted Engineering & Coding Skills (AGENTS.md)
description: How AGBoss keeps every AI coding agent (OpenAI Codex, Cursor, Windsurf, GitHub Copilot, Gemini CLI, Aider, and Claude Code) 100% aligned with HarnessDSL and the Path Scope compiler via AGENTS.md and 12 offline-synced skill reference modules.
---

In modern engineering teams, Senior, Staff, and Principal engineers rarely type multi-agent boilerplate by hand. Instead, they act as **systems architects** who specify domain boundaries, DTO contracts, and failure invariants while **AI coding agents — OpenAI Codex, Cursor, Windsurf, GitHub Copilot, Gemini CLI, Cline, Aider, or Claude Code —** generate and refactor the implementation.

However, pre-trained coding models do not know AGBoss or **HarnessDSL** out of the box. Left unguided, they fall back to legacy orchestration habits: shared mutable state bags, `new MyDto()` instantiation, raw numbers instead of `seconds()` / `usd()`, `as any` casts, or multi-call lines in `*.workflow.ts` that fail Path Scope compilation.

AGBoss solves this in a **tool-agnostic, cross-agent way** by bundling an authoritative, compiler-verified **AI Skill Suite** (`AGENTS.md` + 12 progressive-disclosure reference modules) directly inside the `agboss` npm package and automatically keeping the reference modules in sync with your installed framework version.

---

## How coding agents verify graphs in practice

Every rule in `AGENTS.md` and the 12 skill reference modules maps directly to a compile-time check in `agboss check` and a deterministic offline test in `agboss/testing`. When your coding agent scaffolds or edits a workflow, it validates the graph and runs a deterministic Vitest test in milliseconds:

<!-- snippet-context
import { Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, type BudgetHandler } from "agboss";
import { usd, type Usd } from "agboss/units";
@Budget({ name: "triage-app-budget", scope: BudgetScope.Application, period: BudgetPeriod.Day })
export class TriageAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(50); } }
@Budget({ name: "triage-tenant-budget", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })
export class TriageTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }
@Budget({ name: "triage-exec-budget", scope: BudgetScope.Execution })
export class TriageExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }
// @snippet
-->
```ts title="src/triage/triage.workflow.ts" file=src/triage/triage.workflow.ts
import {
  Action,
  Agent,
  Application,
  DecidedBy,
  Router,
  Workflow,
  WorkflowFinish,
  WorkflowStart,
  route,
  start,
  type ActionHandler,
  type InputOf,
  type OutputOf,
  type Route,
  type RouterHandler,
} from "agboss";
import { Integer, Text } from "agboss/dto";

export class TicketDto {
  @Text({ prompt: "Support ticket ID" })
  ticketId!: string;

  @Integer({ min: 1, max: 5, prompt: "Priority 1 (low) to 5 (critical)" })
  priority!: number;
}

export class ResolutionDto {
  @Text({ prompt: "Resolution summary" })
  summary!: string;
}

@WorkflowStart({
  name: "ticket-workflow-start",
  description: "Accepts an incoming support ticket",
  input: TicketDto,
})
export class TicketStart {}

@WorkflowFinish({
  name: "ticket-workflow-finish",
  description: "Returns the ticket resolution",
  output: ResolutionDto,
})
export class TicketFinish {}

@Agent({
  name: "escalation-agent",
  description: "Drafts an incident response for high-priority tickets",
  prompt: "Draft an immediate escalation plan for the critical ticket.",
  model: "moonshotai/kimi-k2.6",
  input: { ticket: TicketDto },
  output: ResolutionDto,
})
export class EscalationAgent {}

@Action({
  name: "auto-ack-action",
  description: "Acknowledges standard-priority tickets deterministically",
  input: { ticket: TicketDto },
  output: ResolutionDto,
})
export class AutoAckAction implements ActionHandler<AutoAckAction> {
  execute(input: InputOf<AutoAckAction>): Promise<OutputOf<AutoAckAction>> {
    return Promise.resolve({
      summary: `Auto-acknowledged ${input.ticket.value.ticketId}`,
    });
  }
}

@Router({
  name: "priority-router",
  description: "Routes critical tickets to EscalationAgent and others to AutoAckAction",
  decidedBy: DecidedBy.Code,
  input: { ticket: TicketDto },
  routes: [{ target: EscalationAgent }, { target: AutoAckAction }],
})
export class PriorityRouter implements RouterHandler<PriorityRouter> {
  route(input: InputOf<PriorityRouter>): Route<PriorityRouter> {
    return input.ticket.value.priority >= 4 ? EscalationAgent : AutoAckAction;
  }
}

@Workflow({
  name: "ticket-triage-workflow",
  version: "1.0.0",
  flow: [
    start(TicketStart)
      .returns(TicketDto)
      .toRouter(PriorityRouter)
      .chooseOne(
        route(EscalationAgent)
          .returns(ResolutionDto)
          .toFinish(TicketFinish),
        route(AutoAckAction)
          .returns(ResolutionDto)
          .toFinish(TicketFinish),
      ),
  ],
})
export class TicketTriageWorkflow {}

@Application({
  name: "ticket-triage-application",
  version: "1.0.0",
  environment: EmptyEnvironment,
  workflows: [TicketTriageWorkflow],
  budgets: [TriageAppBudget, TriageTenantBudget, TriageExecBudget],
})
export class TicketTriageApplication {}
```

```ts title="test/triage.workflow.test.ts" file=test/triage.workflow.test.ts
import { expect } from "vitest";
import { replyWith, testRouter, testWith } from "agboss/testing";
import {
  AutoAckAction,
  EscalationAgent,
  PriorityRouter,
  ResolutionDto,
  TicketStart,
  TicketTriageApplication,
} from "../src/triage/triage.workflow.js";

const test = testWith(TicketTriageApplication);

test("routes critical tickets to EscalationAgent and unit-tests PriorityRouter", async ({
  app,
  mockLlm,
}) => {
  const runRouter = testRouter(PriorityRouter);
  const { output: selectedRoute } = await runRouter({
    ticket: {
      value: { ticketId: "T-500", priority: 5 },
      producer: TicketStart,
    },
  });
  expect(selectedRoute).toBe(EscalationAgent);

  mockLlm(EscalationAgent).thenReturn(
    replyWith(ResolutionDto, { summary: "Paged on-call SRE for T-500" }),
  );

  const result = await app.execute(TicketStart, {
    ticketId: "T-500",
    priority: 5,
  });
  expect(result.output).toEqual({ summary: "Paged on-call SRE for T-500" });

  const lowPriority = await app.execute(TicketStart, {
    ticketId: "T-100",
    priority: 2,
  });
  expect(lowPriority.output).toEqual({
    summary: "Auto-acknowledged T-100",
  });
  expect(AutoAckAction).toBeDefined();
});
```

---

## How universal skills are scaffolded and synced

When you scaffold a new project with [`agboss create`](/cli/):

```bash
cd /tmp && npx agboss create my-app --yes
```

AGBoss sets up a two-tier, tool-agnostic instruction architecture in your repository:

### 1. Universal `AGENTS.md` Entrypoint (Codex, Cursor, Windsurf, Copilot, Gemini, Aider, Claude)

`agboss create` generates two files in your repository root that are **committed to Git** and **created only once** (never overwritten by subsequent upgrades or syncs):

- **`AGENTS.md` (Universal Standard):** The open cross-agent standard read natively by **OpenAI Codex, Cursor, Windsurf, GitHub Copilot, Gemini CLI, Cline, Roo Code, and Aider**. It contains your project-specific architectural rules and a progressive-disclosure routing table pointing to the 12 framework reference modules. Because AGBoss never overwrites `AGENTS.md`, your team can freely append domain-specific conventions or links for your preferred IDE/agent.
- **`CLAUDE.md` (1-Line Bridge):** A single-line pointer file (`@AGENTS.md`) so Claude Code loads the exact same `AGENTS.md` instructions without duplicating a single rule.

### 2. Offline-Synced Progressive-Disclosure Reference Modules

Why not dump all 50 pages of framework documentation directly into `AGENTS.md`? Because loading 50 pages of docs on every prompt bloats your coding agent's context window and degrades code quality.

Instead, the 12 modular reference guides live inside `node_modules/agboss/skills/agboss/` (shipped offline inside the `agboss` npm package) and are automatically synced into `.claude/skills/agboss/` (the standard skill discovery path also referenced directly by `AGENTS.md` so Cursor, Codex, Windsurf, Copilot, and Gemini CLI read the exact same markdown files on demand):

```text
my-app/
├── AGENTS.md                                          # Committed once — universal entrypoint (Codex, Cursor, Windsurf, Copilot, Gemini, Aider)
├── CLAUDE.md                                          # Committed once — 1-line `@AGENTS.md` bridge for Claude Code
├── .agboss/
│   └── types.d.ts                                     # Gitignored — generated Path Scope & Produced<Dto, P> types
└── .claude/
    └── skills/
        └── agboss/                                    # Gitignored — offline-synced from installed `agboss` package
            ├── SKILL.md                               # Root dispatcher & 10 non-negotiable invariants
            ├── .agboss-skills.json                    # Synced package version stamp & integrity metadata
            └── references/
                ├── 01-composition-and-architecture.md
                ├── 02-flow-dsl-all-combinations.md
                ├── 03-components-di-and-lifecycle.md
                ├── 04-mcp-and-a2a.md
                ├── 05-channels-and-human-in-the-loop.md
                ├── 06-finops-providers-and-queues.md
                ├── 07-guardrails-pii-and-security.md
                ├── 08-observability-and-tracing.md
                ├── 09-persistence-k8s-and-deploy.md
                ├── 10-testing-vcr-and-evals.md
                ├── 11-cli-studio-and-error-catalog.md
                └── 12-end-to-end-recipes.md
```

Why is the synced skill directory gitignored instead of committed?
- **Zero version drift across upgrades:** Every time you upgrade `agboss` and run `npm install` (via `"postinstall": "npm run types"`, where `"types": "agboss check"`), `npx agboss check`, or `npx agboss generate`, the CLI compares the installed `agboss` version against `.agboss-skills.json` and updates the 13 skill files in place.
- **No noisy 13-file PR diffs:** Upgrading `agboss` in `package.json` never pollutes your pull requests with documentation diffs, and accidental local edits to synced skill files are automatically detected (`[skills.local-edit]`) and restored to match the installed runtime.
- **100% offline & supply-chain safe:** `agboss check` never makes network calls to download instructions that steer coding agents; skills always match the exact version of `agboss` installed in `node_modules`.

### Opting out of auto-sync

For environments that prefer not to write synced skill files into the workspace, disable skill syncing in `package.json` (your coding agent can still read `node_modules/agboss/skills/agboss/` directly):

```json
{
  "name": "my-app",
  "agboss": {
    "application": "src/my-app.application.ts",
    "skills": false
  }
}
```

---

## Inside the 12 modular skill references

`AGENTS.md` and `SKILL.md` act as a **context-efficient router**. They define the 10 core invariants and instruct your coding agent (whether Cursor, Codex, Windsurf, Copilot, Gemini CLI, or Claude Code) to open only the specific `references/01..12` file relevant to the current task:

| Reference File | Loaded By Coding Agent When… | Key Contracts Covered |
| :--- | :--- | :--- |
| `SKILL.md` | Starting any task in an AGBoss repository | 10 core invariants, CLI workflow (`generate -> check -> describe -> test`), ban on `as any` / `new Dto()` / component state, 1-call-per-line rule |
| `01-composition-and-architecture.md` | Designing workflows, splitting graphs, or authoring DTOs | `@Agent` vs `@Action` vs `@Tool`, `DecidedBy.Code` vs `DecidedBy.Model`, `@Text`/`@Integer`/`@Flag`/`@OneOf`/`@ListOf`/`@Nested`, narrow DTOs vs God DTOs |
| `02-flow-dsl-all-combinations.md` | Writing or editing `*.workflow.ts` flow paths & error handlers | `start()`, `.returns(Dto, { about })`, `.switch(caseOf())`, `.chooseOne(route())`, `historyOf()`, `.toParallelAgents()`, `.joinQuorum()`, `ThisWorkflow`, `.onError()` hierarchy |
| `03-components-di-and-lifecycle.md` | Implementing components, DI services, lifecycle hooks, or `AppEnvironment` | `@Application`, class-inheritance DI, `OnInit -> OnStart -> OnStop -> OnDestroy`, `ExecutionContext`, `SpendRecorder`, `JudgeModel`, `@ToolInterceptor`, `CompactionStrategy.Custom`, `secret()`, `env()`, `seconds()`, `usd()` |
| `04-mcp-and-a2a.md` | Integrating external MCP servers, A2A remote agents, or Agent Mesh | `@McpServer`, `@McpTool`, `@McpExpose`, `createMcpService`, `@A2AAgent`, `@A2AExpose`, `a2aHttpListener` (`callerOf`), Agent Mesh Envelope (`agboss-mesh`), `$ agboss check --federation` |
| `05-channels-and-human-in-the-loop.md` | Adding human approvals, pauses, or webhook resume endpoints | `@ChannelRole`, `@ReplyInterpreter`, `@Channel`, `ChannelOutcome.awaitReply()`, `withdraw()`, `result.pending`, `app.resume({ pauseId, reply })` |
| `06-finops-providers-and-queues.md` | Configuring budgets, model providers, rate limits, or circuit breakers | `@Budget` (`Application`, `Tenant`, `Execution`), `@ModelProvider` (`OpenRouterProvider`, `ModelProviderHandler`), `PromptCaching`, `QueueBalancingStrategy.TenantRoundRobin`, shared 429 cooldowns |
| `07-guardrails-pii-and-security.md` | Implementing input/output guardrails (`DecidedBy.Model` / `DecidedBy.Code`) or PII masking | `@InputGuardrail`, `@OutputGuardrail`, `GuardrailHandler`, `GuardrailVerdict`, `GuardrailRefusal`, `@PiiPolicy`, deterministic HMAC `PiiAction.replaceWithToken()` |
| `08-observability-and-tracing.md` | Writing `On*` observers, inspecting `result.record`, or Langfuse | 23 `On*` observer interfaces (`OnExecutionEnd`, `OnSpend`, `OnValuesOutdated`, `OnQuorumDecided`), `result.record.pauses`, `scripts/langfuse.sh` |
| `09-persistence-k8s-and-deploy.md` | Configuring SQLite/Postgres stores, leases, or Kubernetes probes | 7 repository contracts, `Sqlite*` WAL providers, 30s execution leases, `SIGTERM` drain, `@HealthCheck`, `checkLiveness()`, `checkReadiness()`, `configHash` rollouts |
| `10-testing-vcr-and-evals.md` | Writing unit tests, trajectory assertions, `@EvalSuite`, or golden evals | `testWith(App, { instances: 2, concurrency: TestConcurrency.inOrder([...]) })`, `toHaveCalledTools`, `toHaveToolCallMatching`, `VirtualClock`, all 10 unit runners (`testTool` .. `testToolInterceptor`), `@EvalSuite` (`pass@k` / `pass^k`, Cohen's $\kappa$) |
| `11-cli-studio-and-error-catalog.md` | Running CLI commands or fixing `[rule.code]` compiler diagnostics | Complete catalog of `[flow.*]`, `[graph.*]`, `[input.*]`, `[router.*]`, `[di.*]`, `[environment.*]`, `[prompt.*]`, and `[judge.*]` diagnostics with before/after fixes |
| `12-end-to-end-recipes.md` | Scaffolding a complete multi-file feature from scratch | 4 complete multi-file blueprints: review loops with `{ about }`, parallel quorums with `@Channel`, MCP + A2A agents, and multi-tenant Kubernetes apps |

---

## Closed-loop workflow for any coding agent

Because every rule in the skill suite corresponds to a deterministic check in `agboss check` and `tsc`, any coding agent operates inside a tight, self-correcting feedback loop:

1. **Scaffold with CLI generators:** The coding agent runs `npx agboss generate agent reviewer --workflow src/offer/offer.workflow.ts` (or `router`, `arbiter`, `tool`, `mcp`, `rag`, `openapi`) to create properly named files and wire imports without boilerplate typos.
2. **Compile Path Scope & generate `.agboss/types.d.ts`:** The agent runs `npx agboss check --strict`. If a path is missing an upstream DTO (`[input.missing-on-path]`), reads a stale loop value (`[input.outdated-on-path]`), or interpolates an input into a system prompt (`[prompt.input-in-instructions]`), `agboss check` outputs the exact `[rule.code]` diagnostic.
3. **Typecheck narrowed `Produced<Dto, P>` contracts:** With `.agboss/types.d.ts` updated, `npm run typecheck` (`tsc --noEmit`) verifies every `@Action`, `@Router`, and `@WorkflowFinish` handler against the exact upstream producer union.
4. **Verify deterministically offline:** The agent writes isolated unit tests (`testTool`, `testRouter`, `testArbiter`, `testJudge`) and full workflow tests (`testWith(App)`) and runs `npm test` in milliseconds with zero network calls.
5. **CI documentation guarantee (`check:docs`):** Inside the `agboss` repository itself, `npm run check:docs` compiles every TypeScript snippet in the skill references and documentation against the built framework, ensuring the skills given to your coding agent can never drift from the actual TypeScript API.
