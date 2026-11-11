#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-only */
/* Copyright (C) 2026 Free Domain Name contributors */
/**
 * Stable Tauri launcher.
 *
 * Tauri delegates to Cargo. A Cargo target directory that changes between runs
 * (CARGO_TARGET_DIR inherited from an IDE or a shell profile) makes Cargo
 * rebuild every dependency — the exact "it compiles the world every time"
 * problem. This wrapper always points Cargo at src-tauri/target and enables
 * incremental compilation for dev, while keeping every other environment
 * variable untouched.
 *
 * Usage: node scripts/tauri.mjs dev|build [...tauri args]
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = path.join(root, "src-tauri", "target");
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

if (inheritedTarget && path.resolve(root, inheritedTarget) !== targetDir) {
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
