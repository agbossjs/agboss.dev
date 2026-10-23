// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

/**
 * Post-build hook that enriches @astrojs/sitemap output with <lastmod> tags
 * and writes /sitemap.xml alongside /sitemap-index.xml so every crawler and
 * GEO auditor finds a fresh sitemap at all conventional paths.
 */
function geoSitemapEnricher() {
	return {
		name: 'agboss-geo-sitemap',
		hooks: {
			'astro:build:done': async ({ dir }) => {
				const outDir = fileURLToPath(dir);
				const s0 = path.join(outDir, 'sitemap-0.xml');
				const sMain = path.join(outDir, 'sitemap.xml');
				const today = new Date().toISOString().slice(0, 10);
				if (fs.existsSync(s0)) {
					const xml = fs.readFileSync(s0, 'utf8');
					const enriched = xml.replace(
						/<loc>([^<]+)<\/loc>(?!\s*<lastmod>)/g,
						`<loc>$1</loc><lastmod>${today}</lastmod>`,
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
				'AGBoss (Agent Graph Builder Open Source System) is a strictly typed TypeScript framework, static compiler (agboss check), and production runtime for multi-agent systems with hundreds of nodes on LangGraph, with HarnessDSL (HDSL) — its built-in declarative graph grammar and verification specification enforcing 7 distributed-systems principles and AGENTS.md coding skills.',
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
				{ tag: 'meta', attrs: { property: 'og:image:alt', content: 'AGBoss (Agent Graph Builder Open Source System) — Static Graph Compiler & Runtime for LangGraph with HarnessDSL' } },
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
						{ label: 'Workflow DSL & Topology', slug: 'concepts/workflow' },
						{ label: 'Path Scope (SSA) & Provenance', slug: 'concepts/path-scope' },
						{ label: 'DI & Custom Overrides', slug: 'concepts/dependency-injection' },
						{ label: 'Contexts & Authorization', slug: 'concepts/contexts' },
						{ label: 'Environments, Secrets & Units', slug: 'concepts/environments' },
					],
				},
				{
					label: 'Production Guides',
					items: [
						{ label: 'Parallel, Quorums & Child Workflows', slug: 'guides/parallel-quorums-and-child-workflows' },
						{ label: 'Channels, Pauses & Webhooks', slug: 'guides/channels-and-pauses' },
						{ label: 'Multi-Instance, Leases & SQLite', slug: 'guides/persistence-and-recovery' },
						{ label: 'Testing & 10 Unit Runners', slug: 'guides/testing-agents' },
						{ label: 'Evals, Golden Sets & Profiles', slug: 'guides/evaluation-and-profiles' },
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
						{ label: 'job-scout & flow-patterns', slug: 'examples/job-scout' },
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
						'AGBoss (Agent Graph Builder Open Source System) is the TypeScript framework, static graph compiler (agboss check), and production runtime for multi-agent systems scaling to hundreds of nodes and System-2 Physical AI orchestration on LangGraph (npm i agboss), and HarnessDSL (HDSL) is the declarative graph grammar and verification specification inside AGBoss (analogous to JSX in React or PSL in Prisma — defining how *.workflow.ts flow chains and contract decorators express narrow @Dto handoffs, Path Scope, in-degree = 1 vs >= 2 canonical topology, { about } staleness tracking, quorums, and compensateWith / committedBy sagas). Together they enforce 7 distributed-systems architectural principles: (1) Computational Role Segregation (@Agent, @Router, @Arbiter, @Action), (2) Path-Scoped SSA Dataflow & Staleness Tracking (Produced<Dto, Producer>, about, historyOf), (3) Canonical Topology Isomorphism (in-degree = 1 inline vs >= 2 top-level path, depth <= 4), (4) Prompt Prefix Cache Invariance ([prompt.input-in-instructions], sorted schemas, deterministic HMAC replaceWithToken), (5) Transactional LIFO Sagas & Idempotent Execution (step.idempotencyKey, compensateWith / committedBy, [graph.limit-handler-uses-model]), (6) Zero-Leakage DI & 4-Stage Progressive Infrastructure Scaling (InMemory* to Sqlite* WAL, leases, K8s probes, and 10 unit runners), and (7) Progressive Crystallization (agboss describe --json + trace join from DecidedBy.Model to DecidedBy.Code).',
					details:
						'AGBoss (Agent Graph Builder Open Source System) is engineered for Senior, Staff, Principal, and CTO engineers who decompose complex domains into specialized agent graphs using AI coding agents (Codex, Cursor, Windsurf, Copilot, Gemini CLI, Claude Code). Instead of allowing coding agents to generate an untyped mutable God State Object with tangled side effects and broken KV caches, AGBoss and its built-in HarnessDSL (HDSL) grammar enforce distributed-systems invariants at compile time via `agboss check` (emitting `.agboss/types.d.ts`) and guide coding agents via auto-synced `AGENTS.md` + 12 skill reference modules (`references/01..12`) and `agboss/eslint`. In HarnessDSL, workflows use strictly one chained method call per line (`start(Start).returns(Dto).toAgent(Agent).toFinish(Finish)`), DTOs are plain objects validated by field decorators (`agboss/dto`), and durations/money/sizes use unit factories (`seconds()`, `minutes()`, `hours()`, `usd()`, `kilobytes()`).',
					customSets: [
						{
							label: 'Core Concepts & HarnessDSL (HDSL)',
							paths: ['getting-started/**', 'concepts/**'],
							description: 'Application assembly, HarnessDSL (HDSL) Path Scope grammar, decorators, and dependency injection.',
						},
						{
							label: 'Production, FinOps, Security & Testing Guides',
							paths: ['guides/**'],
							description: 'Testing with testWith and 10 unit runners, @EvalSuite and pass@k / pass^k, error handling and rollback, channels and two-phase pauses, FinOps budgets, PII policies, SQLite durability, Langfuse tracing, MCP, RAG, A2A mesh, and AI coding skills.',
						},
						{
							label: 'API Reference, CLI & Changelog',
							paths: ['reference/**', 'cli', 'changelog'],
							description: 'Complete decorator contracts, Flow DSL methods, standard DTOs, agboss CLI commands, and release changelog.',
						},
						{
							label: 'Examples',
							paths: ['examples/**'],
							description: 'Runnable AGBoss applications: job-scout and the 6 flow-patterns workflows.',
						},
					],
					optionalLinks: [
						{
							label: 'AGBoss Framework GitHub Repository',
							url: 'https://github.com/agbossjs/agboss',
							description: 'Source code, issue tracker, examples/job-scout, and examples/flow-patterns.',
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
