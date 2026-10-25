#!/usr/bin/env node
/**
 * Two-stage release metadata validator for `agboss.dev`:
 *   - `--source`: validates `src/config/release.ts` (`RELEASE_META`), UI components,
 *     and markdown/MDX source documents without reading or depending on `dist/`.
 *   - `--dist`: validates source metadata AND requires freshly built production HTML
 *     in `dist/` to match the active release mode with zero stale or mixed labels.
 *
 * Usage:
 *   npm run verify:release-meta -- --source
 *   npm run verify:release-meta -- --dist
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PUBLISHED_ONLY_PATTERNS = [
  "v0.1.0 (latest)",
  "<strong>New in v0.1.0:</strong>",
  "**Current Release (`v0.1.0`):**",
  "What is in AGBoss `v0.1.0` (Latest Release)",
  "**`0.1.0` (Latest Published Release):**",
  "See what shipped in v0.1.0 and what is currently in progress.",
  "> **Setup (`v0.1.0`):**",
  "| `0.1.0` (latest) | Yes |",
];

const PRE_RELEASE_ONLY_PATTERNS = [
  "0.1.0-rc",
  "Pre-Release v0.1.0-rc:",
  "Pre-Release Status (`v0.1.0-rc`):",
  "What is in AGBoss `v0.1.0-rc` (Pre-Release Source)",
  "Pre-Release Setup (`v0.1.0-rc`):",
  "| `0.1.0-rc` (pre-release) | Yes |",
];

const DOC_EXPECTATIONS = [
  {
    file: "src/content/docs/index.mdx",
    preReleaseRequired: ["Pre-Release v0.1.0-rc:", "v0.1.0-rc (pre-release)"],
    publishedRequired: ["<strong>New in v0.1.0:</strong>", "v0.1.0 (latest)"],
  },
  {
    file: "src/content/docs/getting-started/installation.md",
    preReleaseRequired: ["**Pre-Release Status (`v0.1.0-rc`):**"],
    publishedRequired: ["**Current Release (`v0.1.0`):**"],
  },
  {
    file: "src/content/docs/getting-started/quick-start.md",
    preReleaseRequired: ["**Pre-Release Status (`v0.1.0-rc`):**"],
    publishedRequired: ["**Current Release (`v0.1.0`):**"],
  },
  {
    file: "src/content/docs/changelog.md",
    preReleaseRequired: [
      "What is in AGBoss `v0.1.0-rc` (Pre-Release Source)",
      "**`0.1.0-rc` (Current Pre-Release in Source):**",
    ],
    publishedRequired: [
      "What is in AGBoss `v0.1.0` (Latest Release)",
      "**`0.1.0` (Latest Published Release):**",
    ],
  },
  {
    file: "src/content/docs/community.mdx",
    preReleaseRequired: ["See what is in v0.1.0-rc and what is currently in progress."],
    publishedRequired: ["See what shipped in v0.1.0 and what is currently in progress."],
  },
  {
    file: "src/content/docs/examples/job-scout.md",
    preReleaseRequired: ["> **Pre-Release Setup (`v0.1.0-rc`):**"],
    publishedRequired: ["> **Setup (`v0.1.0`):**"],
  },
  {
    file: "SECURITY.md",
    preReleaseRequired: ["| `0.1.0-rc` (pre-release) | Yes |"],
    publishedRequired: ["| `0.1.0` (latest) | Yes |"],
  },
];

const DIST_HTML_FILES = [
  "dist/index.html",
  "dist/changelog/index.html",
  "dist/getting-started/installation/index.html",
  "dist/getting-started/quick-start/index.html",
];

export function verifyReleaseMeta({ root = DEFAULT_ROOT, mode }) {
  assert.ok(
    mode === "source" || mode === "dist",
    "Usage: node scripts/verify-release-meta.mjs <--source | --dist> [--root <dir>]",
  );

  const releaseTs = readFileSync(join(root, "src", "config", "release.ts"), "utf8");
  const navTs = readFileSync(join(root, "src", "components", "nav.ts"), "utf8");
  const headerAstro = readFileSync(join(root, "src", "components", "Header.astro"), "utf8");
  const headAstro = readFileSync(join(root, "src", "components", "Head.astro"), "utf8");
  const installCardsAstro = readFileSync(
    join(root, "src", "components", "InstallCards.astro"),
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
    for (const doc of DOC_EXPECTATIONS) {
      const text = readFileSync(join(root, doc.file), "utf8");
      for (const req of doc.preReleaseRequired) {
        assert.equal(
          text.includes(req),
          true,
          `When isPublishedToRegistry is false, ${doc.file} must contain pre-release marker '${req}'`,
        );
      }
      for (const forbidden of PUBLISHED_ONLY_PATTERNS) {
        assert.equal(
          text.includes(forbidden),
          false,
          `When isPublishedToRegistry is false, ${doc.file} must not contain published-only marker '${forbidden}'`,
        );
      }
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
    for (const doc of DOC_EXPECTATIONS) {
      const text = readFileSync(join(root, doc.file), "utf8");
      for (const req of doc.publishedRequired) {
        assert.equal(
          text.includes(req),
          true,
          `When isPublishedToRegistry is true, ${doc.file} must contain published marker '${req}'`,
        );
      }
      for (const forbidden of PRE_RELEASE_ONLY_PATTERNS) {
        assert.equal(
          text.includes(forbidden),
          false,
          `When isPublishedToRegistry is true, ${doc.file} must not contain pre-release marker '${forbidden}' (run 'npm run release:mode -- --published')`,
        );
      }
    }
  }

  // 3. If --dist mode is requested, require built HTML in dist/ and verify consistency with active mode
  if (mode === "dist") {
    for (const relHtml of DIST_HTML_FILES) {
      const absHtml = join(root, relHtml);
      assert.equal(
        existsSync(absHtml),
        true,
        `${relHtml} is missing. Run 'npm run build' before 'npm run verify:release-meta -- --dist'.`,
      );
      const html = readFileSync(absHtml, "utf8");
      if (!isPublishedToRegistry) {
        assert.equal(
          html.includes('data-release-mode="pre-release"'),
          true,
          `${relHtml} must render data-release-mode="pre-release" when isPublishedToRegistry is false`,
        );
        assert.equal(
          html.includes('data-release-mode="published"'),
          false,
          `${relHtml} must not render data-release-mode="published" when isPublishedToRegistry is false`,
        );
        assert.equal(
          html.includes("0.1.0-rc"),
          true,
          `${relHtml} must include '0.1.0-rc' when isPublishedToRegistry is false`,
        );
        for (const forbidden of PUBLISHED_ONLY_PATTERNS) {
          assert.equal(
            html.includes(forbidden),
            false,
            `${relHtml} must not contain published-only marker '${forbidden}' when isPublishedToRegistry is false`,
          );
        }
      } else {
        assert.equal(
          html.includes('data-release-mode="published"'),
          true,
          `${relHtml} must render data-release-mode="published" when isPublishedToRegistry is true (stale dist/ detected; run 'npm run build')`,
        );
        assert.equal(
          html.includes('data-release-mode="pre-release"'),
          false,
          `${relHtml} must not render data-release-mode="pre-release" when isPublishedToRegistry is true`,
        );
        for (const forbidden of PRE_RELEASE_ONLY_PATTERNS) {
          assert.equal(
            html.includes(forbidden),
            false,
            `${relHtml} must not contain pre-release marker '${forbidden}' when isPublishedToRegistry is true`,
          );
        }
      }
    }
  }

  return {
    mode,
    isPublishedToRegistry,
    displayVersion,
    releaseChannelLabel,
    softwareVersion,
  };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const wantSource = argv.includes("--source");
  const wantDist = argv.includes("--dist");
  const rootIdx = argv.indexOf("--root");
  const root = rootIdx !== -1 && argv[rootIdx + 1] ? resolve(argv[rootIdx + 1]) : DEFAULT_ROOT;

  if ((wantSource && wantDist) || (!wantSource && !wantDist)) {
    console.error("Usage: node scripts/verify-release-meta.mjs <--source | --dist> [--root <dir>]");
    process.exit(1);
  }

  const mode = wantDist ? "dist" : "source";
  const result = verifyReleaseMeta({ root, mode });
  console.log(
    `[verify:release-meta] OK (${result.mode}) — isPublishedToRegistry=${result.isPublishedToRegistry}, displayVersion=${result.displayVersion}, releaseChannelLabel=${result.releaseChannelLabel}, softwareVersion=${result.softwareVersion}`,
  );
}
