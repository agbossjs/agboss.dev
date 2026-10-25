/**
 * Single source of truth for AGBoss release and version metadata across the website,
 * homepage installation cards, homepage banner & hero eyebrow, header version switcher,
 * JSON-LD structured data, and navigation.
 *
 * Distinguishes:
 * - `sourceVersion`: version prepared in `agboss` and `agboss-cli` package manifests (`0.1.0`).
 * - `displayVersion`: truthful pre-release label (`v0.1.0-rc`) shown before `0.1.0` is published to npm,
 *   or `'v0.1.0'` once published.
 * - `releaseChannelLabel`: `'pre-release'` before publication, `'latest'` after publication.
 * - `softwareVersion`: `'0.1.0-rc'` before publication, `'0.1.0'` after publication.
 * - `publishedPlaceholderVersion`: initial setup placeholder currently in the npm registry (`0.0.1`).
 *
 * Switching `isPublishedToRegistry` to `true` (along with `displayVersion: 'v0.1.0'`,
 * `releaseChannelLabel: 'latest'`, `softwareVersion: '0.1.0'`) after `npm publish` updates
 * all badges, nav items, JSON-LD metadata, and homepage installation cards atomically.
 * Validated at build time by `npm run verify:release-meta`.
 */
export interface ReleaseMetaConfig {
	readonly sourceVersion: string;
	readonly displayVersion: string;
	readonly releaseChannelLabel: 'pre-release' | 'latest';
	readonly softwareVersion: string;
	readonly publishedPlaceholderVersion: string;
	readonly isPublishedToRegistry: boolean;
	readonly frameworkRepoUrl: string;
	readonly examplesRepoUrl: string;
	readonly preReleaseCommands: {
		readonly packTarballs: string;
		readonly targetCliPreview: string;
	};
	readonly publishedCommands: {
		readonly newProject: string;
		readonly existingProject: string;
	};
}

export function buildReleaseMeta(isPublishedToRegistry: boolean): ReleaseMetaConfig {
	const sourceVersion = '0.1.0';
	return {
		sourceVersion,
		displayVersion: isPublishedToRegistry ? `v${sourceVersion}` : `v${sourceVersion}-rc`,
		releaseChannelLabel: isPublishedToRegistry ? 'latest' : 'pre-release',
		softwareVersion: isPublishedToRegistry ? sourceVersion : `${sourceVersion}-rc`,
		publishedPlaceholderVersion: '0.0.1',
		isPublishedToRegistry,
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
	};
}

export const RELEASE_META: ReleaseMetaConfig = {
	...buildReleaseMeta(false),
	isPublishedToRegistry: false,
	displayVersion: 'v0.1.0-rc',
	releaseChannelLabel: 'pre-release',
	softwareVersion: '0.1.0-rc',
};
