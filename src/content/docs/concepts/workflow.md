---
title: Workflow
description: The single file where a graph is wired together.
---

The workflow is the single file where a graph is wired together: agents, tools and routers are declared as components, and the workflow assembles them through constructor injection.

## Build-time checks

TypeScript checks that every injected dependency exists and matches its declared type. The build step additionally checks that the workflow graph compiles — it does not verify every runtime connection: DTOs crossing a model boundary are validated at runtime, not at build time.

```ts
@Agent()
export class ResearchAgent {
  constructor(private readonly tools: ToolRegistry) {}
}

@Workflow()
export class JobScoutWorkflow {
  constructor(
    private readonly research: ResearchAgent,
    private readonly router: RouterService,
  ) {}
}
```

## Saga & cancellation

:::caution[Planned]
Long-running workflows will support compensating steps and cooperative cancellation. Not available yet — tracked for a future release.
:::
