#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors
//
// The verification runner.
//
// It reads the journeys from the journeys folder, starts the real browser
// build, walks every journey and reports what passed and what did not.
//
//   node verification/run.mjs                 every journey
//   node verification/run.mjs first-launch    one journey
//   node verification/run.mjs --list          the names of the journeys
//
// The exit code is 0 when every step passed and 1 when anything failed.

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { launchCef, evaluate, click, waitForExpression, screenshot, listTargets } from "./lib/harness.mjs";
import { check } from "./lib/assert.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const journeysDir = path.join(here, "journeys");
const artifactsDir = path.join(here, "artifacts");

const args = process.argv.slice(2);
if (args.includes("--list")) {
  for (const file of await journeyFiles()) {
    const spec = JSON.parse(await readFile(file, "utf8"));
    console.log(`${spec.name.padEnd(22)} ${spec.description ?? ""}`);
  }
  process.exit(0);
}

const wanted = args.filter((arg) => !arg.startsWith("-"));
const results = [];

for (const file of await journeyFiles()) {
  const spec = JSON.parse(await readFile(file, "utf8"));
  if (wanted.length && !wanted.includes(spec.name)) continue;

  console.log(`\n${spec.name} — ${spec.description ?? ""}`);
  const harness = await launchCef({ url: spec.startUrl });
  try {
    for (const step of spec.steps) {
      const description = step.why ?? step.do;
      try {
        await runStep(harness, step);
        results.push({ journey: spec.name, step: description, ok: true });
        console.log(`  ok    ${description}`);
      } catch (error) {
        results.push({ journey: spec.name, step: description, ok: false, error: error.message });
        console.log(`  FAIL  ${description}`);
        console.log(`        ${error.message}`);
        const shot = await screenshot(harness.client).catch(() => null);
        if (shot) {
          await mkdir(artifactsDir, { recursive: true });
          const file_name = `${spec.name}-${results.length}.png`;
          await writeFile(path.join(artifactsDir, file_name), shot);
          console.log(`        screenshot: verification/artifacts/${file_name}`);
        }
        break;
      }
    }
  } finally {
    await harness.close();
  }
}

async function journeyFiles() {
  const names = await readdir(journeysDir);
  return names.filter((name) => name.endsWith(".json")).sort().map((name) => path.join(journeysDir, name));
}

/** Runs one step of a journey. */
async function runStep(harness, step) {
  switch (step.do) {
    case "evaluate": {
      const value = await evaluate(harness.client, step.expression);
      if (step.expect) check(value, step.expect, step.why ?? "the value");
      return value;
    }
    case "click": {
      await click(harness.client, step.selector);
      if (step.expect) {
        const value = await evaluate(harness.client, step.expression ?? "return true;");
        check(value, step.expect, step.why ?? "the click");
      }
      return true;
    }
    case "waitFor": {
      await waitForExpression(harness.client, step.expression, step.timeout ?? 10000);
      if (step.expect) {
        const value = await evaluate(harness.client, step.expression);
        check(value, step.expect, step.why ?? "the wait");
      }
      return true;
    }
    case "waitForSelector": {
      await waitForExpression(
        harness.client,
        `!!document.querySelector(${JSON.stringify(step.selector)})`,
        step.timeout ?? 10000,
      );
      return true;
    }
    case "type": {
      const typed = await evaluate(
        harness.client,
        `const element = document.querySelector(${JSON.stringify(step.selector)});
         if (!element) return false;
         element.focus();
         element.value = ${JSON.stringify(step.text ?? "")};
         element.dispatchEvent(new Event("input", { bubbles: true }));
         ${step.press === false ? "" : 'element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));'}
         return true;`,
      );
      if (!typed) throw new Error(`there is no element for ${step.selector}`);
      return true;
    }
    case "pause": {
      await new Promise((resolve) => setTimeout(resolve, step.ms ?? 300));
      return true;
    }
    case "targets": {
      // A page takes a moment to open, so the check waits for it.
      const deadline = Date.now() + (step.timeout ?? 5000);
      let list = "";
      let problem = null;
      while (Date.now() < deadline) {
        list = await listTargets(harness.port);
        try {
          if (step.expect) check(list, step.expect, step.why ?? "the open pages");
          problem = null;
          break;
        } catch (error) {
          problem = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (problem) throw problem;
      return list;
    }
    case "screenshot": {
      await mkdir(artifactsDir, { recursive: true });
      const name = step.name ?? "shot";
      await writeFile(path.join(artifactsDir, `${name}.png`), await screenshot(harness.client));
      return true;
    }
    default:
      throw new Error(`unknown step "${step.do}"`);
  }
}

const failed = results.filter((result) => !result.ok);
console.log(
  `\n${results.length - failed.length} of ${results.length} steps passed` +
    (failed.length ? `, ${failed.length} failed` : ""),
);
process.exit(failed.length ? 1 : 0);
