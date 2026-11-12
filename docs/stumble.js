/* SPDX-License-Identifier: GPL-3.0-only */
/* Copyright (C) 2026 Free Domain Name contributors */
/**
 * Stumble page: pick a random registry name and show its public GitHub review
 * thread. The review index and comments are read-only public GitHub data.
 *
 * There is deliberately no AI layer, ranking model or tracking. Votes are
 * GitHub reactions; comments are GitHub comments and require a GitHub account.
 */
(() => {
  "use strict";

  const INDEX_URL =
    "https://raw.githubusercontent.com/free-domain-name/registry/main/reviews/index.json";
  const ISSUE_API =
    "https://api.github.com/repos/free-domain-name/registry/issues";
  const INDEX_CACHE_KEY = "fdn.stumble.index.v1";
  const INDEX_CACHE_TTL = 5 * 60 * 1000;
  const MAX_COMMENT_LENGTH = 520;

  const domainEl = document.querySelector("#stumbleDomain");
  const targetEl = document.querySelector("#stumbleTarget");
  const scoreEl = document.querySelector("#stumbleScore");
  const votesEl = document.querySelector("#stumbleVotes");
  const commentsEl = document.querySelector("#stumbleComments");
  const scoreBarEl = document.querySelector("#stumbleScoreBar");
  const reviewEl = document.querySelector("#stumbleReview");
  const visitEl = document.querySelector("#stumbleVisit");
  const nextEl = document.querySelector("#stumbleNext");
  const commentsListEl = document.querySelector("#stumbleCommentList");
  const allCommentsEl = document.querySelector("#stumbleAllComments");

  const commentCache = new Map();
  let entries = [];
  let current = null;
  let requestId = 0;

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

  function reviewUrl(value) {
    const url = httpsUrl(value);
    if (!url) return null;
    return /^https:\/\/github\.com\/free-domain-name\/registry\/issues\/\d+$/.test(url)
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

  function shortComment(value) {
    const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
    if (text.length <= MAX_COMMENT_LENGTH) return text;
    return `${text.slice(0, MAX_COMMENT_LENGTH).trimEnd()}…`;
  }

  function commentDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "recently";
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function clear(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function message(text, href, label) {
    const paragraph = document.createElement("p");
    paragraph.className = "stumble-muted";
    paragraph.textContent = text;
    if (href && label) {
      paragraph.append(" ");
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = label;
      paragraph.append(link);
    }
    return paragraph;
  }

  function renderComments(entry, token, comments, error) {
    if (token !== requestId || entry.domain !== current?.domain) return;

    clear(commentsListEl);
    if (!entry.issue) {
      commentsListEl.append(
        message(
          "This name does not have a review thread yet.",
          "https://github.com/free-domain-name/registry/issues/new",
          "Open a review on GitHub →",
        ),
      );
      return;
    }

    if (error) {
      commentsListEl.append(
        message(
          "Comments could not be loaded here. The conversation is still on GitHub.",
          entry.url,
          "Read the thread →",
        ),
      );
      return;
    }

    if (!comments.length) {
      commentsListEl.append(
        message(
          "No comments yet. Be the first human to review this name.",
          entry.url,
          "Open the thread →",
        ),
      );
      return;
    }

    for (const comment of comments) {
      const article = document.createElement("article");
      article.className = "stumble-comment";

      const meta = document.createElement("div");
      meta.className = "stumble-comment-meta";

      const author = document.createElement("a");
      const userUrl = httpsUrl(comment?.user?.html_url);
      author.href = userUrl || entry.url;
      author.target = "_blank";
      author.rel = "noreferrer";
      author.textContent = `@${comment?.user?.login || "someone"}`;

      const time = document.createElement("time");
      time.dateTime = comment?.created_at || "";
      time.textContent = commentDate(comment?.created_at);

      meta.append(author, time);

      const body = document.createElement("p");
      body.className = "stumble-comment-body";
      body.textContent = shortComment(comment?.body) || "(empty comment)";

      const link = document.createElement("a");
      link.className = "stumble-comment-link";
      link.href = httpsUrl(comment?.html_url) || entry.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "View on GitHub →";

      article.append(meta, body, link);
      commentsListEl.append(article);
    }
  }

  async function loadComments(entry, token) {
    if (!entry.issue) {
      renderComments(entry, token, [], null);
      return;
    }

    const cached = commentCache.get(entry.issue);
    if (cached) {
      renderComments(entry, token, cached, null);
      return;
    }

    try {
      const response = await fetch(
        `${ISSUE_API}/${encodeURIComponent(entry.issue)}/comments?per_page=100`,
        { headers: { Accept: "application/vnd.github+json" } },
      );
      if (!response.ok) {
        throw new Error(`Comments returned HTTP ${response.status}`);
      }
      const comments = await response.json();
      const latest = Array.isArray(comments) ? comments.slice(-3).reverse() : [];
      commentCache.set(entry.issue, latest);
      renderComments(entry, token, latest, null);
    } catch {
      renderComments(entry, token, [], new Error("comments unavailable"));
    }
  }

  function render(entry) {
    if (!entry) return;

    current = entry;
    const token = ++requestId;
    const reviewIssueUrl = reviewUrl(entry.url);
    const visitUrl = httpUrl(entry.target_url);
    const votes = Number(entry.up || 0) + Number(entry.down || 0);
    const score = Number.isFinite(entry.score) ? entry.score : null;

    domainEl.textContent = entry.domain;
    targetEl.textContent = `Registry target: ${entry.target_url}`;
    scoreEl.textContent = score === null ? "—" : `${score}%`;
    scoreEl.title =
      score === null
        ? "No votes yet"
        : `${score}% positive from ${formatCount(votes)} votes`;
    votesEl.textContent = formatCount(votes);
    commentsEl.textContent = formatCount(entry.comments);
    scoreBarEl.style.width = `${score === null ? 0 : Math.max(0, Math.min(100, score))}%`;

    if (reviewIssueUrl) {
      reviewEl.href = reviewIssueUrl;
      reviewEl.hidden = false;
      allCommentsEl.href = reviewIssueUrl;
      allCommentsEl.hidden = false;
    } else {
      reviewEl.hidden = true;
      allCommentsEl.hidden = true;
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

    clear(commentsListEl);
    commentsListEl.append(message("Loading the conversation…"));
    void loadComments(entry, token);
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
    reviewEl.hidden = true;
    visitEl.hidden = true;
    allCommentsEl.hidden = true;
    nextEl.disabled = true;

    clear(commentsListEl);
    commentsListEl.append(
      message(
        "Try again in a moment, or browse the registry directly.",
        "https://github.com/free-domain-name/registry",
        "Open the registry →",
      ),
    );
    console.error(error);
  }

  nextEl?.addEventListener("click", () => {
    if (entries.length) render(pick());
  });

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
