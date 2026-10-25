---
title: CLI Reference
description: Complete reference for the agboss CLI (agboss-cli) — project scaffolding, component generators, static flow checking, interactive chat, and evaluation.
---

The `agboss-cli` package provides the `agboss` command-line interface for scaffolding projects (`agboss create`), generating and wiring components (`agboss generate`), generating `.agboss/types.d.ts` and checking assembly rules (`agboss check`), inspecting workflows (`agboss describe`), running interactive or one-shot turns (`agboss chat`, `agboss run`), and evaluating prompt profiles (`agboss eval`, `agboss compare`).

## How to scaffold projects and generate components

Create a new project interactively or via flags in CI with `npx agboss create` (also works via `npx agboss-cli create`, short alias `agb c`):

```bash
npx agboss create my-app
cd my-app
npm install
agboss c support-desk --yes --agents "triage:Sorts requests,answerer:Answers questions" --tools "answerer:search_orders" --mcp filesystem:/path/to/docs --rag notes --skip-install
```

Generate components into an existing workflow module with `agboss generate` (alias `agboss g`) using their full names (including kind suffix). The CLI uses the TypeScript Compiler API to wire new components into `@Workflow` / `@Router` / `@EvalSuite` arrays and regenerate `.agboss/types.d.ts`:

```bash
agboss g agent billing-agent --workflow support-desk-workflow --description "Handles invoices"
agboss g router escalation-router --workflow support-desk-workflow
agboss g tool refund-tool --workflow support-desk-workflow --agent billing-agent
agboss g mcp tickets-mcp --workflow support-desk-workflow --command tickets-mcp --tool search-tool --agent billing-agent
agboss g rag policies-rag --workflow support-desk-workflow --folder policies --agent billing-agent
agboss g openapi pets --url ./pets.yaml --workflow support-desk-workflow --agent billing-agent
agboss g workflow onboarding-workflow
agboss g eval-case refund-edge-eval-case --suite support-desk-eval-suite --from-execution exec-9102
```

## All `agboss` CLI commands

| Command | What It Does |
| :--- | :--- |
| `agboss create <name>` (`agboss c`) | Scaffolds a new AGBoss project with `agboss` (`dependencies`), `agboss-cli` (`devDependencies`), `@Application`, workflow, environments, `eslint.config.js` (`agboss/eslint`), `.agboss/types.d.ts`, `AGENTS.md`, `CLAUDE.md`, 13 AI coding skills, and Vitest tests |
| `agboss generate <kind> <name>` (`agboss g`) | Generates and wires an `agent`, `router`, `tool`, `arbiter`, `mcp`, `rag`, `workflow`, `openapi` client, or `eval-case` (`--from-execution <executionId>`) |
| `agboss check [--application <path>]` | Writes `.agboss/types.d.ts`, syncs `.claude/skills/agboss/` (`SKILL.md` + 13 reference modules), and validates all flow, assembly, environment, and prompt rules without calling models |
| `agboss check --strict` | Treats analyser warnings (`[flow.path-too-deep]`, `[judge.same-model-family]`) and assembly warnings (`[application.in-memory-cost-ledger]`, `[application.in-memory-child-queue]`) as errors |
| `agboss check --models` | Verifies every model setting across the application against its resolved `@ModelProvider` |
| `agboss check --cassettes` | Verifies recorded VCR cassettes against current `promptHash` and `schemaHash` fingerprints (`[vcr.stale-cassette]`) |
| `agboss check --federation <path...>` | Verifies cross-repository `@A2AAgent` / `@McpServer` contracts against snapshots from `agboss describe --json` (`[federation.*]`) |
| `agboss dev` / `agboss studio` | Watches `src/` to regenerate `.agboss/types.d.ts` on save (`dev`), or launches LangGraph Studio for every workflow and child subgraph (`studio`) |
| `agboss describe [--application <path>]` | Prints paths, node inputs by producer, `{ about }` links, `historyOf` limits, model → provider resolution, budgets, and step limits |
| `agboss describe --json` | Exports the full declarative revision snapshot (`configHash`, `maxConcurrentSteps`, `@Action` `compensateWith` / `committedBy` links, per-agent `promptHash`, per-DTO `schemaHash`, and `application.contracts.imports` / `exports`) |
| `agboss chat` / `agboss run` | Starts an interactive terminal chat (`--thread`, `--profile`, `--env`) or executes a single task on the `@Application` and prints the output and spend summary |
| `agboss eval score` / `agboss replay` | Scores recent `Tern`s (`--start`, `--version`, `--limit`, `--profile`) or replays a prompt version against recorded tasks |
| `agboss eval run --suite <name>` | Runs an `@EvalSuite` across `--runs <k>` trials (`pass@k` and `pass^k`), `--chaos <rate> --chaos-seed <n>`, `--metamorphic`, `--report <run.json>`, `--baseline <run.json> --fail-on-regression`, and `--html <report.html>` |
| `agboss eval calibrate --report <run.json>` | Computes pairwise **Cohen's kappa ($\kappa$)**, confusion matrices, disagreements, and metric rubrics between `@Judge` verdicts and human `EvalLabel` JSONL annotations (`--labels <file.jsonl>`) |
| `agboss eval show <run.json> [--html <file>]` / `agboss eval ui` | Re-renders a saved `EvalRunReport` artifact into a self-contained static HTML page without calling models, or launches the local interactive Eval UI workbench (`127.0.0.1`) |
| `agboss records export` | Exports completed `ExecutionRecord`s from `ExecutionHistoryRepository` (`--tenant <id>` or `--all-tenants`, `--since`, `--until`) to `--out <file.jsonl>` |
| `agboss hub show <path...> [--html <file>]` / `agboss hub ui <path...>` | Stitches `describe --json` snapshots, `.jsonl` execution records, and eval reports into the **AGBoss Mesh Hub** (Global Agent Mesh Graph, Cross-Service Execution Trees, Progressive Crystallization Radar, and Blast Radius) as a static HTML page or local UI server (`127.0.0.1`) |
| `agboss golden add --name <n>` | Saves recent real tasks as a reusable golden evaluation dataset |
| `agboss compare --profiles base,<p>` | Compares YAML configuration profiles side by side against a golden set |
| `agboss rag index` | Builds or updates `@Rag` knowledge-base indexes |
| `agboss migrate imports` | Rewrites imports from deprecated sub-entries to current AGBoss entries |

## Key static analyzer diagnostics (`agboss check`)

`agboss check` verifies structural, dataflow, security, and governance invariants before a single token is spent:

| Rule Code | What It Catches |
| :--- | :--- |
| `[name.kind-suffix]` | A decorated component's `name` option (`"-agent"`, `"-budget"`, `"-tool-interceptor"`) or its TypeScript class identifier (`*Agent`, `*Budget`, `*ToolInterceptor`) is missing its kind suffix. |
| `[input.missing-on-path]` & `[input.outdated-on-path]` | A downstream node reads a DTO that is not produced on every incoming branch or was invalidated by a review loop's `{ about: Dto }` without being re-produced. |
| `[flow.uncompensated-action]` & `[graph.limit-handler-uses-model]` | A side-effecting `@Action` lacks `compensateWith` / `committedBy`, or a resource-limit `.onError()` handler routes to an LLM node instead of a deterministic `@Action` / `@WorkflowFinish`. |
| `[prompt.input-in-instructions]` | Runtime `input` fields are interpolated into `prompt` / `promptUrls` (which would break LLM KV prefix caching). |
| `[compaction.missing-handler]` & `[compaction.invalid-setting]` | A `CompactionStrategy.Custom` class omits `compact(input)`, or sets model-only options (`model`, `prompt`, `summaryQueueLength`, `summaryMaxTokens`). |
| `[guardrail.missing-handler]` & `[tool-interceptor.missing-handler]` | A `DecidedBy.Code` guardrail omits `check(text)`, or a `@ToolInterceptor` implements neither `BeforeToolCall` nor `AfterToolCall`. |
| `[model-provider.both-modes]` | A `@ModelProvider` mixes HTTP `baseUrl` / `apiKey` options with a custom `ModelProviderHandler.complete(request)` implementation. |
| `[vcr.stale-cassette]` & `[judge.same-model-family]` | A VCR cassette's recorded `promptHash` / `schemaHash` no longer matches current code, or a `DecidedBy.Model` `@Judge` uses the same model family as the judged `@Agent`. |
| `[flow.conflicting-placement]` & `[application.in-memory-child-queue]` | Two paths to the same child workflow specify different `ChildPlacement` modes, or `ChildPlacement.AnyInstance` is used without a shared `ChildExecutionQueueRepository` in `@Application({ providers })`. |
| `[federation.incompatible-schema]` & `[federation.missing-target]` | Cross-service `@A2AAgent` / `@McpServer` DTO schemas drifted from the producer's `@A2AExpose` / `@McpExpose` `schemaHash` in `agboss describe --json`. |

## Exporting a declarative revision snapshot with `agboss describe --json`

Running `agboss describe --json --application <path>` dumps the complete machine-readable anatomy (`{ application, workflows[], schemas }`) of an application revision without booting model providers:

- **Application & graph topology (`configHash`):** Deterministic hash of the workflow graph, `starts`, `finishes`, `edges`, `onError` handlers, `maxConcurrentSteps`, `compensationTimeout`, and versioned child workflow registrations (`[ChildWorkflowV1, ChildWorkflowV2]`) so sleeping pauses can be verified and resumed across rolling releases.
- **Component & saga metadata (`promptHash`, `schemaHash`, `compensateWith`, `committedBy`):** Full configuration of every `@Agent`, `@Router`, `@Arbiter`, `@Action`, and `@Tool` in `workflows[].nodes[]`, including individual SHA-256 `promptHash` and `schemaHash` fingerprints and saga compensation edges.
- **DTO schema registry & trace join keys:** Every DTO class, field decorator (`@Text`, `@Integer`, `@Float`, `@Enum`, `@List`), constraint, and `schemaHash` in `schemas` joins directly against runtime `ExecutionRecord` (`WorkflowRecord.configHash`), `ComponentRecord` (`{ name, kind, promptHash, schemaHash }`), and `StepRecord` (`{ toolLoopIteration, validationAttempts, branch: { verdict, status } }`) spans in Langfuse / OpenTelemetry to measure real branch, tool, and DTO field coverage.

## AI coding-agent skills and machine-readable docs

AGBoss is built for Senior/Staff engineers steering AI coding agents (OpenAI Codex, Cursor, Windsurf, GitHub Copilot, Gemini CLI, Aider, and Claude Code):

- **Universal project entrypoints (`AGENTS.md` & `CLAUDE.md`):** `agboss create <name>` generates root `AGENTS.md` and a one-line `CLAUDE.md` (`@AGENTS.md`) once and commits them to Git. They are never overwritten, allowing you to add project-specific domain rules alongside the AGBoss skill routing table.
- **Offline, gitignored skill suite (`SKILL.md` + `references/01..13.md`):** Bundled directly inside the `agboss` npm package (`node_modules/agboss/skills/agboss/`) and automatically synced into `.claude/skills/agboss/` (`SKILL.md`, `references/01-composition-and-architecture.md` .. `13-migrating-from-langgraph.md`, and `.agboss-skills.json`) whenever `npm install` (`"postinstall": "npm run types"`, where `"types": "agboss check"`), `agboss check`, or `agboss generate` runs. Opt out anytime via `"agboss": { "skills": false }` in `package.json`. See [AI-Assisted Engineering & Coding Skills](/concepts/ai-coding-skills/) for the full architecture.
- **Machine-readable documentation:** Every documentation page on `agboss.dev` is published in [`/llms.txt`](/llms.txt) and [`/llms-full.txt`](/llms-full.txt) for instant context ingestion.
