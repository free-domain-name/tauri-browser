#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-only */
/* Copyright (C) 2026 Free Domain Name contributors */
/**
 * Stable Tauri launcher.
 *
 * Tauri delegates to Cargo. A Cargo target directory that changes between runs
 * (CARGO_TARGET_DIR inherited from an IDE or a shell profile) makes Cargo
 * rebuild every dependency — the exact "it compiles the world every time"
 * problem. This wrapper points Cargo at src-tauri/target whenever the
 * inherited value would land somewhere else, and leaves every other
 * environment variable untouched.
 *
 * Usage: node scripts/tauri.mjs dev|build [...tauri args]
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcTauri = path.join(root, "src-tauri");
const targetDir = path.join(srcTauri, "target");
const cli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const args = process.argv.slice(2);
const command = args[0] ?? "";

if (!existsSync(cli)) {
  console.error(
    "Tauri CLI not found. Run `npm install` first (expected at node_modules/@tauri-apps/cli/tauri.js).",
  );
  process.exit(1);
}

if (!command) {
  console.error("Usage: node scripts/tauri.mjs <dev|build|android|...> [...args]");
  process.exit(1);
}

const env = { ...process.env };
const inheritedTarget = env.CARGO_TARGET_DIR;

// Cargo resolves a relative CARGO_TARGET_DIR against the directory it runs
// in, and the Tauri CLI runs Cargo inside src-tauri. Resolving it against the
// repository root would compare the wrong path and pin the target dir even
// when Cargo would have used the very same directory.
const inheritedTargetPath = inheritedTarget
  ? path.resolve(srcTauri, inheritedTarget)
  : null;

if (inheritedTargetPath && inheritedTargetPath !== targetDir) {
  // Only correct a target dir that would fragment the cache. Leaving an unset
  // CARGO_TARGET_DIR alone is important: setting it explicitly can itself
  // invalidate Cargo's fingerprints for one rebuild.
  console.warn(
    `[cache] ignoring CARGO_TARGET_DIR=${inheritedTarget}; using ${targetDir} so the cache stays warm.`,
  );
  env.CARGO_TARGET_DIR = targetDir;
}

const child = spawn(process.execPath, [cli, ...args], {
  cwd: root,
  env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error(`Failed to start the Tauri CLI: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
