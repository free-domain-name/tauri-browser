// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors
//
// A very small Chrome DevTools Protocol client.
//
// Node ships a WebSocket client, so the whole verification framework runs
// without installing anything. The client speaks the same protocol as the
// DevTools endpoint of the CEF build and of Chromium itself.

/** Connects to a DevTools endpoint and speaks CDP over it. */
export class CdpClient {
  #socket = null;
  #nextId = 1;
  #pending = new Map();
  #handlers = new Map();

  /** Opens the WebSocket and waits for the handshake. */
  static async connect(url) {
    const client = new CdpClient();
    await client.#open(url);
    return client;
  }

  #open(url) {
    return new Promise((resolve, reject) => {
      let socket;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        reject(new Error(`cannot open ${url}: ${error.message}`));
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error(`no answer from ${url}`));
      }, 15000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        this.#socket = socket;
        resolve();
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`cannot reach ${url}`));
      });
      socket.addEventListener("message", (event) => {
        this.#onMessage(String(event.data));
      });
    });
  }

  #onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    for (const handler of this.#handlers.get(message.method) ?? []) {
      handler(message.params);
    }
  }

  /** Sends one command and waits for its answer. */
  send(method, params = {}, sessionId = undefined) {
    if (!this.#socket) return Promise.reject(new Error("the client is closed"));
    const id = this.#nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, method });
      this.#socket.send(JSON.stringify(payload));
      setTimeout(() => {
        if (!this.#pending.has(id)) return;
        this.#pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 30000);
    });
  }

  /** Registers a listener for one protocol event. */
  on(method, handler) {
    const handlers = this.#handlers.get(method) ?? [];
    handlers.push(handler);
    this.#handlers.set(method, handlers);
  }

  /** Closes the connection. */
  close() {
    try {
      this.#socket?.close();
    } catch {
      /* The socket is going away anyway. */
    }
    this.#socket = null;
  }
}

/**
 * Waits until `probe` returns something truthy.
 *
 * `probe` may throw while the app is still starting up; that counts as "not
 * ready yet" rather than as a failure.
 */
export async function waitFor(probe, { timeout = 30000, interval = 200, what = "the app" } = {}) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  const detail = lastError ? ` (${lastError.message})` : "";
  throw new Error(`${what} did not become ready within ${timeout} ms${detail}`);
}

/** Fetches a URL and returns the parsed JSON, waiting for it to appear. */
export async function fetchJsonWhenReady(url, options = {}) {
  return waitFor(
    async () => {
      const response = await fetch(url);
      if (!response.ok) return null;
      return response.json();
    },
    { what: url, ...options },
  );
}
