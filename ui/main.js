/* global window, document */

/**
 * Browser chrome for the Free Domain Browser.
 *
 * The Rust side owns resolution. This UI only renders the plan it receives:
 *
 *   navigate  -> load `url` in the content view
 *   conflict  -> ask the user, then call choose_resolution
 *   unavailable -> offer a retry or an explicit public-web fallback
 */

const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;
const listen = tauri?.event?.listen;

const $ = (selector) => document.querySelector(selector);

const els = {
  address: $("#address"),
  omnibox: $("#omnibox"),
  back: $("#back"),
  forward: $("#forward"),
  refresh: $("#refresh"),
  home: $("#home"),
  go: $("#go"),
  external: $("#external"),
  clear: $("#clear"),
  frame: $("#frame"),
  start: $("#start"),
  progress: $("#progress"),
  status: $("#status"),
  statusText: $("#statusText"),
  schemeDot: $("#schemeDot"),
  modal: $("#modal"),
  modalIcon: $("#modalIcon"),
  modalTitle: $("#modalTitle"),
  modalBody: $("#modalBody"),
  conflictChoices: $("#conflictChoices"),
  unavailableActions: $("#unavailableActions"),
  chooseRegistry: $("#chooseRegistry"),
  choosePublic: $("#choosePublic"),
  registryTarget: $("#registryTarget"),
  publicTarget: $("#publicTarget"),
  retry: $("#retry"),
  fallbackPublic: $("#fallbackPublic"),
  modalCancel: $("#modalCancel"),
  toast: $("#toast"),
};

const LABELS = {
  github_registry: "GitHub Free Registry",
  public_icann: "Public ICANN Web",
  conflict: "Conflict — choose",
  unavailable: "Registry unavailable",
  idle: "Ready",
};

const state = {
  history: [],
  index: -1,
  current: null,
  pending: null,
  toastTimer: null,
};

function displayFor(outcome) {
  if (outcome.source === "github_registry") {
    return `${outcome.domain}${outcome.path === "/" ? "" : outcome.path}`;
  }
  return outcome.url || outcome.domain;
}

function setStatus(source, text = LABELS[source] ?? "Ready") {
  els.status.dataset.source = source;
  els.statusText.textContent = text;
  els.schemeDot.dataset.source = source;
}

function setBusy(busy) {
  els.progress.hidden = !busy;
  els.go.disabled = busy;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 4200);
}

function updateNav() {
  els.back.disabled = state.index <= 0;
  els.forward.disabled = state.index >= state.history.length - 1;
}

function pushHistory(entry) {
  state.history = state.history.slice(0, state.index + 1);
  state.history.push(entry);
  state.index = state.history.length - 1;
  updateNav();
}

function showStart() {
  state.current = null;
  els.start.hidden = false;
  els.frame.hidden = true;
  els.frame.src = "about:blank";
  els.address.value = "";
  setStatus("idle");
  updateNav();
}

function loadEntry(entry) {
  state.current = entry;
  els.start.hidden = true;
  els.frame.hidden = false;
  els.frame.src = entry.url;
  els.address.value = entry.display;
  setStatus(entry.source, LABELS[entry.source]);
  updateNav();
}

function applyOutcome(outcome, { push = true } = {}) {
  if (!outcome.url) {
    toast("The resolver returned no destination URL.");
    return;
  }
  const entry = {
    url: outcome.url,
    display: displayFor(outcome),
    source: outcome.source,
    domain: outcome.domain,
    path: outcome.path,
    registryTarget: outcome.registry_target || null,
    publicUrl: outcome.public_url || null,
    kind: "navigate",
  };
  if (push) pushHistory(entry);
  else if (state.index >= 0) state.history[state.index] = entry;
  loadEntry(entry);
}

async function navigate(raw, options = {}) {
  const input = String(raw ?? "").trim();
  if (!input) return;
  if (!invoke) {
    toast("Tauri IPC is not available. Run the app with `npm run dev`.");
    return;
  }

  setBusy(true);
  try {
    const outcome = await invoke("navigate", { input });
    if (outcome.kind === "conflict") {
      showConflict(outcome);
    } else if (outcome.kind === "unavailable") {
      showUnavailable(outcome);
    } else if (outcome.kind === "navigate") {
      applyOutcome(outcome, options);
    } else {
      toast(outcome.message || "Unable to navigate.");
    }
  } catch (error) {
    toast(String(error));
  } finally {
    setBusy(false);
  }
}

function showConflict(outcome) {
  state.pending = outcome;
  els.modalIcon.textContent = "⇄";
  els.modalIcon.style.background = "var(--conflict-soft)";
  els.modalIcon.style.color = "var(--conflict)";
  els.modalTitle.textContent = "This domain exists in both places";
  els.modalBody.textContent =
    `${outcome.domain} has a record in the Free GitHub Registry and also resolves through public ICANN DNS. Which would you like to visit?`;
  els.registryTarget.textContent = outcome.registry_target || "registry destination";
  els.publicTarget.textContent = outcome.public_url || `https://${outcome.domain}`;
  els.conflictChoices.hidden = false;
  els.unavailableActions.hidden = true;
  els.modal.hidden = false;
  setStatus("conflict");
  els.chooseRegistry.focus();
}

function showUnavailable(outcome) {
  state.pending = outcome;
  els.modalIcon.textContent = "!";
  els.modalIcon.style.background = "var(--danger-soft)";
  els.modalIcon.style.color = "var(--danger)";
  els.modalTitle.textContent = "Free Registry unreachable";
  els.modalBody.textContent =
    `${outcome.domain} could not be looked up in the GitHub registry. ` +
    `${outcome.message || "The registry request failed."} ` +
    "Retry, or continue explicitly to the public web.";
  els.conflictChoices.hidden = true;
  els.unavailableActions.hidden = false;
  els.modal.hidden = false;
  setStatus("unavailable");
  els.retry.focus();
}

function hideModal() {
  els.modal.hidden = true;
  state.pending = null;
  if (state.current) {
    setStatus(state.current.source, LABELS[state.current.source]);
  } else {
    setStatus("idle");
  }
}

async function choose(choice) {
  const pending = state.pending;
  if (!pending) return;
  hideModal();
  try {
    const url = await invoke("choose_resolution", {
      domain: pending.domain,
      path: pending.path,
      choice,
    });
    applyOutcome(
      {
        ...pending,
        kind: "navigate",
        source: choice === "registry" ? "github_registry" : "public_icann",
        url,
      },
      { push: true },
    );
  } catch (error) {
    toast(String(error));
  }
}

function go(delta) {
  const next = state.index + delta;
  if (next < 0 || next >= state.history.length) return;
  state.index = next;
  loadEntry(state.history[next]);
}

function refresh() {
  if (!state.current?.url) return;
  // Re-assigning src is the only reload that works across the iframe origin.
  els.frame.src = state.current.url;
}

function openExternal() {
  if (!state.current) {
    toast("Open a page first.");
    return;
  }
  const current = state.current;
  let url = current.url;
  if (current.source !== "public_icann") {
    const base = current.registryTarget || `https://${current.domain}`;
    if (current.path && current.path !== "/") {
      try {
        url = new URL(current.path, base).toString();
      } catch {
        url = base;
      }
    } else {
      url = base;
    }
  }
  invoke("open_external", { url }).catch((error) => toast(String(error)));
}

function bind() {
  els.omnibox.addEventListener("submit", (event) => {
    event.preventDefault();
    navigate(els.address.value);
    els.address.blur();
  });

  els.back.addEventListener("click", () => go(-1));
  els.forward.addEventListener("click", () => go(1));
  els.refresh.addEventListener("click", refresh);
  els.home.addEventListener("click", showStart);
  els.external.addEventListener("click", openExternal);

  els.clear.addEventListener("click", async () => {
    try {
      await invoke("clear_registry_cache");
      toast("Registry cache cleared.");
    } catch (error) {
      toast(String(error));
    }
  });

  document.querySelectorAll(".sample").forEach((sample) => {
    sample.addEventListener("click", () => navigate(sample.dataset.url));
  });

  els.chooseRegistry.addEventListener("click", () => choose("registry"));
  els.choosePublic.addEventListener("click", () => choose("public"));
  els.modalCancel.addEventListener("click", hideModal);
  els.modal.querySelector("[data-close]").addEventListener("click", hideModal);

  els.retry.addEventListener("click", () => {
    const pending = state.pending;
    hideModal();
    if (pending) {
      navigate(pending.domain + (pending.path === "/" ? "" : pending.path));
    }
  });

  els.fallbackPublic.addEventListener("click", () => {
    const pending = state.pending;
    if (!pending) return;
    hideModal();
    applyOutcome(
      {
        ...pending,
        kind: "navigate",
        source: "public_icann",
        url: pending.public_url || `https://${pending.domain}${pending.path}`,
      },
      { push: true },
    );
  });

  els.frame.addEventListener("load", () => setBusy(false));
  els.address.addEventListener("focus", () => els.address.select());

  window.addEventListener("message", onFrameMessage);

  window.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "l") {
      event.preventDefault();
      els.address.focus();
    } else if (mod && event.key.toLowerCase() === "r") {
      event.preventDefault();
      refresh();
    } else if (event.altKey && event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1);
    } else if (event.altKey && event.key === "ArrowRight") {
      event.preventDefault();
      go(1);
    } else if (event.key === "Escape" && !els.modal.hidden) {
      hideModal();
    }
  });
}

function onFrameMessage(event) {
  if (event.source !== els.frame.contentWindow) return;
  const data = event.data;
  if (!data || data.fdn !== "location") return;

  const host = String(data.host || "").replace(/^fdn\./i, "");
  if (!host) return;
  let path = String(data.path || "/");
  if (!path.startsWith("/")) path = `/${path}`;

  if (state.current) {
    state.current = {
      ...state.current,
      kind: "navigate",
      domain: host,
      path,
      source: "github_registry",
      display: `${host}${path === "/" ? "" : path}`,
    };
    if (state.history[state.index]) {
      state.history[state.index] = state.current;
    }
  }

  els.address.value = `${host}${path === "/" ? "" : path}`;
  setStatus("github_registry");
}

async function boot() {
  bind();
  updateNav();
  setStatus("idle");

  if (!invoke) {
    toast("Run with `npm run dev` — the Tauri IPC bridge was not found.");
    return;
  }

  try {
    const info = await invoke("browser_info");
    document.title = `Free Domain Browser ${info.version}`;
    els.start.dataset.platform = info.platform;
  } catch {
    /* non-fatal */
  }

  if (listen) {
    await listen("conflict-detected", (event) => {
      const payload = event.payload;
      if (!payload || payload.kind !== "conflict") return;
      if (!els.modal.hidden) return;
      showConflict(payload);
    });
  }
}

boot();
