---
title: Installation
description: Install the AGBoss TypeScript framework and CLI in Node.js 22+ to scaffold, typecheck, and run production multi-agent workflows on LangGraph.
---

Installing AGBoss gives you the core TypeScript decorator runtime (`agboss`), focused sub-entries (`agboss/dto`, `agboss/units`, `agboss/models`, `agboss/testing`, `agboss/mcp`, `agboss/rag`), and the `agboss-cli` command-line tool (`agboss`) for scaffolding projects, generating components, and checking workflow types. Importing `agboss` has zero side effects: tracing, MCP, and SQLite load only when an application uses them.

## How to create a new project with the CLI

The fastest way to start a new project is with `agboss create` (alias `agboss c`), which scaffolds a complete project with agents, prompts, tools, environments, `.agboss/types.d.ts`, and offline Vitest tests:

```bash
npx -p agboss-cli agboss create my-agents
cd my-agents && cp .env.example .env && npm run chat
```

You can also pass flags directly for non-interactive scaffolding in scripts or CI:

```bash
npx -p agboss-cli agboss c support-desk --yes --agents "triage:Sorts requests,answerer:Answers questions" --tools "answerer:search_orders" --skip-install
```

What `agboss create` sets up out of the box:

- **Typed workflow skeleton:** `@WorkflowStart`, `@Router` (`MainRouter`), `@Agent` classes with `*.prompt.md` files, `@WorkflowFinish`, and `@Application`.
- **Environment contracts:** `environments/environment.ts` alongside `dev`, `staging`, and `test` profiles.
- **Generated flow types:** `npm run types` (`agboss check`) writes `.agboss/types.d.ts` automatically on `postinstall` and before `npm run check`.
- **Three-tier Vitest configuration:** Separate `unit` (`*.test.ts`), `integration` (`*.integration.test.ts`), and `suites` (`*.suite.test.ts`) projects.

## How to add AGBoss to an existing Node.js project

Because AGBoss is an embeddable library rather than a standalone server, you can install it directly inside an existing Node.js backend:

```bash
npm i agboss
npm i -D agboss-cli
```

Generate components and wire them into your workflow module using `agboss g`:

```bash
npx agboss g agent billing --workflow src/support-desk/support-desk.workflow.ts --description "Handles invoices"
npx agboss g tool refund --workflow src/support-desk/support-desk.workflow.ts --agent billing
npx agboss g openapi pets --url ./pets.yaml --workflow src/support-desk/support-desk.workflow.ts --agent billing
```

## Verify your installation

Run `agboss check` against your workflow to generate `.agboss/types.d.ts` and validate every flow rule, environment field, and prompt file without making any LLM calls:

```bash
npx agboss check --workflow src/support-desk/support-desk.workflow.ts
```

Continue to the [Quick start](/getting-started/quick-start/) to build and execute your first workflow.
