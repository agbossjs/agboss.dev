---
title: Installation
description: Install the AGBoss TypeScript framework and CLI in Node.js 22+ to scaffold projects with built-in AI coding skills, typecheck Path Scope graphs, and run LangGraph workflows.
---

Installing AGBoss gives you the core TypeScript decorator runtime (`agboss`), focused sub-entries (`agboss/dto`, `agboss/units`, `agboss/models`, `agboss/testing`, `agboss/mcp`, `agboss/rag`, `agboss/a2a`), offline coding-agent skills (`node_modules/agboss/skills/agboss/`), and the `agboss-cli` command-line tool (`agboss` / `agb`). Importing `agboss` has zero side effects: tracing, MCP, and SQLite load only when an application uses them.

## How to create a new project with the CLI

The fastest way to start a new project is with `agboss create` (alias `agboss c`), which takes a project name and scaffolds a complete, typechecked application:

```bash
npx -p agboss-cli agboss create my-agents --yes
cd my-agents && cp .env.example .env && npm run chat
```

You can also pass component flags directly for non-interactive scaffolding in scripts or CI:

```bash
npx -p agboss-cli agboss c support-desk --yes --agents "triage:Sorts requests,answerer:Answers questions" --tools "answerer:search_orders" --skip-install
```

What `agboss create` sets up out of the box:

- **Typed workflow skeleton:** `@WorkflowStart`, `@Router` (`MainRouter`), `@Agent` classes with `*.prompt.md` files, `@WorkflowFinish`, and `@Application`.
- **Environment contracts:** `environments/app.environment.ts` alongside `dev`, `staging`, `prod`, and `test` environment files.
- **Built-in AI coding skills (`AGENTS.md`):** Committed root `AGENTS.md` (read by Codex, Cursor, Windsurf, Copilot, Gemini CLI, Aider) and one-line `CLAUDE.md` (`@AGENTS.md`) created once for your team's rules, plus gitignored `.claude/skills/agboss/` (`SKILL.md` + 12 reference modules) synced offline from `node_modules/agboss/skills/agboss/`.
- **Generated Path Scope types (`.agboss/types.d.ts`):** `npm run types` (`agboss check`) runs automatically on `postinstall` (`"postinstall": "npm run types"`) to write `.agboss/types.d.ts` and sync `.claude/skills/agboss/`.
- **Pre-configured ESLint flat config (`eslint.config.mjs` via `agboss/eslint`):** Enforces `agboss/no-component-state` (stateless singleton components), `agboss/no-direct-time` (using injected `Clock` instead of `Date.now()` / `setTimeout`), and `@stylistic/newline-per-chained-call` (one chained method call per line in `*.workflow.ts`) via `npm run lint`.
- **Three-tier Vitest configuration:** Separate `unit` (`*.test.ts`), `integration` (`*.integration.test.ts`), and `suites` (`*.suite.test.ts`) projects.

## How to add AGBoss to an existing Node.js project

Because AGBoss is an embeddable library rather than a standalone server, you can install it directly inside an existing Node.js 22.13+ backend:

```bash
npm i agboss
npm i -D agboss-cli
```

Generate components and wire them into your workflow module using `agboss generate` (alias `agboss g`):

```bash
npx agboss g agent billing --workflow src/support-desk/support-desk.workflow.ts --description "Handles invoices"
npx agboss g tool refund --workflow src/support-desk/support-desk.workflow.ts --agent billing
npx agboss g openapi pets --url ./pets.yaml --workflow src/support-desk/support-desk.workflow.ts --agent billing
```

## Verify your installation

Run `agboss check` against your application to generate `.agboss/types.d.ts`, sync `.claude/skills/agboss/`, and validate every flow rule, environment field, and prompt file offline without making any LLM calls:

```bash
npx agboss check --application src/support-desk/support-desk.application.ts
```

Continue to the [Quick start](/getting-started/quick-start/) to build and execute your first workflow.
