/**
 * Single source of truth for AGBoss release and version metadata across the website,
 * homepage installation cards, header version switcher, JSON-LD structured data, and navigation.
 *
 * Distinguishes:
 * - `sourceVersion`: version prepared in `agboss` and `agboss-cli` package manifests (`0.1.0`).
 * - `displayVersion`: truthful pre-release label (`v0.1.0-rc`) shown before `0.1.0` is published to npm.
 * - `publishedPlaceholderVersion`: initial setup placeholder currently in the npm registry (`0.0.1`).
 *
 * Flipping `isPublishedToRegistry` to `true` after `npm publish` switches the homepage
 * installation cards and badges from pre-release RC mode to live npm registry mode.
 */
export const RELEASE_META = {
	sourceVersion: '0.1.0',
	displayVersion: 'v0.1.0-rc',
	releaseChannelLabel: 'pre-release',
	softwareVersion: '0.1.0-rc',
	publishedPlaceholderVersion: '0.0.1',
	isPublishedToRegistry: false,
	frameworkRepoUrl: 'https://github.com/agbossjs/agboss',
	examplesRepoUrl: 'https://github.com/agbossjs/agboss-examples',
	preReleaseCommands: {
		packTarballs:
			'git clone https://github.com/agbossjs/agboss.git\ncd agboss && npm ci && npm run build\nnpm pack --workspaces',
		targetCliPreview:
			'# Unlocks on npm once v0.1.0 is published:\nnpx agboss create my-app\n# or: npm i agboss && npm i -D agboss-cli',
	},
	publishedCommands: {
		newProject: 'npx agboss create my-app\ncd my-app\nnpm install',
		existingProject: 'npm install agboss\nnpm install -D agboss-cli\nnpx agboss check',
	},
} as const;
