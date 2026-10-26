// @ts-check
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

/**
 * Resolves the git commit date (YYYY-MM-DD) for the source doc backing a sitemap URL.
 * Returns undefined if no git commit exists for the file so <lastmod> is omitted rather than faked.
 * @param {string} locUrl
 */
function gitLastModForUrl(locUrl) {
	try {
		const u = new URL(locUrl);
		const slug = u.pathname.replace(/^\/+|\/+$/g, '') || 'index';
		const docsDir = path.resolve(process.cwd(), 'src/content/docs');
		const candidates = [
			path.join(docsDir, `${slug}.md`),
			path.join(docsDir, `${slug}.mdx`),
			path.join(docsDir, slug, 'index.md'),
			path.join(docsDir, slug, 'index.mdx'),
		];
		const sourceFile = candidates.find((p) => fs.existsSync(p));
		if (!sourceFile) return undefined;
		const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', sourceFile], {
			encoding: 'utf8',
		}).trim();
		return /^\d{4}-\d{2}-\d{2}$/u.test(out) ? out : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Post-build hook that enriches @astrojs/sitemap output with per-file git <lastmod> tags
 * and writes /sitemap.xml alongside /sitemap-index.xml.
 */
function geoSitemapEnricher() {
	return {
		name: 'agboss-geo-sitemap',
		hooks: {
			'astro:build:done': async ({ dir }) => {
				const outDir = fileURLToPath(dir);
				const s0 = path.join(outDir, 'sitemap-0.xml');
				const sMain = path.join(outDir, 'sitemap.xml');
				if (fs.existsSync(s0)) {
					const xml = fs.readFileSync(s0, 'utf8');
					const enriched = xml.replace(
						/<loc>([^<]+)<\/loc>(?!\s*<lastmod>)/g,
						(_match, loc) => {
							const lastMod = gitLastModForUrl(loc);
							return lastMod ? `<loc>${loc}</loc><lastmod>${lastMod}</lastmod>` : `<loc>${loc}</loc>`;
						},
					);
					fs.writeFileSync(s0, enriched, 'utf8');
					fs.writeFileSync(sMain, enriched, 'utf8');
				}
				function walkHtml(dirPath) {
					for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
						const full = path.join(dirPath, entry.name);
						if (entry.isDirectory()) {
							walkHtml(full);
						} else if (entry.isFile() && entry.name.endsWith('.html')) {
							const html = fs.readFileSync(full, 'utf8');
							const updated = html
								.replace(/<div class="expressive-code">/g, '<div class="expressive-code" role="complementary">')
								.replace(/<table>/g, '<table role="complementary">');
							if (updated !== html) {
								fs.writeFileSync(full, updated, 'utf8');
							}
						}
					}
				}
				walkHtml(outDir);
			},
		},
	};
}

// https://astro.build/config
export default defineConfig({
	site: 'https://agboss.dev',
	integrations: [
		starlight({
			title: 'AGBoss',
			description:
				'Spring-style architecture for LangGraph AI agents. Build reliable, testable AI agents in TypeScript with dependency injection, static workflow validation, and deterministic testing.',
			logo: {
				light: './src/assets/agboss-mark-light.svg',
				dark: './src/assets/agboss-mark-dark.svg',
				alt: 'AGBoss',
			},
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/agbossjs/agboss' },
				{ icon: 'twitter', label: 'Twitter', href: 'https://x.com/agbossjs' },
				{ icon: 'linkedin', label: 'LinkedIn', href: 'https://www.linkedin.com/company/agbossjs' },
			],
			favicon: '/favicon.svg',
			head: [
				{ tag: 'link', attrs: { rel: 'icon', href: '/favicon.ico', sizes: '32x32' } },
				{ tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
				{ tag: 'meta', attrs: { property: 'og:site_name', content: 'AGBoss' } },
				{ tag: 'meta', attrs: { property: 'og:image', content: 'https://agboss.dev/og-image.png' } },
				{ tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
				{ tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
				{ tag: 'meta', attrs: { property: 'og:image:alt', content: 'AGBoss — TypeScript AI Agent Framework for LangGraph' } },
				{ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
				{ tag: 'meta', attrs: { name: 'twitter:image', content: 'https://agboss.dev/og-image.png' } },
			],
			editLink: {
				baseUrl: 'https://github.com/agbossjs/agboss.dev/edit/main/',
			},
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'getting-started/introduction' },
						{ label: 'Installation', slug: 'getting-started/installation' },
						{ label: 'Quick start', slug: 'getting-started/quick-start' },
						{ label: 'Interactive Feature Explorer', slug: 'features' },
					],
				},
				{
					label: 'Core Concepts',
					items: [
						{ label: '7 Architectural Principles', slug: 'concepts/architecture' },
						{ label: 'AI Coding Skills (AGENTS.md)', slug: 'concepts/ai-coding-skills' },
						{ label: 'Progressive Crystallization', slug: 'concepts/progressive-crystallization' },
						{ label: 'Application & Lifecycle', slug: 'concepts/application' },
						{ label: 'Digital & Physical Missions', slug: 'concepts/mission-orchestration' },
						{ label: 'Decorators & Role Segregation', slug: 'concepts/decorators' },
						{ label: 'Workflow HDSL & Topology', slug: 'concepts/workflow' },
						{ label: 'Path Scope (SSA) & Provenance', slug: 'concepts/path-scope' },
						{ label: 'DI & Custom Overrides', slug: 'concepts/dependency-injection' },
						{ label: 'Contexts & Authorization', slug: 'concepts/contexts' },
						{ label: 'Environments, Secrets & Units', slug: 'concepts/environments' },
					],
				},
				{
					label: 'Testing & Evaluation (5 Loops)',
					items: [
						{ label: '5-Loop Verification Funnel', slug: 'concepts/verification-funnel' },
						{ label: 'Loop 0–1: Unit Runners, testWith & VCR', slug: 'guides/testing-agents' },
						{ label: 'Loop 2–4: Evals, pass^k & Calibration', slug: 'guides/evaluation-and-profiles' },
					],
				},
				{
					label: 'Production Guides',
					items: [
						{ label: 'Parallel, Quorums & Child Workflows', slug: 'guides/parallel-quorums-and-child-workflows' },
						{ label: 'Channels, Pauses & Webhooks', slug: 'guides/channels-and-pauses' },
						{ label: 'Multi-Instance, Leases & SQLite', slug: 'guides/persistence-and-recovery' },
						{ label: 'Error Handling & Rollback', slug: 'guides/error-handling-and-rollback' },
						{ label: 'FinOps & Model Providers', slug: 'guides/finops-and-providers' },
						{ label: 'PII Policies & Guardrails', slug: 'guides/security-and-pii' },
						{ label: 'Memory & Compaction', slug: 'guides/memory-and-compaction' },
						{ label: 'Observability & Tracing', slug: 'guides/observability-and-tracing' },
						{ label: 'MCP, RAG & A2A Protocols', slug: 'guides/mcp-rag-and-a2a' },
					],
				},
				{
					label: 'Decorators: App & Workflow',
					items: [
						{ label: '@Application', slug: 'reference/application' },
						{ label: '@Workflow', slug: 'reference/workflow' },
						{ label: '@WorkflowStart', slug: 'reference/workflow-start' },
						{ label: '@WorkflowFinish', slug: 'reference/workflow-finish' },
						{ label: '@HealthCheck', slug: 'reference/health-check' },
					],
				},
				{
					label: 'Decorators: Flow & Routing',
					items: [
						{ label: '@Agent', slug: 'reference/agent' },
						{ label: '@Action', slug: 'reference/action' },
						{ label: '@Router', slug: 'reference/router' },
						{ label: '@Arbiter', slug: 'reference/arbiter' },
						{ label: '@OnAnswer', slug: 'reference/on-answer' },
						{ label: '@Compaction', slug: 'reference/compaction' },
					],
				},
				{
					label: 'Decorators: Tools, Quality & DI',
					items: [
						{ label: '@Tool', slug: 'reference/tool' },
						{ label: '@BindTool', slug: 'reference/bind-tool' },
						{ label: '@ToolInterceptor', slug: 'reference/tool-interceptor' },
						{ label: '@Judge', slug: 'reference/judge' },
						{ label: '@Injectable', slug: 'reference/injectable' },
						{ label: 'DTO Field Decorators', slug: 'reference/dto' },
					],
				},
				{
					label: 'Decorators: Governance & Safety',
					items: [
						{ label: '@ModelProvider', slug: 'reference/model-provider' },
						{ label: '@Budget', slug: 'reference/budget' },
						{ label: '@PiiPolicy', slug: 'reference/pii-policy' },
						{ label: '@InputGuardrail & @OutputGuardrail', slug: 'reference/guardrail' },
						{ label: '@ChannelRole', slug: 'reference/channel-role' },
						{ label: '@Channel', slug: 'reference/channel' },
						{ label: '@ReplyInterpreter', slug: 'reference/reply-interpreter' },
					],
				},
				{
					label: 'Decorators: Knowledge & Protocols',
					items: [
						{ label: '@Rag', slug: 'reference/rag' },
						{ label: '@McpServer', slug: 'reference/mcp' },
						{ label: '@McpTool', slug: 'reference/mcp-tool' },
						{ label: '@McpExpose', slug: 'reference/mcp-expose' },
						{ label: '@A2AAgent', slug: 'reference/a2a-agent' },
					],
				},
				{
					label: 'CLI, Examples & Releases',
					items: [
						{ label: 'agboss CLI', slug: 'cli' },
						{ label: '7 Verified Examples & job-scout', slug: 'examples/job-scout' },
						{ label: 'Changelog & Releases', slug: 'changelog' },
						{ label: 'About AGBoss', slug: 'about' },
					],
				},
			],
			customCss: ['./src/styles/agboss-theme.css', './src/styles/pages.css'],
			components: {
				Head: './src/components/Head.astro',
				ThemeSelect: './src/components/ThemeToggle.astro',
				Header: './src/components/Header.astro',
				Footer: './src/components/Footer.astro',
			},
			plugins: [
				starlightLlmsTxt({
					projectName: 'AGBoss (Agent Graph Builder Open Source System)',
					description:
						'AGBoss (Agent Graph Builder Open Source System) is an open-source TypeScript framework with static verification (agboss check) for complex multi-agent workflows on top of LangGraph, combining dependency injection, typed DTO dataflow, and HarnessDSL (HDSL) — its declarative workflow grammar enforcing 7 distributed-systems architectural principles: (1) Computational Role Segregation (@Agent, @Router, @Arbiter, @Action), (2) Path-Scoped SSA Dataflow & Staleness Tracking (Produced<Dto, Producer>, about, historyOf), (3) Canonical Topology Isomorphism (in-degree = 1 inline vs >= 2 top-level path, depth <= 4), (4) Prompt Prefix Cache Invariance ([prompt.input-in-instructions], sorted schemas, deterministic HMAC replaceWithToken), (5) Transactional LIFO Sagas & Idempotent Execution (step.idempotencyKey, compensateWith / committedBy, [graph.limit-handler-uses-model]), (6) Zero-Leakage DI & Progressive Infrastructure Scaling (InMemory* to Sqlite* WAL, 30s leases, ChildPlacement.AnyInstance work-stealing, health probes, and 10 unit runners), and (7) Progressive Crystallization (agboss describe --json + trace join + agboss hub Crystallization Radar from DecidedBy.Model to DecidedBy.Code).',
					details:
						'AGBoss is designed for TypeScript engineers building multi-agent workflows with or without AI coding assistants. Instead of relying on an untyped mutable shared state object where missing branch inputs or stale loop outputs fail at runtime, AGBoss verifies workflow topology and Path Scope before runtime via `agboss check` (emitting `.agboss/types.d.ts`) and ships with auto-synced `AGENTS.md` + 13 skill reference modules (`references/01..13`) and `@agboss/core/eslint`. Workflows use one chained method call per line (`start(Start).returns(Dto).toAgent(Agent).toFinish(Finish)`), DTOs are plain objects validated by field decorators (`@agboss/core/dto`), and durations/money/sizes use unit factories (`seconds()`, `minutes()`, `hours()`, `usd()`, `kilobytes()`).',
					customSets: [
						{
							label: 'Core Concepts & HarnessDSL (HDSL)',
							paths: ['getting-started/**', 'concepts/**'],
							description: 'Application assembly, HarnessDSL (HDSL) Path Scope grammar, decorators, and dependency injection.',
						},
						{
							label: 'Production, FinOps, Security & Testing Guides',
							paths: ['guides/**'],
							description: 'Testing with testWith and 10 unit runners, @EvalSuite and pass@k / pass^k, error handling and rollback, channels and two-phase pauses, FinOps budgets, PII policies, SQLite durability, ChildPlacement.AnyInstance work-stealing, Langfuse tracing, MCP, RAG, A2A mesh + agboss hub, and AI coding skills.',
						},
						{
							label: 'API Reference, CLI & Changelog',
							paths: ['reference/**', 'cli', 'changelog'],
							description: 'Complete decorator contracts, HarnessDSL (HDSL) flow methods, standard DTOs, agboss CLI commands, and release changelog.',
						},
						{
							label: 'Examples',
							paths: ['examples/**'],
							description: '7 standalone verified applications in agbossjs/agboss-examples (01-hello-agboss, 02-path-scope-proof, 03-support-refund-desk, 04-travel-booking-saga, 05-cluster-work-stealing, 06-enterprise-agent-mesh, 07-langgraph-migration) plus job-scout and flow-patterns.',
						},
					],
					optionalLinks: [
						{
							label: 'AGBoss Framework GitHub Repository',
							url: 'https://github.com/agbossjs/agboss',
							description: 'Source code, issue tracker, examples/job-scout, and examples/flow-patterns.',
						},
						{
							label: 'AGBoss Verified Examples Repository',
							url: 'https://github.com/agbossjs/agboss-examples',
							description: '7 standalone verified applications (01-hello-agboss, 02-path-scope-proof, 03-support-refund-desk, 04-travel-booking-saga, 05-cluster-work-stealing, 06-enterprise-agent-mesh, and 07-langgraph-migration).',
						},
						{
							label: 'Why AGBoss',
							url: 'https://agboss.dev/why/',
							description: 'Architectural overview comparing AGBoss with raw orchestration libraries and hosted agent platforms.',
						},
						{
							label: 'AGBoss Roadmap',
							url: 'https://agboss.dev/roadmap/',
							description: 'Shipped capabilities and upcoming milestones.',
						},
					],
				}),
			],
		}),
		geoSitemapEnricher(),
	],
});
