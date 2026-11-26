---
title: "DecisionModel"
description: "Reference for DecisionModel in AGBoss — the injectable service that asks a decision model closed questions (Decision.boolean, choice, score) from a @Tool, an @Action or a service."
---

`DecisionModel` (`"@agboss/core"`) is the injectable **decisions service**. A `@Tool`, an `@Action` or a service that needs a cheap decision of its own lists it in `deps` and calls `decide({ state, questions }, { model?, modelProvider? })` for typed answers to closed questions. Underneath a model `@Router` is an engine that picks one option for a piece of text; that engine is not public (`ROUTER_FACTORY`, `RouterEngine`, `RouteRequest` are in `@agboss/core/internal`), and `DecisionModel` is its public counterpart for your own code. Replace `routers("name").route(...)` of 0.1.0 by `decisionModel.decide(...)`.

## Complete `DecisionModel` example

```ts title="src/services/job-fit.service.ts" file=src/services/job-fit.service.ts
import { Decision, DecisionModel, Injectable, secret } from "@agboss/core";
import { DecisionsDriver, ModelCost, ModelProvider } from "@agboss/core/models";
import { seconds } from "@agboss/core/units";

// a decision model is served by a provider with a DecisionsDriver
@ModelProvider({
  name: "decisions-model-provider",
  description: "Decision models on OpenRouter's Decisions API",
  driver: DecisionsDriver({ baseUrl: "https://openrouter.ai/api/v1", apiKey: secret("OPENROUTER_API_KEY") }),
  timeout: seconds(30),
  cost: ModelCost.fromResponse(),
})
export class DecisionsModelProvider {}

const FIT_QUESTION = "Does the job fit what the candidate wants?";

@Injectable({ deps: [DecisionModel] })
export class JobFitService {
  constructor(private readonly decisionModel: DecisionModel) {}

  async fits(profile: string, job: string): Promise<boolean> {
    const { fits } = await this.decisionModel.decide(
      {
        state: `Candidate wants:\n${profile}\n\nJob:\n${job}`,
        questions: { fits: Decision.boolean(FIT_QUESTION) },
      },
      { model: "typesafe/jev-1.13", modelProvider: DecisionsModelProvider },
    );
    return fits.probability > 0.5; // P(yes), as every boolean decision answers
  }
}
```

## How a decision runs

- **Questions are closed and typed.** `Decision.boolean(instructions, criteria?)` answers `{ probability }` (P(yes)); `Decision.choice(…)` an option with probabilities and a confidence; `Decision.score(instructions, levels)` the index of a level, lowest first. The answers are typed by the questions' ids. `Decision.noul` of 0.1.0 is `Decision.boolean`, its answer a `probability`.
- **The model is the call's own, else the cascade.** `{ model?, modelProvider? }` of the call, otherwise the `modelProvider` cascade of the component's workflow and application ([`@ModelProvider`](/reference/model-provider/)). A chat provider does not serve a decision (`[model.incompatible-provider]`); a chat model asked to `decide` or a decision model asked to `invoke` throws `ConfigError.ModelKind` (`model.wrong-kind`).
- **Budgets, spend and traces are the framework's.** The call is stopped by an exhausted budget before any request; its cost (and the cost of a billed answer that could not be used) is the tool call's spend — the execution's cost report, its budgets and the ledger — and it is traced like a router's.
- **A failed decision is an error with its spend kept.** `DecisionError` (`DecisionErrorKind.InvalidResponse`, …) never carries what the model said.

## What related entities work with `DecisionModel`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `Decision` (`boolean`, `choice`, `score`) | `"@agboss/core"` | Builders for the closed questions of `decide({ state, questions })`. |
| `JudgeModel` / `ArbiterModel` | `"@agboss/core"` | The same capability for a hybrid [`@Judge`](/reference/judge/) and [`@Arbiter`](/reference/arbiter/), charged under `judge:<name>` / `arbiter:<name>`. |
| `DecisionsDriver` | `"@agboss/core/models"` | The driver of a provider that serves decision models (`DECISION_MODELS`: `typesafe/jev-*`, `openai/gpt-6-luna-decisions`, …). |
| `decideWith({ id: 0.9 })` | `"@agboss/core/testing"` | Scripts a decision model's answers by question id in `testWith`. |
