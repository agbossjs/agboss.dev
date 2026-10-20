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
		blurb: 'Strictly typed TypeScript framework for mission-critical multi-agent workflows and autonomous digital & Physical AI missions on LangGraph.',
		groups: [
			{ links: [{ label: 'Overview', href: '/why/' }, { label: 'Digital & Physical Missions', href: '/concepts/mission-orchestration/' }, { label: 'About AGBoss', href: '/about/' }] },
			{
				title: 'Architecture & Patterns',
				links: [
					{ label: 'Routing, parallel & quorums', href: '/concepts/workflow/' },
					{ label: 'Transactional sagas & LIFO rollback', href: '/guides/error-handling-and-rollback/' },
					{ label: 'Tools, MCP & A2A', href: '/guides/mcp-rag-and-a2a/' },
					{ label: 'Channels & human pauses', href: '/guides/channels-and-pauses/' },
				],
			},
		],
	},
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
				],
			},
			{
				title: 'Production Guides',
				links: [
					{ label: 'Parallel, quorums & child workflows', href: '/guides/parallel-quorums-and-child-workflows/' },
					{ label: 'Memory & compaction', href: '/guides/memory-and-compaction/' },
					{ label: 'Testing & 8 unit runners', href: '/guides/testing-agents/' },
					{ label: 'Error handling & rollback', href: '/guides/error-handling-and-rollback/' },
					{ label: 'FinOps & model providers', href: '/guides/finops-and-providers/' },
					{ label: 'PII policies & guardrails', href: '/guides/security-and-pii/' },
					{ label: 'SQLite, leases & recovery', href: '/guides/persistence-and-recovery/' },
					{ label: 'Observability & tracing', href: '/guides/observability-and-tracing/' },
					{ label: 'Profiles & evaluation', href: '/guides/evaluation-and-profiles/' },
				],
			},
			{
				title: 'Examples & Releases',
				links: [
					{ label: 'job-scout & flow-patterns', href: '/examples/job-scout/' },
					{ label: 'Changelog & releases', href: '/changelog/' },
				],
			},
		],
	},
	{
		label: 'Docs',
		blurb: 'Core concepts, categorized decorator reference, CLI, and release notes (v0.0.2).',
		groups: [
			{
				title: 'Core Concepts',
				links: [
					{ label: '@Application & lifecycle', href: '/concepts/application/' },
					{ label: 'Digital & Physical Missions', href: '/concepts/mission-orchestration/' },
					{ label: 'Decorators & naming', href: '/concepts/decorators/' },
					{ label: 'Workflow DSL', href: '/concepts/workflow/' },
					{ label: 'Path Scope & provenance', href: '/concepts/path-scope/' },
					{ label: 'Dependency injection', href: '/concepts/dependency-injection/' },
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
					{ label: '@Agent', href: '/reference/agent/' },
					{ label: '@Action', href: '/reference/action/' },
					{ label: '@Router', href: '/reference/router/' },
					{ label: '@Arbiter', href: '/reference/arbiter/' },
					{ label: '@OnAnswer', href: '/reference/on-answer/' },
				],
			},
			{
				title: 'Tools, Quality, DI & Governance',
				links: [
					{ label: '@Tool', href: '/reference/tool/' },
					{ label: '@BindTool', href: '/reference/bind-tool/' },
					{ label: '@Judge', href: '/reference/judge/' },
					{ label: '@Injectable', href: '/reference/injectable/' },
					{ label: 'DTO Field Decorators', href: '/reference/dto/' },
					{ label: '@ModelProvider', href: '/reference/model-provider/' },
					{ label: '@Budget', href: '/reference/budget/' },
					{ label: '@PiiPolicy', href: '/reference/pii-policy/' },
					{ label: '@Guardrail', href: '/reference/guardrail/' },
					{ label: '@ChannelRole', href: '/reference/channel-role/' },
					{ label: '@Channel', href: '/reference/channel/' },
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
					{ label: 'v0.0.2 Changelog', href: '/changelog/' },
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
