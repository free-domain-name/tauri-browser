/* SPDX-License-Identifier: GPL-3.0-only */
/* Copyright (C) 2026 Free Domain Name contributors */

/* global window, document, requestAnimationFrame */

/**
 * Browser chrome for the Free Domain Browser.
 *
 * Every tab owns its own page view and history stack, so switching tabs keeps
 * the page (and its form state) alive. On desktop the view is a native child
 * webview, because sites that send `frame-ancestors` refuse to render in an
 * iframe; mobile keeps the iframe. The Rust side owns resolution and the
 * native views; this file only renders the plan it receives:
 *
 *   navigate     -> load `url` in the tab's view
 *   unregistered -> show the claim page for a name absent everywhere
 *   conflict     -> ask the user, then call choose_resolution
 *   unavailable  -> offer a retry or an explicit public-web fallback
 */

const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;
const appearance = window.FDN_APPEARANCE;

const $ = (selector) => document.querySelector(selector);

const els = {
  address: $("#address"),
  omnibox: $("#omnibox"),
  back: $("#back"),
  forward: $("#forward"),
  refresh: $("#refresh"),
  home: $("#home"),
  go: $("#go"),
  review: $("#review"),
  reviewUp: $("#reviewUp"),
  reviewDown: $("#reviewDown"),
  reviewUpCount: $("#reviewUpCount"),
  reviewDownCount: $("#reviewDownCount"),
  external: $("#external"),
  clear: $("#clear"),
  chatToggle: $("#chatToggle"),
  chatPanel: $("#chatPanel"),
  chatDot: $("#chatDot"),
  chatRoomLabel: $("#chatRoomLabel"),
  chatClose: $("#chatClose"),
  chatSettingsBtn: $("#chatSettingsBtn"),
  chatError: $("#chatError"),
  chatAge: $("#chatAge"),
  chatAgeCheck: $("#chatAgeCheck"),
  chatAgeConfirm: $("#chatAgeConfirm"),
  chatMain: $("#chatMain"),
  chatOnline: $("#chatOnline"),
  chatUsersBtn: $("#chatUsersBtn"),
  chatUsers: $("#chatUsers"),
  chatMessages: $("#chatMessages"),
  chatComposer: $("#chatComposer"),
  chatText: $("#chatText"),
  chatCount: $("#chatCount"),
  chatSend: $("#chatSend"),
  chatSettingsLink: $("#chatSettingsLink"),
  chatSettingsView: $("#chatSettingsView"),
  chatSettingsBack: $("#chatSettingsBack"),
  chatNickname: $("#chatNickname"),
  chatNicknameSave: $("#chatNicknameSave"),
  chatFingerprint: $("#chatFingerprint"),
  chatRelay: $("#chatRelay"),
  chatRoomId: $("#chatRoomId"),
  chatIgnoreList: $("#chatIgnoreList"),
  chatIgnoreEmpty: $("#chatIgnoreEmpty"),
  chatClear: $("#chatClear"),
  settings: $("#settings"),
  settingsMenu: $("#settingsMenu"),
  settingsClose: $("#settingsClose"),
  settingsReset: $("#settingsReset"),
  skinSelect: $("#skinSelect"),
  skinHint: $("#skinHint"),
  skinCss: $("#skinCss"),
  applyCss: $("#applyCss"),
  clearCss: $("#clearCss"),
  frames: $("#frames"),
  tabs: $("#tabs"),
  tabstrip: $(".tabstrip"),
  toolbar: $(".toolbar"),
  newTab: $("#newTab"),
  start: $("#start"),
  claim: $("#claim"),
  claimBadge: $("#claimBadge"),
  claimDomain: $("#claimDomain"),
  claimMessage: $("#claimMessage"),
  claimPath: $("#claimPath"),
  claimJson: $("#claimJson"),
  claimRegister: $("#claimRegister"),
  claimCopy: $("#claimCopy"),
  claimRepo: $("#claimRepo"),
  claimRecheck: $("#claimRecheck"),
  progress: $("#progress"),
  status: $("#status"),
  statusText: $("#statusText"),
  statusUrl: $("#statusUrl"),
  statusMode: $("#statusMode"),
  statusbar: $("#statusbar"),
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
  notice: $("#notice"),
  viewport: $(".viewport"),
};

const REGISTRY_REPO = "https://github.com/free-domain-name/registry";
const REVIEW_INDEX_URL =
  "https://raw.githubusercontent.com/free-domain-name/registry/main/reviews/index.json";
const STUMBLE_URL = "https://free-domain-name.github.io/tauri-browser/stumble.html";

const SKIN_META = {
  default: { label: "Default", hint: "The original clean chrome." },
  "high-tech": {
    label: "High-Tech",
    hint: "Graphite panels, cyan instruments and a squared-off HUD.",
  },
  futuristic: {
    label: "Futuristic",
    hint: "Violet glass, neon edges and a soft nebula start page.",
  },
  historic: {
    label: "Historic",
    hint: "Parchment, sepia ink and an old-style serif.",
  },
  victorian: {
    label: "Victorian",
    hint: "Dusty rose, oxblood rules and gold botanical ornament.",
  },
  amazon: {
    label: "Amazon",
    hint: "Rainforest greens, clay and river-blue accents.",
  },
  terminal: {
    label: "Terminal",
    hint: "Phosphor CRT, monospace type and subtle scanlines.",
  },
};

const LABELS = {
  github_registry: "Registry",
  public_icann: "Public web",
  conflict: "Conflict",
  unavailable: "Unavailable",
  unregistered: "Available",
  idle: "Ready",
};

const LABEL_HINTS = {
  github_registry: "Resolved through the GitHub Free Registry",
  public_icann: "Loaded directly from the public web (ICANN DNS)",
  conflict: "Exists in both the registry and public DNS",
  unavailable: "The GitHub Free Registry could not be reached",
  unregistered: "Not registered and not present in public DNS",
  idle: "Ready",
};

const state = {
  tabs: [],
  contentMode: "iframe",
  layoutFrame: 0,
  layoutRetry: false,
  lastCommand: { name: "", at: 0 },
  activeId: null,
  nextId: 0,
  pending: null,
  toastTimer: null,
  reviewIndex: null,
  reviewIndexPromise: null,
  reviewDomain: null,
  chat: {
    enabledTabs: new Set(),
    snapshot: null,
    panelOpen: false,
    settingsOpen: false,
    usersOpen: false,
    sending: false,
    cooldownUntil: 0,
    cooldownTimer: null,
    error: "",
    clearArmed: false,
    clearTimer: null,
    unlisten: [],
  },
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
  els.status.title = LABEL_HINTS[source] ?? text;
  els.schemeDot.dataset.source = source;
}

function setStatusDetail(text) {
  if (els.statusUrl) els.statusUrl.textContent = text || "";
  if (els.statusUrl) els.statusUrl.title = text || "";
}

function setBusy(busy) {
  els.progress.hidden = !busy;
  els.go.disabled = busy;
}


/* ------------------------------------------------------------- community chat */

function chatTabId() {
  return state.activeId === null ? null : String(state.activeId);
}

function chatEnabledHere() {
  const id = chatTabId();
  return Boolean(id && state.chat.enabledTabs.has(id));
}

function setChatError(error) {
  if (!error) {
    state.chat.error = "";
    return;
  }
  state.chat.error =
    typeof error === "string" ? error : error?.message || String(error);
}

async function ensureChatSnapshot(force = false) {
  if (state.chat.snapshot && !force) return state.chat.snapshot;
  if (!invoke) return null;
  try {
    state.chat.snapshot = await invoke("chat_snapshot");
    setChatError(state.chat.snapshot?.error || "");
  } catch (error) {
    setChatError(error);
  }
  return state.chat.snapshot;
}

function syncChatToActiveTab() {
  const enabled = chatEnabledHere();
  els.chatToggle.setAttribute("aria-pressed", enabled ? "true" : "false");
  els.chatToggle.setAttribute("aria-expanded", String(state.chat.panelOpen));
  if (!enabled) {
    state.chat.panelOpen = false;
    state.chat.settingsOpen = false;
    els.chatPanel.hidden = true;
    layoutContent();
    return;
  }
  state.chat.panelOpen = true;
  els.chatPanel.hidden = false;
  renderChat();
  layoutContent();
}

function openChatPanel() {
  state.chat.panelOpen = true;
  els.chatPanel.hidden = false;
  els.chatToggle.setAttribute("aria-expanded", "true");
  renderChat();
  layoutContent();
}

function hideChatPanel() {
  state.chat.panelOpen = false;
  state.chat.settingsOpen = false;
  els.chatPanel.hidden = true;
  els.chatToggle.setAttribute("aria-expanded", "false");
  layoutContent();
}

async function toggleChat() {
  const id = chatTabId();
  if (!id) return;

  if (state.chat.panelOpen && state.chat.enabledTabs.has(id)) {
    await disableChat(id, { close: true });
    return;
  }
  if (state.chat.enabledTabs.has(id)) {
    openChatPanel();
    return;
  }

  openChatPanel();
  const snapshot = await ensureChatSnapshot();
  if (!snapshot) {
    renderChat();
    return;
  }
  if (!snapshot.age_confirmed) {
    renderChat();
    return;
  }
  await enableChat(id);
}

async function enableChat(id) {
  if (!invoke) {
    setChatError("The Tauri IPC bridge was not found.");
    renderChat();
    return;
  }
  try {
    const snapshot = await invoke("chat_set_enabled", { tabId: id, enabled: true });
    state.chat.snapshot = snapshot;
    state.chat.enabledTabs.add(id);
    state.chat.panelOpen = true;
    state.chat.error = "";
    els.chatPanel.hidden = false;
    renderChat();
  } catch (error) {
    setChatError(error);
    renderChat();
  }
}

async function disableChat(id, { close = false } = {}) {
  state.chat.enabledTabs.delete(id);
  if (invoke) {
    try {
      state.chat.snapshot = await invoke("chat_set_enabled", { tabId: id, enabled: false });
    } catch (error) {
      setChatError(error);
    }
  }
  if (close && chatTabId() === id) {
    hideChatPanel();
  } else if (!chatEnabledHere()) {
    hideChatPanel();
  }
  renderChat();
}

async function closeChat() {
  const id = chatTabId();
  if (id && state.chat.enabledTabs.has(id)) {
    await disableChat(id, { close: true });
  } else {
    hideChatPanel();
  }
}

async function confirmChatAge() {
  if (!els.chatAgeCheck.checked || !invoke) return;
  try {
    state.chat.snapshot = await invoke("chat_confirm_age");
    setChatError("");
    const id = chatTabId();
    if (id) await enableChat(id);
  } catch (error) {
    setChatError(error);
    renderChat();
  }
}

function chatCooldownLeft() {
  return Math.max(0, state.chat.cooldownUntil - Date.now());
}

function scheduleChatCooldown() {
  if (state.chat.cooldownTimer) {
    clearTimeout(state.chat.cooldownTimer);
    state.chat.cooldownTimer = null;
  }
  const left = chatCooldownLeft();
  if (left <= 0) return;
  state.chat.cooldownTimer = setTimeout(() => {
    state.chat.cooldownTimer = null;
    renderChat();
  }, left + 20);
}

function updateChatCount() {
  const count = [...els.chatText.value].length;
  els.chatCount.textContent = `${count} / 500`;
}

function updateChatComposer(snapshot) {
  const left = chatCooldownLeft();
  const connected = Boolean(snapshot?.connected);
  const blocked = !connected || state.chat.sending || left > 0;
  els.chatSend.disabled = blocked;
  els.chatText.disabled = !connected;
  if (state.chat.sending) {
    els.chatSend.textContent = "Sending…";
  } else if (left > 0) {
    els.chatSend.textContent = `Wait ${Math.ceil(left / 1000)}s`;
  } else {
    els.chatSend.textContent = "Send";
  }
  els.chatText.placeholder = connected
    ? "Message the General lobby"
    : "Connecting to the lobby…";
  updateChatCount();
  if (left > 0) scheduleChatCooldown();
}

async function sendChat() {
  const text = els.chatText.value.trim();
  const snapshot = state.chat.snapshot;
  if (!text || !snapshot?.connected || state.chat.sending || chatCooldownLeft() > 0) {
    return;
  }
  if (!invoke) return;

  state.chat.sending = true;
  updateChatComposer(snapshot);
  try {
    await invoke("chat_send", { text });
    els.chatText.value = "";
    state.chat.cooldownUntil = Date.now() + Math.max(5000, snapshot.cooldown_ms || 0);
    setChatError("");
  } catch (error) {
    setChatError(error);
  } finally {
    state.chat.sending = false;
    renderChat();
  }
}

async function ignoreChatSender(sender) {
  if (!invoke) return;
  try {
    state.chat.snapshot = await invoke("chat_ignore", { sender });
    renderChat();
  } catch (error) {
    setChatError(error);
    renderChat();
  }
}

async function unignoreChatSender(sender) {
  if (!invoke) return;
  try {
    state.chat.snapshot = await invoke("chat_unignore", { sender });
    renderChat();
  } catch (error) {
    setChatError(error);
    renderChat();
  }
}

async function saveChatNickname() {
  if (!invoke) return;
  const nickname = els.chatNickname.value.trim();
  try {
    state.chat.snapshot = await invoke("chat_set_nickname", { nickname });
    setChatError("");
    renderChat();
    toast("Nickname saved.");
  } catch (error) {
    setChatError(error);
    renderChat();
  }
}

function renderChatMessages(snapshot) {
  const messages = snapshot.messages || [];
  const atBottom =
    els.chatMessages.scrollHeight -
      els.chatMessages.scrollTop -
      els.chatMessages.clientHeight <
    48;
  els.chatMessages.textContent = "";

  if (messages.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = snapshot.connected
      ? "No messages yet. Say hello to the lobby."
      : "Connecting to the lobby…";
    els.chatMessages.append(empty);
    return;
  }

  for (const message of messages) {
    const article = document.createElement("article");
    article.className = "chat-message";
    article.dataset.mine = message.mine ? "true" : "false";

    const head = document.createElement("div");
    head.className = "chat-message-head";

    const name = document.createElement("span");
    name.className = "chat-message-name";
    name.textContent = message.nickname || "anon";
    head.append(name);

    const fp = document.createElement("span");
    fp.className = "chat-message-fp";
    fp.textContent = `#${message.fingerprint || "????"}`;
    head.append(fp);

    const time = document.createElement("time");
    time.className = "chat-message-time";
    time.dateTime = new Date(message.timestamp).toISOString();
    time.textContent = new Date(message.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    head.append(time);

    if (!message.mine) {
      const ignore = document.createElement("button");
      ignore.type = "button";
      ignore.className = "chat-message-ignore";
      ignore.dataset.ignore = message.sender;
      ignore.title = `Ignore ${message.nickname || "this person"}`;
      ignore.textContent = "Ignore";
      head.append(ignore);
    }

    const text = document.createElement("p");
    text.className = "chat-message-text";
    text.textContent = message.text;

    article.append(head, text);
    els.chatMessages.append(article);
  }

  if (atBottom || snapshot.messages?.at(-1)?.mine) {
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }
}

function renderChatUsers(snapshot) {
  els.chatUsersBtn.setAttribute("aria-expanded", String(state.chat.usersOpen));
  els.chatUsers.hidden = !state.chat.usersOpen;
  if (!state.chat.usersOpen) return;

  els.chatUsers.textContent = "";
  const users = snapshot.users || [];
  if (users.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chat-fine";
    empty.textContent = "Nobody has announced presence yet.";
    els.chatUsers.append(empty);
    return;
  }

  for (const user of users) {
    const row = document.createElement("div");
    row.className = "chat-user";
    row.dataset.ignored = String(Boolean(user.ignored));

    const name = document.createElement("span");
    name.className = "chat-user-name";
    const strong = document.createElement("strong");
    strong.textContent = user.nickname || "anon";
    name.append(strong);
    if (user.is_me) {
      const you = document.createElement("span");
      you.className = "chat-user-fp";
      you.textContent = "(you)";
      name.append(you);
    }
    const fp = document.createElement("span");
    fp.className = "chat-user-fp";
    fp.textContent = `#${user.fingerprint || "????"}`;
    name.append(fp);
    row.append(name);

    if (!user.is_me) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "chat-user-action";
      action.dataset[user.ignored ? "unignore" : "ignore"] = user.sender;
      action.textContent = user.ignored ? "Unignore" : "Ignore";
      row.append(action);
    }
    els.chatUsers.append(row);
  }
}

function renderChatSettings(snapshot) {
  if (document.activeElement !== els.chatNickname) {
    els.chatNickname.value = snapshot.nickname || "anon";
  }
  els.chatFingerprint.textContent = snapshot.fingerprint
    ? `#${snapshot.fingerprint}`
    : "—";
  els.chatRelay.textContent = snapshot.relay_url || "—";
  els.chatRoomId.textContent = snapshot.room || "—";

  const ignored = (snapshot.users || []).filter((user) => user.ignored);
  els.chatIgnoreList.textContent = "";
  els.chatIgnoreEmpty.hidden = ignored.length > 0;
  for (const user of ignored) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${user.nickname || "anon"} #${user.fingerprint || "????"}`;
    const action = document.createElement("button");
    action.type = "button";
    action.className = "chat-text-button";
    action.dataset.unignore = user.sender;
    action.textContent = "Unignore";
    item.append(label, action);
    els.chatIgnoreList.append(item);
  }

  if (state.chat.clearArmed) {
    els.chatClear.textContent = "Click again to erase everything";
  } else {
    els.chatClear.textContent = "Clear local chat data";
  }
}

function renderChat() {
  const snapshot = state.chat.snapshot;
  if (!snapshot) return;

  const enabled = chatEnabledHere();
  const error = state.chat.error || snapshot.error || "";
  els.chatError.hidden = !error;
  els.chatError.textContent = error;

  const connected = Boolean(snapshot.connected);
  els.chatDot.dataset.state = !enabled
    ? "idle"
    : connected
      ? "connected"
      : error
        ? "error"
        : "connecting";
  els.chatRoomLabel.textContent =
    snapshot.room === "fdn:general:v1"
      ? "General lobby"
      : snapshot.room || "General lobby";
  els.chatOnline.textContent = connected
    ? `${snapshot.online || 0} online`
    : "Connecting…";
  els.chatOnline.dataset.connected = String(connected);
  els.chatToggle.setAttribute("aria-pressed", enabled ? "true" : "false");

  const showGate = !snapshot.age_confirmed;
  const showSettings = !showGate && state.chat.settingsOpen;
  els.chatAge.hidden = !showGate;
  els.chatSettingsView.hidden = !showSettings;
  els.chatMain.hidden = showGate || showSettings;
  els.chatAgeConfirm.disabled = !els.chatAgeCheck.checked;

  if (showGate) return;
  if (showSettings) {
    renderChatSettings(snapshot);
    return;
  }
  renderChatMessages(snapshot);
  renderChatUsers(snapshot);
  updateChatComposer(snapshot);
}

function openChatSettings() {
  state.chat.settingsOpen = true;
  renderChat();
}

function closeChatSettings() {
  state.chat.settingsOpen = false;
  renderChat();
}

function resetChatClear() {
  state.chat.clearArmed = false;
  if (state.chat.clearTimer) {
    clearTimeout(state.chat.clearTimer);
    state.chat.clearTimer = null;
  }
  if (state.chat.snapshot) renderChatSettings(state.chat.snapshot);
}

async function clearChatData() {
  if (!state.chat.clearArmed) {
    state.chat.clearArmed = true;
    state.chat.clearTimer = setTimeout(resetChatClear, 6000);
    renderChatSettings(state.chat.snapshot);
    return;
  }
  resetChatClear();
  if (!invoke) return;
  try {
    state.chat.snapshot = await invoke("chat_clear_local_data");
    state.chat.enabledTabs.clear();
    state.chat.error = "";
    hideChatPanel();
    toast("Local chat data cleared.");
  } catch (error) {
    setChatError(error);
    renderChat();
  }
}

function bindChat() {
  els.chatToggle.addEventListener("click", () => {
    toggleChat().catch((error) => toast(String(error)));
  });
  els.chatClose.addEventListener("click", () => {
    closeChat().catch((error) => toast(String(error)));
  });
  els.chatSettingsBtn.addEventListener("click", openChatSettings);
  els.chatSettingsLink.addEventListener("click", openChatSettings);
  els.chatSettingsBack.addEventListener("click", closeChatSettings);
  els.chatAgeCheck.addEventListener("change", () => {
    els.chatAgeConfirm.disabled = !els.chatAgeCheck.checked;
  });
  els.chatAgeConfirm.addEventListener("click", () => {
    confirmChatAge().catch((error) => toast(String(error)));
  });
  els.chatText.addEventListener("input", updateChatCount);
  els.chatText.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChat().catch((error) => toast(String(error)));
    }
  });
  els.chatComposer.addEventListener("submit", (event) => {
    event.preventDefault();
    sendChat().catch((error) => toast(String(error)));
  });
  els.chatUsersBtn.addEventListener("click", () => {
    state.chat.usersOpen = !state.chat.usersOpen;
    renderChat();
  });
  els.chatNicknameSave.addEventListener("click", () => {
    saveChatNickname().catch((error) => toast(String(error)));
  });
  els.chatClear.addEventListener("click", () => {
    clearChatData().catch((error) => toast(String(error)));
  });
  els.chatMessages.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ignore]");
    if (button) ignoreChatSender(button.dataset.ignore);
  });
  els.chatUsers.addEventListener("click", (event) => {
    const ignore = event.target.closest("[data-ignore]");
    if (ignore) {
      ignoreChatSender(ignore.dataset.ignore);
      return;
    }
    const unignore = event.target.closest("[data-unignore]");
    if (unignore) unignoreChatSender(unignore.dataset.unignore);
  });
  els.chatIgnoreList.addEventListener("click", (event) => {
    const unignore = event.target.closest("[data-unignore]");
    if (unignore) unignoreChatSender(unignore.dataset.unignore);
  });

  const listen = tauri?.event?.listen;
  if (!listen) return;
  listen("chat://state", (event) => {
    state.chat.snapshot = {
      ...(state.chat.snapshot || {}),
      ...(event.payload || {}),
    };
    setChatError(state.chat.snapshot.error || "");
    renderChat();
  }).then((unlisten) => state.chat.unlisten.push(unlisten)).catch(() => {});
  listen("chat://message", (event) => {
    const snapshot = state.chat.snapshot;
    if (!snapshot) return;
    snapshot.messages = snapshot.messages || [];
    if (!snapshot.messages.some((message) => message.id === event.payload?.id)) {
      snapshot.messages.push(event.payload);
    }
    renderChat();
  }).then((unlisten) => state.chat.unlisten.push(unlisten)).catch(() => {});
  listen("chat://presence", (event) => {
    const snapshot = state.chat.snapshot;
    if (!snapshot) return;
    snapshot.users = event.payload?.users || [];
    renderChat();
  }).then((unlisten) => state.chat.unlisten.push(unlisten)).catch(() => {});
  listen("chat://error", (event) => {
    setChatError(event.payload?.message || "");
    renderChat();
  }).then((unlisten) => state.chat.unlisten.push(unlisten)).catch(() => {});
}

/* --------------------------------------------------------------- reviews */

async function loadReviewIndex() {
  if (state.reviewIndex) return state.reviewIndex;
  if (state.reviewIndexPromise) return state.reviewIndexPromise;

  state.reviewIndexPromise = fetch(REVIEW_INDEX_URL, {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`review index returned HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      const index = new Map();
      for (const entry of data?.domains ?? []) {
        if (entry && typeof entry.domain === "string") {
          index.set(entry.domain, entry);
        }
      }
      state.reviewIndex = index;
      return index;
    })
    .catch((error) => {
      // The browser still works without the review index; simply do not show
      // a control that cannot open a known thread.
      console.warn("Review index unavailable:", error);
      state.reviewIndex = new Map();
      return state.reviewIndex;
    })
    .finally(() => {
      state.reviewIndexPromise = null;
    });

  return state.reviewIndexPromise;
}

function reviewDomainFor(tab) {
  if (!tab?.entry || tab.entry.kind !== "navigate") return null;
  if (tab.entry.source !== "github_registry") return null;
  return tab.entry.domain || null;
}

function updateReviewControl() {
  const domain = reviewDomainFor(activeTab());
  const entry = domain ? state.reviewIndex?.get(domain) : null;

  if (!domain || !entry) {
    state.reviewDomain = null;
    els.review.hidden = true;
    return;
  }

  state.reviewDomain = domain;
  els.review.hidden = false;
  els.reviewUpCount.textContent = String(Number(entry.up) || 0);
  els.reviewDownCount.textContent = String(Number(entry.down) || 0);
  const title = `Open the review thread for ${domain}`;
  els.reviewUp.title = title;
  els.reviewDown.title = title;
  els.reviewUp.setAttribute("aria-label", `Open the review thread to upvote ${domain}`);
  els.reviewDown.setAttribute("aria-label", `Open the review thread to downvote ${domain}`);
}

function syncReviewControl() {
  const domain = reviewDomainFor(activeTab());
  if (!domain) {
    updateReviewControl();
    return;
  }
  loadReviewIndex().then(updateReviewControl);
}

function openReviewWindow() {
  const domain = state.reviewDomain;
  if (!domain) return;

  if (!invoke) {
    toast("Reviews need the desktop app; Tauri IPC is not available.");
    return;
  }

  invoke("open_review_window", { domain }).catch((error) => {
    toast(String(error));
    // The browser's built-in review window is the primary path. If it cannot
    // be created, let the user finish in their normal browser instead.
    const fallback = `${STUMBLE_URL}?domain=${encodeURIComponent(domain)}`;
    invoke("open_external", { url: fallback }).catch(() => {});
  });
}

function toast(message) {
  els.notice.textContent = message;
  els.notice.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    els.notice.hidden = true;
  }, 4200);
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the selection-based copy */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

function focusAddress() {
  els.address.focus();
  els.address.select();
}

/* -------------------------------------------------------------- settings */

function renderSettings() {
  const current = appearance?.get() ?? {
    theme: "system",
    density: "comfortable",
    skin: "default",
    customCss: "",
  };
  for (const choice of els.settingsMenu.querySelectorAll("[data-theme-choice]")) {
    choice.setAttribute(
      "aria-checked",
      String(choice.dataset.themeChoice === current.theme),
    );
  }
  for (const choice of els.settingsMenu.querySelectorAll("[data-density-choice]")) {
    choice.setAttribute(
      "aria-checked",
      String(choice.dataset.densityChoice === current.density),
    );
  }
  els.skinSelect.value = current.skin;
  const skinHint = SKIN_META[current.skin]?.hint ?? SKIN_META.default.hint;
  els.skinHint.textContent = current.customCss.trim()
    ? `${skinHint} Custom CSS is active.`
    : skinHint;
  if (document.activeElement !== els.skinCss) {
    els.skinCss.value = current.customCss;
  }
}

function setSettingsOpen(open) {
  els.settingsMenu.hidden = !open;
  els.settings.setAttribute("aria-expanded", String(open));
  layoutContent();
  if (!open) return;
  renderSettings();
  const selected = els.settingsMenu.querySelector('[aria-checked="true"]');
  requestAnimationFrame(() => (selected ?? els.settingsClose).focus());
}

function closeSettings({ restoreFocus = false } = {}) {
  if (els.settingsMenu.hidden) return;
  setSettingsOpen(false);
  if (restoreFocus) els.settings.focus();
}

/* ------------------------------------------------------------------ tabs */

/**
 * Native content commands are asynchronous. Chaining them keeps create ->
 * show -> focus -> hide in the same order even when the user is fast.
 */
let contentChain = Promise.resolve();

function contentCall(command, args) {
  if (!invoke) return Promise.reject(new Error("Tauri IPC is not available."));
  const run = () => invoke(command, args);
  const result = contentChain.then(run, run);
  contentChain = result.catch(() => {});
  return result;
}

/**
 * Fixed-size browser chrome around one elastic content area.
 *
 * This is deliberately the same idea as Swing's BoxLayout: the tab strip,
 * toolbar and status bar are non-growing boxes, and the viewport is the only
 * child with `flex-grow`. Native child webviews are positioned from the
 * *measured* viewport, never from a guessed height. `measure()` also refuses to
 * report a usable box when the chrome has not been laid out yet, so a page can
 * never be shown over a missing address bar.
 */
const chromeLayout = {
  last: null,

  measure() {
    const tabstrip = els.tabstrip.getBoundingClientRect();
    const toolbar = els.toolbar.getBoundingClientRect();
    const statusbar = els.statusbar?.getBoundingClientRect();
    const viewport = els.viewport.getBoundingClientRect();
    const chatWidth = els.chatPanel.hidden
      ? 0
      : els.chatPanel.getBoundingClientRect().width;

    // The viewport already excludes the fixed top boxes in CSS. Clamp it to the
    // measured toolbar and status bar as a second line of defence: a native
    // webview must never cover the address bar or the footer, even for a frame.
    // Hard floor for the native page. Native child webviews are outside the
    // chrome DOM, so a collapsed or absolutely positioned toolbar must never
    // give them a chance to climb over the address bar.
    const top = Math.max(
      86,
      Math.round(viewport.top),
      Math.round(toolbar.bottom),
      Math.round(tabstrip.bottom),
    );
    const statusVisible = Boolean(statusbar && statusbar.height >= 12);
    const bottom = Math.min(
      Math.round(viewport.bottom),
      statusVisible ? Math.round(statusbar.top) : window.innerHeight,
    );
    const width = Math.max(1, Math.round(viewport.width - chatWidth));
    const height = Math.max(1, bottom - top);
    const valid = toolbar.height >= 20 && viewport.width > 1 && height > 1;

    this.last = {
      x: Math.max(0, Math.round(viewport.left)),
      y: Math.max(0, top),
      width,
      height,
      valid,
      top,
      bottom,
      chrome: {
        tabstrip: Math.round(tabstrip.height),
        toolbar: Math.round(toolbar.height),
        statusbar: statusVisible ? Math.round(statusbar.height) : 0,
      },
    };

    document.documentElement.style.setProperty("--content-top", `${this.last.y}px`);
    document.documentElement.style.setProperty("--content-height", `${this.last.height}px`);
    document.documentElement.style.setProperty("--chrome-top-height", `${this.last.y}px`);
    document.documentElement.style.setProperty(
      "--chrome-bottom-height",
      `${Math.max(0, window.innerHeight - bottom)}px`,
    );

    return this.last;
  },

  contentBounds() {
    const measured = this.measure();
    return {
      x: measured.x,
      y: measured.y,
      width: measured.width,
      height: measured.height,
    };
  },
};

function boundsKey(bounds) {
  return `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
}

function ensureFrames() {
  // The iframe layer only exists on the mobile fallback path. Never create it
  // for desktop tabs, which are native child webviews outside this DOM.
  if (els.frames && els.frames.isConnected) return els.frames;
  const layer = document.createElement("div");
  layer.id = "frames";
  layer.className = "frames";
  els.viewport.prepend(layer);
  els.frames = layer;
  return layer;
}

function iframeView(tab) {
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
  ensureFrames().append(frame);

  return {
    kind: "iframe",
    source: () => frame.contentWindow,
    navigate(url, generation) {
      // Clear first: if the next navigation fails, WebKit would otherwise leave
      // the previous document visible and make the address change look ignored.
      frame.src = "about:blank";
      requestAnimationFrame(() => {
        if (tab.generation !== generation) return;
        frame.src = url;
      });
    },
    show() {
      frame.hidden = false;
    },
    hide() {
      frame.hidden = true;
    },
    focus() {
      try {
        frame.contentWindow?.focus();
      } catch {
        /* cross-origin focus is best-effort */
      }
      return Promise.resolve();
    },
    destroy() {
      frame.remove();
    },
  };
}

function webviewView(tab) {
  const tabId = String(tab.id);
  let shown = false;
  let lastBounds = "";

  const bounds = () => chromeLayout.contentBounds();

  return {
    kind: "webview",
    source: () => null,
    navigate(url) {
      lastBounds = "";
      return contentCall("content_open", { tabId, url, bounds: bounds() });
    },
    show(force = false) {
      const next = bounds();
      const key = boundsKey(next);
      if (shown && !force && key === lastBounds) return Promise.resolve();
      shown = true;
      lastBounds = key;
      return contentCall("content_show", { tabId, bounds: next });
    },
    hide() {
      if (!shown) return Promise.resolve();
      shown = false;
      return contentCall("content_hide", { tabId });
    },
    focus() {
      return contentCall("content_focus", { tabId }).catch(() => {});
    },
    destroy() {
      shown = false;
      lastBounds = "";
      return contentCall("content_close", { tabId });
    },
  };
}

function createTabView(tab) {
  return state.contentMode === "webview" ? webviewView(tab) : iframeView(tab);
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
    view: null,
  };
  tab.view = createTabView(tab);
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
  syncChatToActiveTab();
  if (
    tab.view.kind === "webview" &&
    tab.entry?.kind === "navigate" &&
    els.modal.hidden &&
    els.settingsMenu.hidden
  ) {
    tab.view.focus().catch(() => {});
  }
  if (invoke && chatEnabledHere()) {
    invoke("chat_set_active_tab", { tabId: String(id) }).catch(() => {});
  }
}

function closeTab(id) {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  const chatWasEnabled = state.chat.enabledTabs.has(String(id));
  const [tab] = state.tabs.splice(index, 1);
  const closed = tab.view.destroy();
  if (closed && typeof closed.catch === "function") closed.catch(() => {});
  if (state.tabs.length === 0) {
    newTab({ activate: true });
  } else if (state.activeId === id) {
    const next = state.tabs[Math.min(index, state.tabs.length - 1)];
    activateTab(next.id);
  } else {
    renderTabs();
  }
  if (chatWasEnabled) {
    disableChat(String(id)).catch(() => {});
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

/**
 * Re-assert the native page rectangle after a load. Page load can reflow the
 * tab title, review controls and status text; lock the view to the final boxes.
 */
function repaintChrome() {
  if (!els.settingsMenu.hidden || !els.modal.hidden) return;
  // WebKit can keep a stale chrome layer when a native child view is added
  // after a page load. Recreate the toolbar layer once so its controls are
  // painted again; the native page itself stays below it.
  els.toolbar.style.display = "none";
  void els.toolbar.offsetHeight;
  els.toolbar.style.display = "";
  els.toolbar.style.transform = "translateZ(0)";
  requestAnimationFrame(() => {
    els.toolbar.style.transform = "";
  });
}

function lockContentBox(tab) {
  if (!tab || tab.view.kind !== "webview") return;
  const apply = () => {
    if (tab !== activeTab() || tab.entry?.kind !== "navigate") return;
    if (!els.settingsMenu.hidden || !els.modal.hidden) return;
    // Re-measure every time. The page load can change the tab title, review
    // controls and status text; the native view must follow the final boxes.
    chromeLayout.measure();
    tab.view.show(true).catch(() => {});
  };
  apply();
  for (const delay of [50, 150, 400, 900, 1600]) {
    setTimeout(apply, delay);
  }
}

/**
 * Native child webviews always sit above the chrome, so chrome dialogs and the
 * chat panel cannot overlay them. Hide the active page while a dialog is open,
 * and give the chat panel its own column instead of covering the page.
 */
function layoutContent() {
  state.layoutFrame = 0;
  const layout = chromeLayout.measure();
  const tab = activeTab();
  const suppressed = !els.settingsMenu.hidden || !els.modal.hidden;
  const live = Boolean(tab && tab.entry?.kind === "navigate" && !suppressed && layout.valid);

  if (!layout.valid && !state.layoutRetry) {
    state.layoutRetry = true;
    setTimeout(() => {
      state.layoutRetry = false;
      scheduleLayout();
    }, 50);
  }

  for (const candidate of state.tabs) {
    const action = candidate === tab && live ? candidate.view.show() : candidate.view.hide();
    if (action && typeof action.catch === "function") action.catch(() => {});
  }
}

function scheduleLayout() {
  if (state.layoutFrame) return;
  state.layoutFrame = requestAnimationFrame(layoutContent);
}

function syncView() {
  const tab = activeTab();
  els.start.hidden = true;
  els.claim.hidden = true;

  if (!tab || !tab.entry) {
    els.start.hidden = false;
    els.address.value = "";
    setStatus("idle");
    setStatusDetail("");
  } else if (tab.entry.kind === "unregistered") {
    fillClaim(tab.entry);
    els.claim.hidden = false;
    els.address.value = tab.entry.display;
    setStatus("unregistered");
    setStatusDetail(tab.entry.display);
  } else {
    els.address.value = tab.entry.display;
    setStatus(tab.entry.source, LABELS[tab.entry.source]);
    setStatusDetail(tab.entry.display);
  }
  updateNav();
  renderTabs();
  syncReviewControl();
  layoutContent();
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

  if (tab.view.kind === "webview") {
    tab.view.navigate(url).catch((error) => {
      if (tab.generation !== generation) return;
      tab.loading = false;
      clearTimeout(tab.loadWatchdog);
      if (state.activeId === tab.id) setBusy(false);
      renderTabs();
      toast(String(error));
    });
  } else {
    tab.view.navigate(url, generation);
  }

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
  closeSettings();
  const tab = activeTab();
  if (!tab) return;
  tab.entry = null;
  tab.liveUrl = null;
  tab.loading = false;
  tab.title = "New tab";
  tab.generation += 1;
  clearTimeout(tab.loadWatchdog);
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
  navigateFrame(tab, entry.url);
  activateTab(tab.id);
}

async function navigate(raw, { tab = activeTab(), push = true } = {}) {
  const input = String(raw ?? "").trim();
  if (!input) return;
  closeSettings();
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
  closeSettings();
  if (!tab) tab = newTab();
  state.pending = { tabId: tab.id, outcome };
  // Mark the modal open before activation so the content view stays hidden
  // during the switch instead of flashing the previous page.
  els.modal.hidden = false;
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
  layoutContent();
  els.address.value = displayFor(outcome);
  setStatus("conflict");
  els.chooseRegistry.focus();
}

function showUnavailable(outcome, tab = activeTab()) {
  closeSettings();
  if (!tab) tab = newTab();
  state.pending = { tabId: tab.id, outcome };
  els.modal.hidden = false;
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
  layoutContent();
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
    target_url: "http://203.0.113.10:8080",
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
  const freeNamespace = domain === "fdn" || domain.endsWith(".fdn");
  claimTarget = { domain, registerUrl: claimUrl(domain), repoUrl: REGISTRY_REPO };
  els.claimDomain.textContent = domain;
  els.claimBadge.textContent = freeNamespace ? "Available" : "Unregistered";
  els.claimMessage.textContent = freeNamespace
    ? "Nobody has claimed this name in the Free Domain Registry. Claiming it is a pull request; after it merges, every Free Domain Browser can open it."
    : "This name is not active on the public internet, and nobody has claimed it in the Free Domain Registry. Registering it here maps it to a server you control. It does not buy the ICANN domain. If the public name becomes active later, the browser will ask visitors which destination to use.";
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

function applyLiveLocation(tab, href, title = "") {
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

    if (tab.id === state.activeId) {
      setStatusDetail(display);
      if (document.activeElement !== els.address && els.modal.hidden) {
        els.address.value = display;
        setStatus(tab.entry.source, LABELS[tab.entry.source]);
      }
    }
  }

  if (typeof title === "string" && title.trim()) {
    tab.title = title.trim().slice(0, 80);
  }
  renderTabs();
  syncReviewControl();
}

function onFrameMessage(event) {
  const tab = state.tabs.find(
    (candidate) => candidate.view.source() === event.source,
  );
  if (!tab) return;
  const data = event.data;
  if (!data || data.fdn !== "location") return;
  applyLiveLocation(tab, typeof data.href === "string" ? data.href : "", data.title);
}

/* -------------------------------------------------- native content events */

function contentTab(payload) {
  const id = Number(payload?.tab_id);
  return Number.isFinite(id) ? tabById(id) : null;
}

function bindContentEvents() {
  const listen = tauri?.event?.listen;
  if (!listen) return;

  listen("browser-command", (event) => {
    runBrowserCommand(String(event.payload ?? ""));
  }).catch(() => {});

  listen("content://load", (event) => {
    const payload = event.payload || {};
    const tab = contentTab(payload);
    if (!tab) return;
    if (payload.url) applyLiveLocation(tab, String(payload.url));
    if (payload.loading) {
      tab.loading = true;
      if (state.activeId === tab.id) setBusy(true);
    } else {
      tab.loading = false;
      clearTimeout(tab.loadWatchdog);
      if (state.activeId === tab.id) setBusy(false);
    }
    renderTabs();

    // A page can finish loading after the chrome has reflowed (status text,
    // progress bar, chat panel). Re-assert the measured box so the native view
    // can never keep an old, taller rectangle over the toolbar or footer.
    if (!payload.loading && tab === activeTab()) {
      repaintChrome();
      scheduleLayout();
      requestAnimationFrame(() => lockContentBox(tab));
    }
  }).catch(() => {});

  listen("content://title", (event) => {
    const payload = event.payload || {};
    const tab = contentTab(payload);
    if (!tab) return;
    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    if (!title) return;
    tab.title = title.slice(0, 80);
    renderTabs();
  }).catch(() => {});

  listen("content://open-tab", (event) => {
    const url = event.payload?.url;
    if (typeof url !== "string" || !url) return;
    const tab = newTab({ activate: true });
    navigate(url, { tab }).catch(() => {});
  }).catch(() => {});

  listen("content://external", (event) => {
    const url = event.payload?.url;
    if (typeof url !== "string" || !url) return;
    invoke?.("open_external", { url }).catch((error) => toast(String(error)));
  }).catch(() => {});
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
  els.reviewUp.addEventListener("click", openReviewWindow);
  els.reviewDown.addEventListener("click", openReviewWindow);

  els.clear.addEventListener("click", async () => {
    try {
      await invoke("clear_registry_cache");
      toast("Registry cache cleared.");
    } catch (error) {
      toast(String(error));
    }
  });

  els.settings.addEventListener("click", (event) => {
    event.stopPropagation();
    setSettingsOpen(els.settingsMenu.hidden);
  });

  els.settingsClose.addEventListener("click", () => closeSettings({ restoreFocus: true }));

  els.settingsMenu.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      return;
    }
    const radio = event.target.closest('[role="radio"]');
    const group = radio?.closest('[role="radiogroup"]');
    if (!group) return;
    const choices = [...group.querySelectorAll('[role="radio"]')];
    const index = choices.indexOf(radio);
    if (index < 0) return;
    event.preventDefault();
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const next = (index + (forward ? 1 : -1) + choices.length) % choices.length;
    choices[next].focus();
    choices[next].click();
  });

  els.settingsMenu.addEventListener("click", (event) => {
    const themeChoice = event.target.closest("[data-theme-choice]");
    if (themeChoice) {
      appearance?.setTheme(themeChoice.dataset.themeChoice);
      renderSettings();
      return;
    }
    const densityChoice = event.target.closest("[data-density-choice]");
    if (densityChoice) {
      appearance?.setDensity(densityChoice.dataset.densityChoice);
      renderSettings();
    }
  });

  els.skinSelect.addEventListener("change", () => {
    if (!appearance) return;
    const skin = els.skinSelect.value;
    appearance.setSkin(skin);
    renderSettings();
    toast(`Skin: ${SKIN_META[skin]?.label ?? SKIN_META.default.label}`);
  });

  els.applyCss.addEventListener("click", () => {
    if (!appearance) return;
    const css = els.skinCss.value;
    appearance.setCustomCss(css);
    renderSettings();
    toast(css.trim() ? "Custom CSS applied." : "Custom CSS cleared.");
  });

  els.clearCss.addEventListener("click", () => {
    if (!appearance) return;
    els.skinCss.value = "";
    appearance.setCustomCss("");
    renderSettings();
    toast("Custom CSS cleared.");
  });

  els.skinCss.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      els.applyCss.click();
    }
  });

  els.settingsReset.addEventListener("click", () => {
    if (!appearance) return;
    const current = appearance.get();
    const custom = current.skin !== "default" || current.customCss;
    if (custom && !window.confirm("Reset theme, layout, skin and custom CSS?")) return;
    appearance.setTheme("system");
    appearance.setDensity("comfortable");
    appearance.setSkin("default");
    appearance.setCustomCss("");
    renderSettings();
    toast("Appearance reset.");
  });

  document.addEventListener("click", (event) => {
    if (els.settingsMenu.hidden) return;
    if (event.target.closest(".settings-wrap")) return;
    closeSettings();
  });

  window.addEventListener("fdn:appearance", renderSettings);

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

  els.claimRegister.addEventListener("click", async () => {
    if (!claimTarget) return;
    // GitHub's new-file editor usually keeps the URL-encoded line breaks, but
    // some editor versions flatten them. Keep a formatted copy on the clipboard
    // so the record can always be pasted intact.
    const copied = await copyText(els.claimJson.textContent);
    invoke("open_external", { url: claimTarget.registerUrl }).catch((error) =>
      toast(String(error)),
    );
    if (copied) {
      toast("Opening GitHub — formatted JSON copied too.");
    }
  });

  els.claimCopy.addEventListener("click", async () => {
    if (!claimTarget) return;
    const copied = await copyText(els.claimJson.textContent);
    toast(copied ? "Formatted JSON copied." : "Could not copy — select the JSON manually.");
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

    if (event.key === "Escape") {
      if (!els.modal.hidden) {
        hideModal();
        return;
      }
      if (!els.settingsMenu.hidden) {
        closeSettings({ restoreFocus: true });
        return;
      }
      if (!els.chatPanel.hidden) {
        if (state.chat.settingsOpen) {
          closeChatSettings();
        } else {
          closeChat().catch(() => {});
        }
        return;
      }
    }

    if (mod && key === "l") {
      event.preventDefault();
      runBrowserCommand("focus-address");
    } else if (mod && key === "t") {
      event.preventDefault();
      runBrowserCommand("new-tab");
    } else if (mod && key === "w") {
      event.preventDefault();
      runBrowserCommand("close-tab");
    } else if (mod && key === "r") {
      event.preventDefault();
      runBrowserCommand("reload");
    } else if (mod && key === ",") {
      event.preventDefault();
      runBrowserCommand("settings");
    } else if (event.ctrlKey && event.key === "Tab") {
      event.preventDefault();
      runBrowserCommand(event.shiftKey ? "prev-tab" : "next-tab");
    } else if (event.altKey && event.key === "ArrowLeft") {
      event.preventDefault();
      runBrowserCommand("back");
    } else if (event.altKey && event.key === "ArrowRight") {
      event.preventDefault();
      runBrowserCommand("forward");
    }
  });
}

/**
 * Keyboard events go to the native content webview, not to the chrome, so the
 * native menu drives these commands and forwards them here.
 */
async function focusChrome() {
  if (!invoke) return;
  try {
    await invoke("focus_chrome");
  } catch {
    /* focus is best-effort */
  }
}

async function runBrowserCommand(command) {
  // The native menu and the chrome's keydown handler can both see the same
  // accelerator on some platforms. Ignore the duplicate delivery.
  const now = performance.now();
  if (state.lastCommand.name === command && now - state.lastCommand.at < 250) {
    return;
  }
  state.lastCommand = { name: command, at: now };

  switch (command) {
    case "focus-address":
      await focusChrome();
      focusAddress();
      break;
    case "new-tab":
      newTab({ activate: true });
      await focusChrome();
      focusAddress();
      break;
    case "close-tab":
      closeTab(state.activeId);
      break;
    case "reload":
      refresh();
      break;
    case "back":
      go(-1);
      break;
    case "forward":
      go(1);
      break;
    case "next-tab":
      cycleTab(1);
      break;
    case "prev-tab":
      cycleTab(-1);
      break;
    case "settings":
      await focusChrome();
      setSettingsOpen(els.settingsMenu.hidden);
      break;
    default:
      break;
  }
}

function watchLayout() {
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => scheduleLayout());
    for (const element of [els.tabstrip, els.toolbar, els.statusbar, els.notice, els.viewport, els.chatPanel]) {
      if (element) observer.observe(element);
    }
  }
  window.addEventListener("resize", scheduleLayout);
  window.visualViewport?.addEventListener("resize", scheduleLayout);
}

async function boot() {
  bind();
  bindChat();
  bindContentEvents();
  renderSettings();

  if (invoke) {
    try {
      const info = await invoke("browser_info");
      state.contentMode = info.content_mode === "webview" ? "webview" : "iframe";
      document.documentElement.dataset.contentMode = state.contentMode;
      if (state.contentMode === "webview" && els.frames) {
        els.frames.remove();
        els.frames = null;
      }
      document.title = `Free Domain Browser ${info.version}`;
      els.start.dataset.platform = info.platform;
      if (els.statusMode) {
        els.statusMode.textContent =
          state.contentMode === "webview" ? "Desktop webview · UI 8" : "Mobile frame · UI 8";
      }
    } catch {
      state.contentMode = "iframe";
    }
  }

  newTab({ activate: true });
  setStatus("idle");
  layoutContent();
  watchLayout();

  if (!invoke) {
    if (els.statusMode) els.statusMode.textContent = "Browser preview";
    toast("Run with `npm run dev` — the Tauri IPC bridge was not found.");
    return;
  }

  ensureChatSnapshot().catch(() => {});
}

boot();
