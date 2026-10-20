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
				'Production-grade TypeScript application framework for LangGraph agents — @Application container, compile-time Path Scope DSL, multi-tenant FinOps budgets, PII policies, durable SQLite/CAS execution, and deterministic testing.',
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
						{ label: 'Application & Lifecycle', slug: 'concepts/application' },
						{ label: 'Decorators & Naming', slug: 'concepts/decorators' },
						{ label: 'Workflow DSL', slug: 'concepts/workflow' },
						{ label: 'Path Scope & Provenance', slug: 'concepts/path-scope' },
						{ label: 'Dependency Injection', slug: 'concepts/dependency-injection' },
						{ label: 'Contexts & Authorization', slug: 'concepts/contexts' },
						{ label: 'Environments, Secrets & Units', slug: 'concepts/environments' },
					],
				},
				{
					label: 'Production Guides',
					items: [
						{ label: 'Parallel, Quorums & Child Workflows', slug: 'guides/parallel-quorums-and-child-workflows' },
						{ label: 'Memory & Compaction', slug: 'guides/memory-and-compaction' },
						{ label: 'Channels & Pauses', slug: 'guides/channels-and-pauses' },
						{ label: 'Error Handling & Rollback', slug: 'guides/error-handling-and-rollback' },
						{ label: 'FinOps & Model Providers', slug: 'guides/finops-and-providers' },
						{ label: 'PII Policies & Guardrails', slug: 'guides/security-and-pii' },
						{ label: 'Persistence, Leases & Recovery', slug: 'guides/persistence-and-recovery' },
						{ label: 'Testing & Unit Runners', slug: 'guides/testing-agents' },
						{ label: 'Observability & Tracing', slug: 'guides/observability-and-tracing' },
						{ label: 'Profiles & Evaluation', slug: 'guides/evaluation-and-profiles' },
						{ label: 'MCP, RAG, A2A & AI Skills', slug: 'guides/mcp-rag-and-a2a' },
					],
				},
				{
					label: 'Decorators: App & Workflow',
					items: [
						{ label: '@Application', slug: 'reference/application' },
						{ label: '@Workflow', slug: 'reference/workflow' },
						{ label: '@WorkflowStart', slug: 'reference/workflow-start' },
						{ label: '@WorkflowFinish', slug: 'reference/workflow-finish' },
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
					],
				},
				{
					label: 'Decorators: Tools, Quality & DI',
					items: [
						{ label: '@Tool', slug: 'reference/tool' },
						{ label: '@BindTool', slug: 'reference/bind-tool' },
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
						{ label: '@Guardrail', slug: 'reference/guardrail' },
						{ label: '@ChannelRole', slug: 'reference/channel-role' },
						{ label: '@Channel', slug: 'reference/channel' },
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
					projectName: 'AGBoss',
					description:
						'Production-grade TypeScript application framework for LangGraph agents — @Application assembly root, compile-time Path Scope Flow DSL, constructor dependency injection by class inheritance, @ModelProvider rate limits and tenant-fair queues, @Budget FinOps caps, @PiiPolicy boundary token masking, durable multi-instance SQLite repositories with 30s leases, and deterministic testing via testWith(App) and 8 isolated unit runners.',
					details:
						'AGBoss layers strict software engineering architecture on top of LangGraph in TypeScript without vendor lock-in. Workflows are written with one chained method call per line (`start(Start).returns(Dto).toAgent(Agent).toFinish(Finish)`), DTOs are plain objects validated by class decorators, and durations/money use unit factories (`seconds()`, `minutes()`, `hours()`, `usd()`).',
					customSets: [
						{
							label: 'Core Concepts & Flow DSL',
							paths: ['getting-started/**', 'concepts/**'],
							description: 'Application assembly, Path Scope Flow DSL, decorators, and dependency injection.',
						},
						{
							label: 'Production, FinOps, Security & Testing Guides',
							paths: ['guides/**'],
							description: 'Testing with testWith and 8 unit runners, error handling and rollback, channels and two-phase pauses, FinOps budgets, PII policies, SQLite durability, Langfuse tracing, profiles, MCP, RAG, and AI coding skills.',
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
