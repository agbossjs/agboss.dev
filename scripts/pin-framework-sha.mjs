#!/usr/bin/env node
/**
 * Updates `.agboss-version.json` with a validated 40-character hexadecimal git commit SHA
 * (and optional `--branch <branch>`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_FILE = join(ROOT, ".agboss-version.json");

export function parsePinShaArgs(args) {
  let sha;
  let branch;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--sha") {
      sha = args[i + 1];
      i += 1;
    } else if (arg === "--branch") {
      branch = args[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown argument '${arg}'. Usage: node scripts/pin-framework-sha.mjs --sha <40-hex-sha> [--branch <branch>]`);
    }
  }
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(
      `Invalid or missing --sha '${sha ?? ""}'. Expected a full 40-character hexadecimal git commit SHA.`,
    );
  }
  return { sha: sha.toLowerCase(), branch };
}

function runMain() {
  const { sha, branch } = parsePinShaArgs(process.argv.slice(2));
  const current = JSON.parse(readFileSync(VERSION_FILE, "utf8"));
  const updated = {
    ...current,
    ...(branch ? { branch } : {}),
    frameworkSha: sha,
  };
  writeFileSync(VERSION_FILE, JSON.stringify(updated, null, 2) + "\n", "utf8");
  console.log(
    `[pin-framework-sha] Updated .agboss-version.json -> frameworkSha=${sha} (branch=${updated.branch})`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    runMain();
  } catch (err) {
    console.error(`[pin-framework-sha] ERROR: ${err.message}`);
    process.exit(1);
  }
}
