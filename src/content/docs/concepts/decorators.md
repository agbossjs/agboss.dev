---
title: Decorators
description: The component decorators AGBoss is built from.
---

AGBoss components are declared with decorators, in an Angular-style design: `@Agent`, `@Tool`, `@Router` and `@Workflow`. Each decorator marks a class as a component that the workflow wires together through constructor injection.

| Decorator | Marks a component that… |
|---|---|
| `@Agent` | wraps a model call |
| `@Tool` | performs an action the model can call |
| `@Router` | decides which branch of the graph runs next |
| `@Workflow` | assembles components into the graph |

See [API Reference](/reference/) for the full decorator signatures.
