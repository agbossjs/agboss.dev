---
title: CLI Reference
description: Complete reference for the agboss CLI (agboss-cli) — project scaffolding, component generators, static flow checking, interactive chat, and evaluation.
---

The `agboss-cli` package provides the `agboss` command-line interface for scaffolding projects (`agboss create`), generating and wiring components (`agboss generate`), generating `.agboss/types.d.ts` and checking assembly rules (`agboss check`), inspecting workflows (`agboss describe`), running interactive or one-shot turns (`agboss chat`, `agboss run`), and evaluating prompt profiles (`agboss eval`, `agboss compare`).

## How to scaffold projects and generate components

Create a new project interactively or via flags in CI with `agboss create` (alias `agboss c`):

```bash
npx -p agboss-cli agboss create my-agents
agboss c support-desk --yes --agents "triage:Sorts requests,answerer:Answers questions" --tools "answerer:search_orders" --mcp filesystem:/path/to/docs --rag notes --skip-install
```

Generate components into an existing workflow module with `agboss generate` (alias `agboss g`). The CLI uses the TypeScript Compiler API to wire new components into `@Workflow` / `@Router` arrays and regenerate `.agboss/types.d.ts`:

```bash
agboss g agent billing --workflow src/support-desk/support-desk.workflow.ts --description "Handles invoices"
agboss g router escalation --workflow src/support-desk/support-desk.workflow.ts
agboss g tool refund --workflow src/support-desk/support-desk.workflow.ts --agent billing
agboss g mcp tickets --workflow src/support-desk/support-desk.workflow.ts --command tickets-mcp --tool search --agent billing
agboss g rag policies --workflow src/support-desk/support-desk.workflow.ts --folder policies --agent billing
agboss g openapi pets --url ./pets.yaml --workflow src/support-desk/support-desk.workflow.ts --agent billing
agboss g workflow onboarding
```

## All `agboss` CLI commands

| Command | What It Does |
| :--- | :--- |
| `agboss create <name>` (`agboss c`) | Scaffolds a new AGBoss project with workflow, `@Application`, environments, `.agboss/types.d.ts`, and Vitest tests |
| `agboss generate <kind>` (`agboss g`) | Generates and wires an `agent`, `router`, `tool`, `arbiter`, `mcp`, `rag`, `workflow`, or `openapi` client |
| `agboss check --workflow <path>` | Writes `.agboss/types.d.ts` and validates all flow, assembly, environment, and prompt rules without calling models |
| `agboss check --strict --workflow <path>` | Treats analyser warnings (`[flow.path-too-deep]`) and assembly warnings (`[application.in-memory-cost-ledger]`) as errors |
| `agboss check --models --workflow <path>` | Verifies every model setting across the application against its resolved `@ModelProvider` |
| `agboss describe --workflow <path>` | Prints paths, node inputs by producer, `{ about }` links, `historyOf` limits, model → provider resolution, budgets, and step limits |
| `agboss describe --json --workflow <path>` | Exports the full declarative revision snapshot (`configHash`, `maxInstanceConcurrency`, `@Action` `compensateWith` / `committedBy` links, per-agent `promptHash`, per-DTO `schemaHash`, and model/tool registries) for Langfuse/OTel trace coverage analysis and versioned pause compatibility checks |
| `agboss chat --workflow <path>` | Starts an interactive terminal chat (`--thread`, `--profile`, `--env`) on the workflow's `@Application` |
| `agboss run --workflow <path> "task"` | Executes a single task on the workflow's `@Application` and prints the output and spend summary |
| `agboss eval` / `agboss replay` | Scores recent runs with Jev or replays a prompt version against recorded tasks |
| `agboss golden add --name <n>` | Saves recent real tasks as a reusable golden evaluation dataset |
| `agboss compare --profiles base,<p>` | Compares YAML configuration profiles side by side against a golden set |
| `agboss rag:index` | Builds or updates `@Rag` knowledge-base indexes |
| `agboss migrate imports` | Rewrites imports from deprecated sub-entries to current AGBoss entries |

## Exporting a declarative revision snapshot with `agboss describe --json`

Running `agboss describe --json --workflow <path>` dumps the complete machine-readable anatomy (`{ application, workflows[], schemas }`) of an application revision without booting model providers:

- **Application & graph topology (`configHash`):** Deterministic hash of the workflow graph, `starts`, `finishes`, `edges`, `onError` handlers, `maxInstanceConcurrency`, `compensationTimeout`, and versioned child workflow registrations (`[ChildWorkflowV1, ChildWorkflowV2]`) so sleeping pauses can be verified and resumed across rolling releases.
- **Component & saga metadata (`promptHash`, `schemaHash`, `compensateWith`, `committedBy`):** Full configuration of every `@Agent`, `@Router`, `@Arbiter`, `@Action`, and `@Tool` in `workflows[].nodes[]`, including individual SHA-256 `promptHash` and `schemaHash` fingerprints and saga compensation edges.
- **DTO schema registry & trace join keys:** Every DTO class, field decorator (`@Text`, `@Integer`, `@Float`, `@Enum`, `@List`), constraint, and `schemaHash` in `schemas` joins directly against runtime `ExecutionRecord` (`WorkflowRecord.configHash`), `ComponentRecord` (`{ name, kind, promptHash, schemaHash }`), and `StepRecord` (`{ toolLoopIteration, validationAttempts, branch: { verdict, status } }`) spans in Langfuse / OpenTelemetry to measure real branch, tool, and DTO field coverage.

## AI coding-agent skills and machine-readable docs

AGBoss is designed for seamless pair-programming with AI coding agents (Claude Code, Cursor, Windsurf, GitHub Copilot, and OpenCode):

- **Machine-readable documentation:** Every documentation page on `agboss.dev` is published in [`/llms.txt`](/llms.txt) and [`/llms-full.txt`](/llms-full.txt) for instant context ingestion.
- **Coding-agent project rules:** Scaffolded projects include `CLAUDE.md` and `.claude/skills/` conventions enforcing AGBoss architecture (`@Application` assembly, one chained call per line in `flow`, plain object DTOs without `new`, `usd()` / `seconds()` / `minutes()` units, and `testWith` / unit runners).
