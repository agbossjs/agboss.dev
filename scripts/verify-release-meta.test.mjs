#!/usr/bin/env node
/**
 * Automated regression suite for `scripts/verify-release-meta.mjs` and `scripts/set-release-mode.mjs`.
 *
 * Covers all 6 required release-mode verification scenarios in isolated temporary roots:
 *   1. Pre-release source + stale pre-release `dist/` -> `--source` PASS.
 *   2. Published source + stale pre-release `dist/` -> `--source` PASS.
 *   3. Published source + stale pre-release `dist/` -> `--dist` FAIL.
 *   4. Published source + fresh published build -> `--source` PASS and `--dist` PASS.
 *   5. Published mode containing pre-release labels -> FAIL.
 *   6. Pre-release mode containing published-only labels -> FAIL.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyReleaseMeta } from "./verify-release-meta.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SET_MODE_SCRIPT = join(REPO_ROOT, "scripts", "set-release-mode.mjs");

const SOURCE_FILES = [
  "src/config/release.ts",
  "src/components/nav.ts",
  "src/components/Header.astro",
  "src/components/Head.astro",
  "src/components/InstallCards.astro",
  "src/content/docs/index.mdx",
  "src/content/docs/getting-started/installation.md",
  "src/content/docs/getting-started/quick-start.md",
  "src/content/docs/changelog.md",
  "src/content/docs/community.mdx",
  "src/content/docs/examples/job-scout.md",
  "SECURITY.md",
];

const DIST_HTML_FILES = [
  "dist/index.html",
  "dist/changelog/index.html",
  "dist/getting-started/installation/index.html",
  "dist/getting-started/quick-start/index.html",
];

function createFixtureRoot({ distMode }) {
  const tmpRoot = mkdtempSync(join(tmpdir(), "agboss-release-meta-test-"));
  for (const rel of SOURCE_FILES) {
    const src = join(REPO_ROOT, rel);
    const dst = join(tmpRoot, rel);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst);
  }
  if (distMode === "pre-release") {
    for (const rel of DIST_HTML_FILES) {
      const dst = join(tmpRoot, rel);
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(
        dst,
        `<!doctype html><html><body data-release-mode="pre-release"><span>v0.1.0-rc</span></body></html>`,
        "utf8",
      );
    }
  } else if (distMode === "published") {
    for (const rel of DIST_HTML_FILES) {
      const dst = join(tmpRoot, rel);
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(
        dst,
        `<!doctype html><html><body data-release-mode="published"><span>v0.1.0 (latest)</span></body></html>`,
        "utf8",
      );
    }
  }
  return tmpRoot;
}

function switchMode(root, flag) {
  execFileSync(process.execPath, [SET_MODE_SCRIPT, flag, "--root", root], {
    stdio: "pipe",
  });
}

test("Case 1: Pre-release source + stale pre-release dist/ -> --source PASS", () => {
  const root = createFixtureRoot({ distMode: "pre-release" });
  try {
    switchMode(root, "--pre-release");
    const res = verifyReleaseMeta({ root, mode: "source" });
    assert.equal(res.isPublishedToRegistry, false);
    assert.equal(res.displayVersion, "v0.1.0-rc");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Case 2: Published source + stale pre-release dist/ -> --source PASS", () => {
  const root = createFixtureRoot({ distMode: "pre-release" });
  try {
    switchMode(root, "--published");
    const res = verifyReleaseMeta({ root, mode: "source" });
    assert.equal(res.isPublishedToRegistry, true);
    assert.equal(res.displayVersion, "v0.1.0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Case 3: Published source + stale pre-release dist/ -> --dist FAIL", () => {
  const root = createFixtureRoot({ distMode: "pre-release" });
  try {
    switchMode(root, "--published");
    assert.throws(
      () => verifyReleaseMeta({ root, mode: "dist" }),
      /must render data-release-mode="published" when isPublishedToRegistry is true/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Case 4: Published source + fresh published build -> --source PASS and --dist PASS", () => {
  const root = createFixtureRoot({ distMode: "published" });
  try {
    switchMode(root, "--published");
    const srcRes = verifyReleaseMeta({ root, mode: "source" });
    assert.equal(srcRes.isPublishedToRegistry, true);
    const distRes = verifyReleaseMeta({ root, mode: "dist" });
    assert.equal(distRes.isPublishedToRegistry, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Case 5: Published mode containing pre-release labels -> FAIL", () => {
  const root = createFixtureRoot({ distMode: "published" });
  try {
    switchMode(root, "--published");
    const changelogPath = join(root, "src/content/docs/changelog.md");
    writeFileSync(
      changelogPath,
      `${readFileSync(changelogPath, "utf8")}\nLeftover v0.1.0-rc label\n`,
      "utf8",
    );
    assert.throws(
      () => verifyReleaseMeta({ root, mode: "source" }),
      /must not contain pre-release marker '0\.1\.0-rc'/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Case 6: Pre-release mode containing published-only labels -> FAIL", () => {
  const root = createFixtureRoot({ distMode: "pre-release" });
  try {
    switchMode(root, "--pre-release");
    const installPath = join(root, "src/content/docs/getting-started/installation.md");
    writeFileSync(
      installPath,
      `${readFileSync(installPath, "utf8")}\n> **Current Release (\`v0.1.0\`):** leaked published banner\n`,
      "utf8",
    );
    assert.throws(
      () => verifyReleaseMeta({ root, mode: "source" }),
      /must not contain published-only marker '\*\*Current Release \(`v0\.1\.0`\):\*\*'/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
