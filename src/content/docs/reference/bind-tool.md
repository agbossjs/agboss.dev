---
title: "@BindTool"
description: Complete API reference for the @BindTool decorator in AGBoss — binding pre-configured variants of a @Tool class with fixed parameters or overrides.
---

The `@BindTool` decorator creates a specialized, pre-bound variant of a base [`@Tool`](/reference/tool/) class (`tools/*.tool.ts`). It allows different agents in a workflow to share the same underlying `ToolHandler` implementation while restricting or pre-filling specific parameters, descriptions, timeouts, or approval channels.

## What options does `@BindTool` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique snake_case tool name for this bound variant (e.g., `"search_eu_jobs"`). |
| `description` | `string` | Yes | Specialized description shown to agents that use this bound tool. |
| `tool` | `Class<ToolHandler>` | Yes | The base [`@Tool`](/reference/tool/) class to delegate execution to. |
| `bind` | `Partial<Input>` | Yes | Fixed input fields merged into every call (omitted from the LLM's input schema). |
| `timeout` | `Milliseconds` | No | Overrides the base tool's timeout for this bound variant. |
| `approvalChannel` | `Class` | No | Attaches or overrides a [`@ChannelRole`](/reference/channel-role/) approval gate for this variant. |

## Complete `@BindTool` example

```ts title="src/tools/search-regional-jobs.tool.ts" no-check: reference example
import { BindTool, Tool, type ToolHandler } from "agboss";
import { ListOf, OneOf, Text } from "agboss/dto";
import { JobIndexService } from "../services/job-index.service.js";

export class RegionalSearchInputDto {
  @Text({ prompt: "Role keywords, e.g. Staff TypeScript" })
  query!: string;

  @OneOf({ values: ["EU", "US", "APAC"], prompt: "Hiring region" })
  region!: "EU" | "US" | "APAC";
}

export class RegionalSearchOutputDto {
  @ListOf(Text)
  openings!: string[];
}

@Tool({
  name: "search_regional_jobs",
  description: "Searches openings in a target region",
  input: RegionalSearchInputDto,
  output: RegionalSearchOutputDto,
  deps: [JobIndexService],
})
export class SearchRegionalJobsTool
  implements ToolHandler<RegionalSearchInputDto, RegionalSearchOutputDto>
{
  constructor(private readonly index: JobIndexService) {}

  async run(input: RegionalSearchInputDto): Promise<RegionalSearchOutputDto> {
    return { openings: await this.index.search(input.query, input.region) };
  }
}

// Bound variant that fixes region = "EU" so the LLM only passes { query }:
@BindTool({
  name: "search_eu_jobs",
  description: "Searches open engineering roles in the European Union (EU)",
  tool: SearchRegionalJobsTool,
  bind: { region: "EU" },
})
export class SearchEuJobsTool {}
```

```ts title="src/agents/eu-scout.agent.ts" no-check: reference example
import { Agent } from "agboss";
import { SearchEuJobsTool } from "../tools/search-regional-jobs.tool.js";

@Agent({
  name: "eu-scout-agent",
  description: "Finds EU roles using the pre-bound SearchEuJobsTool",
  model: "moonshotai/kimi-k2.6",
  prompt: "Call search_eu_jobs to find matching roles in Europe.",
  tools: [SearchEuJobsTool],
})
export class EuScoutAgent {}
```

```ts title="test/search-eu-jobs.tool.test.ts" no-check: reference example
import { expect, it } from "vitest";
import { testTool } from "agboss/testing";
import { SearchEuJobsTool } from "../src/tools/search-regional-jobs.tool.js";

it("automatically merges bound region='EU' when executing SearchEuJobsTool", async () => {
  const res = await testTool(SearchEuJobsTool, { query: "TypeScript" });
  expect(res.output.openings).toBeDefined();
});
```
