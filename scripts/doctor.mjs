#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-only */
/* Copyright (C) 2026 Free Domain Name contributors */
/**
 * Print the facts that determine whether Cargo reuses the build cache.
 * Run this if `npm run dev` recompiles dependencies instead of taking ~1s.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcTauri = path.join(root, "src-tauri");
const expectedTarget = path.join(srcTauri, "target");
const defaultCargoHome = path.join(os.homedir(), ".cargo");

const line = (label, value) => console.log(`${label.padEnd(22)} ${value ?? "(unset)"}`);
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return (result.stdout || result.stderr || "").trim();
};

console.log("Free Domain Browser — build doctor\n");

line("node", process.version);
line("platform", `${process.platform} ${process.arch}`);
line("project", root);
line("cargo", run("cargo", ["--version"]).split("\n")[0]);
line("rustc", run("rustc", ["--version"]));

let targetDir = expectedTarget;
const metadata = spawnSync(
  "cargo",
  ["metadata", "--format-version", "1", "--no-deps", "--offline"],
  { cwd: srcTauri, encoding: "utf8" },
);
if (metadata.status === 0) {
  try {
    targetDir = JSON.parse(metadata.stdout).target_directory || expectedTarget;
  } catch {
    /* fall back to the conventional path */
  }
}

console.log("");
line("CARGO_TARGET_DIR", process.env.CARGO_TARGET_DIR);
line("cargo target dir", targetDir);
line("expected target", expectedTarget);
line("CARGO_HOME", process.env.CARGO_HOME || defaultCargoHome);
line("CARGO_INCREMENTAL", process.env.CARGO_INCREMENTAL);
line("RUSTFLAGS", process.env.RUSTFLAGS);
line("RUSTC_WRAPPER", process.env.RUSTC_WRAPPER);

const binary = path.join(targetDir, "debug", "free-domain-browser");
if (existsSync(binary)) {
  const stat = statSync(binary);
  line("debug binary", `${binary} (${stat.size.toLocaleString()} bytes)`);
  line("binary mtime", stat.mtime.toISOString());
} else {
  line("debug binary", "missing — the next build is cold");
}

const depsDir = path.join(targetDir, "debug", "deps");
if (existsSync(depsDir)) {
  const rlibs = readdirSync(depsDir).filter((name) => name.endsWith(".rlib")).length;
  line("cached rlibs", String(rlibs));
}

if (process.platform !== "win32" && existsSync(targetDir)) {
  const size = spawnSync("du", ["-sh", targetDir], { encoding: "utf8" });
  if (size.status === 0) line("target size", size.stdout.trim());
}

console.log("\nWhat makes Cargo rebuild dependencies:");
console.log("  - a different target directory (CARGO_TARGET_DIR, IDE, shell profile)");
console.log("  - a different CARGO_HOME, Rust toolchain or RUSTFLAGS");
console.log("  - a feature/profile change, or a changed Cargo.lock");
console.log("  - deleting src-tauri/target (cargo clean, disk cleaner, iCloud sync)");

const targetOverride =
  process.env.CARGO_TARGET_DIR &&
  path.resolve(root, process.env.CARGO_TARGET_DIR) !== expectedTarget;
const tempCargoHome =
  process.env.CARGO_HOME &&
  (process.env.CARGO_HOME.startsWith("/tmp/") ||
    process.env.CARGO_HOME.startsWith("/var/folders/"));

const warnings = [];
if (targetOverride) {
  warnings.push("CARGO_TARGET_DIR points somewhere else; npm run dev pins it to src-tauri/target.");
}
if (targetDir !== expectedTarget) {
  warnings.push("Cargo is not using src-tauri/target; npm run dev will pin it.");
}
if (tempCargoHome) {
  warnings.push("CARGO_HOME is a temporary directory; use a stable ~/.cargo for this project.");
}
if (process.env.RUSTFLAGS) {
  warnings.push("RUSTFLAGS is set; changing it invalidates compiled dependencies.");
}
if (!existsSync(binary)) {
  warnings.push("No debug binary yet: the first build is expected to be long.");
}

if (warnings.length > 0) {
  console.log("\nWarnings:");
  for (const warning of warnings) console.log(`  ! ${warning}`);
} else {
  console.log("\nNo target-dir or Cargo-home mismatch detected.");
}
