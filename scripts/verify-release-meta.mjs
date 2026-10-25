#!/usr/bin/env node
/**
 * Validates `src/config/release.ts` (`RELEASE_META`), UI components, documentation
 * pages, and built HTML (`dist/`) so that pre-release (`v0.1.0-rc`) and published
 * (`v0.1.0`) modes remain 100% consistent with zero mixed pre-release/published labels.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const releaseTs = readFileSync(join(ROOT, "src", "config", "release.ts"), "utf8");
const navTs = readFileSync(join(ROOT, "src", "components", "nav.ts"), "utf8");
const headerAstro = readFileSync(join(ROOT, "src", "components", "Header.astro"), "utf8");
const headAstro = readFileSync(join(ROOT, "src", "components", "Head.astro"), "utf8");
const installCardsAstro = readFileSync(
  join(ROOT, "src", "components", "InstallCards.astro"),
  "utf8",
);

// 1. Ensure components import RELEASE_META and have zero hardcoded v0.1.0-rc literals
for (const [name, content] of [
  ["src/components/nav.ts", navTs],
  ["src/components/Header.astro", headerAstro],
  ["src/components/Head.astro", headAstro],
  ["src/components/InstallCards.astro", installCardsAstro],
]) {
  assert.equal(
    content.includes("RELEASE_META"),
    true,
    `${name} must reference RELEASE_META from src/config/release.ts`,
  );
  assert.equal(
    content.includes("v0.1.0-rc"),
    false,
    `${name} must not hardcode 'v0.1.0-rc'; derive version labels from RELEASE_META`,
  );
}

// 2. Parse active RELEASE_META block in src/config/release.ts
const activeBlockMatch = releaseTs.match(
  /export const RELEASE_META[\s\S]*?=\s*\{([\s\S]*?)\};/,
);
assert.ok(
  activeBlockMatch,
  "Could not locate `export const RELEASE_META = { ... };` in src/config/release.ts",
);
const activeBlock = activeBlockMatch[1];

const isPublishedMatch = activeBlock.match(/isPublishedToRegistry:\s*(true|false)/);
const displayVerMatch = activeBlock.match(/displayVersion:\s*['"]([^'"]+)['"]/);
const channelMatch = activeBlock.match(/releaseChannelLabel:\s*['"]([^'"]+)['"]/);
const softwareVerMatch = activeBlock.match(/softwareVersion:\s*['"]([^'"]+)['"]/);

assert.ok(isPublishedMatch, "RELEASE_META missing explicit isPublishedToRegistry boolean");
assert.ok(displayVerMatch, "RELEASE_META missing explicit displayVersion string");
assert.ok(channelMatch, "RELEASE_META missing explicit releaseChannelLabel string");
assert.ok(softwareVerMatch, "RELEASE_META missing explicit softwareVersion string");

const isPublishedToRegistry = isPublishedMatch[1] === "true";
const displayVersion = displayVerMatch[1];
const releaseChannelLabel = channelMatch[1];
const softwareVersion = softwareVerMatch[1];

const DOC_FILES = [
  "src/content/docs/index.mdx",
  "src/content/docs/getting-started/installation.md",
  "src/content/docs/getting-started/quick-start.md",
  "src/content/docs/changelog.md",
  "src/content/docs/community.mdx",
  "src/content/docs/examples/job-scout.md",
  "SECURITY.md",
];

if (!isPublishedToRegistry) {
  assert.equal(
    displayVersion,
    "v0.1.0-rc",
    `When isPublishedToRegistry is false, displayVersion must be 'v0.1.0-rc' (found '${displayVersion}')`,
  );
  assert.equal(
    releaseChannelLabel,
    "pre-release",
    `When isPublishedToRegistry is false, releaseChannelLabel must be 'pre-release' (found '${releaseChannelLabel}')`,
  );
  assert.equal(
    softwareVersion,
    "0.1.0-rc",
    `When isPublishedToRegistry is false, softwareVersion must be '0.1.0-rc' (found '${softwareVersion}')`,
  );
  for (const relPath of DOC_FILES) {
    const text = readFileSync(join(ROOT, relPath), "utf8");
    assert.equal(
      text.includes("0.1.0-rc"),
      true,
      `When isPublishedToRegistry is false, ${relPath} must reflect pre-release status ('0.1.0-rc')`,
    );
  }
} else {
  assert.equal(
    displayVersion,
    "v0.1.0",
    `When isPublishedToRegistry is true, displayVersion must be 'v0.1.0' with no '-rc' suffix (found '${displayVersion}')`,
  );
  assert.equal(
    releaseChannelLabel,
    "latest",
    `When isPublishedToRegistry is true, releaseChannelLabel must be 'latest' (found '${releaseChannelLabel}')`,
  );
  assert.equal(
    softwareVersion,
    "0.1.0",
    `When isPublishedToRegistry is true, softwareVersion must be '0.1.0' with no '-rc' suffix (found '${softwareVersion}')`,
  );
  for (const relPath of DOC_FILES) {
    const text = readFileSync(join(ROOT, relPath), "utf8");
    assert.equal(
      text.includes("0.1.0-rc"),
      false,
      `When isPublishedToRegistry is true, ${relPath} must not contain '0.1.0-rc' (run 'npm run release:mode -- --published')`,
    );
  }
}

// 3. If dist/index.html has been built, verify the rendered HTML matches the active mode with no mixed labels
const distIndexPath = join(ROOT, "dist", "index.html");
if (existsSync(distIndexPath)) {
  const html = readFileSync(distIndexPath, "utf8");
  if (!isPublishedToRegistry) {
    assert.equal(
      html.includes('data-release-mode="pre-release"'),
      true,
      'dist/index.html must render data-release-mode="pre-release" when isPublishedToRegistry is false',
    );
    assert.equal(
      html.includes("v0.1.0-rc"),
      true,
      "dist/index.html must display v0.1.0-rc when isPublishedToRegistry is false",
    );
  } else {
    assert.equal(
      html.includes('data-release-mode="published"'),
      true,
      'dist/index.html must render data-release-mode="published" when isPublishedToRegistry is true',
    );
    assert.equal(
      html.includes("v0.1.0-rc"),
      false,
      "dist/index.html must not contain any 'v0.1.0-rc' labels when isPublishedToRegistry is true",
    );
  }
}

console.log(
  `[verify:release-meta] OK — isPublishedToRegistry=${isPublishedToRegistry}, displayVersion=${displayVersion}, releaseChannelLabel=${releaseChannelLabel}, softwareVersion=${softwareVersion}`,
);
