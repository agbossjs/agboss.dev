// Site navigation — shared by the header mega menu and the footer sitemap.
// Items without `href` render as "soon" (visible in the design, not clickable yet).

export interface NavLink {
	label: string;
	href?: string;
	note?: string;
}

export interface NavGroup {
	title?: string;
	links: NavLink[];
}

export interface NavItem {
	label: string;
	href?: string; // top-level link without a dropdown
	blurb?: string; // one line shown at the left of the dropdown panel
	groups?: NavGroup[];
	soon?: boolean;
}

export const NAV: NavItem[] = [
	{
		label: 'Why AGBoss',
		blurb: 'Why multi-agent graphs become hard to maintain at scale—and how AGBoss combines DI, typed dataflow, and static workflow verification.',
		groups: [
			{
				links: [
					{ label: 'Why AGBoss (Manifesto)', href: '/why/' },
					{ label: 'Interactive Feature Explorer', href: '/features/' },
					{ label: '7 Architectural Principles', href: '/concepts/architecture/' },
					{ label: '5-Loop Verification Funnel', href: '/concepts/verification-funnel/' },
					{ label: 'AI Coding Skills (AGENTS.md)', href: '/concepts/ai-coding-skills/' },
					{ label: 'Progressive Crystallization', href: '/concepts/progressive-crystallization/' },
					{ label: 'Digital & Physical Missions', href: '/concepts/mission-orchestration/' },
					{ label: 'About AGBoss', href: '/about/' },
				],
			},
			{
				title: 'Architecture & Patterns',
				links: [
					{ label: 'Canonical Topology & Quorums (HDSL)', href: '/concepts/workflow/' },
					{ label: 'Path-Scoped SSA Dataflow', href: '/concepts/path-scope/' },
					{ label: 'Transactional Sagas & Rollback', href: '/guides/error-handling-and-rollback/' },
					{ label: 'Multi-Instance, Leases & SQLite', href: '/guides/persistence-and-recovery/' },
					{ label: 'Channels, Pauses & Webhooks', href: '/guides/channels-and-pauses/' },
					{ label: 'Prefix Cache Invariance & PII', href: '/guides/security-and-pii/' },
				],
			},
		],
	},
	{ label: 'Architecture', href: '/concepts/architecture/' },
	{
		label: 'Learn',
		blurb: 'From an empty folder to a multi-instance, cost-capped, deterministic agent application.',
		groups: [
			{
				title: 'Getting started',
				links: [
					{ label: 'Introduction', href: '/getting-started/introduction/' },
					{ label: 'Installation', href: '/getting-started/installation/' },
					{ label: 'Quickstart', href: '/getting-started/quick-start/' },
					{ label: 'job-scout & flow-patterns', href: '/examples/job-scout/' },
					{ label: 'Changelog & releases', href: '/changelog/' },
				],
			},
			{
				title: 'Testing & Evaluation (5 Loops)',
				links: [
					{ label: '5-Loop Verification Funnel', href: '/concepts/verification-funnel/' },
					{ label: 'Loop 0–1: Unit Runners, testWith & VCR', href: '/guides/testing-agents/' },
					{ label: 'Loop 2–4: Evals, pass^k & Calibration', href: '/guides/evaluation-and-profiles/' },
					{ label: 'Loop B: Progressive Crystallization', href: '/concepts/progressive-crystallization/' },
				],
			},
			{
				title: 'Production Guides',
				links: [
					{ label: 'Parallel, quorums & child workflows', href: '/guides/parallel-quorums-and-child-workflows/' },
					{ label: 'Channels, pauses & webhooks', href: '/guides/channels-and-pauses/' },
					{ label: 'Multi-instance, leases & SQLite', href: '/guides/persistence-and-recovery/' },
					{ label: 'Error handling & rollback', href: '/guides/error-handling-and-rollback/' },
					{ label: 'FinOps & model providers', href: '/guides/finops-and-providers/' },
					{ label: 'PII policies & guardrails', href: '/guides/security-and-pii/' },
					{ label: 'Memory & compaction', href: '/guides/memory-and-compaction/' },
					{ label: 'Observability & tracing', href: '/guides/observability-and-tracing/' },
					{ label: 'MCP, RAG & A2A protocols', href: '/guides/mcp-rag-and-a2a/' },
				],
			},
		],
	},
	{
		label: 'Docs',
		blurb: 'Core concepts, HarnessDSL (HDSL) syntax, categorized decorator reference, CLI, and release notes (v0.1.0-rc).',
		groups: [
			{
				title: 'Core Concepts',
				links: [
					{ label: 'Interactive Feature Explorer', href: '/features/' },
					{ label: '7 Architectural Principles', href: '/concepts/architecture/' },
					{ label: '5-Loop Verification Funnel', href: '/concepts/verification-funnel/' },
					{ label: 'AI Coding Skills (AGENTS.md)', href: '/concepts/ai-coding-skills/' },
					{ label: 'Progressive Crystallization', href: '/concepts/progressive-crystallization/' },
					{ label: '@Application & lifecycle', href: '/concepts/application/' },
					{ label: 'Digital & Physical Missions', href: '/concepts/mission-orchestration/' },
					{ label: 'Decorators & Role Segregation', href: '/concepts/decorators/' },
					{ label: 'Workflow HDSL & Topology', href: '/concepts/workflow/' },
					{ label: 'Path Scope (SSA) & Provenance', href: '/concepts/path-scope/' },
					{ label: 'DI & Custom Overrides', href: '/concepts/dependency-injection/' },
					{ label: 'Contexts & authorization', href: '/concepts/contexts/' },
					{ label: 'Environments, secrets & units', href: '/concepts/environments/' },
				],
			},
			{
				title: 'App, Workflow & Flow Nodes',
				links: [
					{ label: '@Application', href: '/reference/application/' },
					{ label: '@Workflow', href: '/reference/workflow/' },
					{ label: '@WorkflowStart', href: '/reference/workflow-start/' },
					{ label: '@WorkflowFinish', href: '/reference/workflow-finish/' },
					{ label: '@HealthCheck', href: '/reference/health-check/' },
					{ label: '@Agent', href: '/reference/agent/' },
					{ label: '@Action', href: '/reference/action/' },
					{ label: '@Router', href: '/reference/router/' },
					{ label: '@Arbiter', href: '/reference/arbiter/' },
					{ label: '@OnAnswer', href: '/reference/on-answer/' },
					{ label: '@Compaction', href: '/reference/compaction/' },
				],
			},
			{
				title: 'Tools, Quality, DI & Governance',
				links: [
					{ label: '@Tool', href: '/reference/tool/' },
					{ label: '@BindTool', href: '/reference/bind-tool/' },
					{ label: '@ToolInterceptor', href: '/reference/tool-interceptor/' },
					{ label: '@Judge', href: '/reference/judge/' },
					{ label: '@Injectable', href: '/reference/injectable/' },
					{ label: 'DTO Field Decorators', href: '/reference/dto/' },
					{ label: '@ModelProvider', href: '/reference/model-provider/' },
					{ label: '@Budget', href: '/reference/budget/' },
					{ label: '@PiiPolicy', href: '/reference/pii-policy/' },
					{ label: '@InputGuardrail & @OutputGuardrail', href: '/reference/guardrail/' },
					{ label: '@ChannelRole', href: '/reference/channel-role/' },
					{ label: '@Channel', href: '/reference/channel/' },
					{ label: '@ReplyInterpreter', href: '/reference/reply-interpreter/' },
				],
			},
			{
				title: 'Knowledge, Protocols & CLI',
				links: [
					{ label: '@Rag', href: '/reference/rag/' },
					{ label: '@McpServer', href: '/reference/mcp/' },
					{ label: '@McpTool', href: '/reference/mcp-tool/' },
					{ label: '@McpExpose', href: '/reference/mcp-expose/' },
					{ label: '@A2AAgent', href: '/reference/a2a-agent/' },
					{ label: 'CLI (agboss)', href: '/cli/' },
					{ label: 'v0.1.0-rc Changelog', href: '/changelog/' },
				],
			},
		],
	},
	{ label: 'Roadmap', href: '/roadmap/' },
	{
		label: 'Community',
		blurb: 'Ask, contribute, follow along.',
		groups: [
			{ links: [{ label: 'Overview', href: '/community/' }] },
			{
				title: 'Join the conversation',
				links: [
					{ label: 'GitHub', href: 'https://github.com/agbossjs/agboss' },
					{ label: 'X', href: 'https://x.com/agbossjs' },
					{ label: 'LinkedIn', href: 'https://www.linkedin.com/company/agbossjs' },
					{ label: 'YouTube', href: 'https://www.youtube.com/@agbossjs' },
				],
			},
		],
	},
	{
		label: 'Enterprise',
		soon: true,
		blurb: 'Support for teams running AGBoss in production. Coming.',
		groups: [
			{ links: [{ label: 'Overview', href: '/enterprise/' }] },
			{
				title: 'Planned',
				links: [
					{ label: 'Long-term support', href: '/enterprise/#lts' },
					{ label: 'Day-0 security patches', href: '/enterprise/#patches' },
					{ label: 'Automated upgrades', href: '/enterprise/#upgrades' },
					{ label: 'Governance & compliance', href: '/enterprise/#governance' },
				],
			},
		],
	},
];
