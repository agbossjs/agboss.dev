---
title: "@Rag"
description: Complete API reference for the @Rag decorator in AGBoss — RagSource, SqliteFtsRagSource, RagScope, search(query), rerankers, citations, and testUnit().
---

A knowledge base is a class that **extends `RagSource`** — embeddings or full-text, local or an API, SQLite or a vector DB — annotated `@Rag` (`rag/*.rag.ts`). The core wires it: agents that list it in `rag` get its passages before their first model call, and anything else (a `@Tool`, an `@Action`) injects it and calls `search(query)`. Both go through one pipeline — scope, reranking, PII policies, cost and tokens into the budgets, tracing under `rag:<name>` — so a caller cannot bypass any of it: `retrieve` is `protected`. `@Rag` and `@Tool` are orthogonal: `@Tool` knows nothing of `@agboss/core/rag`. The 0.1.0 `RagConnector` interface, `SqliteFtsConnector`, `RagTenancy` and `RagMode` (`@Agent({ rag: [{ use, mode }] })`) are gone.

## Complete `@Rag` examples (`SqliteFtsRagSource` and a custom `RagSource`)

```ts title="src/rag/job-postings.rag.ts" file=src/rag/job-postings.rag.ts
import { ExecutionContext } from "@agboss/core";
import {
  Rag,
  RagScope,
  RagSource,
  SqliteFtsRagSource,
  type RagRetrieval,
  type RagRetrieveOptions,
} from "@agboss/core/rag";
import { usd } from "@agboss/core/units";
import { VectorSearchService } from "../services/vector-search.service.js";

// 1. Built-in SQLite FTS5 BM25 knowledge base (extends SqliteFtsRagSource; its options go to super):
@Rag({
  name: "job_postings_fts",
  description: "Full-text BM25 index of open engineering job descriptions and salary bands",
  scope: RagScope.Shared, // one corpus every tenant reads
  topK: 5,
})
export class JobPostingsFtsRag extends SqliteFtsRagSource {
  constructor() {
    super({ directory: "./docs/jobs", path: ".agboss/rag/job-postings.sqlite" });
  }
}

// 2. Custom external vector/hybrid database (extends RagSource, implements retrieve):
@Rag({
  name: "engineering_runbooks",
  description: "Production architecture runbooks and incident postmortems",
  scope: RagScope.Tenant, // every call carries the tenant: retrieve returns that tenant's passages only
  topK: 4,
  deps: [ExecutionContext, VectorSearchService],
})
export class EngineeringRunbooksRag extends RagSource {
  constructor(
    private readonly executionContext: ExecutionContext,
    private readonly vectorSearch: VectorSearchService,
  ) {
    super();
  }

  protected override async retrieve(query: string, options: RagRetrieveOptions): Promise<RagRetrieval> {
    void this.executionContext.signal;
    const hits = await this.vectorSearch.query(query, { topK: options.topK });
    const results = hits.map((hit) => ({ text: hit.text, source: hit.id, score: hit.score }));
    return { results, costUsd: usd(0.0004) };
  }
}
```

```ts title="src/services/vector-search.service.ts" file=src/services/vector-search.service.ts
import { Injectable } from "@agboss/core";

@Injectable()
export class VectorSearchService {
  query(_query: string, opts: { topK: number; tenantId?: string }) {
    return Promise.resolve(
      [
        { id: "band-l6", text: "L6 Staff Engineer band: $210k-$250k", score: 0.94 },
      ].slice(0, opts.topK),
    );
  }
}
```

```ts title="src/agents/recruiter-rag.agent.ts" file=src/agents/recruiter-rag.agent.ts
import { Agent, inline } from "@agboss/core";
import { EngineeringRunbooksRag, JobPostingsFtsRag } from "../rag/job-postings.rag.js";

@Agent({
  name: "recruiter-rag-agent",
  description: "Combines BM25 FTS search and custom vector retrieval with [source] citations",
  model: "moonshotai/kimi-k2.6",
  prompt: inline("Answer candidate questions using retrieved chunks and cite [source]."),
  rag: [JobPostingsFtsRag, EngineeringRunbooksRag], // a list of @Rag classes; one listed twice is [agent.duplicate-rag]
})
export class RecruiterRagAgent {}
```

```ts title="src/tools/search-runbooks.tool.ts" file=src/tools/search-runbooks.tool.ts
import { Tool } from "@agboss/core";
import { RagQueryDto, RagSearchResultsDto } from "@agboss/core/rag";
import { EngineeringRunbooksRag } from "../rag/job-postings.rag.js";

// a search tool: an ordinary @Tool over the knowledge base, with the ready-made DTOs
@Tool({
  name: "search-runbooks",
  description: "Searches the engineering runbooks",
  input: RagQueryDto, // { query }
  output: RagSearchResultsDto, // { results }
  readOnly: true,
  deps: [EngineeringRunbooksRag],
})
export class SearchRunbooksTool {
  constructor(private readonly runbooks: EngineeringRunbooksRag) {}

  execute({ query }: RagQueryDto) {
    return this.runbooks.search(query); // topK and filter per call: search(query, { topK: 2 })
  }
}
```

```ts title="test/job-postings.rag.test.ts" file=test/job-postings.rag.test.ts
import { expect, it } from "vitest";
import { testUnit } from "@agboss/core/testing";
import { EngineeringRunbooksRag } from "../src/rag/job-postings.rag.js";

it("retrieves ranked passages with source IDs and tracks rag spend", async () => {
  const runRag = testUnit(EngineeringRunbooksRag);

  const { output, spend } = await runRag("Staff Engineer salary band", { topK: 3 });
  expect(output[0]?.source).toBe("band-l6");
  expect(spend.totalUsd).toBeCloseTo(0.0004);
});
```

## What options does `@Rag` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique identifier for the knowledge base (`"company_handbook"`); keys cost attribution (`rag:company_handbook`) and generated search tool names. |
| `description` | `string` | Yes | Explains what documents this knowledge base holds. |
| `topK` | `number` | Yes | Maximum number of passages returned per retrieval call (no implicit default; omitting it is a compile error). |
| `scope` | `RagScope` | Yes | Whose passages a call may read: `RagScope.Shared` (one corpus every tenant reads), `Tenant`, `Owner` or `Custom` (the source's `resolveScope(context)` returns a key, `[rag.custom-scope-missing-resolver]`). Every scope but `Shared` is bound to the tenant: a call carries `tenantId` and `scopeId` and a source keys its rows on the pair. Without it the decorator does not compile (`[rag.scope-required]` for a JS caller). It replaces `tenancy`. |
| `reranker` | `Class` | No | A `@RagReranker` class that re-orders `candidates` from the source and gives the agent the best `topK` (`1 ≤ topK ≤ candidates`, else `[rag.rerank-invalid]`). |
| `deps` | `readonly Token[]` | No | Constructor dependencies (`ExecutionContext`, `@Injectable` vector clients) verified against constructor parameters; call `super()` first. |

The 0.1.0 `prompt` / `promptUrls` of a knowledge base are gone.

## What related entities work with `@Rag`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `RagSource` | `"@agboss/core/rag"` | The base class: `protected abstract retrieve(query, options)` returning `{ results, costUsd?, tokens? }`, an optional `protected index(options)`, `resolveScope?` for `RagScope.Custom`, and the public `search(query, { topK?, filter? })`. `RagSource<TFilter>` types a metadata filter. |
| `SqliteFtsRagSource` | `"@agboss/core/rag"` | Built-in zero-dependency SQLite FTS5 BM25 source with automatic tokenization and ranking; `agboss rag index --tenant <id>` builds it. |
| `RagQueryDto` & `RagSearchResultsDto` | `"@agboss/core/rag"` | The ready-made input and output of a search tool. |
| `@RagReranker` | `"@agboss/core/rag"` | A reranker (`candidates`, `maxCandidateLength`, `onFailure`); an empty class is the core's LLM reranker on the model of its provider's cascade. |
| `testUnit(RagClass, options?)` | `"@agboss/core/testing"` | Isolated unit runner that tests `retrieve()` and `rag:<name>` cost tracking with fake `services` without booting an agent. |
