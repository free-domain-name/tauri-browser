/* global window, document, requestAnimationFrame */

/**
 * Browser chrome for the Free Domain Browser.
 *
 * Every tab owns its own iframe and history stack, so switching tabs keeps the
 * page (and its form state) alive. The Rust side owns resolution; this file only
 * renders the plan it receives:
 *
 *   navigate     -> load `url` in the tab's iframe
 *   unregistered -> show the claim page for a free .fdn name
 *   conflict     -> ask the user, then call choose_resolution
 *   unavailable  -> offer a retry or an explicit public-web fallback
 */

const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;

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
  frames: $("#frames"),
  tabs: $("#tabs"),
  newTab: $("#newTab"),
  start: $("#start"),
  claim: $("#claim"),
  claimDomain: $("#claimDomain"),
  claimPath: $("#claimPath"),
  claimJson: $("#claimJson"),
  claimRegister: $("#claimRegister"),
  claimRepo: $("#claimRepo"),
  claimRecheck: $("#claimRecheck"),
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

const REGISTRY_REPO = "https://github.com/free-domain-name/registry";

const LABELS = {
  github_registry: "GitHub Free Registry",
  public_icann: "Public ICANN Web",
  conflict: "Conflict — choose",
  unavailable: "Registry unavailable",
  unregistered: "Name available",
  idle: "Ready",
};

const state = {
  tabs: [],
  activeId: null,
  nextId: 0,
  pending: null,
  toastTimer: null,
};

let claimTarget = null;

function activeTab() {
  return state.tabs.find((tab) => tab.id === state.activeId) ?? null;
}

function tabById(id) {
  return state.tabs.find((tab) => tab.id === id) ?? null;
}

function displayFor(outcome) {
  if (
    outcome.source === "github_registry" ||
    outcome.kind === "conflict" ||
    outcome.kind === "unregistered"
  ) {
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

function focusAddress() {
  els.address.focus();
  els.address.select();
}

/* ------------------------------------------------------------------ tabs */

function createFrame(tab) {
  const frame = document.createElement("iframe");
  frame.className = "frame";
  frame.title = "Page content";
  frame.referrerPolicy = "no-referrer";
  frame.allow = "fullscreen; clipboard-read; clipboard-write";
  frame.hidden = true;
  frame.addEventListener("load", () => {
    let href = "";
    try {
      href = frame.contentWindow?.location.href ?? "";
    } catch {
      href = "cross-origin";
    }
    // Ignore the blank document we install before the real navigation.
    if (href === "about:blank") return;
    tab.loading = false;
    clearTimeout(tab.loadWatchdog);
    if (state.activeId === tab.id) setBusy(false);
    renderTabs();
  });
  els.frames.append(frame);
  return frame;
}

function newTab({ activate = true } = {}) {
  const tab = {
    id: ++state.nextId,
    title: "New tab",
    history: [],
    index: -1,
    entry: null,
    liveUrl: null,
    loading: false,
    generation: 0,
    frame: null,
  };
  tab.frame = createFrame(tab);
  state.tabs.push(tab);
  if (activate) {
    activateTab(tab.id);
  } else {
    renderTabs();
  }
  return tab;
}

function activateTab(id) {
  const tab = tabById(id);
  if (!tab) return;
  state.activeId = id;
  setBusy(Boolean(tab.loading));
  syncView();
}

function closeTab(id) {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  const [tab] = state.tabs.splice(index, 1);
  tab.frame.remove();
  if (state.tabs.length === 0) {
    newTab({ activate: true });
    return;
  }
  if (state.activeId === id) {
    const next = state.tabs[Math.min(index, state.tabs.length - 1)];
    activateTab(next.id);
  } else {
    renderTabs();
  }
}

function cycleTab(delta) {
  if (state.tabs.length < 2) return;
  const index = state.tabs.findIndex((tab) => tab.id === state.activeId);
  if (index < 0) return;
  const next = (index + delta + state.tabs.length) % state.tabs.length;
  activateTab(state.tabs[next].id);
}

function renderTabs() {
  els.tabs.textContent = "";
  for (const tab of state.tabs) {
    const tabEl = document.createElement("div");
    tabEl.className = "tab";
    tabEl.dataset.id = String(tab.id);
    tabEl.setAttribute("role", "tab");
    tabEl.setAttribute("aria-selected", tab.id === state.activeId ? "true" : "false");
    tabEl.title = tab.title || "New tab";

    const dot = document.createElement("span");
    dot.className = "tab-dot";
    dot.dataset.source = tab.entry?.source || "idle";
    tabEl.append(dot);

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title || "New tab";
    tabEl.append(title);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.dataset.close = String(tab.id);
    close.setAttribute("aria-label", "Close tab");
    close.title = "Close tab (Ctrl+W)";
    close.textContent = "×";
    tabEl.append(close);

    els.tabs.append(tabEl);
  }
  const active = els.tabs.querySelector(`.tab[data-id="${state.activeId}"]`);
  active?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function updateNav() {
  const tab = activeTab();
  els.back.disabled = !tab || tab.index <= 0;
  els.forward.disabled = !tab || tab.index >= tab.history.length - 1;
}

function syncView() {
  const tab = activeTab();
  for (const candidate of state.tabs) candidate.frame.hidden = true;
  els.start.hidden = true;
  els.claim.hidden = true;

  if (!tab || !tab.entry) {
    els.start.hidden = false;
    els.address.value = "";
    setStatus("idle");
  } else if (tab.entry.kind === "unregistered") {
    fillClaim(tab.entry);
    els.claim.hidden = false;
    els.address.value = tab.entry.display;
    setStatus("unregistered");
  } else {
    tab.frame.hidden = false;
    els.address.value = tab.entry.display;
    setStatus(tab.entry.source, LABELS[tab.entry.source]);
  }
  updateNav();
  renderTabs();
}

function pushHistory(tab, entry) {
  tab.history = tab.history.slice(0, tab.index + 1);
  tab.history.push(entry);
  tab.index = tab.history.length - 1;
}

function replaceEntry(tab, entry) {
  if (tab.index >= 0) {
    tab.history[tab.index] = entry;
  } else {
    pushHistory(tab, entry);
  }
}

function navigateFrame(tab, url) {
  if (!url) return;
  tab.loading = true;
  tab.liveUrl = url;
  if (state.activeId === tab.id) setBusy(true);

  const generation = tab.generation + 1;
  tab.generation = generation;

  // Clear first: if the next navigation fails, WebKit would otherwise leave the
  // previous document visible and make the address change look ignored.
  tab.frame.src = "about:blank";
  requestAnimationFrame(() => {
    if (tab.generation !== generation) return;
    tab.frame.src = url;
  });

  clearTimeout(tab.loadWatchdog);
  tab.loadWatchdog = setTimeout(() => {
    if (tab.generation !== generation) return;
    tab.loading = false;
    if (state.activeId === tab.id) setBusy(false);
    renderTabs();
  }, 15000);

  renderTabs();
}

function loadEntry(tab, entry) {
  tab.entry = entry;
  tab.title = entry.kind === "unregistered" ? entry.display : entry.domain || entry.display;
  tab.liveUrl = entry.kind === "navigate" ? entry.url : null;
  if (entry.kind === "navigate") {
    navigateFrame(tab, entry.url);
  } else {
    tab.loading = false;
  }
  syncView();
}

function showStart() {
  const tab = activeTab();
  if (!tab) return;
  tab.entry = null;
  tab.liveUrl = null;
  tab.loading = false;
  tab.title = "New tab";
  tab.generation += 1;
  clearTimeout(tab.loadWatchdog);
  tab.frame.src = "about:blank";
  setBusy(false);
  syncView();
}

function applyOutcome(outcome, { push = true, tab = activeTab() } = {}) {
  if (!tab) tab = newTab();
  if (!outcome || !outcome.kind) return;

  if (outcome.kind === "unregistered") {
    const entry = {
      kind: "unregistered",
      display: displayFor(outcome),
      source: "unregistered",
      domain: outcome.domain,
      path: outcome.path,
      publicUrl: outcome.public_url || null,
    };
    if (push) pushHistory(tab, entry);
    else replaceEntry(tab, entry);
    tab.entry = entry;
    tab.liveUrl = null;
    tab.loading = false;
    tab.title = outcome.domain;
    activateTab(tab.id);
    return;
  }

  if (!outcome.url) {
    toast("The resolver returned no destination URL.");
    return;
  }

  const entry = {
    kind: "navigate",
    url: outcome.url,
    display: displayFor(outcome),
    source: outcome.source,
    domain: outcome.domain,
    path: outcome.path,
    registryTarget: outcome.registry_target || null,
    publicUrl: outcome.public_url || null,
  };
  if (push) pushHistory(tab, entry);
  else replaceEntry(tab, entry);
  tab.entry = entry;
  tab.title = outcome.domain;
  activateTab(tab.id);
  navigateFrame(tab, entry.url);
}

async function navigate(raw, { tab = activeTab(), push = true } = {}) {
  const input = String(raw ?? "").trim();
  if (!input) return;
  if (!invoke) {
    toast("Tauri IPC is not available. Run the app with `npm run dev`.");
    return;
  }

  const targetTab = tab || newTab();
  setBusy(true);
  try {
    const outcome = await invoke("navigate", { input });
    if (!outcome || typeof outcome !== "object") {
      throw new Error("The resolver returned malformed data.");
    }
    if (outcome.kind === "conflict") {
      showConflict(outcome, targetTab);
    } else if (outcome.kind === "unavailable") {
      showUnavailable(outcome, targetTab);
    } else if (outcome.kind === "navigate" || outcome.kind === "unregistered") {
      applyOutcome(outcome, { tab: targetTab, push });
    } else {
      toast(outcome.message || "Unable to navigate.");
    }
  } catch (error) {
    toast(String(error));
  } finally {
    if (state.activeId === targetTab.id) setBusy(Boolean(targetTab.loading));
  }
}

/* ------------------------------------------------------------------ modal */

function showConflict(outcome, tab = activeTab()) {
  if (!tab) tab = newTab();
  state.pending = { tabId: tab.id, outcome };
  activateTab(tab.id);

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
  els.address.value = displayFor(outcome);
  setStatus("conflict");
  els.chooseRegistry.focus();
}

function showUnavailable(outcome, tab = activeTab()) {
  if (!tab) tab = newTab();
  state.pending = { tabId: tab.id, outcome };
  activateTab(tab.id);

  els.modalIcon.textContent = "!";
  els.modalIcon.style.background = "var(--danger-soft)";
  els.modalIcon.style.color = "var(--danger)";
  const freeNamespace = outcome.domain === "fdn" || outcome.domain.endsWith(".fdn");
  els.modalTitle.textContent = "Free Registry unreachable";
  els.modalBody.textContent =
    `${outcome.domain} could not be looked up in the GitHub registry. ` +
    `${outcome.message || "The registry request failed."} ` +
    (freeNamespace
      ? "Public DNS cannot answer .fdn names, so retry when the registry is reachable."
      : "Retry, or continue explicitly to the public web.");
  els.conflictChoices.hidden = true;
  els.unavailableActions.hidden = false;
  els.fallbackPublic.hidden = freeNamespace;
  els.modal.hidden = false;
  els.address.value = displayFor(outcome);
  setStatus("unavailable");
  els.retry.focus();
}

function hideModal() {
  els.modal.hidden = true;
  state.pending = null;
  syncView();
}

async function choose(choice) {
  const pending = state.pending;
  if (!pending) return;
  const tab = tabById(pending.tabId);
  state.pending = null;
  els.modal.hidden = true;
  if (!tab) {
    toast("That tab was closed.");
    syncView();
    return;
  }

  try {
    const url = await invoke("choose_resolution", {
      domain: pending.outcome.domain,
      path: pending.outcome.path,
      choice,
    });
    applyOutcome(
      {
        ...pending.outcome,
        kind: "navigate",
        source: choice === "registry" ? "github_registry" : "public_icann",
        url,
      },
      { tab, push: true },
    );
  } catch (error) {
    toast(String(error));
    syncView();
  }
}

/* ------------------------------------------------------------ navigation */

function go(delta) {
  const tab = activeTab();
  if (!tab) return;
  const next = tab.index + delta;
  if (next < 0 || next >= tab.history.length) return;
  tab.index = next;
  loadEntry(tab, tab.history[next]);
}

function refresh() {
  const tab = activeTab();
  if (!tab?.entry) return;
  if (tab.entry.kind === "unregistered") {
    recheckClaim(tab);
    return;
  }
  navigateFrame(tab, tab.liveUrl || tab.entry.url);
}

async function recheckClaim(tab) {
  const entry = tab.entry;
  if (!entry) return;
  if (invoke) {
    try {
      await invoke("clear_registry_cache");
    } catch {
      /* clearing is best-effort */
    }
  }
  await navigate(entry.domain + (entry.path === "/" ? "" : entry.path), { tab });
}

function openExternal() {
  const tab = activeTab();
  if (!tab?.entry) {
    toast("Open a page first.");
    return;
  }
  let url = "";
  if (tab.entry.kind === "unregistered") {
    url = claimUrl(tab.entry.domain);
  } else if (tab.entry.source === "public_icann") {
    url = tab.liveUrl || tab.entry.url;
  } else {
    const base = tab.entry.registryTarget || `https://${tab.entry.domain}`;
    if (tab.entry.path && tab.entry.path !== "/") {
      try {
        url = new URL(tab.entry.path, base).toString();
      } catch {
        url = base;
      }
    } else {
      url = base;
    }
  }
  invoke("open_external", { url }).catch((error) => toast(String(error)));
}

/* --------------------------------------------------------- claim page */

function shardPath(domain) {
  const slug = domain.split(".").join("").padEnd(4, "_").slice(0, 4);
  return `${slug.split("").join("/")}/${domain}.json`;
}

function claimRecord(domain) {
  return {
    domain,
    target_url: "https://example.com",
    owner_github: "your-github-handle",
    ttl: 3600,
  };
}

function claimUrl(domain) {
  const path = shardPath(domain);
  const value = `${JSON.stringify(claimRecord(domain), null, 2)}\n`;
  return (
    `${REGISTRY_REPO}/new/main` +
    `?filename=${encodeURIComponent(path)}` +
    `&value=${encodeURIComponent(value)}`
  );
}

function fillClaim(entry) {
  const domain = entry.domain;
  const path = shardPath(domain);
  claimTarget = { domain, registerUrl: claimUrl(domain), repoUrl: REGISTRY_REPO };
  els.claimDomain.textContent = domain;
  els.claimPath.textContent = path;
  els.claimJson.textContent = JSON.stringify(claimRecord(domain), null, 2);
}

/* ---------------------------------------------------------- iframe bridge */

function proxyTarget(href) {
  try {
    const url = new URL(href);
    let host = "";
    if (url.protocol === "fdn:") {
      host = url.host;
    } else if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.toLowerCase().startsWith("fdn.")
    ) {
      host = url.hostname.slice(4);
    }
    if (!host) return null;
    return { domain: host, path: `${url.pathname || "/"}${url.search}${url.hash}` };
  } catch {
    return null;
  }
}

function displayForHref(href) {
  const proxy = proxyTarget(href);
  if (proxy) {
    return `${proxy.domain}${proxy.path === "/" ? "" : proxy.path}`;
  }
  return href;
}

function onFrameMessage(event) {
  const tab = state.tabs.find((candidate) => candidate.frame.contentWindow === event.source);
  if (!tab) return;
  const data = event.data;
  if (!data || data.fdn !== "location") return;

  const href = typeof data.href === "string" ? data.href : "";
  if (!href) return;
  tab.liveUrl = href;

  const display = displayForHref(href);
  const proxy = proxyTarget(href);
  if (tab.entry && tab.entry.kind === "navigate") {
    if (proxy) {
      tab.entry.domain = proxy.domain;
      tab.entry.path = proxy.path;
      tab.entry.source = "github_registry";
      tab.entry.url = href;
    } else {
      tab.entry.source = "public_icann";
      tab.entry.url = href;
    }
    tab.entry.display = display;

    if (
      tab.id === state.activeId &&
      document.activeElement !== els.address &&
      els.modal.hidden
    ) {
      els.address.value = display;
      setStatus(tab.entry.source, LABELS[tab.entry.source]);
    }
  }

  if (typeof data.title === "string" && data.title.trim()) {
    tab.title = data.title.trim().slice(0, 80);
  }
  renderTabs();
}

/* -------------------------------------------------------------------- bind */

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

  els.newTab.addEventListener("click", () => {
    newTab({ activate: true });
    focusAddress();
  });

  els.tabs.addEventListener("click", (event) => {
    const close = event.target.closest("[data-close]");
    if (close) {
      event.stopPropagation();
      closeTab(Number(close.dataset.close));
      return;
    }
    const tabEl = event.target.closest(".tab");
    if (tabEl) activateTab(Number(tabEl.dataset.id));
  });

  els.tabs.addEventListener("auxclick", (event) => {
    if (event.button !== 1) return;
    const tabEl = event.target.closest(".tab");
    if (!tabEl) return;
    event.preventDefault();
    closeTab(Number(tabEl.dataset.id));
  });

  document.querySelectorAll(".sample").forEach((sample) => {
    sample.addEventListener("click", () => navigate(sample.dataset.url));
  });

  els.claimRegister.addEventListener("click", () => {
    if (!claimTarget) return;
    invoke("open_external", { url: claimTarget.registerUrl }).catch((error) =>
      toast(String(error)),
    );
  });

  els.claimRepo.addEventListener("click", () => {
    if (!claimTarget) return;
    invoke("open_external", { url: claimTarget.repoUrl }).catch((error) =>
      toast(String(error)),
    );
  });

  els.claimRecheck.addEventListener("click", () => {
    const tab = activeTab();
    if (tab?.entry?.kind === "unregistered") recheckClaim(tab);
  });

  els.chooseRegistry.addEventListener("click", () => choose("registry"));
  els.choosePublic.addEventListener("click", () => choose("public"));
  els.modalCancel.addEventListener("click", hideModal);
  els.modal.querySelector("[data-close]").addEventListener("click", hideModal);

  els.retry.addEventListener("click", () => {
    const pending = state.pending;
    if (!pending) return;
    const tab = tabById(pending.tabId);
    hideModal();
    if (tab) {
      navigate(
        pending.outcome.domain + (pending.outcome.path === "/" ? "" : pending.outcome.path),
        { tab },
      );
    }
  });

  els.fallbackPublic.addEventListener("click", () => {
    const pending = state.pending;
    if (!pending) return;
    const tab = tabById(pending.tabId);
    hideModal();
    if (!tab) return;
    applyOutcome(
      {
        ...pending.outcome,
        kind: "navigate",
        source: "public_icann",
        url:
          pending.outcome.public_url ||
          `https://${pending.outcome.domain}${pending.outcome.path}`,
      },
      { tab, push: true },
    );
  });

  els.address.addEventListener("focus", () => els.address.select());
  window.addEventListener("message", onFrameMessage);

  window.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (mod && key === "l") {
      event.preventDefault();
      focusAddress();
    } else if (mod && key === "t") {
      event.preventDefault();
      newTab({ activate: true });
      focusAddress();
    } else if (mod && key === "w") {
      event.preventDefault();
      closeTab(state.activeId);
    } else if (mod && key === "r") {
      event.preventDefault();
      refresh();
    } else if (event.ctrlKey && event.key === "Tab") {
      event.preventDefault();
      cycleTab(event.shiftKey ? -1 : 1);
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

async function boot() {
  bind();
  newTab({ activate: true });
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
}

boot();
