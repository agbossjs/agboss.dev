---
title: "@BindTool"
description: Complete API reference for the @BindTool method decorator in AGBoss — binding service methods to @Tool or @McpTool invocations.
---

The `@BindTool(ToolClass, options?)` method decorator (`"agboss"`) binds a method on a workflow provider class to a [`@Tool`](/reference/tool/) or [`@McpTool`](/reference/mcp-tool/) (optionally scoped to a specific [`@Agent`](/reference/agent/) via `{ agent: MyAgent }`).

## `@BindTool` example

<!--
```ts file=src/tools/bind-tool-ambient.d.ts
import type { BindToolOptions, Class } from "agboss";

declare module "agboss" {
  export function BindTool(
    tool: Class | string,
    options?: BindToolOptions,
  ): (value: unknown, context: ClassMethodDecoratorContext) => void;
}
```
-->

```ts title="src/tools/bound-search.service.ts" file=src/tools/bound-search.service.ts
import { Agent, BindTool, Injectable, Tool, type ToolHandler } from "agboss";
import { ListOf, Text } from "agboss/dto";

export class RegionalSearchInputDto {
  @Text({ prompt: "Role keywords, e.g. Staff TypeScript" })
  query!: string;
}

export class RegionalSearchOutputDto {
  @ListOf(Text, { prompt: "Matching role titles" })
  openings!: string[];
}

@Tool({
  name: "search_regional_jobs",
  description: "Searches openings in a target region",
  input: RegionalSearchInputDto,
  output: RegionalSearchOutputDto,
})
export class SearchRegionalJobsTool
  implements ToolHandler<RegionalSearchInputDto, RegionalSearchOutputDto>
{
  run(input: RegionalSearchInputDto): Promise<RegionalSearchOutputDto> {
    return Promise.resolve({ openings: [`Global: ${input.query}`] });
  }
}

@Agent({
  name: "eu-scout-agent",
  description: "Finds EU roles using SearchRegionalJobsTool",
  model: "moonshotai/kimi-k2.6",
  prompt: "Call search_regional_jobs to find matching roles in Europe.",
  tools: [SearchRegionalJobsTool],
})
export class EuScoutAgent {}

@Injectable()
export class EuJobSearchBindings {
  @BindTool(SearchRegionalJobsTool, { agent: EuScoutAgent })
  searchForEuAgent(input: RegionalSearchInputDto): Promise<RegionalSearchOutputDto> {
    return Promise.resolve({ openings: [`EU: ${input.query}`] });
  }
}
```

```ts title="test/bound-search.service.test.ts" file=test/bound-search.service.test.ts
import { expect, it } from "vitest";
import { testTool } from "agboss/testing";
import {
  EuJobSearchBindings,
  SearchRegionalJobsTool,
} from "../src/tools/bound-search.service.js";

it("executes default tool handler and bound EU override method", async () => {
  const runTool = testTool(SearchRegionalJobsTool);
  const { output: globalOut } = await runTool({ query: "Staff TypeScript" });
  expect(globalOut.openings).toEqual(["Global: Staff TypeScript"]);

  const bindings = new EuJobSearchBindings();
  const euOut = await bindings.searchForEuAgent({ query: "Staff TypeScript" });
  expect(euOut.openings).toEqual(["EU: Staff TypeScript"]);
});
```

## Signature and options

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `tool` | `Class \| string` | **Yes** | The `@Tool` / `@McpTool` class (or snake_case tool name string) handled or intercepted by this method. |
| `options.agent` | `Class \| string` | No | Optional `@Agent` class (or kebab-case agent name) restricting the binding to calls made by that specific agent. |
