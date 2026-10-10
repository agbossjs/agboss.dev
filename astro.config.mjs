// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

// https://astro.build/config
export default defineConfig({
	site: 'https://agboss.dev',
	integrations: [
		starlight({
			title: 'AGBoss',
			description: 'The application framework for LangGraph agents in TypeScript.',
			logo: {
				light: './src/assets/agboss-mark-light.svg',
				dark: './src/assets/agboss-mark-dark.svg',
				alt: 'AGBoss',
			},
			social: [
				// TODO: point at agbossjs/agboss once the framework repo is renamed/moved (ticket #167)
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/agbossjs' },
				{ icon: 'twitter', label: 'Twitter', href: 'https://twitter.com/agbossjs' },
				{ icon: 'linkedin', label: 'LinkedIn', href: 'https://www.linkedin.com/company/agbossjs' },
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
					label: 'Concepts',
					items: [
						{ label: 'Decorators', slug: 'concepts/decorators' },
						{ label: 'Workflow', slug: 'concepts/workflow' },
						{ label: 'Dependency injection', slug: 'concepts/dependency-injection' },
					],
				},
				{
					label: 'Guides',
					items: [{ autogenerate: { directory: 'guides' } }],
				},
				{
					label: 'API Reference',
					items: [{ autogenerate: { directory: 'reference' } }],
				},
				{
					label: 'CLI',
					items: [{ label: 'agb', slug: 'cli' }],
				},
				{
					label: 'Examples',
					items: [{ label: 'job-scout', slug: 'examples/job-scout' }],
				},
				{
					label: 'Roadmap',
					items: [{ label: 'Roadmap', slug: 'roadmap' }],
				},
				{
					label: 'About',
					items: [{ label: 'About AGBoss', slug: 'about' }],
				},
			],
			customCss: ['./src/styles/agboss-theme.css'],
			components: {
				ThemeSelect: './src/components/ThemeToggle.astro',
			},
			plugins: [
				starlightLlmsTxt({
					projectName: 'AGBoss',
					description: 'The application framework for LangGraph agents in TypeScript — decorator components wired into a workflow, constructor injection, build-time checks and component-level regression testing. Bring your own backend, no ecosystem lock-in.',
					details: 'AGBoss complements LangGraph rather than replacing it — it is an application framework layered on top, not a competing orchestration engine.',
					customSets: [
						{
							label: 'Examples',
							paths: ['examples/**'],
							description: 'Task-focused, runnable AGBoss examples.',
						},
					],
				}),
			],
		}),
	],
});
