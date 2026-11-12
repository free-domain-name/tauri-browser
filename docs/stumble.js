/* SPDX-License-Identifier: GPL-3.0-only */
/* Copyright (C) 2026 Free Domain Name contributors */
/**
 * Stumble page: pick a random registry name and embed its public GitHub
 * Discussions review thread through giscus.
 *
 * giscus provides the GitHub sign-in, inline comments and the 👍/👎 reaction
 * bar. The score and comment count come from the registry's generated
 * reviews/index.json, which is refreshed by GitHub Actions.
 *
 * There is deliberately no AI layer, ranking model or tracking.
 */
(() => {
  "use strict";

  const INDEX_URL =
    "https://raw.githubusercontent.com/free-domain-name/registry/main/reviews/index.json";
  const INDEX_CACHE_KEY = "fdn.stumble.index.v2";
  const INDEX_CACHE_TTL = 5 * 60 * 1000;
  const GISCUS_ORIGIN = "https://giscus.app";

  // IDs come from the registry's General Discussion category. Keep them in
  // sync with giscus.json and the one-time giscus app installation.
  const GISCUS = {
    repo: "free-domain-name/registry",
    repoId: "R_kgDOVp0scg",
    category: "General",
    categoryId: "DIC_kwDOVp0scs4DK_ld",
    mapping: "specific",
    strict: "0",
    reactionsEnabled: "1",
    emitMetadata: "1",
    inputPosition: "top",
    lang: "en",
    loading: "lazy",
  };

  const domainEl = document.querySelector("#stumbleDomain");
  const targetEl = document.querySelector("#stumbleTarget");
  const scoreEl = document.querySelector("#stumbleScore");
  const votesEl = document.querySelector("#stumbleVotes");
  const commentsEl = document.querySelector("#stumbleComments");
  const scoreBarEl = document.querySelector("#stumbleScoreBar");
  const visitEl = document.querySelector("#stumbleVisit");
  const nextEl = document.querySelector("#stumbleNext");
  const voteUpEl = document.querySelector("#stumbleVoteUp");
  const voteDownEl = document.querySelector("#stumbleVoteDown");
  const discussionLinkEl = document.querySelector("#stumbleDiscussionLink");
  const giscusThreadEl = document.querySelector("#giscusThread");
  const giscusFallbackEl = document.querySelector("#giscusFallback");
  const threadEl = document.querySelector("#stumbleThread");

  let entries = [];
  let current = null;

  function readIndexCache() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(INDEX_CACHE_KEY) || "null");
      if (
        cached &&
        Array.isArray(cached.entries) &&
        Date.now() - cached.at < INDEX_CACHE_TTL
      ) {
        return cached.entries;
      }
    } catch {}
    return null;
  }

  function writeIndexCache(value) {
    try {
      sessionStorage.setItem(
        INDEX_CACHE_KEY,
        JSON.stringify({ at: Date.now(), entries: value }),
      );
    } catch {}
  }

  function validEntry(entry) {
    return (
      entry &&
      typeof entry.domain === "string" &&
      entry.domain.length > 0 &&
      typeof entry.target_url === "string"
    );
  }

  async function loadIndex() {
    const cached = readIndexCache();
    if (cached?.length) return cached;

    const response = await fetch(INDEX_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      throw new Error(`Review index returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const domains = Array.isArray(data?.domains)
      ? data.domains.filter(validEntry)
      : [];
    if (!domains.length) throw new Error("The review index is empty");

    writeIndexCache(domains);
    return domains;
  }

  function randomIndex(length) {
    if (length <= 0) return 0;
    try {
      const values = new Uint32Array(1);
      crypto.getRandomValues(values);
      return values[0] % length;
    } catch {
      return Math.floor(Math.random() * length);
    }
  }

  function pick(preferredDomain) {
    if (preferredDomain) {
      const exact = entries.find(
        (entry) => entry.domain.toLowerCase() === preferredDomain.toLowerCase(),
      );
      if (exact) return exact;
    }

    let candidates = entries;
    if (entries.length > 1 && current) {
      candidates = entries.filter((entry) => entry.domain !== current.domain);
    }
    return candidates[randomIndex(candidates.length)] || entries[0];
  }

  function httpsUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function discussionUrl(value) {
    const url = httpsUrl(value);
    if (!url) return null;
    return /^https:\/\/github\.com\/free-domain-name\/registry\/discussions\/\d+$/.test(
      url,
    )
      ? url
      : null;
  }

  function httpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function formatCount(value) {
    const count = Number(value) || 0;
    return count.toLocaleString();
  }

  function paintVotes(up, down, comments) {
    const votes = up + down;
    const score = votes === 0 ? null : Math.round((up / votes) * 100);
    scoreEl.textContent = score === null ? "—" : `${score}%`;
    scoreEl.title =
      score === null
        ? "No votes yet"
        : `${score}% positive from ${formatCount(votes)} votes`;
    votesEl.textContent = formatCount(votes);
    commentsEl.textContent = formatCount(comments);
    scoreBarEl.style.width = `${score === null ? 0 : Math.max(0, Math.min(100, score))}%`;
  }

  function themeName() {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }

  function applyGiscusTheme() {
    const iframe = document.querySelector("iframe.giscus-frame");
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      { giscus: { setConfig: { theme: themeName() } } },
      GISCUS_ORIGIN,
    );
  }

  function mountGiscus(entry) {
    if (!giscusThreadEl) return;
    giscusThreadEl.replaceChildren();

    const script = document.createElement("script");
    script.src = `${GISCUS_ORIGIN}/client.js`;
    script.async = true;
    script.crossOrigin = "anonymous";

    const attributes = {
      repo: GISCUS.repo,
      "repo-id": GISCUS.repoId,
      category: GISCUS.category,
      "category-id": GISCUS.categoryId,
      mapping: GISCUS.mapping,
      term: entry.domain,
      strict: GISCUS.strict,
      "reactions-enabled": GISCUS.reactionsEnabled,
      "emit-metadata": GISCUS.emitMetadata,
      "input-position": GISCUS.inputPosition,
      theme: themeName(),
      lang: GISCUS.lang,
      loading: GISCUS.loading,
    };

    for (const [key, value] of Object.entries(attributes)) {
      script.setAttribute(`data-${key}`, value);
    }
    giscusThreadEl.append(script);

    // Giscus reads the theme when it mounts. Apply it again after the iframe
    // exists so a theme toggle before load is not lost.
    window.setTimeout(applyGiscusTheme, 1200);
  }

  function focusThread() {
    threadEl?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      const iframe = document.querySelector("iframe.giscus-frame");
      if (iframe) iframe.focus();
    }, 650);
  }

  function onGiscusMessage(event) {
    if (event.origin !== GISCUS_ORIGIN) return;
    const data = event.data?.giscus;
    if (!data || !current) return;

    if (data.error) {
      giscusFallbackEl.hidden = false;
      return;
    }

    const discussion = data.discussion;
    if (!discussion?.reactions) return;

    // Ignore late metadata from an iframe for a previous Stumble card.
    const expected = discussionUrl(current.url);
    if (expected && discussion.url && discussion.url !== expected) return;

    const up = discussion.reactions.THUMBS_UP?.count ?? 0;
    const down = discussion.reactions.THUMBS_DOWN?.count ?? 0;
    paintVotes(up, down, discussion.totalCommentCount ?? 0);
  }

  function render(entry) {
    if (!entry) return;

    current = entry;
    const reviewUrl = discussionUrl(entry.url);
    const visitUrl = httpUrl(entry.target_url);

    domainEl.textContent = entry.domain;
    targetEl.textContent = `Registry target: ${entry.target_url}`;
    paintVotes(Number(entry.up || 0), Number(entry.down || 0), Number(entry.comments || 0));

    if (reviewUrl) {
      discussionLinkEl.href = reviewUrl;
      discussionLinkEl.hidden = false;
      giscusFallbackEl.href = reviewUrl;
      giscusFallbackEl.hidden = false;
      voteUpEl.disabled = false;
      voteDownEl.disabled = false;
    } else {
      discussionLinkEl.hidden = true;
      giscusFallbackEl.hidden = true;
      voteUpEl.disabled = true;
      voteDownEl.disabled = true;
    }

    if (visitUrl) {
      visitEl.href = visitUrl;
      visitEl.hidden = false;
    } else {
      visitEl.hidden = true;
    }

    nextEl.disabled = entries.length < 2;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("domain", entry.domain);
      history.replaceState(null, "", url);
    } catch {}
    document.title = `${entry.domain} — Stumble the registry`;

    mountGiscus(entry);
  }

  function renderFatalError(error) {
    current = null;
    domainEl.textContent = "The registry is taking a break.";
    targetEl.textContent =
      "The review index could not be loaded. The registry itself is still available.";
    scoreEl.textContent = "—";
    votesEl.textContent = "0";
    commentsEl.textContent = "0";
    scoreBarEl.style.width = "0%";
    discussionLinkEl.hidden = true;
    giscusFallbackEl.hidden = true;
    voteUpEl.disabled = true;
    voteDownEl.disabled = true;
    visitEl.hidden = true;
    nextEl.disabled = true;
    giscusThreadEl.replaceChildren();
    const paragraph = document.createElement("p");
    paragraph.className = "stumble-muted";
    paragraph.textContent = "Try again in a moment, or browse the registry directly.";
    const link = document.createElement("a");
    link.href = "https://github.com/free-domain-name/registry";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Open the registry →";
    paragraph.append(" ", link);
    giscusThreadEl.append(paragraph);
    console.error(error);
  }

  nextEl?.addEventListener("click", () => {
    if (entries.length) render(pick());
  });
  voteUpEl?.addEventListener("click", focusThread);
  voteDownEl?.addEventListener("click", focusThread);

  new MutationObserver(applyGiscusTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  window.addEventListener("message", onGiscusMessage);

  (async () => {
    try {
      entries = await loadIndex();
      const preferred = new URLSearchParams(window.location.search).get("domain");
      render(pick(preferred));
    } catch (error) {
      renderFatalError(error);
    }
  })();
})();
