---
title: "@Rag"
description: Complete API reference for the @Rag decorator in AGBoss — RagConnector, SqliteFtsConnector, RagMode.Tool vs RagMode.Context, source citations, and testRag().
---

The `@Rag` decorator (`rag/*.rag.ts`) defines a knowledge base component implementing `RagConnector` (or extending the built-in zero-dependency `SqliteFtsConnector`). Agents attach knowledge bases via `@Agent({ rag: [{ use: DocsRag, mode: RagMode.Tool | RagMode.Context }] })`, and AGBoss automatically formats retrieved passages with `[source]` citations and tracks retrieval spend under `rag:<name>`.

## What options does `@Rag` accept?

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Unique identifier for the knowledge base (`"company_handbook"`); keys cost attribution (`rag:company_handbook`) and generated search tool names. |
| `description` | `string` | Yes | Explains what documents this knowledge base holds so the agent knows when to query it in `RagMode.Tool`. |
| `topK` | `number` | Yes | Maximum number of passages returned per retrieval call (required, no implicit default). |
| `prompt` / `promptUrls` | `string` / `readonly string[]` | No | Additional instructions guiding how the agent should query or cite passages from this knowledge base. |
| `deps` | `readonly Token[]` | No | Constructor dependencies (`AppEnvironment`, `ExecutionContext`, `@Injectable` vector clients) verified against constructor parameters. |

## Complete `@Rag` examples (`SqliteFtsConnector` and custom `RagConnector`)

```ts title="src/rag/job-postings.rag.ts" no-check: reference example
import { ExecutionContext, Rag, RagMode } from "agboss";
import { SqliteFtsConnector, type RagConnector, type RagDocument, type RagRetrieveOptions, type RagRetrieveResult } from "agboss/rag";
import { AppEnvironment } from "../environments/app.environment.js";
import { VectorSearchService } from "../services/vector-search.service.js";

// 1. Built-in SQLite FTS5 BM25 knowledge base (extends SqliteFtsConnector):
@Rag({
  name: "job_postings_fts",
  description: "Full-text BM25 index of open engineering job descriptions and salary bands",
  topK: 5,
  prompt: "Cite the posting ID in brackets like [job-104] for every compensation figure.",
  deps: [AppEnvironment],
})
export class JobPostingsFtsRag extends SqliteFtsConnector {
  constructor(env: AppEnvironment) {
    super({ dbPath: env.sqlitePath, tableName: "jobs_fts" });
  }
}

// 2. Custom external vector/hybrid database (implements RagConnector):
@Rag({
  name: "engineering_runbooks",
  description: "Production architecture runbooks and incident postmortems",
  topK: 4,
  deps: [ExecutionContext, VectorSearchService],
})
export class EngineeringRunbooksRag implements RagConnector {
  constructor(
    private readonly executionContext: ExecutionContext,
    private readonly vectorSearch: VectorSearchService,
  ) {}

  async retrieve(query: string, options: RagRetrieveOptions): Promise<RagRetrieveResult> {
    const hits = await this.vectorSearch.query({
      query,
      topK: options.topK,
      signal: options.signal ?? this.executionContext.signal,
    });
    return {
      chunks: hits.map((hit) => ({
        content: hit.text,
        source: hit.docId,
        score: hit.similarity,
      })),
      costUsd: 0.0004,
    };
  }

  async index(documents: readonly RagDocument[]): Promise<void> {
    await this.vectorSearch.upsert(documents);
  }
}
```

```ts title="src/agents/recruiter-rag.agent.ts" no-check: reference example
import { Agent, RagMode } from "agboss";
import { JobPostingsFtsRag, CompensationVectorRag } from "../rag/job-postings.rag.js";

@Agent({
  name: "recruiter-rag-agent",
  description: "Combines BM25 FTS search and custom vector retrieval with [source] citations",
  model: "moonshotai/kimi-k2.6",
  prompt: "Answer candidate questions using retrieved chunks and cite [source].",
  rag: [
    { use: JobPostingsFtsRag, mode: RagMode.Tool },
    { use: CompensationVectorRag, mode: RagMode.Context },
  ],
})
export class RecruiterRagAgent {}
```

## What related entities work with `@Rag`?

| Related Entity | Import Path | Purpose |
| :--- | :--- | :--- |
| `RagConnector` | `"agboss/rag"` | Interface implemented by `@Rag` classes (`retrieve(query, { topK, signal }): Promise<RagRetrieveResult>` and optional `index(docs)`). |
| `SqliteFtsConnector` | `"agboss/rag"` | Built-in zero-dependency SQLite FTS5 BM25 connector with automatic tokenization and ranking. |
| `RagMode` (`Tool`, `Context`) | `"agboss"` | Used in `@Agent({ rag: [{ use: MyRag, mode }] })`: `RagMode.Tool` exposes a search tool the model calls on demand; `RagMode.Context` pre-fetches top-K passages before the model call. |
| `testRag(RagClass, options?)` | `"agboss/testing"` | Isolated unit runner that tests `retrieve()` and `index()` with DI overrides without booting an agent. |

### Unit-testing a `@Rag` knowledge base with `testRag`

```ts title="test/job-postings.rag.test.ts" no-check: reference example
import { expect, it } from "vitest";
import { testRag } from "agboss/testing";
import { JobPostingsFtsRag } from "./job-postings-fts.rag.js";

it("indexes documents and retrieves ranked BM25 chunks with source IDs", async () => {
  const rag = testRag(JobPostingsFtsRag);

  await rag.index([
    { id: "job-104", content: "Staff TypeScript Engineer — distributed LangGraph workflows, $210k-$240k." },
  ]);

  const result = await rag.retrieve("TypeScript LangGraph salary");
  expect(result.chunks[0]?.source).toBe("job-104");
});
```

```ts title="src/services/vector-search.service.ts" no-check: reference example
import { Injectable } from "agboss";

@Injectable()
export class VectorSearchService {
  async query(query: string, opts: { topK: number; tenantId?: string }) {
    return [
      { id: "band-l6", text: "L6 Staff Engineer band: $210k-$250k", score: 0.94 },
    ].slice(0, opts.topK);
  }
}
```
