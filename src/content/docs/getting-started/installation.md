---
title: Installation
description: Install the AGBoss TypeScript framework (agboss) and CLI compiler (agboss-cli) in Node.js 22+ to scaffold projects with 13 AI coding skills, typecheck Path Scope graphs, and run LangGraph workflows.
---

Installing AGBoss gives you the lightweight production runtime (`agboss`), focused subpath entries (`agboss/dto`, `agboss/units`, `agboss/models`, `agboss/testing`, `agboss/eval`, `agboss/mcp`, `agboss/rag`, `agboss/a2a`, `agboss/memory`, `agboss/eslint`), 13 bundled AI coding-agent reference modules (`node_modules/agboss/skills/agboss/`), and the `agboss-cli` static compiler and developer toolkit (`agboss` / `agb`). Importing `agboss` has zero side effects: tracing, MCP, and SQLite load only when an application uses them.

## Option 1: Create a new project (`npx agboss create my-app`)

The fastest way to start a new project from scratch is with `npx agboss create` (also works via `npx agboss-cli create`, short alias `agb c`):

```bash
npx agboss create my-app
cd my-app
npm install
```

What happens when you run these three commands:

1. **Pre-wired `package.json` (`agboss` + `agboss-cli`):** `npx agboss create my-app` creates a ready-to-run TypeScript project where `package.json` already places `agboss` in `dependencies` and `agboss-cli` in `devDependencies`, alongside committed `AGENTS.md` and `CLAUDE.md` (`@AGENTS.md`) files.
2. **Automatic `postinstall` compilation & skill unpacking:** When you run `npm install`, the `"postinstall": "npm run types"` hook automatically executes `agboss check`, which:
   - Generates **`.agboss/types.d.ts`** so TypeScript immediately knows the Path Scope input of every node (`Produced<Dto, Producer>`), `app.execute`, and test scripts.
   - Unpacks **13 version-matched reference guides** into `.claude/skills/agboss/` (`SKILL.md` + `references/01..13`, including `13-migrating-from-langgraph.md`) so Claude Code, Cursor, Codex, Windsurf, and Copilot write idiomatic AGBoss v2 code from the first prompt.
3. **Interactive or non-interactive scaffolding:** Pass `--yes` and component flags directly in scripts or CI:

```bash
npx agboss create support-desk --yes --agents "triage:Sorts requests,answerer:Answers questions" --tools "answerer:search_orders"
```

Every scaffolded project also includes:
- **Typed workflow skeleton & environments:** `@WorkflowStart`, `@Router`, `@Agent` classes with `*.prompt.md` files, `@WorkflowFinish`, `@Application`, and `environments/` (`dev`, `staging`, `prod`, `test`).
- **Pre-configured ESLint flat config (`eslint.config.js` via `agboss/eslint`):** Enforces `agboss/no-component-state` (stateless singleton components), `agboss/no-direct-time` (using injected `Clock` instead of `Date.now()` / `setTimeout`), and `FLOW_CHAIN_RULE` (`@stylistic/newline-per-chained-call` — one chained method call per line in `*.workflow.ts`):

```ts title="eslint.config.ts"
import { agbossPlugin, FLOW_CHAIN_RULE } from "agboss/eslint";

export default [
  {
    plugins: { agboss: agbossPlugin },
    rules: {
      "agboss/no-component-state": "error",
      "agboss/no-direct-time": "error",
    },
  },
  {
    files: ["**/*.workflow.ts"],
    rules: {
      ...FLOW_CHAIN_RULE,
    },
  },
];
```

## Option 2: Add AGBoss to an existing project (why there are two packages)

To add AGBoss to an existing Node.js 22.13+ service or monorepo, install the runtime and the CLI in three steps:

```bash
npm install agboss
npm install -D agboss-cli
npx agboss check
```

### Why is AGBoss split into `agboss` and `agboss-cli`?

| Package | Where It Belongs | What It Contains & Why |
| :--- | :--- | :--- |
| **`agboss`** | `dependencies` | **Lightweight production runtime** shipped into your Docker / Kubernetes container image: decorators (`@Application`, `@Workflow`, `@Agent`, `@Action`, `@Router`, `@Arbiter`, `@Tool`, `@Budget`, `@PiiPolicy`, `@ChannelRole`), execution graph engine, DI container, storage repository contracts (`InMemory*` and `Sqlite*`), subpath entries (`agboss/dto`, `agboss/units`, `agboss/models`, `agboss/testing`, `agboss/eval`, `agboss/mcp`, `agboss/rag`, `agboss/a2a`, `agboss/memory`, `agboss/eslint`), and the bundled AI coding skills (`skills/agboss/`). |
| **`agboss-cli`** | `devDependencies` | **Developer & CI toolchain** kept out of production container images: the static graph compiler (`agboss check`, `--strict`, `--models`, `--cassettes`, `--federation`), code generator (`agboss generate`), watch-mode compiler (`agboss dev`), LangGraph Studio bridge (`agboss studio`), and local visual UI servers (`agboss eval ui`, `agboss hub ui`, `agboss eval show --html`, `agboss hub show --html`). |

Point `"agboss": { "application": "src/my-app.application.ts" }` in your `package.json`, then scaffold and wire components using `agboss generate` (alias `agboss g`) by their full names (including kind suffix):

```bash
npx agboss g agent billing-agent --workflow support-desk-workflow --description "Handles invoices"
npx agboss g tool refund-tool --workflow support-desk-workflow --agent billing-agent
npx agboss g openapi pets --url ./pets.yaml --workflow support-desk-workflow --agent billing-agent
```

## Verify your installation

Run `agboss check` to generate `.agboss/types.d.ts`, sync the 13 reference modules in `.claude/skills/agboss/`, and statically verify every flow path, DTO handoff, environment field, and prompt file offline without making any LLM calls:

```bash
npx agboss check
```

Continue to the [Quick start](/getting-started/quick-start/) to build and execute your first workflow.
