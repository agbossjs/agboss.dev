/**
 * Single source of truth for AGBoss release and version metadata across the website,
 * header version switcher, JSON-LD structured data, and navigation.
 *
 * Distinguishes:
 * - `sourceVersion`: version prepared in `agboss` and `agboss-cli` package manifests (`0.1.0`).
 * - `displayVersion`: truthful pre-release label (`v0.1.0-rc`) shown before `0.1.0` is published to npm.
 * - `publishedPlaceholderVersion`: initial setup placeholder currently in the npm registry (`0.0.1`).
 */
export const RELEASE_META = {
	sourceVersion: '0.1.0',
	displayVersion: 'v0.1.0-rc',
	releaseChannelLabel: 'pre-release',
	softwareVersion: '0.1.0-rc',
	publishedPlaceholderVersion: '0.0.1',
	isPublishedToRegistry: false,
} as const;
