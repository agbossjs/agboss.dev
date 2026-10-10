---
title: Quick start
description: A minimal AGBoss agent in a few lines.
---

```ts
import { Agent, Workflow } from 'agboss';

@Agent()
export class ResearchAgent {
  constructor(private readonly tools: ToolRegistry) {}
}

@Workflow()
export class JobScoutWorkflow {
  constructor(private readonly research: ResearchAgent) {}
}
```

See the [job-scout](/examples/job-scout/) example for a complete, runnable workflow.
