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
		blurb: 'A Spring-style DSL for LangGraph agents: declare components, let the framework wire them.',
		groups: [
			{ links: [{ label: 'Overview', href: '/why/' }] },
			{
				title: 'Patterns',
				links: [
					{ label: 'Routing & multi-agent' },
					{ label: 'Tools & MCP' },
					{ label: 'Knowledge bases (RAG)' },
					{ label: 'Human approval' },
				],
			},
		],
	},
	{
		label: 'Learn',
		blurb: 'From an empty folder to a tested, traced agent.',
		groups: [
			{
				title: 'Getting started',
				links: [
					{ label: 'Quickstart', href: '/getting-started/quick-start/' },
					{ label: 'Installation', href: '/getting-started/installation/' },
				],
			},
			{
				title: 'Guides',
				links: [
					{ label: 'Testing agents', href: '/guides/testing-agents/' },
					{ label: 'A/B testing' },
					{ label: 'Tracing' },
					{ label: 'Cost caps' },
				],
			},
			{ title: 'Examples', links: [{ label: 'job-scout', href: '/examples/job-scout/' }] },
		],
	},
	{
		label: 'Docs',
		blurb: 'Concepts, API reference and the agb CLI.',
		groups: [
			{
				title: 'Concepts',
				links: [
					{ label: 'Introduction', href: '/getting-started/introduction/' },
					{ label: 'Decorators', href: '/concepts/decorators/' },
					{ label: 'Workflow', href: '/concepts/workflow/' },
					{ label: 'Dependency injection', href: '/concepts/dependency-injection/' },
				],
			},
			{
				title: 'Reference',
				links: [
					{ label: '@Workflow', href: '/reference/workflow/' },
					{ label: '@Agent', href: '/reference/agent/' },
					{ label: '@Router', href: '/reference/router/' },
					{ label: '@Tool', href: '/reference/tool/' },
					{ label: 'CLI (agb)', href: '/cli/' },
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
					{ label: 'GitHub', href: 'https://github.com/agbossjs' },
					{ label: 'X', href: 'https://twitter.com/agbossjs' },
					{ label: 'LinkedIn', href: 'https://www.linkedin.com/company/agbossjs' },
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
