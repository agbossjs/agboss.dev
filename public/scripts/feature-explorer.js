/*
 * Feature explorer on the home page: Problem -> Solution -> Code.
 * Every snippet mirrors real AGBoss contracts without vertical scrollbars.
 */
(function () {
	var SNIPPETS = {
		"application": {
			"file": "src/job-scout.application.ts",
			"problem": "Ad-hoc scripts boot without cost caps, PII policies, or durable stores, wiring different graphs in prod and tests.",
			"solution": "<code>@Application</code> is a single verified root: <code>createApp()</code> checks all paths, budgets, and secrets upfront.",
			"code": [
				"import {",
				"  Application,",
				"  Budget,",
				"  BudgetPeriod,",
				"  BudgetScope,",
				"  EmptyEnvironment,",
				"  type BudgetHandler,",
				"} from \"@agboss/core\";",
				"import { usd, type Usd } from \"@agboss/core/units\";",
				"import { JobIndexService } from \"./services/job-index.service.js\";",
				"import { JobScoutWorkflow } from \"./workflows/job-scout.workflow.js\";",
				"import { JobScoutModelProvider } from \"./job-scout.model-provider.js\";",
				"",
				"@Budget({ name: \"js-app-budget\", scope: BudgetScope.Application, period: BudgetPeriod.Day })",
				"export class JsAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(20); } }",
				"@Budget({ name: \"js-tenant-budget\", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })",
				"export class JsTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }",
				"@Budget({ name: \"js-exec-budget\", scope: BudgetScope.Execution })",
				"export class JsExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }",
				"",
				"@Application({",
				"  name: \"job-scout-application\",",
				"  version: \"1.0.0\",",
				"  environment: EmptyEnvironment,",
				"  workflows: [JobScoutWorkflow],",
				"  modelProvider: JobScoutModelProvider,",
				"  providers: [JobScoutModelProvider, JobIndexService],",
				"  budgets: [JsAppBudget, JsTenantBudget, JsExecBudget],",
				"})",
				"export class JobScoutApplication {}"
			],
			"files": [
				{
					"file": "src/support.storage.ts",
					"code": [
						"import { DatabaseStorage, SqliteDriver, defineEnv, env, secret } from \"@agboss/core\";",
						"import { hours } from \"@agboss/core/units\";",
						"",
						"const databaseEnv = defineEnv({",
						"  path: env(\"AGBOSS_SQLITE_PATH\", { default: \".agboss/state.sqlite\" }),",
						"  piiSecret: secret(\"PII_PSEUDONYM_KEY\"),",
						"  idempotencySecret: secret(\"AGBOSS_IDEMPOTENCY_SECRET\"),",
						"});",
						"",
						"@DatabaseStorage({",
						"  name: \"support-database-storage\",",
						"  driver: SqliteDriver({ path: databaseEnv.path }),",
						"  auditLogTtl: hours(24 * 30),",
						"  ledgerEntriesTtl: hours(24),",
						"  piiSecret: databaseEnv.piiSecret, // the key of the application's PII tokens, the same on every pod",
						"  idempotencySecret: databaseEnv.idempotencySecret,",
						"})",
						"export class SupportDatabaseStorage {}"
					]
				}
			]
		},
		"workflow": {
			"file": "src/chat.workflow.ts",
			"problem": "Imperative loops and mutable God State bags hide broken edges and dead branches until production traffic hits them.",
			"solution": "<code>@Workflow</code> declares pure <code>HarnessDSL</code> paths (1 call per line) verified by <code>agboss check</code> before runtime.",
			"code": [
				"import { Workflow, onAgent, onStart, toAgent, toFinish, toRouter, Ttl } from \"@agboss/core\";",
				"",
				"@Workflow({",
				"  name: \"chat-workflow\",",
				"  version: \"1.0.0\",",
				"  historyTtl: Ttl.Forever,",
				"  flow: [",
				"    onStart(IntakeWorkflowStart)",
				"      .toRouter(MainRouter)",
				"      .onRoute(",
				"        toAgent(ProfilerAgent)",
				"          .toOneOf([",
				"            toAgent(ScoutAgent), // reached from two places: continued once, below",
				"            toFinish(AskResumeWorkflowFinish),",
				"          ]),",
				"      )",
				"      .onRoute(toAgent(ScoutAgent))",
				"      .onRoute(toFinish(NoReplyWorkflowFinish)),",
				"",
				"    onAgent(ScoutAgent)",
				"      .toFinish(ChatWorkflowFinish),",
				"  ],",
				"  executionLimits: { maxSteps: 8 },",
				"})",
				"export class ChatWorkflow {}"
			],
			"files": [
				{
					"file": "src/workflows/role-match/role-match.workflow.ts",
					"code": [
						"import { Workflow, WorkflowFinish, optional, onStart, Ttl } from \"@agboss/core\";",
						"import { WorkflowFinishTextDto } from \"@agboss/core/dto\";",
						"import {",
						"  CandidateProfileDto,",
						"  JobRoleDto,",
						"  RoleMatchWorkflowStart,",
						"} from \"./role-match.workflow-start.js\";",
						"import { MatcherAgent } from \"../../agents/matcher/matcher.agent.js\";",
						"",
						"@WorkflowFinish({",
						"  name: \"match-workflow-finish\",",
						"  description: \"Returns candidate match report\",",
						"  output: WorkflowFinishTextDto,",
						"})",
						"export class MatchWorkflowFinish {}",
						"",
						"@Workflow({",
						"  name: \"role-match-workflow\",",
						"  version: \"1.0.0\",",
						"  historyTtl: Ttl.Forever,",
						"  flow: [",
						"    onStart(RoleMatchWorkflowStart)",
						"      .toAgent(MatcherAgent)",
						"      .toFinish(MatchWorkflowFinish),",
						"  ],",
						"})",
						"export class RoleMatchWorkflow {}"
					]
				}
			]
		},
		"agent": {
			"file": "src/agents/order-assistant.agent.ts",
			"problem": "Stuffing tools, prompts, and retries into a single mega-agent wastes tokens and makes quality regressions impossible to isolate.",
			"solution": "<code>@Agent</code> isolates one role with typed <code>input</code>/<code>output</code> DTOs, static prompts, and <code>@Judge</code> gates.",
			"code": [
				"import { Agent, inline } from \"@agboss/core\";",
				"import { LookupOrderTool } from \"../tools/lookup-order.tool.js\";",
				"",
				"@Agent({",
				"  name: \"order-assistant-agent\",",
				"  description: \"Looks up customer order status using LookupOrderTool\",",
				"  model: \"moonshotai/kimi-k2.6\",",
				"  prompt: inline(\"Look up the order status before answering.\"),",
				"  tools: [LookupOrderTool],",
				"})",
				"export class OrderAssistantAgent {}"
			],
			"files": [
				{
					"file": "src/agents/offer-reviewer.prompt.md",
					"code": [
						"# Role: Principal Compensation Reviewer ({{department}})",
						"",
						"Audit the candidate offer draft against the {{department}} salary bands.",
						"- Cite every handbook rule using its [source] identifier.",
						"- Output `DraftApprovedDto` only if base salary and equity are within band.",
						"- Otherwise output `ChangesRequestedDto` with concrete revision instructions."
					]
				}
			]
		},
		"router": {
			"file": "src/routers/order-triage.router.ts",
			"problem": "Calling a frontier chat LLM just to pick the next branch adds 2–4s of latency and burns token budget on every hop.",
			"solution": "<code>@Router</code> switches between <code>DecidedBy.Model</code> (fast JEV classifier) and <code>DecidedBy.Code</code> (0ms, $0.00).",
			"code": [
				"import {",
				"  DecidedBy,",
				"  Router,",
				"  type InputOf,",
				"  type Route,",
				"  type RouterHandler,",
				"} from \"@agboss/core\";",
				"",
				"@Router({",
				"  name: \"order-triage-router\",",
				"  description: \"Deterministically routes international or high-value orders to compliance review\",",
				"  decidedBy: DecidedBy.Code,",
				"  input: { order: OrderTriageDto },",
				"  routes: [ComplianceReviewAgent, FastTrackCaptureAction], // a code router's route is its class",
				"})",
				"export class OrderTriageRouter implements RouterHandler<OrderTriageRouter> {",
				"  route(input: InputOf<OrderTriageRouter>): Route<OrderTriageRouter> {",
				"    const { amountCents, isInternational } = input.order;",
				"    return isInternational || amountCents > 500_000",
				"      ? ComplianceReviewAgent",
				"      : FastTrackCaptureAction;",
				"  }",
				"}"
			],
			"files": [
				{
					"file": "test/order-triage.router.test.ts",
					"code": [
						"import { expect, it } from \"vitest\";",
						"import { testUnit } from \"@agboss/core/testing\";",
						"import {",
						"  ComplianceReviewAgent,",
						"  FastTrackCaptureAction,",
						"  OrderTriageRouter,",
						"} from \"../src/routers/order-triage.router.js\";",
						"",
						"it(\"verifies crystallized DecidedBy.Code router with zero LLM calls\", async () => {",
						"  const runRouter = testUnit(OrderTriageRouter);",
						"",
						"  const highValue = await runRouter({",
						"    order: {",
						"      tier: \"enterprise\", amountCents: 750_000, isInternational: false,",
						"    },",
						"  });",
						"  expect(highValue.output).toBe(ComplianceReviewAgent);",
						"",
						"  const standard = await runRouter({",
						"    order: {",
						"      tier: \"free\", amountCents: 25_000, isInternational: false,",
						"    },",
						"  });",
						"  expect(standard.output).toBe(FastTrackCaptureAction);",
						"});"
					]
				}
			]
		},
		"tool": {
			"file": "src/tools/refund-card-payment.tool.ts",
			"problem": "Unvalidated tool arguments, hung HTTP calls, and non-idempotent retries corrupt external APIs and databases.",
			"solution": "<code>@Tool</code> validates DTOs, enforces <code>timeout: seconds(n)</code>, and injects <code>step.idempotencyKey</code> via DI.",
			"code": [
				"import { ExecutionContext, SpendRecorder, Tool } from \"@agboss/core\";",
				"import { kilobytes, seconds, usd } from \"@agboss/core/units\";",
				"import { RefundToolApproval } from \"../approvals/refund.tool-approval.js\";",
				"import { RefundInputDto, RefundOutputDto } from \"../dto/refund.dto.js\";",
				"import { PaymentsService } from \"../services/payments.service.js\";",
				"",
				"@Tool({",
				"  name: \"refund_card_payment\",",
				"  description: \"Issues a card refund for an order after approval. Call it only after verifying the order ID and exact amount in cents.\",",
				"  input: RefundInputDto,",
				"  output: RefundOutputDto,",
				"  approval: RefundToolApproval, // the target, never the channel: a person answers before every call runs",
				"  timeout: seconds(15),",
				"  maxResultSize: kilobytes(64),",
				"  deps: [ExecutionContext, SpendRecorder, PaymentsService],",
				"})",
				"export class RefundCardPaymentTool {",
				"  constructor(",
				"    private readonly executionContext: ExecutionContext,",
				"    private readonly spendRecorder: SpendRecorder,",
				"    private readonly paymentsService: PaymentsService,",
				"  ) {}",
				"",
				"  async execute(input: RefundInputDto): Promise<RefundOutputDto> {",
				"    const refundId = await this.paymentsService.refund({",
				"      orderId: input.orderId,",
				"      amountCents: input.amountCents,",
				"      idempotencyKey: this.executionContext.step.idempotencyKey,",
				"      signal: this.executionContext.signal,",
				"    });",
				"    this.spendRecorder.record({ service: \"stripe-refund-fee\", cost: usd(0.02) });",
				"    return {",
				"      status: \"refunded\",",
				"      refundId,",
				"    };",
				"  }",
				"}"
			],
			"files": [
				{
					"file": "src/approvals/refund.tool-approval.ts",
					"code": [
						"import { PauseRespondent, ToolApproval } from \"@agboss/core\";",
						"import { hours } from \"@agboss/core/units\";",
						"import { RefundInputDto } from \"../dto/refund.dto.js\";",
						"",
						"// the target: what is approved, who may answer, for how long — its @Channel (listed in",
						"// @Application({ channels })) only carries it",
						"@ToolApproval({",
						"  name: \"refund-tool-approval\",",
						"  description: \"Requests human sign-off before executing high-value card refunds\",",
						"  input: RefundInputDto, // the input of every tool naming it",
						"  respondent: PauseRespondent.Delegate,",
						"  timeout: hours(24),",
						"})",
						"export class RefundToolApproval {}"
					]
				}
			]
		},
		"mcp": {
			"file": "src/mcp/job-scout.mcp-endpoint.ts",
			"problem": "Raw MCP integrations return untyped JSON blobs and require custom server boilerplate to expose your own tools.",
			"solution": "<code>@McpServer</code> types external calls inside a <code>@Tool</code>, while <code>@McpEndpoint</code> serves your tools and workflow starts over MCP.",
			"code": [
				"import { connectMcpStdio, McpEndpoint } from \"@agboss/core/mcp\";",
				"",
				"@McpEndpoint({",
				"  name: \"job-scout-mcp\",",
				"  version: \"1.0.0\",",
				"  tools: [SearchIssues, ChatWorkflowStart], // tools of the workflow, and its starts (listed in @Application({ endpoints }))",
				"})",
				"export class JobScoutMcp {}",
				"",
				"export async function serveStdio() {",
				"  const app = await createApp(JobScoutApplication);",
				"  await using connection = await connectMcpStdio(app, {",
				"    endpoint: JobScoutMcp,",
				"    session: { tenant: { tenantId: \"acme\" }, ownerId: \"claude-desktop\" }, // who the local client is",
				"  }); // serves until closed",
				"  void connection;",
				"}"
			],
			"files": [
				{
					"file": "src/mcp/read-file.mcp.ts",
					"code": [
						"import { Tool } from \"@agboss/core\";",
						"import { McpServer, McpServerClient, McpTransport } from \"@agboss/core/mcp\";",
						"",
						"const fsTools = {",
						"  read_file: { input: ReadFileInputDto, output: ReadFileOutputDto }, // the server's own tool name",
						"};",
						"",
						"@McpServer({",
						"  name: \"filesystem-mcp-server\",",
						"  transport: McpTransport.Stdio,",
						"  command: \"npx\",",
						"  args: [\"-y\", \"@modelcontextprotocol/server-filesystem\", \"./workspace\"],",
						"  tools: fsTools,",
						"})",
						"export class FilesystemMcpServer extends McpServerClient<typeof fsTools> {}",
						"",
						"// the model sees the @Tool; it lists the server in deps and calls it",
						"@Tool({",
						"  name: \"read_file\",",
						"  description: \"Reads a file from the workspace via MCP\",",
						"  input: ReadFileInputDto,",
						"  output: ReadFileOutputDto,",
						"  deps: [FilesystemMcpServer],",
						"})",
						"export class ReadFileTool {",
						"  constructor(private readonly fs: FilesystemMcpServer) {}",
						"",
						"  execute(input: ReadFileInputDto): Promise<ReadFileOutputDto> {",
						"    return this.fs.call(\"read_file\", input);",
						"  }",
						"}"
					]
				}
			]
		},
		"rag": {
			"file": "src/rag/company-docs.rag.ts",
			"problem": "Uncited vector search dumps noisy chunks into prompts without tracking retrieval spend or source provenance.",
			"solution": "<code>@Rag</code> enforces <code>topK</code> and <code>RagScope</code>, cites <code>[source]</code> IDs, and ships built-in <code>SqliteFtsRagSource</code> BM25 search.",
			"code": [
				"import { Agent, inline } from \"@agboss/core\";",
				"import { Rag, RagScope, SqliteFtsRagSource } from \"@agboss/core/rag\";",
				"",
				"@Rag({",
				"  name: \"company_docs\",",
				"  description: \"Product, onboarding, and engineering runbook documentation\",",
				"  scope: RagScope.Tenant, // each tenant indexes and reads its own copy",
				"  topK: 4,",
				"})",
				"export class CompanyDocs extends SqliteFtsRagSource {",
				"  constructor() {",
				"    super({ directory: \"./docs/handbook\", path: \".agboss/rag/company-docs.sqlite\" });",
				"  }",
				"}",
				"",
				"@Agent({",
				"  name: \"onboarding-agent\",",
				"  description: \"Answers questions from the handbook with citations\",",
				"  prompt: inline(\"Answer from the handbook passages and cite [source].\"),",
				"  model: \"moonshotai/kimi-k2.6\",",
				"  rag: [CompanyDocs],",
				"})",
				"export class OnboardingAgent {}"
			],
			"files": [
				{
					"file": "test/company-docs.rag.test.ts",
					"code": [
						"import { expect, it } from \"vitest\";",
						"import { testUnit } from \"@agboss/core/testing\";",
						"import { CompanyDocs } from \"../src/rag/company-docs.rag.js\";",
						"",
						"it(\"retrieves BM25 chunks with [source] IDs via testUnit\", async () => {",
						"  const runRag = testUnit(CompanyDocs);",
						"  const { output, spend } = await runRag(\"refund timeframe\");",
						"  expect(output).toBeDefined();",
						"  expect(spend.totalUsd).toBe(0);",
						"});"
					]
				}
			]
		},
		"provider": {
			"file": "src/model-providers/openrouter.model-provider.ts",
			"problem": "Concurrent tenants trigger 429 rate-limit cascades and retry storms when hitting model APIs directly.",
			"solution": "<code>@ModelProvider</code> takes an explicit driver (<code>OpenRouterDriver</code>, <code>OpenAiCompatibleDriver</code>) with tenant-weighted queues, shared 429 cooldowns, circuit breakers, and cost attribution.",
			"code": [
				"import { secret } from \"@agboss/core\";",
				"import {",
				"  CircuitBreakerPolicy,",
				"  ModelCost,",
				"  ModelProvider,",
				"  OpenRouterDriver,",
				"  PromptCaching,",
				"  QueueBalancingStrategy,",
				"  RateLimitPolicy,",
				"  Reasoning,",
				"  RetryPolicy,",
				"  TRANSIENT_FAILURES,",
				"} from \"@agboss/core/models\";",
				"import { minutes, seconds } from \"@agboss/core/units\";",
				"",
				"@ModelProvider({",
				"  name: \"openrouter-model-provider\",",
				"  description: \"OpenRouter — shared chat model pool with tenant fairness\",",
				"  driver: OpenRouterDriver({",
				"    apiKey: secret(\"OPENROUTER_API_KEY\"),",
				"    routing: { ignore: [\"Inceptron\"] }, // OpenRouter's provider routing",
				"  }),",
				"  timeout: minutes(2),",
				"  cost: ModelCost.fromResponse(),",
				"  reasoning: Reasoning.modelDecides(),",
				"  promptCaching: PromptCaching.off(),",
				"  retryPolicy: RetryPolicy.exponential({",
				"    maxAttempts: 3,",
				"    initialDelay: seconds(1),",
				"    maxDelay: seconds(20),",
				"    jitter: true,",
				"    retryOn: TRANSIENT_FAILURES,",
				"  }),",
				"  rateLimitPolicy: RateLimitPolicy.of({",
				"    maxConcurrentCalls: 8,",
				"    perMinute: { calls: 60 },",
				"    balancing: QueueBalancingStrategy.TenantRoundRobin,",
				"  }),",
				"  circuitBreakerPolicy: CircuitBreakerPolicy.fixed({",
				"    failureThreshold: 5,",
				"    failureWindow: minutes(1),",
				"    openDuration: seconds(30),",
				"  }),",
				"})",
				"export class OpenRouterModelProvider {}"
			],
			"files": [
				{
					"file": "test/openrouter.model-provider.test.ts",
					"code": [
						"import { expect, it } from \"vitest\";",
						"import { OpenRouterModelProvider } from \"../src/model-providers/openrouter.model-provider.js\";",
						"",
						"it(\"exports OpenRouterModelProvider with tenant round-robin queueing\", () => {",
						"  expect(OpenRouterModelProvider).toBeDefined();",
						"});"
					]
				}
			]
		},
		"loops": {
			"file": "src/workflows/offer-review.workflow.ts",
			"problem": "Review loops without visit bounds or error paths spin infinitely when a model repeatedly requests edits.",
			"solution": "<code>executionLimits: { maxVisits }</code> caps loop iterations and routes exhaustion cleanly through <code>.onError(LimitError.Visits, ...)</code>.",
			"code": [
				"import { Workflow, onAgent, onStart, toAgent, toFinish, Ttl } from \"@agboss/core\";",
				"import { OfferReviewerAgent } from \"../agents/offer-reviewer.agent.js\";",
				"import {",
				"  OfferReviewFinish,",
				"  OfferReviewStart,",
				"  OfferWriterAgent,",
				"} from \"../agents/offer-deps.js\";",
				"",
				"@Workflow({",
				"  name: \"offer-review-workflow\",",
				"  version: \"1.0.0\",",
				"  historyTtl: Ttl.Forever,",
				"  flow: [",
				"    onStart(OfferReviewStart)",
				"      .toAgent(OfferWriterAgent),",
				"",
				"    onAgent(OfferWriterAgent)",
				"      .toAgent(OfferReviewerAgent)",
				"      .toOneOf([",
				"        toFinish(OfferReviewFinish),",
				"        toAgent(OfferWriterAgent),",
				"      ]),",
				"  ],",
				"})",
				"export class OfferReviewWorkflow {}"
			],
			"files": [
				{
					"file": "src/dto/offer.dto.ts",
					"code": [
						"import { Integer, Text } from \"@agboss/core/dto\";",
						"",
						"export class CandidateInputDto {",
						"  @Text() level!: string;",
						"  @Text() location!: string;",
						"}",
						"",
						"export class OfferDraftDto {",
						"  @Text() text!: string;",
						"  @Integer() baseSalaryUsd!: number;",
						"}",
						"",
						"export class DraftApprovedDto {",
						"  @Text() summary!: string;",
						"}",
						"",
						"export class ChangesRequestedDto {",
						"  @Text() notes!: string;",
						"}"
					]
				}
			]
		},
		"provenance": {
			"file": "src/workflows/offer-scope.workflow.ts",
			"problem": "After an editor writes draft v2, stale v1 approvals still linger in shared state and can leak into final actions.",
			"solution": "Tracked DTOs mark prior critiques outdated (<code>OutdatedReason.Replaced</code>) when the draft is overwritten, while <code>historyOf()</code> bounds loop context.",
			"code": [
				"import { Workflow, onAgent, onStart, toAction, toAgent, toFinish, Ttl } from \"@agboss/core\";",
				"",
				"@Workflow({",
				"  name: \"offer-scope-workflow\",",
				"  version: \"1.0.0\",",
				"  historyTtl: Ttl.Forever,",
				"  flow: [",
				"    onStart(OfferStart)",
				"      .toAgent(DraftAgent)",
				"      .toAgent(ReviewerAgent),",
				"",
				"    onAgent(ReviewerAgent)",
				"      .toOneOf([",
				"        toAction(SendOfferAction)",
				"          .toFinish(OfferFinish),",
				"        toAgent(EditorAgent)",
				"          .toAgent(ReviewerAgent),",
				"      ]),",
				"  ],",
				"  executionLimits: { maxSteps: 10 },",
				"})",
				"export class OfferScopeWorkflow {}"
			],
			"files": [
				{
					"file": "src/dto/offer-negotiation.dto.ts",
					"code": [
						"import { Integer, Text } from \"@agboss/core/dto\";",
						"",
						"export class CandidateInputDto {",
						"  @Text() role!: string;",
						"  @Text() region!: string;",
						"}",
						"",
						"export class OfferDraftDto {",
						"  @Text() summary!: string;",
						"  @Integer() baseUsd!: number;",
						"}",
						"",
						"export class DraftApprovedDto {",
						"  @Text() signedBy!: string;",
						"}",
						"",
						"export class ChangesRequestedDto {",
						"  @Text() critique!: string;",
						"}",
						"",
						"export class ComplianceReportDto {",
						"  @Text() status!: string;",
						"}",
						"",
						"export class AuditVerdictDto {",
						"  @Text() auditor!: string;",
						"}"
					]
				}
			]
		},
		"parallel": {
			"file": "src/workflows/parallel-review.workflow.ts",
			"problem": "Unbounded <code>Promise.all</code> fan-out overwhelms downstream APIs and leaves sibling tasks running after a crash.",
			"solution": "<code>.inParallel([...])</code> and <code>.forEachItem(step, { takeFirst, maxConcurrency })</code> cap fan-out and abort on failure.",
			"code": [
				"import { StepError, Workflow, onStart, toAction, toAgent, toFinish, Ttl } from \"@agboss/core\";",
				"import { seconds } from \"@agboss/core/units\";",
				"",
				"@Workflow({",
				"  name: \"parallel-review-workflow\",",
				"  version: \"1.0.0\",",
				"  historyTtl: Ttl.Forever,",
				"  flow: [",
				"    onStart(ProposalStart)",
				"      .inParallel([toAgent(SecurityAgent), toAgent(LegalAgent), toAgent(BackupAuditAgent)])",
				"      .arbitratedBy(ReviewQuorumArbiter)",
				"      .joinQuorumGroups({ deadline: seconds(10) })",
				"      .onError(",
				"        StepError.QuorumNotReached,",
				"        toAction(RecordQuorumFailureAction)",
				"          .toFinish(ProposalRejectedFinish),",
				"      )",
				"      .onGroup(",
				"        [SecurityAgent, LegalAgent],",
				"        { priority: 1 },",
				"        toAction(MergePrimaryVerdictsAction)",
				"          .toFinish(ProposalApprovedFinish),",
				"      )",
				"      .onGroup(",
				"        [SecurityAgent, BackupAuditAgent],",
				"        { priority: 2 },",
				"        toAction(MergeFallbackVerdictsAction)",
				"          .toFinish(ProposalApprovedFinish),",
				"      ),",
				"  ],",
				"})",
				"export class ParallelReviewWorkflow {}"
			],
			"files": [
				{
					"file": "test/parallel-review.workflow.test.ts",
					"code": [
						"import { expect } from \"vitest\";",
						"import { ExecutionStatus } from \"@agboss/core\";",
						"import { TestConcurrency, replyWith, step, testWith } from \"@agboss/core/testing\";",
						"import {",
						"  ReviewApplication,",
						"  ProposalStart,",
						"  SecurityAgent,",
						"  BackupAuditAgent,",
						"  LegalAgent,",
						"  SecurityVerdictDto,",
						"  BackupVerdictDto,",
						"} from \"../src/parallel-review.workflow.js\";",
						"",
						"const test = testWith(ReviewApplication, {",
						"  concurrency: TestConcurrency.inOrder([",
						"    step(BackupAuditAgent),",
						"    step(SecurityAgent),",
						"    step(LegalAgent),",
						"  ]),",
						"});",
						"",
						"test(\"reaches priority-2 quorum when SecurityAgent and BackupAuditAgent finish first\", async ({ app, mockModel }) => {",
						"  mockModel(BackupAuditAgent).thenReturn(replyWith(BackupVerdictDto, { passed: true }));",
						"  mockModel(SecurityAgent).thenReturn(replyWith(SecurityVerdictDto, { passed: true, confidence: 95 }));",
						"  const res = await app.execute(ProposalStart, { title: \"SOC2 Policy Update\" });",
						"  expect(res.status).toBe(ExecutionStatus.Finished);",
						"});"
					]
				}
			]
		},
		"quorum": {
			"file": "src/dto/risk.dto.ts",
			"problem": "Waiting for the slowest model in a parallel ensemble inflates tail latency and wastes tokens once consensus is reached.",
			"solution": "<code>.arbitratedBy(Arbiter).joinQuorum()</code> proceeds as soon as quorum is met and aborts slower branches as <code>Surplus</code>.",
			"code": [
				"import { Float, Integer, Text } from \"@agboss/core/dto\";",
				"",
				"export class RiskScoreDto {",
				"  @Integer({ min: 0, max: 100 })",
				"  score!: number;",
				"",
				"  @Float({ min: 0, max: 1 })",
				"  confidence!: number;",
				"",
				"  @Text()",
				"  rationale!: string;",
				"}"
			],
			"files": [
				{
					"file": "test/risk-quorum.arbiter.test.ts",
					"code": [
						"import { expect, it } from \"vitest\";",
						"import { testUnit } from \"@agboss/core/testing\";",
						"import { ConfidenceThresholdArbiter } from \"../src/arbiters/risk-quorum.arbiter.js\";",
						"import { FastRiskAgent } from \"../src/agents/risk.agents.js\";",
						"",
						"it(\"unit-tests @Arbitrate handlers on ConfidenceThresholdArbiter\", async () => {",
						"  const runArbiter = testUnit(ConfidenceThresholdArbiter);",
						"",
						"  const { output } = await runArbiter(FastRiskAgent, {",
						"    score: 72,",
						"    confidence: 0.91,",
						"    rationale: \"Healthy cash reserve\",",
						"  });",
						"  expect(output).toBe(true);",
						"});"
					]
				}
			]
		},
		"recursion": {
			"file": "src/workflows/recursive-research.workflow.ts",
			"problem": "Self-recursive workflows risk infinite depth explosions or hard crashes when reaching their recursion ceiling.",
			"solution": "<code>toWorkflow(() => Self)</code> with <code>executionLimits.maxDepth</code> softly strips recursive schema variants at max depth, warming only 2 KV prefixes.",
			"code": [
				"import { ChildPlacement, toAction, toFinish, toWorkflow } from \"@agboss/core\";",
				"",
				"@Workflow({",
				"  name: \"recursive-research-workflow\",",
				"  version: \"1.0.0\",",
				"  historyTtl: Ttl.Forever,",
				"  placement: ChildPlacement.AnyWorker, // where this workflow runs as a child: on the child, never on the flow",
				"  flow: [",
				"    onStart(ResearchStart)",
				"      .toAgent(DecomposeTopicAgent)",
				"      .toOneOf([",
				"        toWorkflow(FactCheckChildWorkflow) // the branch of the ResolvedDto variant",
				"          .toFinish(ResearchFinish),",
				"        toAction(ExtractSubTopicsAction) // the branch of the SubTopicsDto variant",
				"          .forEachItem(toWorkflow(() => RecursiveResearchWorkflow), { takeFirst: 5, maxConcurrency: 2 })",
				"          .join()",
				"          .toAction(MergeFindingsAction)",
				"          .toFinish(ResearchFinish),",
				"      ]),",
				"  ],",
				"  executionLimits: { maxDepth: 3, maxConcurrency: 6 },",
				"})",
				"export class RecursiveResearchWorkflow {}"
			],
			"files": [
				{
					"file": "test/recursive-research.workflow.test.ts",
					"code": [
						"import { expect, it } from \"vitest\";",
						"import { testUnit } from \"@agboss/core/testing\";",
						"import {",
						"  ExtractSubTopicsAction,",
						"  RecursiveResearchWorkflow,",
						"} from \"../src/recursive-research.workflow.js\";",
						"",
						"it(\"extracts sub-topic items for recursive fan-out\", async () => {",
						"  expect(RecursiveResearchWorkflow).toBeDefined();",
						"  const runExtract = testUnit(ExtractSubTopicsAction);",
						"  const { output } = await runExtract({",
						"    subTopics: { items: [{ topic: \"Raft\" }, { topic: \"Paxos\" }] }, // a plain DTO literal, tracked by default",
						"  });",
						"  expect(output).toEqual([{ topic: \"Raft\" }, { topic: \"Paxos\" }]);",
						"});"
					]
				}
			]
		},
		"di": {
			"file": "src/tools/search-jobs.tool.ts",
			"problem": "Global singletons leak database pools across tests and drop in-flight steps when a worker pod receives SIGTERM.",
			"solution": "4-stage lifecycle hooks (<code>OnInit..OnDestroy</code>) and <code>app.close()</code> drain running steps before releasing leases.",
			"code": [
				"import { Tool } from \"@agboss/core\";",
				"import { List, Text } from \"@agboss/core/dto\";",
				"import { JobIndexService } from \"../services/job-index.service.js\";",
				"",
				"export class JobSearchInputDto {",
				"  @Text({ prompt: \"Role search query\" })",
				"  query!: string;",
				"}",
				"",
				"export class JobSearchOutputDto {",
				"  @List(Text, { prompt: \"Matching roles\" })",
				"  jobs!: string[];",
				"}",
				"",
				"@Tool({",
				"  name: \"search_jobs\",",
				"  description: \"Queries the warmed JobIndexService\",",
				"  input: JobSearchInputDto,",
				"  output: JobSearchOutputDto,",
				"  deps: [JobIndexService],",
				"})",
				"export class SearchJobsTool {",
				"  constructor(private readonly index: JobIndexService) {}",
				"",
				"  async execute(input: JobSearchInputDto): Promise<JobSearchOutputDto> {",
				"    return { jobs: await this.index.searchByTenant(input.query) };",
				"  }",
				"}"
			],
			"files": [
				{
					"file": "test/job-index.service.test.ts",
					"code": [
						"import { expect } from \"vitest\";",
						"import { ApplicationContext, Clock, ExecutionContext, Injectable, Logger } from \"@agboss/core\";",
						"import { testWith } from \"@agboss/core/testing\";",
						"import { JobScoutApplication } from \"../src/job-scout.application.js\";",
						"import { JobIndexService } from \"../src/services/job-index.service.js\";",
						"import { ChatWorkflowStart } from \"../src/workflows/job-scout.workflow.js\";",
						"",
						"@Injectable({ deps: [ApplicationContext, ExecutionContext, Clock, Logger] })",
						"class FakeJobIndexService extends JobIndexService {",
						"  override searchByTenant(): Promise<string[]> {",
						"    return Promise.resolve([\"Stubbed Staff Engineer Role\"]);",
						"  }",
						"}",
						"",
						"const test = testWith(JobScoutApplication, { services: [FakeJobIndexService] });",
						"",
						"test(\"uses FakeJobIndexService and spies on calls via mockService\", async ({ app, mockService }) => {",
						"  await app.execute(ChatWorkflowStart, { text: \"Find TypeScript roles\" });",
						"  expect(mockService(JobIndexService).searchByTenant).toHaveBeenCalledOnce();",
						"});"
					]
				}
			]
		},
		"callbacks": {
			"file": "src/observers/audit.observer.ts",
			"problem": "Ad-hoc console logging misses child workflow trees, parallel branch verdicts, and model retry reasons.",
			"solution": "Give an <code>@Observer</code> class any of the typed hooks (<code>onExecutionEnd</code>, <code>onAgentRetry</code>, ...) and list it in <code>@Application</code>.",
			"code": [
				"import { Application, Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, Observer, Workflow, WorkflowFinish, WorkflowStart, onStart, type AgentStartEvent, type BudgetHandler, type ExecutionEndEvent, type ExecutionRejectedEvent, Ttl } from \"@agboss/core\";",
				"import { WorkflowStartTextDto } from \"@agboss/core/dto\";",
				"import { usd, type Usd } from \"@agboss/core/units\";",
				"",
				"@Observer()",
				"export class MetricsObserver {",
				"  onExecutionEnd(event: ExecutionEndEvent): void {",
				"    console.log(",
				"      `${event.workflow.name} ${event.executionId} cost $${String(event.spend.totalUsd)}`,",
				"    );",
				"  }",
				"",
				"  onAgentStart(event: AgentStartEvent): void {",
				"    console.log(",
				"      `${event.step.component.name} visit ${String(event.step.visitNumber)}`,",
				"    );",
				"  }",
				"",
				"  onExecutionRejected(event: ExecutionRejectedEvent): void {",
				"    console.log(",
				"      `${event.operation} refused for ${event.tenantId}: ${event.code}`,",
				"    );",
				"  }",
				"}"
			],
			"files": [
				{
					"file": "test/audit.observer.test.ts",
					"code": [
						"import { expect } from \"vitest\";",
						"import { ExecutionStatus } from \"@agboss/core\";",
						"import { testWith } from \"@agboss/core/testing\";",
						"import { PingApplication, MetricsObserver, PingWorkflowStart } from \"../src/observers/audit.observer.js\";",
						"",
						"const test = testWith(PingApplication);",
						"",
						"test(\"records execution and agent lifecycle events in MetricsObserver\", async ({ app, mockService }) => {",
						"  const res = await app.execute(PingWorkflowStart, { text: \"Check invoice #102\" });",
						"  expect(res.status).toBe(ExecutionStatus.Finished);",
						"  expect(mockService(MetricsObserver).onExecutionEnd).toHaveBeenCalledTimes(1);",
						"});"
					]
				}
			]
		},
		"contexts": {
			"file": "src/config/support-contexts.ts",
			"problem": "Passing <code>tenantId</code>, <code>signal</code>, and <code>idempotencyKey</code> through every function signature pollutes domain code.",
			"solution": "Inject <code>ExecutionContext</code> and <code>TenantContext</code> anywhere, and expose K8s probes via <code>@HealthCheck</code>.",
			"code": [
				"import { ExecutionContext, TenantContext, Tool } from \"@agboss/core\";",
				"import { Integer, Text } from \"@agboss/core/dto\";",
				"",
				"export class SupportTenantContext extends TenantContext {",
				"  @Text()",
				"  planTier!: string;",
				"",
				"  @Integer()",
				"  monthlyQuotaCents!: number;",
				"}",
				"",
				"export class SupportExecutionContext extends ExecutionContext {",
				"  @Text()",
				"  requestTraceId!: string;",
				"}",
				"",
				"@Tool({",
				"  name: \"issue_credit\",",
				"  description: \"Issues a tenant-scoped credit using ExecutionContext idempotencyKey\",",
				"  input: CreditRequestDto,",
				"  output: CreditReceiptDto,",
				"  deps: [SupportExecutionContext, SupportTenantContext],",
				"})",
				"export class IssueCreditTool {",
				"  constructor(",
				"    private readonly ctx: SupportExecutionContext,",
				"    private readonly tenant: SupportTenantContext,",
				"  ) {}",
				"",
				"  execute(input: CreditRequestDto): CreditReceiptDto {",
				"    this.ctx.signal.throwIfAborted();",
				"    return {",
				"      receiptId: `cr_${this.ctx.step.idempotencyKey}`,",
				"      tenantId: this.tenant.tenantId,",
				"      planTier: this.tenant.planTier,",
				"      traceId: this.ctx.requestTraceId,",
				"      amountCents: input.amountCents,",
				"    };",
				"  }",
				"}"
			],
			"files": [
				{
					"file": "src/support.application.ts",
					"code": [
						"import { Application, EmptyEnvironment } from \"@agboss/core\";",
						"import { SupportTenantContext, SupportExecutionContext } from \"./config/support-contexts.js\";",
						"",
						"@Application({",
						"  name: \"support-application\",",
						"  version: \"1.0.0\",",
						"  environment: EmptyEnvironment,",
						"  tenantContext: SupportTenantContext,",
						"  executionContext: SupportExecutionContext,",
						"  workflows: [SupportWorkflow],",
						"  budgets: [CtxAppBudget, CtxTenantBudget, CtxExecBudget],",
						"})",
						"export class SupportApplication {}"
					]
				}
			]
		},
		"dto": {
			"file": "src/dto/offer-negotiation.dto.ts",
			"problem": "Hand-written JSON Schemas drift from TypeScript classes and leak raw PII into model prompts and trace logs.",
			"solution": "<code>@agboss/core/dto</code> decorators compile directly to strict JSON Schema, with field-level PII verbs (<code>mask</code>, <code>tokenize</code>, <code>block</code>).",
			"code": [
				"import { Integer, Text } from \"@agboss/core/dto\";",
				"",
				"export class CandidateInputDto {",
				"  @Text() role!: string;",
				"  @Text() region!: string;",
				"}",
				"",
				"export class OfferDraftDto {",
				"  @Text() summary!: string;",
				"  @Integer() baseUsd!: number;",
				"}",
				"",
				"export class DraftApprovedDto {",
				"  @Text() signedBy!: string;",
				"}",
				"",
				"export class ChangesRequestedDto {",
				"  @Text() critique!: string;",
				"}",
				"",
				"export class ComplianceReportDto {",
				"  @Text() status!: string;",
				"}",
				"",
				"export class AuditVerdictDto {",
				"  @Text() auditor!: string;",
				"}"
			],
			"files": [
				{
					"file": "test/candidate-offer.dto.test.ts",
					"code": [
						"import { expect } from \"vitest\";",
						"import { ExecutionStatus } from \"@agboss/core\";",
						"import { replyWith, testWith } from \"@agboss/core/testing\";",
						"import { OfferDrafterAgent, OfferPackageDto } from \"../src/dto/candidate-offer.dto.js\";",
						"import { OfferDraftApplication, OfferDraftStart } from \"../src/offer-drafter.application.js\";",
						"",
						"const test = testWith(OfferDraftApplication);",
						"",
						"test(\"validates nested OfferPackageDto structured output at runtime\", async ({ app, mockModel }) => {",
						"  mockModel(OfferDrafterAgent).thenReturn(",
						"    replyWith(OfferPackageDto, {",
						"      offerId: \"550e8400-e29b-41d4-a716-446655440000\",",
						"      candidateName: \"Ada Lovelace\",",
						"      contact: {",
						"        email: \"ada@example.com\",",
						"        phone: \"+14155550199\",",
						"        country: \"US\",",
						"      },",
						"      items: [{ kind: \"base\", amount: \"225000.00\", currency: \"USD\" }],",
						"      tags: [\"principal\", \"distributed-systems\"],",
						"      startDate: \"2026-11-01\",",
						"      expiresAt: \"2026-10-31T23:59:59Z\",",
						"      benefitsUrl: \"https://example.com/benefits.pdf\",",
						"      level: 7,",
						"      relocationIncluded: true,",
						"    }),",
						"  );",
						"",
						"  const res = await app.execute(OfferDraftStart, { text: \"Prepare Principal Engineer offer\" });",
						"  expect(res.status).toBe(ExecutionStatus.Finished);",
						"});"
					]
				}
			]
		},
		"environments": {
			"file": "src/environments/prod.environment.ts",
			"problem": "Scattered <code>process.env</code> reads fail hours into a run and mix raw millisecond/dollar numbers without units.",
			"solution": "<code>defineEnv</code> with <code>env</code> and <code>secret</code> validates every variable at startup, while <code>seconds()</code> and <code>usd()</code> enforce typed units.",
			"code": [
				"import { env, secret } from \"@agboss/core\";",
				"import { seconds, usd } from \"@agboss/core/units\";",
				"import type { AppEnvironment } from \"./app.environment.js\";",
				"",
				"export const environment: AppEnvironment = {",
				"  openRouterApiKey: secret(\"OPENROUTER_API_KEY\"),",
				"  piiPseudonymKey: secret(\"PII_PSEUDONYM_KEY\"),",
				"  sqlitePath: env(\"AGBOSS_SQLITE_PATH\", {",
				"    default: \"/var/lib/agboss/state.sqlite\",",
				"  }),",
				"  webhookBaseUrl: env.optional(\"WEBHOOK_BASE_URL\"),",
				"  requestTimeout: seconds(30),",
				"  dailyTenantCap: usd(50),",
				"};"
			],
			"files": [
				{
					"file": "src/app.env.ts",
					"code": [
						"import { defineEnv, env, secret } from \"@agboss/core\";",
						"",
						"export const appEnv = defineEnv({",
						"  port: env.integer(\"PORT\", { default: 8080 }),",
						"  debug: env.boolean(\"DEBUG\", { default: false }),",
						"  apiKey: secret(\"SUPPORT_API_KEY\"),",
						"  webhookUrl: env.optional(\"WEBHOOK_URL\"),",
						"});"
					]
				}
			]
		},
		"guards": {
			"file": "src/support.application.ts",
			"problem": "Random UUID PII masks mutate historical messages on every turn, destroying provider KV prefix cache hit rates.",
			"solution": "<code>@PiiPolicy</code> uses deterministic HMAC-SHA256 tokens (<code>&lt;email:7f3a91&gt;</code>) and restores real values inside <code>@Tool</code>.",
			"code": [
				"import {",
				"  Application,",
				"  Budget,",
				"  BudgetPeriod,",
				"  BudgetScope,",
				"  EmptyEnvironment,",
				"  type BudgetHandler,",
				"} from \"@agboss/core\";",
				"import { usd, type Usd } from \"@agboss/core/units\";",
				"import {",
				"  CustomerContactPiiPolicy,",
				"  EmployeeBadgePiiPolicy,",
				"} from \"./policies/customer.pii-policy.js\";",
				"import { SupportModelProvider, SupportWorkflow } from \"./workflows/support.workflow.js\";",
				"",
				"@Budget({ name: \"pii-app-budget\", scope: BudgetScope.Application, period: BudgetPeriod.Day })",
				"export class PiiAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(20); } }",
				"@Budget({ name: \"pii-tenant-budget\", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })",
				"export class PiiTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }",
				"@Budget({ name: \"pii-exec-budget\", scope: BudgetScope.Execution })",
				"export class PiiExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }",
				"",
				"@Application({",
				"  name: \"support-application\",",
				"  version: \"1.0.0\",",
				"  environment: EmptyEnvironment,",
				"  workflows: [SupportWorkflow],",
				"  modelProvider: SupportModelProvider,",
				"  providers: [SupportModelProvider],",
				"  piiPolicies: [CustomerContactPiiPolicy, EmployeeBadgePiiPolicy],",
				"  budgets: [PiiAppBudget, PiiTenantBudget, PiiExecBudget],",
				"})",
				"export class SupportApplication {}"
			],
			"files": [
				{
					"file": "test/employee-badge.pii-policy.test.ts",
					"code": [
						"import { expect, it } from \"vitest\";",
						"import { testUnit } from \"@agboss/core/testing\";",
						"import { EmployeeBadgePiiPolicy } from \"../src/policies/customer.pii-policy.js\";",
						"",
						"it(\"pseudonymizes employee badge numbers and restores them for tools\", async () => {",
						"  const pii = testUnit([EmployeeBadgePiiPolicy]);",
						"",
						"  const { output: masked } = await pii.mask(\"Assign ticket to EMP-482910 immediately.\");",
						"  expect(masked).not.toContain(\"EMP-482910\");",
						"  expect(pii.reveal(masked)).toBe(\"Assign ticket to EMP-482910 immediately.\");",
						"});"
					]
				}
			]
		},
		"guardrail": {
			"file": "src/policies/tenant-blocklist.guardrail.ts",
			"problem": "Prompt injections and policy violations reach downstream steps or customers when left to prompt instructions alone.",
			"solution": "<code>@InputGuardrail</code> and <code>@OutputGuardrail</code> block unsafe payloads via fast models or deterministic code.",
			"code": [
				"import {",
				"  GuardrailVerdict,",
				"  Injectable,",
				"  OutputGuardrail,",
				"  TenantContext,",
				"  type GuardrailContent,",
				"} from \"@agboss/core\";",
				"import { Enum } from \"@agboss/core/dto\";",
				"",
				"export class ShopTenantContext extends TenantContext {",
				"  @Enum([\"toys\", \"tools\"])",
				"  shop!: \"toys\" | \"tools\";",
				"}",
				"",
				"@Injectable()",
				"export class BlocklistService {",
				"  containsBlockedTerms(shop: \"toys\" | \"tools\", text: string): Promise<boolean> {",
				"    const blocked = shop === \"toys\" ? [\"knife\"] : [\"toy\"];",
				"    return Promise.resolve(blocked.some((term) => text.toLowerCase().includes(term)));",
				"  }",
				"}",
				"",
				"@OutputGuardrail({",
				"  name: \"tenant-blocklist-guardrail\",",
				"  description: \"Blocks replies containing terms forbidden for the active tenant\",",
				"  deps: [ShopTenantContext, BlocklistService],",
				"})",
				"export class TenantBlocklistGuardrail {",
				"  constructor(",
				"    private readonly tenant: ShopTenantContext,",
				"    private readonly blocklist: BlocklistService,",
				"  ) {}",
				"",
				"  async check(content: GuardrailContent): Promise<GuardrailVerdict> {",
				"    const hasForbidden = await this.blocklist.containsBlockedTerms(this.tenant.shop, content.text);",
				"    return hasForbidden",
				"      ? GuardrailVerdict.blocked(\"The response contained restricted terms.\")",
				"      : GuardrailVerdict.passed();",
				"  }",
				"}"
			],
			"files": [
				{
					"file": "test/tenant-blocklist.guardrail.test.ts",
					"code": [
						"import { expect, it } from \"vitest\";",
						"import { testUnit } from \"@agboss/core/testing\";",
						"import {",
						"  ShopTenantContext,",
						"  TenantBlocklistGuardrail,",
						"} from \"../src/policies/tenant-blocklist.guardrail.js\";",
						"",
						"it(\"blocks restricted tenant terms deterministically without a model stub\", async () => {",
						"  const check = testUnit(TenantBlocklistGuardrail, {",
						"    tenantContext: ShopTenantContext,",
						"    tenant: { tenantId: \"t-1\", shop: \"toys\" },",
						"  });",
						"",
						"  const blocked = await check(\"We recommend a pocket knife.\");",
						"  expect(blocked.output.isBlocked).toBe(true);",
						"  expect(blocked.output.refusal).toBe(\"The response contained restricted terms.\");",
						"});"
					]
				}
			]
		},
		"approval": {
			"file": "src/refunds/tool-approvals/refund.tool-approval.ts",
			"problem": "In-memory human approval promises die on pod restarts, and resolved quorums leave stale Approve buttons in Slack.",
			"solution": "Two-phase <code>app.resume({ pauseId, decision })</code> persists in the database and calls <code>onPauseClosed()</code> when a pause closes.",
			"code": [
				"// the target: what is approved, who may answer, for how long — no transport here",
				"import { PauseRespondent, ToolApproval } from \"@agboss/core\";",
				"import { hours } from \"@agboss/core/units\";",
				"import { RefundRequestDto } from \"../dto/refund.dto.js\";",
				"",
				"@ToolApproval({",
				"  name: \"refund-tool-approval\",",
				"  description: \"A manager approves refunds\",",
				"  input: RefundRequestDto, // the input of every tool naming it",
				"  respondent: PauseRespondent.Delegate, // Slack authenticates who answers",
				"  timeout: hours(24), // a hard deadline, fixed when the pause is made",
				"  remindBefore: hours(2), // the channel hears onPauseExpiring two hours before it",
				"})",
				"export class RefundToolApproval {}"
			],
			"files": [
				{
					"file": "src/refunds/tools/refund.tool.ts",
					"code": [
						"// names the target; runs only once a call is approved",
						"import { ExecutionContext, Tool } from \"@agboss/core\";",
						"import { RefundDoneDto, RefundRequestDto } from \"../dto/refund.dto.js\";",
						"import { RefundToolApproval } from \"../tool-approvals/refund.tool-approval.js\";",
						"",
						"@Tool({",
						"  name: \"refund-tool\",",
						"  description: \"Refunds an order\",",
						"  input: RefundRequestDto,",
						"  output: RefundDoneDto,",
						"  approval: RefundToolApproval, // the target, never the channel",
						"  deps: [ExecutionContext],",
						"})",
						"export class RefundTool {",
						"  constructor(private readonly executionContext: ExecutionContext) {}",
						"",
						"  execute({ orderId }: RefundRequestDto): RefundDoneDto {",
						"    return { refundId: `${orderId}:${this.executionContext.step.idempotencyKey}` };",
						"  }",
						"}"
					]
				}
			]
		},
		"cost": {
			"file": "src/support.application.ts",
			"problem": "Post-hoc token accounting only notices a runaway loop or parallel fan-out after the bill has already been incurred.",
			"solution": "<code>@Budget</code> reserves estimated cost before each call and aborts sibling branches on <code>LimitError.Budget</code>.",
			"code": [
				"import { Application, EmptyEnvironment } from \"@agboss/core\";",
				"import {",
				"  ApplicationDailyBudget,",
				"  DeepResearchExecutionBudget,",
				"  DefaultExecutionBudget,",
				"  SupportTenantContext,",
				"  TenantDailyBudget,",
				"} from \"./budgets/support.budgets.js\";",
				"import { DeepResearchWorkflow, SupportWorkflow } from \"./workflows/support.workflow.js\";",
				"",
				"@Application({",
				"  name: \"support-application\",",
				"  version: \"1.0.0\",",
				"  environment: EmptyEnvironment,",
				"  tenantContext: SupportTenantContext,",
				"  workflows: [SupportWorkflow, DeepResearchWorkflow],",
				"  budgets: [",
				"    ApplicationDailyBudget,",
				"    TenantDailyBudget,",
				"    DefaultExecutionBudget,",
				"    DeepResearchExecutionBudget,",
				"  ],",
				"})",
				"export class SupportApplication {}"
			],
			"files": [
				{
					"file": "test/budget-cap.test.ts",
					"code": [
						"import { expect } from \"vitest\";",
						"import { LimitError } from \"@agboss/core\";",
						"import { replyWith, testWith } from \"@agboss/core/testing\";",
						"import { usd } from \"@agboss/core/units\";",
						"import { SupportApplication } from \"../src/support.application.js\";",
						"import { SupportAgent, SupportStart } from \"../src/workflows/support.workflow.js\";",
						"",
						"const test = testWith(SupportApplication);",
						"",
						"test(\"halts execution when simulated spend exceeds DefaultExecutionBudget\", async ({ app, mockModel }) => {",
						"  mockModel(SupportAgent).thenReturn(",
						"    replyWith(\"Expensive turn\", { cost: usd(1.25) }),",
						"  );",
						"  await expect(",
						"    app.execute(",
						"      SupportStart,",
						"      { text: \"Analyze all logs\" },",
						"      { tenant: { tenantId: \"acme\", weight: 1, planTier: \"pro\" } },",
						"    ),",
						"  ).rejects.toThrow(LimitError.Budget);",
						"});"
					]
				}
			]
		},
		"durability": {
			"file": "src/claims/storages/claims.database-storage.ts",
			"problem": "Deploying durable agent state usually forces teams to stand up external Redis/Postgres clusters on day one.",
			"solution": "<code>@DatabaseStorage</code> with the built-in zero-dependency <code>SqliteDriver</code> persists checkpoints, pauses, leases, and cost ledgers; Postgres and MongoDB drivers take over for clusters.",
			"code": [
				"import { DatabaseStorage, SqliteDriver, defineEnv, env, secret } from \"@agboss/core\";",
				"import { hours } from \"@agboss/core/units\";",
				"",
				"const databaseEnv = defineEnv({",
				"  path: env(\"AGBOSS_SQLITE_PATH\", { default: \"/data/claims.sqlite\" }), // a persistent volume",
				"  idempotencySecret: secret(\"AGBOSS_IDEMPOTENCY_SECRET\"),",
				"  piiSecret: secret(\"PII_PSEUDONYM_KEY\"),",
				"});",
				"",
				"@DatabaseStorage({",
				"  name: \"claims-database-storage\",",
				"  driver: SqliteDriver({ path: databaseEnv.path }),",
				"  auditLogTtl: hours(24 * 30),",
				"  ledgerEntriesTtl: hours(24),",
				"  idempotencySecret: databaseEnv.idempotencySecret, // a key of its own: business keys of Idempotency",
				"  piiSecret: databaseEnv.piiSecret, // the key of the application's PII tokens, the same on every instance",
				"})",
				"export class ClaimsDatabaseStorage {}"
			],
			"files": [
				{
					"file": "src/claims/claims.application.ts",
					"code": [
						"import { Application, Budget, BudgetPeriod, BudgetScope, EmptyEnvironment, type BudgetHandler } from \"@agboss/core\";",
						"import { usd, type Usd } from \"@agboss/core/units\";",
						"import { ClaimsDatabaseStorage } from \"./storages/claims.database-storage.js\";",
						"",
						"@Budget({ name: \"claims-app-budget\", scope: BudgetScope.Application, period: BudgetPeriod.Day })",
						"export class ClaimsAppBudget implements BudgetHandler { maxSpend(): Usd { return usd(20); } }",
						"@Budget({ name: \"claims-tenant-budget\", scope: BudgetScope.Tenant, period: BudgetPeriod.Day })",
						"export class ClaimsTenantBudget implements BudgetHandler { maxSpend(): Usd { return usd(5); } }",
						"@Budget({ name: \"claims-exec-budget\", scope: BudgetScope.Execution })",
						"export class ClaimsExecBudget implements BudgetHandler { maxSpend(): Usd { return usd(0.5); } }",
						"",
						"@Application({",
						"  name: \"claims-application\",",
						"  version: \"1.0.0\",",
						"  environment: EmptyEnvironment,",
						"  workflows: [],",
						"  storage: ClaimsDatabaseStorage, // every store durable and shared: no [application.in-memory-…] warning",
						"  budgets: [ClaimsAppBudget, ClaimsTenantBudget, ClaimsExecBudget],",
						"})",
						"export class ClaimsApplication {}"
					]
				}
			]
		},
		"recovery": {
			"file": "test/multi-instance.test.ts",
			"problem": "When a worker pod crashes mid-step, another pod can double-execute side effects while the zombie pod still runs.",
			"solution": "30s execution-tree leases and <code>ExecutionLeaseLostError</code> abort lost steps before the next tool call runs.",
			"code": [
				"import { Application, EmptyEnvironment } from \"@agboss/core\";",
				"import { expect } from \"vitest\";",
				"import { testWith } from \"@agboss/core/testing\";",
				"import { seconds } from \"@agboss/core/units\";",
				"import { SupportFinish, SupportStart, SupportWorkflow } from \"../src/support.application.js\";",
				"",
				"@Application({",
				"  name: \"cluster-test-application\",",
				"  version: \"1.0.0\",",
				"  environment: EmptyEnvironment,",
				"  workflows: [SupportWorkflow],",
				"})",
				"export class ClusterTestApplication {}",
				"",
				"const test = testWith(ClusterTestApplication, { instances: 2 });",
				"",
				"test(\"runs two application instances over shared stores and a shared virtual clock\", async ({",
				"  apps,",
				"  clock,",
				"}) => {",
				"  const [instanceA, instanceB] = apps;",
				"  if (!instanceA || !instanceB) throw new Error(\"Expected 2 instances\");",
				"  const first = await instanceA.execute(",
				"    SupportStart,",
				"    { text: \"Turn 1 on instance A\" },",
				"    { threadId: \"shared-thread-1\" },",
				"  );",
				"  expect(first.finish).toBe(SupportFinish);",
				"",
				"  await clock.advance(seconds(31));",
				"",
				"  const second = await instanceB.execute(",
				"    SupportStart,",
				"    { text: \"Turn 2 on instance B\" },",
				"    { threadId: \"shared-thread-1\" },",
				"  );",
				"  expect(second.output).toEqual({ text: \"Turn 2 on instance B\" });",
				"});"
			],
			"files": [
				{
					"file": "src/support.database-storage.ts",
					"code": [
						"import { DatabaseStorage, SqliteDriver, defineEnv, env, secret } from \"@agboss/core\";",
						"import { hours } from \"@agboss/core/units\";",
						"",
						"const databaseEnv = defineEnv({",
						"  path: env(\"AGBOSS_SQLITE_PATH\", { default: \".agboss/job-scout.sqlite\" }), // a persistent volume",
						"  idempotencySecret: secret(\"AGBOSS_IDEMPOTENCY_SECRET\"),",
						"});",
						"",
						"@DatabaseStorage({",
						"  name: \"support-database-storage\",",
						"  driver: SqliteDriver({ path: databaseEnv.path }), // one file: shared by the processes on one machine",
						"  auditLogTtl: hours(24 * 30),",
						"  ledgerEntriesTtl: hours(24),",
						"  idempotencySecret: databaseEnv.idempotencySecret,",
						"})",
						"export class SupportDatabaseStorage {}"
					]
				}
			]
		},
		"testing": {
			"file": "test/offer-negotiation.workflow.test.ts",
			"problem": "Testing multi-agent workflows against live LLMs is slow, flaky, expensive, and non-deterministic on parallel races.",
			"solution": "<code>testWith(App)</code> scripts model turns offline and controls branch completion order via <code>TestConcurrency.inOrder()</code>.",
			"code": [
				"import { expect } from \"vitest\";",
				"import { ExecutionStatus } from \"@agboss/core\";",
				"import { replyWith, routeTo, testWith } from \"@agboss/core/testing\";",
				"import { OfferApplication } from \"../src/offer.application.js\";",
				"import {",
				"  ComplianceAgent,",
				"  DrafterAgent,",
				"  LegalAuditAgent,",
				"  OfferWorkflowStart,",
				"  ReviewerAgent,",
				"  SecurityAuditAgent,",
				"  TriageRouter,",
				"} from \"../src/offer.components.js\";",
				"import {",
				"  AuditVerdictDto,",
				"  ComplianceReportDto,",
				"  DraftApprovedDto,",
				"  OfferDraftDto,",
				"} from \"../src/dto/offer-negotiation.dto.js\";",
				"",
				"const test = testWith(OfferApplication);",
				"",
				"test(\"runs OfferWorkflow through review loop and quorum to approval\", async ({ app, mockModel }) => {",
				"  mockModel(TriageRouter).thenReturn(routeTo(DrafterAgent));",
				"  mockModel(DrafterAgent).thenReturn(",
				"    replyWith(OfferDraftDto, { summary: \"Staff TS Engineer\", baseUsd: 215_000 }),",
				"  );",
				"  mockModel(ReviewerAgent).thenReturn(",
				"    replyWith(DraftApprovedDto, { signedBy: \"comp-committee\" }),",
				"  );",
				"  mockModel(ComplianceAgent).thenReturn(",
				"    replyWith(ComplianceReportDto, { status: \"passed\" }),",
				"  );",
				"  mockModel(SecurityAuditAgent).thenReturn(",
				"    replyWith(AuditVerdictDto, { auditor: \"sec-1\" }),",
				"  );",
				"  mockModel(LegalAuditAgent).thenReturn(",
				"    replyWith(AuditVerdictDto, { auditor: \"legal-1\" }),",
				"  );",
				"  const res = await app.execute(OfferWorkflowStart, { role: \"Staff TS\", region: \"EU\" });",
				"  expect(res.status).toBe(ExecutionStatus.Finished);",
				"});"
			],
			"files": [
				{
					"file": "test/order.workflow.test.ts",
					"code": [
						"import { Application, EmptyEnvironment } from \"@agboss/core\";",
						"import { expect } from \"vitest\";",
						"import { testWith } from \"@agboss/core/testing\";",
						"import { OrderWorkflow } from \"./order.workflow.js\";",
						"import { OrderWorkflowFinish, OrderWorkflowStart } from \"./order.components.js\";",
						"",
						"@Application({",
						"  name: \"order-application\",",
						"  version: \"1.0.0\",",
						"  environment: EmptyEnvironment,",
						"  workflows: [OrderWorkflow],",
						"  budgets: [OrderAppBudget, OrderTenantBudget, OrderExecBudget],",
						"})",
						"export class OrderApplication {}",
						"",
						"const test = testWith(OrderApplication);",
						"",
						"test(\"reserves stock and ships order on the happy path\", async ({ app }) => {",
						"  const result = await app.execute(OrderWorkflowStart, { orderId: \"ORD-42\" });",
						"  expect(result.finish).toBe(OrderWorkflowFinish);",
						"  expect(result.output).toEqual({ trackingNumber: \"trk-res-ORD-42\" });",
						"});"
					]
				}
			]
		},
		"runners": {
			"file": "test/settlement.components.test.ts",
			"problem": "Booting an entire workflow graph just to unit-test one tool, interceptor, router, judge, or PII policy slows down TDD.",
			"solution": "<code>testUnit</code> runs any single component (tool, interceptor, router, judge, PII policy, memory, ...) in 1ms.",
			"code": [
				"import { expect, it } from \"vitest\";",
				"import { testUnit } from \"@agboss/core/testing\";",
				"import {",
				"  DirectCaptureAction,",
				"  FraudAnalystAgent,",
				"  LowRiskArbiter,",
				"  RiskCheckAction,",
				"  SettlementRouter,",
				"} from \"../src/settlement/settlement.components.js\";",
				"",
				"it(\"verifies segregated @Arbiter, @Router, and @Action roles in isolation\", async () => {",
				"  const runArbiter = testUnit(LowRiskArbiter);",
				"  const verdict = await runArbiter(FraudAnalystAgent, { score: 12 });",
				"  expect(verdict.output).toBe(true);",
				"",
				"  const runRouter = testUnit(SettlementRouter);",
				"  const { output: selectedRoute } = await runRouter({",
				"    order: { orderId: \"ORD-9\", amountCents: 250_000 }, // a plain DTO literal: tracked by default",
				"  });",
				"  expect(selectedRoute).toBe(RiskCheckAction);",
				"",
				"  const runAction = testUnit(DirectCaptureAction);",
				"  const { output } = await runAction({",
				"    order: { orderId: \"ORD-1\", amountCents: 5_000 },",
				"  });",
				"  expect(output).toEqual({ txId: \"tx_ORD-1\" });",
				"});"
			],
			"files": [
				{
					"file": "test/grounded-citation.judge.test.ts",
					"code": [
						"import { expect, it } from \"vitest\";",
						"import { decideWith, testUnit } from \"@agboss/core/testing\";",
						"import { GroundedCitationJudge, PolicyAnswerDto } from \"../src/judges/grounded-citation.judge.js\";",
						"",
						"it(\"fails an uncited reply and returns actionable retry reason\", async () => {",
						"  const runJudge = testUnit(GroundedCitationJudge, {",
						"    model: decideWith({",
						"      hasCitations: 0.1,",
						"      accuracyScore: 2,",
						"    }),",
						"  });",
						"",
						"  const { output } = await runJudge({",
						"    variant: PolicyAnswerDto,",
						"    task: \"What is our parental leave policy?\",",
						"    output: { answer: \"Employees receive 16 weeks of paid leave.\", citations: [] },",
						"    attempt: 0,",
						"  });",
						"",
						"  expect(output.passed).toBe(false);",
						"  if (!output.passed) {",
						"    expect(output.reason).toContain(\"[source]\");",
						"  }",
						"});"
					]
				}
			]
		},
		"tracing": {
			"file": "scripts/langfuse-and-startup-audit.sh",
			"problem": "Scattered LLM logs make it impossible to reconstruct full parent-child execution trees, retries, and per-step USD spend.",
			"solution": "<code>includeRecord</code>, <code>agboss executions export</code> and OpenTelemetry/Langfuse exporters capture every step, tool call, pause, and revision hash.",
			"code": [
				"# 1. Private self-hosted Langfuse on 127.0.0.1 (telemetry off, mode 600 secrets):",
				"scripts/langfuse.sh up",
				"",
				"# 2. Startup log computes exact worst-case step & concurrency bounds:",
				"# 15:02:11 INFO  Started job-scout-application 1.0.0 — env prod, host scout-7f3a",
				"# 15:02:11 INFO  Worst case of one chat-workflow-start call:",
				"#                1 workflow execution, 3 at the same time, 12 agent/router steps",
				"",
				"# 3. Strict CI gate catches in-memory stores & non-static prompts before deploy:",
				"npx agboss check --strict",
				"# -> fails if [application.in-memory-cost-ledger] or [application.in-memory-pauses]",
				"# -> verifies every @Workflow path scope, DTO, static system prompt ([prompt.input-in-instructions]), and model provider"
			],
			"files": [
				{
					"file": "src/observers/langfuse.observer.ts",
					"code": [
						"import { Observer, type ExecutionEndEvent } from \"@agboss/core\";",
						"",
						"@Observer({ name: \"langfuse-audit-observer\", description: \"Logs the end of every execution\" })",
						"export class LangfuseAuditObserver {",
						"  onExecutionEnd(event: ExecutionEndEvent): void {",
						"    console.log({",
						"      executionId: event.executionId,",
						"      workflow: event.workflow.name,",
						"      status: event.status,",
						"      durationMs: event.durationMs,",
						"    });",
						"  }",
						"}"
					]
				},
				{
					"file": "src/job-scout.application.ts",
					"code": [
						"import { Application } from \"@agboss/core\";",
						"import { LangfuseObserver } from \"./observers/langfuse.observer.js\";",
						"import { JobScout } from \"./job-scout.workflow.js\";",
						"",
						"@Application({",
						"  name: \"job-scout-application\",",
						"  version: \"1.0.0\",",
						"  workflows: [JobScout],",
						"  observers: [LangfuseObserver],",
						"})",
						"export class JobScoutApplication {}"
					]
				}
			]
		},
		"ab": {
			"file": "src/config/scout-low-thinking.config.yaml",
			"problem": "Swapping models or temperatures in code requires redeploying and offers no side-by-side quality vs. cost proof.",
			"solution": "Declarative YAML profiles override models/settings and benchmark side by side via <code>agboss compare</code>.",
			"code": [
				"# a profile: only what differs from the TypeScript base; layered with --profile base,scout-low-thinking",
				"workflows:",
				"  job-scout-workflow:",
				"    version: 1.0.0-low-thinking",
				"    agents:",
				"      scout-eval-agent:",
				"        temperature: 0"
			],
			"files": [
				{
					"file": "src/evals/compare-profiles.ts",
					"code": [
						"import { compareProfiles } from \"@agboss/core\";",
						"",
						"export async function runComparison() {",
						"  const comparison = await compareProfiles(JobScout, {",
						"    start: ChatWorkflowStart,",
						"    profiles: [\"base\", \"scout-low-thinking\"],",
						"    tasks: [\"Find senior backend jobs in Europe\", \"Save the first two jobs\"],",
						"  });",
						"",
						"  for (const profile of comparison.profiles) {",
						"    const pairwise = profile.pairwise",
						"      ? `${String(profile.pairwise.wins)}/${String(profile.pairwise.losses)}/${String(profile.pairwise.ties)}`",
						"      : \"—\";",
						"    console.log(",
						"      `${profile.name}: score ${String(profile.meanScore ?? \"—\")}, w/l/t ${pairwise}, $${profile.costPerTaskUsd.toFixed(4)}/task`,",
						"    );",
						"  }",
						"}"
					]
				}
			]
		},
		"skills": {
			"file": "AGENTS.md",
			"problem": "Without framework guardrails, coding agents generate mutable God State objects, raw numbers, and broken graph edges.",
			"solution": "<code>AGENTS.md</code> and 13 synced skill reference modules guide any coding agent (Codex, Cursor, Windsurf, Copilot, Claude Code) while <code>agboss check</code> verifies the graph.",
			"code": [
				"# AGBoss Project Rules for Coding Agents (Codex, Cursor, Windsurf, Copilot, Gemini CLI, Claude Code)",
				"",
				"- Single assembly root: `@Application` (`*.application.ts`) passed to `createApp` and `testWith`.",
				"- HarnessDSL (`*.workflow.ts`): strictly one chained call per line (`@stylistic/newline-per-chained-call`).",
				"- Run `npm run types` (`agboss check`) to regenerate `.agboss/types.d.ts` before `npm run typecheck`.",
				"- Progressive-disclosure reference modules (synced offline from `node_modules/@agboss/core/skills/agboss/`):",
				"#   ├── SKILL.md                                     (quick-start rules & index)",
				"#   └── references/01..13.md                         (composition, Flow DSL, DI, MCP/A2A, channels, FinOps, PII, tracing, K8s, testing, CLI, recipes, LangGraph migration)"
			],
			"files": [
				{
					"file": "skills/agboss/SKILL.md",
					"code": [
						"# Auto-synced offline from `node_modules/@agboss/core/skills/agboss/` on `npm install`, `agboss check` & `agboss generate`:",
						"#",
						"# ├── AGENTS.md                                          (cross-agent standard: Codex, Cursor, Windsurf, Copilot, Gemini, Aider)",
						"# ├── CLAUDE.md                                          (`@AGENTS.md` 1-line bridge for Claude Code)",
						"# └── .claude/skills/agboss/                             (gitignored, version-locked to installed `@agboss/core`)",
						"#       ├── SKILL.md                                     (quick-start rules & index)",
						"#       ├── .agboss-skills.json                          (synced package version stamp)",
						"#       └── references/",
						"#             ├── 01-composition-and-architecture.md   ├── 08-observability-and-tracing.md",
						"#             ├── 02-flow-dsl-all-combinations.md      ├── 09-persistence-k8s-and-deploy.md",
						"#             ├── 03-components-di-and-lifecycle.md    ├── 10-testing-vcr-and-evals.md",
						"#             ├── 04-mcp-and-a2a.md                    ├── 11-cli-studio-and-error-catalog.md",
						"#             ├── 05-channels-and-human-in-the-loop.md ├── 12-end-to-end-recipes.md",
						"#             ├── 06-finops-providers-and-queues.md    └── 13-migrating-from-langgraph.md",
						"#             └── 07-guardrails-pii-and-security.md"
					]
				},
				{
					"file": "package.json",
					"code": [
						"{",
						"  \"name\": \"my-app\",",
						"  \"agboss\": {",
						"    \"application\": \"src/my-app.application.ts\",",
						"    \"skills\": true",
						"  },",
						"  \"scripts\": {",
						"    \"postinstall\": \"npm run types\",",
						"    \"types\": \"agboss check\",",
						"    \"typecheck\": \"npm run types && tsc --noEmit -p .\"",
						"  }",
						"}"
					]
				}
			]
		},
		"sagas": {
			"file": "src/actions/register-offer.action.ts",
			"problem": "Partial failures leave external side effects (escrow holds, ATS offers, hardware states) uncommitted and uncompensated.",
			"solution": "<code>@Action({ compensateWith, committedBy })</code> enforces rollback coverage statically (<code>[flow.uncompensated-action]</code>).",
			"code": [
				"import { Action, ExecutionContext, type ActionHandler, type InputOf, type OutputOf } from \"@agboss/core\";",
				"import { WithdrawOfferAction } from \"./withdraw-offer.action.js\";",
				"",
				"@Action({",
				"  name: \"register-offer-action\",",
				"  description: \"Creates a provisional offer in the external ATS; rolled back by WithdrawOfferAction\",",
				"  input: { draft: OfferDraftDto },",
				"  output: RegisteredOfferDto,",
				"  compensateWith: WithdrawOfferAction,",
				"  committedBy: ConfirmOfferAction,",
				"  deps: [ExecutionContext],",
				"})",
				"export class RegisterOfferAction implements ActionHandler<RegisterOfferAction> {",
				"  constructor(private readonly executionContext: ExecutionContext) {}",
				"",
				"  async execute(input: InputOf<RegisterOfferAction>): Promise<OutputOf<RegisterOfferAction>> {",
				"    return {",
				"      offerId: `ats_${this.executionContext.step.idempotencyKey}`,",
				"      role: input.draft.role,",
				"    };",
				"  }",
				"}"
			],
			"files": [
				{
					"file": "src/actions/withdraw-offer.action.ts",
					"code": [
						"import { Action, ExecutionContext, type ActionHandler, type InputOf } from \"@agboss/core\";",
						"",
						"@Action({",
						"  name: \"withdraw-offer-action\",",
						"  description: \"Revokes the provisional ATS offer under a live compensationTimeout cleanup signal\",",
						"  input: { offer: RegisteredOfferDto },",
						"  deps: [ExecutionContext],",
						"})",
						"export class WithdrawOfferAction implements ActionHandler<WithdrawOfferAction> {",
						"  constructor(private readonly executionContext: ExecutionContext) {}",
						"",
						"  async execute(input: InputOf<WithdrawOfferAction>): Promise<void> {",
						"    void input.offer.offerId;",
						"    void this.executionContext.signal;",
						"  }",
						"}"
					]
				}
			]
		},
		"lifo": {
			"file": "src/missions/escrow-settlement.workflow.ts",
			"problem": "External cancellations (<code>app.cancel</code>, <code>FailFast</code>, quorum <code>Surplus</code>, budget breach) bypass normal <code>.onError</code> edges.",
			"solution": "The runtime checkpoints open compensators and unwinds them in LIFO order under a dedicated <code>compensationTimeout</code>.",
			"code": [
				"import { StepError, Workflow, onStart, toAction, toWorkflow } from \"@agboss/core\";",
				"import {",
				"  CommitSettlementAction,",
				"  HoldEscrowFundsAction,",
				"  ProvisionLedgerEntryAction,",
				"  ReleaseEscrowFundsAction,",
				"  ReverseLedgerEntryAction,",
				"} from \"./escrow.actions.js\";",
				"",
				"@Workflow({",
				"  name: \"escrow-settlement-workflow\",",
				"  version: \"1.0.0\",",
				"  historyTtl: Ttl.Forever,",
				"  executionLimits: { maxConcurrency: 12 },",
				"  flow: [",
				"    onStart(SettlementStart)",
				"      .toAction(HoldEscrowFundsAction)",
				"      .toAction(ProvisionLedgerEntryAction)",
				"      // Distributed child workflows work-stolen across cluster instances:",
				"      .forEachItem(toWorkflow(ComplianceCheckWorkflow), { takeFirst: 6, maxConcurrency: 4 })",
				"      .join()",
				"      .onError(",
				"        StepError,",
				"        toAction(ReverseLedgerEntryAction)",
				"          .toAction(ReleaseEscrowFundsAction)",
				"          .toFinish(SettlementRolledBackFinish),",
				"      )",
				"      // Commit boundary: marks both HoldEscrowFundsAction and ProvisionLedgerEntryAction committed",
				"      .toAction(CommitSettlementAction)",
				"      .toFinish(SettlementFinish),",
				"  ],",
				"})",
				"export class EscrowSettlementWorkflow {}"
			],
			"files": []
		},
		"scaling": {
			"file": "src/support.database-storage.ts",
			"problem": "Traffic spikes overload single pods with deep parallel trees while sibling pods in the cluster sit idle.",
			"solution": "<code>ChildPlacement.AnyWorker</code> on the child workflow plus the shared child queue distribute child workflows across pods while parents yield their lease.",
			"code": [
				"import { DatabaseStorage, SqliteDriver, defineEnv, env, secret } from \"@agboss/core\";",
				"import { hours } from \"@agboss/core/units\";",
				"",
				"const databaseEnv = defineEnv({",
				"  path: env(\"AGBOSS_SQLITE_PATH\", { default: \".agboss/job-scout.sqlite\" }), // a persistent volume",
				"  idempotencySecret: secret(\"AGBOSS_IDEMPOTENCY_SECRET\"),",
				"});",
				"",
				"@DatabaseStorage({",
				"  name: \"support-database-storage\",",
				"  driver: SqliteDriver({ path: databaseEnv.path }), // one file: shared by the processes on one machine",
				"  auditLogTtl: hours(24 * 30),",
				"  ledgerEntriesTtl: hours(24),",
				"  idempotencySecret: databaseEnv.idempotencySecret,",
				"})",
				"export class SupportDatabaseStorage {}"
			],
			"files": []
		},
		"describe": {
			"file": "src/routers/order-triage-model.router.ts",
			"problem": "Keeping stabilized routing decisions on LLM calls forever wastes latency and budget long after patterns settle.",
			"solution": "Join <code>agboss describe --json</code> and <code>agboss executions export</code> in <code>agboss hub</code> to crystallize routes into code.",
			"code": [
				"import { DecidedBy, Router, inline } from \"@agboss/core\";",
				"import { Bool, Integer, Text } from \"@agboss/core/dto\";",
				"",
				"export class OrderTriageDto {",
				"  @Text({ prompt: \"Customer tier: free or enterprise\" })",
				"  tier!: string;",
				"",
				"  @Integer({ min: 0, prompt: \"Total order value in cents\" })",
				"  amountCents!: number;",
				"",
				"  @Bool({ prompt: \"Whether the shipping address is international\" })",
				"  isInternational!: boolean;",
				"}",
				"",
				"@Router({",
				"  name: \"order-triage-model-router\",",
				"  description: \"Routes orders to compliance review or fast-track capture\",",
				"  decidedBy: DecidedBy.Model,",
				"  model: \"typesafe/jev-1.13\",",
				"  prompt: inline(\"Route international orders or orders over $5,000 to compliance review; fast-track the rest.\"),",
				"  input: { order: OrderTriageDto },",
				"  routes: [",
				"    {",
				"      target: ComplianceReviewAgent,",
				"      prompt: \"Order requires manual or automated export/value compliance review\",",
				"    },",
				"    {",
				"      target: FastTrackCaptureAction,",
				"      prompt: \"Domestic standard order eligible for immediate capture\",",
				"    },",
				"  ],",
				"})",
				"export class OrderTriageModelRouter {}"
			],
			"files": [
				{
					"file": "src/services/job-fit.service.ts",
					"code": [
						"import { Decision, DecisionModel, Injectable, secret } from \"@agboss/core\";",
						"import { DecisionsDriver, ModelCost, ModelProvider } from \"@agboss/core/models\";",
						"import { seconds } from \"@agboss/core/units\";",
						"",
						"// a decision model is served by a provider with a DecisionsDriver",
						"@ModelProvider({",
						"  name: \"decisions-model-provider\",",
						"  description: \"Decision models on OpenRouter's Decisions API\",",
						"  driver: DecisionsDriver({ baseUrl: \"https://openrouter.ai/api/v1\", apiKey: secret(\"OPENROUTER_API_KEY\") }),",
						"  timeout: seconds(30),",
						"  cost: ModelCost.fromResponse(),",
						"})",
						"export class DecisionsModelProvider {}",
						"",
						"const FIT_QUESTION = \"Does the job fit what the candidate wants?\";",
						"",
						"@Injectable({ deps: [DecisionModel] })",
						"export class JobFitService {",
						"  constructor(private readonly decisionModel: DecisionModel) {}",
						"",
						"  async fits(profile: string, job: string): Promise<boolean> {",
						"    const { fits } = await this.decisionModel.decide(",
						"      {",
						"        state: `Candidate wants:\\n${profile}\\n\\nJob:\\n${job}`,",
						"        questions: { fits: Decision.boolean(FIT_QUESTION) },",
						"      },",
						"      { model: \"typesafe/jev-1.13\", modelProvider: DecisionsModelProvider },",
						"    );",
						"    return fits.probability > 0.5; // P(yes), as every boolean decision answers",
						"  }",
						"}"
					]
				}
			]
		}
	};

	var KW = /^(import|from|export|class|abstract|const|let|new|return|await|async|private|readonly|implements|extends|type|test|it|expect|true|false|function|if|override)$/;

	function esc(s) {
		return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}

	function highlightYaml(line) {
		if (/^\s*#/.test(line)) { return '<span class="tok-com">' + esc(line) + "</span>"; }
		var m = /^(\s*)([A-Za-z_][\w-]*)(:)(.*)$/.exec(line);
		if (!m) { return esc(line); }
		return m[1] + '<span class="tok-kw">' + m[2] + "</span>" + m[3] + '<span class="tok-str">' + esc(m[4]) + "</span>";
	}

	function highlightTs(line) {
		var re = /(\/\/.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|`[^`]*`)|(@[A-Za-z]+)|\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
		var out = "";
		var last = 0;
		var m;
		while ((m = re.exec(line))) {
			out += esc(line.slice(last, m.index));
			if (m[1]) {
				out += '<span class="tok-com">' + esc(m[1]) + "</span>";
			} else if (m[2]) {
				out += '<span class="tok-str">' + esc(m[2]) + "</span>";
			} else if (m[3]) {
				out += '<span class="tok-dec">' + esc(m[3]) + "</span>";
			} else if (KW.test(m[4])) {
				out += '<span class="tok-kw">' + m[4] + "</span>";
			} else if (/^[A-Z]/.test(m[4])) {
				out += '<span class="tok-cls">' + m[4] + "</span>";
			} else {
				out += m[4];
			}
			last = re.lastIndex;
		}
		return out + esc(line.slice(last));
	}

	function render(snip) {
		var hl = /\.(ya?ml|sh|md)$/.test(snip.file) ? highlightYaml : highlightTs;
		return snip.code.map(hl).join("\n");
	}

	function init() {
		var root = document.getElementById("agx");
		if (!root) { return; }
		var filesEl = document.getElementById("agx-files");
		var srcEl = document.getElementById("agx-src");
		var win = root.querySelector(".agx-win");
		var diag = document.getElementById("agx-diag");
		var problemEl = document.getElementById("agx-problem");
		var solutionEl = document.getElementById("agx-solution");
		var body = root.querySelector(".agx-body");
		var items = root.querySelectorAll(".agx-item");
		var subs = root.querySelectorAll(".agx-sub");
		var current = null;
		var navBox = root.querySelector(".agx-nav");
		var codeBox = root.querySelector(".agx-code");
		var narrow = window.matchMedia("(max-width: 59.99rem)");
		var lastScrollY = window.scrollY;
		var codeStickyTop = 80;
		var navStickyTop = 80;

		function getNavGap() {
			return (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sl-nav-height")) * 16 || 64) + 16;
		}

		function syncSticky(resetCodeToTop) {
			if (narrow.matches) {
				if (codeBox) { codeBox.style.top = ""; }
				if (navBox) { navBox.style.top = ""; }
				lastScrollY = window.scrollY;
				return;
			}
			var maxTop = getNavGap();
			var bottomPad = 24;
			var dy = window.scrollY - lastScrollY;
			lastScrollY = window.scrollY;

			if (codeBox) {
				var minCodeTop = Math.min(maxTop, window.innerHeight - codeBox.offsetHeight - bottomPad);
				if (resetCodeToTop) {
					codeStickyTop = maxTop;
				} else {
					codeStickyTop = Math.max(minCodeTop, Math.min(maxTop, codeStickyTop - dy));
				}
				codeBox.style.top = codeStickyTop + "px";
			}

			if (navBox) {
				var minNavTop = Math.min(maxTop, window.innerHeight - navBox.offsetHeight - bottomPad);
				navStickyTop = Math.max(minNavTop, Math.min(maxTop, navStickyTop - dy));
				navBox.style.top = navStickyTop + "px";
			}
		}

		function ensureCodeTopVisible() {
			if (narrow.matches || !codeBox) { return; }
			var maxTop = getNavGap();
			var rect = codeBox.getBoundingClientRect();
			if (rect.top < maxTop - 8) {
				window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - maxTop), behavior: "smooth" });
			}
		}

		function placeCode(scroll) {
			var active = root.querySelector(".agx-item.is-active");
			if (narrow.matches && active) {
				if (active.nextElementSibling !== codeBox) { active.after(codeBox); }
				if (scroll) {
					var top = active.getBoundingClientRect().top;
					var nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sl-nav-height")) * 16 || 64;
					if (top < nav || top > window.innerHeight * 0.25) {
						window.scrollTo({ top: window.scrollY + top - nav - 12, behavior: "smooth" });
					}
				}
			} else if (codeBox.parentElement !== root) {
				root.appendChild(codeBox);
			}
			syncSticky(false);
		}

		function shortTabLabels(entries) {
			var bases = entries.map(function (e) {
				var parts = e.file.split("/");
				return parts[parts.length - 1];
			});
			return entries.map(function (e, i) {
				var base = bases[i];
				var dup = bases.some(function (b, j) { return j !== i && b === base; });
				if (!dup) { return base; }
				var parts = e.file.split("/");
				return parts.length >= 2 ? parts[parts.length - 2] + "/" + base : e.file;
			});
		}

		function renderFileTabs(snip) {
			var allFiles = [{ file: snip.file, code: snip.code }].concat(snip.files || []);
			if (!filesEl) { return; }
			var labels = shortTabLabels(allFiles);
			filesEl.innerHTML = "";
			filesEl.scrollLeft = 0;
			allFiles.forEach(function (entry, idx) {
				var btn = document.createElement("button");
				btn.type = "button";
				btn.className = "agx-file-tab" + (idx === 0 ? " is-active" : "");
				btn.setAttribute("role", "tab");
				btn.setAttribute("aria-selected", idx === 0 ? "true" : "false");
				btn.title = entry.file;
				btn.textContent = labels[idx];
				btn.addEventListener("click", function () {
					filesEl.querySelectorAll(".agx-file-tab").forEach(function (b, bIdx) {
						var active = bIdx === idx;
						b.classList.toggle("is-active", active);
						b.setAttribute("aria-selected", active ? "true" : "false");
					});
					btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
					srcEl.innerHTML = render(entry);
					body.scrollLeft = 0;
					syncSticky(true);
				});
				filesEl.appendChild(btn);
			});
		}

		function applySnippet(key) {
			var snip = SNIPPETS[key];
			if (!snip) { return; }
			renderFileTabs(snip);
			srcEl.innerHTML = render(snip);
			if (problemEl) { problemEl.innerHTML = snip.problem || ""; }
			if (solutionEl) { solutionEl.innerHTML = snip.solution || ""; }
			body.scrollLeft = 0;
			syncSticky(true);
			ensureCodeTopVisible();
		}

		function show(key) {
			if (key === current || !SNIPPETS[key]) { return; }
			current = key;
			win.classList.add("is-swapping");
			if (diag) { diag.classList.add("is-swapping"); }
			setTimeout(function () {
				applySnippet(key);
				win.classList.remove("is-swapping");
				if (diag) { diag.classList.remove("is-swapping"); }
			}, 120);
		}

		items.forEach(function (item) {
			var tab = item.querySelector(".agx-tab");
			tab.addEventListener("click", function () {
				items.forEach(function (i) { i.classList.toggle("is-active", i === item); });
				placeCode(true);
				var activeSub = item.querySelector(".agx-sub.is-active");
				show(activeSub ? activeSub.getAttribute("data-key") : tab.getAttribute("data-key"));
			});
		});

		subs.forEach(function (sub) {
			sub.addEventListener("click", function () {
				var owner = sub.closest(".agx-item");
				items.forEach(function (i) { i.classList.toggle("is-active", i === owner); });
				owner.querySelectorAll(".agx-sub").forEach(function (s) {
					s.classList.toggle("is-active", s === sub);
				});
				placeCode(true);
				show(sub.getAttribute("data-key"));
			});
		});

		current = "application";
		placeCode(false);
		applySnippet("application");

		document.querySelectorAll("[data-skill-tab]").forEach(function (chip) {
			chip.addEventListener("click", function () {
				var tabIndex = parseInt(chip.getAttribute("data-skill-tab") || "0", 10);
				var skillsControl = root.querySelector(".agx-tab[data-key='skills'], .agx-sub[data-key='skills']");
				if (skillsControl) {
					var item = skillsControl.closest(".agx-item");
					items.forEach(function (i) { i.classList.toggle("is-active", i === item); });
					if (skillsControl.classList.contains("agx-sub")) {
						item.querySelectorAll(".agx-sub").forEach(function (s) {
							s.classList.toggle("is-active", s === skillsControl);
						});
					}
					current = "skills";
					placeCode(false);
					applySnippet("skills");
					var fileBtns = filesEl ? filesEl.querySelectorAll(".agx-file-tab") : [];
					if (fileBtns[tabIndex]) {
						fileBtns[tabIndex].click();
					}
					root.scrollIntoView({ behavior: "smooth", block: "start" });
				}
			});
		});

		window.addEventListener("scroll", function () {
			syncSticky(false);
		}, { passive: true });

		var resizeTimer;
		window.addEventListener("resize", function () {
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(function () { placeCode(false); }, 150);
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
