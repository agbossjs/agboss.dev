#!/usr/bin/env node
/**
 * Switches `agboss.dev` deterministically between `--pre-release` (`v0.1.0-rc`,
 * `isPublishedToRegistry: false`) and `--published` (`v0.1.0`, `isPublishedToRegistry: true`)
 * across `src/config/release.ts`, homepage frontmatter, quickstart/installation callouts,
 * changelog, and security policy.
 *
 * Usage:
 *   npm run release:mode -- --published
 *   npm run release:mode -- --pre-release
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const wantPublished = argv.includes("--published");
const wantPreRelease = argv.includes("--pre-release");
const rootIdx = argv.indexOf("--root");
const ROOT = rootIdx !== -1 && argv[rootIdx + 1] ? resolve(argv[rootIdx + 1]) : DEFAULT_ROOT;

if ((wantPublished && wantPreRelease) || (!wantPublished && !wantPreRelease)) {
  console.error("Usage: node scripts/set-release-mode.mjs <--published | --pre-release> [--root <dir>]");
  process.exit(1);
}

const TRANSFORMS = [
  {
    file: "src/config/release.ts",
    preRelease: [
      "\tisPublishedToRegistry: false,",
      "\tdisplayVersion: 'v0.1.0-rc',",
      "\treleaseChannelLabel: 'pre-release',",
      "\tsoftwareVersion: '0.1.0-rc',",
    ].join("\n"),
    published: [
      "\tisPublishedToRegistry: true,",
      "\tdisplayVersion: 'v0.1.0',",
      "\treleaseChannelLabel: 'latest',",
      "\tsoftwareVersion: '0.1.0',",
    ].join("\n"),
  },
  {
    file: "src/content/docs/index.mdx",
    preRelease: [
      "banner:",
      "  content: '<strong>Pre-Release v0.1.0-rc:</strong> <a href=\"#executable-proof\">Executable Path Scope Proof</a> · <a href=\"/features/\">Interactive Feature Explorer</a> · <a href=\"/examples/job-scout/\">7 Verified Examples</a> · <a href=\"/getting-started/quick-start/\">Quickstart →</a>'",
      "hero:",
      "  title: '<span class=\"hero-eyebrow\">Apache-2.0 · TypeScript · Built on LangGraph · v0.1.0-rc (pre-release)</span><span class=\"hero-headline\">Build AI agents.<br/>Verify workflows before runtime.</span>'",
    ].join("\n"),
    published: [
      "banner:",
      "  content: '<strong>New in v0.1.0:</strong> <a href=\"#executable-proof\">Executable Path Scope Proof</a> · <a href=\"/features/\">Interactive Feature Explorer</a> · <a href=\"/examples/job-scout/\">7 Verified Examples</a> · <a href=\"/getting-started/quick-start/\">Quickstart →</a>'",
      "hero:",
      "  title: '<span class=\"hero-eyebrow\">Apache-2.0 · TypeScript · Built on LangGraph · v0.1.0 (latest)</span><span class=\"hero-headline\">Build AI agents.<br/>Verify workflows before runtime.</span>'",
    ].join("\n"),
  },
  {
    file: "src/content/docs/getting-started/installation.md",
    preRelease:
      "> **Pre-Release Status (`v0.1.0-rc`):** The current repository source in [`agbossjs/agboss`](https://github.com/agbossjs/agboss) targets **`0.1.0` (`v0.1.0-rc` pre-release)**. On the public npm registry (`registry.npmjs.org`), `agboss@0.0.1` and `agboss-cli@0.0.1` are currently initial placeholder packages while `0.1.0` completes pre-release verification. Until `0.1.0` is published to npm, run the examples via [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples) (`node ./scripts/pack-framework.mjs && node ./scripts/install-packed.mjs`) or pack local tarballs from [`agbossjs/agboss`](https://github.com/agbossjs/agboss) (`npm run build && npm pack --workspaces`).",
    published:
      "> **Current Release (`v0.1.0`):** `agboss@0.1.0` and `agboss-cli@0.1.0` are published on the public npm registry (`registry.npmjs.org`). Scaffold a new project with `npx agboss create my-app` or explore the 7 verified architecture examples in [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples).",
  },
  {
    file: "src/content/docs/getting-started/quick-start.md",
    preRelease:
      "> **Pre-Release Status (`v0.1.0-rc`):** The current repository source in [`agbossjs/agboss`](https://github.com/agbossjs/agboss) targets **`0.1.0` (`v0.1.0-rc`)**, while `agboss@0.0.1` and `agboss-cli@0.0.1` on `registry.npmjs.org` are initial placeholder packages. To run a verified starter today before `0.1.0` is published to npm, clone [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples) (`node ./scripts/pack-framework.mjs && node ./scripts/install-packed.mjs && cd 01-hello-agboss`) or install local tarballs packed from [`agbossjs/agboss`](https://github.com/agbossjs/agboss).",
    published:
      "> **Current Release (`v0.1.0`):** `agboss@0.1.0` and `agboss-cli@0.1.0` are published on `registry.npmjs.org`. Run `npx agboss create my-app` to scaffold a new project or clone [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples) (`cd 01-hello-agboss && npm install`) to run the verified starter.",
  },
  {
    file: "src/content/docs/changelog.md",
    preRelease: [
      "## What is in AGBoss `v0.1.0-rc` (Pre-Release Source)",
      "",
      "> **Release status notice:** The current repository source targets **`0.1.0` (`v0.1.0-rc` pre-release)**. On the public npm registry (`registry.npmjs.org`), `agboss@0.0.1` and `agboss-cli@0.0.1` are currently initial placeholder packages while `0.1.0` completes pre-release verification. Until `0.1.0` is published to npm, build and pack tarballs from [`github.com/agbossjs/agboss`](https://github.com/agbossjs/agboss) (`make check && npm pack --workspaces`).",
      "",
      "AGBoss is organized as two Apache 2.0 packages — `agboss` (the core runtime, decorators, **HarnessDSL (`HDSL`)** flow syntax, SQLite stores, testing harness, and bundled coding-agent skills) and `agboss-cli` (the `agboss` / `agb` CLI). Key capabilities in `v0.1.0-rc` include:",
    ].join("\n"),
    published: [
      "## What is in AGBoss `v0.1.0` (Latest Release)",
      "",
      "> **Release status:** `agboss@0.1.0` and `agboss-cli@0.1.0` are published on the public npm registry (`registry.npmjs.org`) under the `latest` dist-tag.",
      "",
      "AGBoss is organized as two Apache 2.0 packages — `agboss` (the core runtime, decorators, **HarnessDSL (`HDSL`)** flow syntax, SQLite stores, testing harness, and bundled coding-agent skills) and `agboss-cli` (the `agboss` / `agb` CLI). Key capabilities in `v0.1.0` include:",
    ].join("\n"),
  },
  {
    file: "src/content/docs/changelog.md",
    preRelease: [
      "- **`0.1.0-rc` (Current Pre-Release in Source):** Full v0.1.0 framework and CLI implementation on `main` in [`agbossjs/agboss`](https://github.com/agbossjs/agboss), verified against the 7-project executable proof suite in [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples).",
      "- **`0.0.1` (Published npm Placeholder):** Initial package-name reservation currently published on `registry.npmjs.org`. Do not depend on `0.0.1` for application development; use packed `0.1.0` tarballs from source until `0.1.0` is published.",
    ].join("\n"),
    published: [
      "- **`0.1.0` (Latest Published Release):** First substantive public release of the `agboss` framework and `agboss-cli` toolkit on `registry.npmjs.org`, verified against the 7-project executable proof suite in [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples).",
      "- **`0.0.1` (Historical npm Placeholder):** Initial package-name reservation published during repository setup; superseded by `0.1.0`.",
    ].join("\n"),
  },
  {
    file: "src/content/docs/community.mdx",
    preRelease: "See what is in v0.1.0-rc and what is currently in progress.",
    published: "See what shipped in v0.1.0 and what is currently in progress.",
  },
  {
    file: "src/content/docs/examples/job-scout.md",
    preRelease:
      "> **Pre-Release Setup (`v0.1.0-rc`):** From the [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples) repository root, run `node ./scripts/pack-framework.mjs && node ./scripts/install-packed.mjs` once to build and install the `0.1.0` release-candidate tarballs into all 7 projects before running per-project commands.",
    published:
      "> **Setup (`v0.1.0`):** `agboss@0.1.0` and `agboss-cli@0.1.0` are published on `registry.npmjs.org`. Run `npm install` inside any example directory (or `node ./scripts/install-published.mjs --live-registry --version 0.1.0` from the [`agbossjs/agboss-examples`](https://github.com/agbossjs/agboss-examples) repository root) before running per-project commands.",
  },
  {
    file: "SECURITY.md",
    preRelease: "| `0.1.0-rc` (pre-release) | Yes |",
    published: "| `0.1.0` (latest) | Yes |",
  },
];

for (const item of TRANSFORMS) {
  const absPath = join(ROOT, item.file);
  const current = readFileSync(absPath, "utf8");
  const from = wantPublished ? item.preRelease : item.published;
  const to = wantPublished ? item.published : item.preRelease;

  if (current.includes(to)) {
    continue;
  }
  assert.equal(
    current.includes(from),
    true,
    `Expected snippet not found in ${item.file} when switching to ${wantPublished ? "published" : "pre-release"} mode.`,
  );
  writeFileSync(absPath, current.replace(from, to), "utf8");
}

console.log(
  `[release:mode] Switched agboss.dev to ${wantPublished ? "PUBLISHED (v0.1.0 / latest)" : "PRE-RELEASE (v0.1.0-rc / pre-release)"} mode.`,
);
