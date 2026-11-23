// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors
//
// The harness: it starts a real browser build, attaches to it and exposes a
// handful of actions to the journey runner.
//
// Nothing here is mocked. The CEF adapter starts the actual application
// binary, which contains the actual Chromium and the actual Rust code, and
// then drives that running window through the DevTools protocol.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CdpClient, fetchJsonWhenReady, waitFor } from "./cdp.mjs";

/** The path of the browser build this machine can start. */
export function cefBinary() {
  if (process.env.FDB_CEF_BINARY) return process.env.FDB_CEF_BINARY;
  const root = "../free-domain-browser-cef/target";
  // On macOS the app must run from its bundle: the raw binary cannot find the
  // Chromium Embedded Framework and the ICU data.
  if (process.platform === "darwin") {
    return `${root}/bundle/free-domain-browser-cef.app/Contents/MacOS/free-domain-browser-cef`;
  }
  return `${root}/debug/free-domain-browser-cef`;
}

/** Starts the CEF build and attaches to its browser window. */
export async function launchCef(options = {}) {
  const binary = options.binary ?? cefBinary();
  const port = options.port ?? 9333;

  if (!existsSync(binary)) {
    throw new Error(
      `the CEF build is missing at ${binary}\n` +
        "Build it first:\n" +
        "  cd ../free-domain-browser-cef\n" +
        "  cargo build --bin free-domain-browser-cef\n" +
        "  cargo run --bin bundle -- --build-only   (macOS)\n" +
        "or point FDB_CEF_BINARY at an existing build.",
    );
  }

  const args = [`--remote-debugging-port=${port}`, "--no-sandbox"];
  // A journey may want the app to start on a specific page. Without this
  // the app starts the way a user starts it, which is what the first-launch
  // journey checks.
  if (options.url) args.push(`--url=${options.url}`);

  // Its own profile, so the run never touches the profile of the browser
  // the developer is using and can start next to it.
  const profile = mkdtempSync(path.join(tmpdir(), "fdb-verify-"));
  const child = spawn(binary, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      FDB_SETTINGS_PATH: path.join(profile, "settings.json"),
      FDB_CACHE_DIR: path.join(profile, "cache"),
    },
  });
  const log = [];
  child.stdout.on("data", (chunk) => log.push(String(chunk)));
  child.stderr.on("data", (chunk) => log.push(String(chunk)));

  let exited = false;
  child.on("exit", (code) => {
    exited = true;
    log.push(`\n[the browser exited with code ${code}]`);
  });

  const version = await fetchJsonWhenReady(`http://127.0.0.1:${port}/json/version`, {
    timeout: 30000,
    what: "the DevTools endpoint",
  }).catch((error) => {
    child.kill("SIGKILL");
    throw new Error(
      `${error.message}\nThe browser said:\n${log.join("").slice(-2000) || "(nothing)"}`,
    );
  });

  const client = await attachToChrome(port);
  return {
    name: "cef",
    version: version.Browser ?? version["User-Agent"] ?? "unknown",
    port,
    client,
    log,
    async close() {
      client.close();
      if (!exited) child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (!exited) child.kill("SIGKILL");
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/**
 * Lists the open pages of the browser.
 *
 * Every view of the application is a real page, so the list shows what the
 * user can see: the chrome, the start page, the settings and the chat.
 */
export async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  if (!response.ok) return "[]";
  const targets = await response.json();
  return JSON.stringify(
    targets.map((target) => ({
      type: target.type,
      title: target.title,
      url: target.url,
    })),
  );
}

/** Attaches to the chrome window of a running browser. */
export async function attachToChrome(port) {  const targets = await waitFor(
    async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (!response.ok) return null;
      const list = await response.json();
      return list.length ? list : null;
    },
    { timeout: 20000, what: "the browser windows" },
  );

  const target =
    targets.find((entry) => entry.type === "page" && entry.url.startsWith("data:text/html")) ??
    targets.find((entry) => entry.type === "page");
  if (!target) throw new Error("the browser did not open a window");

  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  return client;
}

/** Evaluates an expression in the attached window and returns its value. */
export async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression: `(() => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    const detail =
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.text ??
      "the evaluation failed";
    throw new Error(detail);
  }
  return result.result.value;
}

/** Clicks an element in the attached window. */
export async function click(client, selector) {
  const clicked = await evaluate(
    client,
    `const element = document.querySelector(${JSON.stringify(selector)});
     if (!element) return false;
     element.click();
     return true;`,
  );
  if (!clicked) throw new Error(`there is no element for ${selector}`);
}

/** Waits until an expression returns something truthy. */
export async function waitForExpression(client, expression, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(client, `return ${expression};`);
      if (last) return last;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`"${expression}" was still false after ${timeout} ms (last: ${last})`);
}

/** Takes a screenshot of the window and returns the PNG bytes. */
export async function screenshot(client) {
  const shot = await client.send("Page.captureScreenshot", { format: "png" });
  return Buffer.from(shot.data, "base64");
}
