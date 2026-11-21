/* SPDX-License-Identifier: GPL-3.0-only */
/* Copyright (C) 2026 Free Domain Name contributors */

(() => {
  const root = document.documentElement;
  const themeKey = "fdn.docs.theme";
  const scheme = window.matchMedia?.("(prefers-color-scheme: light)");
  const themeToggle = document.querySelector("#themeToggle");
  const previewButtons = [...document.querySelectorAll("[data-preview-theme]")];
  const labels = [...document.querySelectorAll("[data-theme-label]")];
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const shots = [...document.querySelectorAll(".theme-shot")];
  const lightbox = document.querySelector("#lightbox");
  const lightboxImage = document.querySelector("#lightboxImage");
  const lightboxCaption = document.querySelector("#lightboxCaption");
  const toast = document.querySelector("#toast");
  let toastTimer = 0;
  let lightboxLabel = "";

  function storedTheme() {
    try {
      const saved = localStorage.getItem(themeKey);
      return saved === "light" || saved === "dark" ? saved : null;
    } catch {
      return null;
    }
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 1900);
  }

  function updateThemeImages(theme) {
    for (const image of shots) {
      const next = image.dataset[theme];
      if (!next) continue;
      if (image.getAttribute("src") !== next) image.setAttribute("src", next);
      const alt = image.dataset[theme === "light" ? "altLight" : "altDark"];
      if (alt) image.setAttribute("alt", alt);
    }

    for (const label of labels) {
      label.textContent = theme === "dark" ? "Dark" : "Light";
    }

    for (const button of previewButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.previewTheme === theme));
    }

    if (themeToggle) {
      const next = theme === "dark" ? "light" : "dark";
      themeToggle.setAttribute("aria-label", `Switch to ${next} theme`);
      themeToggle.setAttribute("title", `Switch to ${next} theme`);
    }

    if (themeMeta) themeMeta.content = theme === "dark" ? "#080b12" : "#f4f6fa";

    if (lightbox?.open && lightboxImage) {
      const next = lightboxImage.dataset[theme];
      if (next) {
        lightboxImage.setAttribute("src", next);
        lightboxImage.setAttribute(
          "alt",
          lightboxImage.dataset[theme === "light" ? "altLight" : "altDark"] ?? "",
        );
      }
      lightboxCaption.textContent = `${lightboxLabel} — ${theme} preview`;
    }
  }

  function setTheme(theme, { persist = true } = {}) {
    const next = theme === "light" ? "light" : "dark";
    root.dataset.theme = next;
    if (persist) {
      try {
        localStorage.setItem(themeKey, next);
      } catch {
        /* private mode or blocked storage: the page still switches */
      }
    }
    updateThemeImages(next);
  }

  const initial = root.dataset.theme === "light" ? "light" : "dark";
  setTheme(initial, { persist: false });

  themeToggle?.addEventListener("click", () => {
    setTheme(root.dataset.theme === "dark" ? "light" : "dark");
  });

  for (const button of previewButtons) {
    button.addEventListener("click", () => {
      setTheme(button.dataset.previewTheme);
    });
  }

  scheme?.addEventListener?.("change", (event) => {
    if (!storedTheme()) setTheme(event.matches ? "light" : "dark", { persist: false });
  });

  for (const button of document.querySelectorAll(".skin-shot, #heroZoom")) {
    button.addEventListener("click", () => {
      if (!lightbox || !lightboxImage) return;
      const theme = root.dataset.theme === "light" ? "light" : "dark";
      lightboxLabel = button.dataset.label ?? "Skin";
      lightboxImage.dataset.light = button.dataset.light ?? "";
      lightboxImage.dataset.dark = button.dataset.dark ?? "";
      lightboxImage.setAttribute("src", button.dataset[theme] ?? "");
      lightboxImage.setAttribute(
        "alt",
        `${lightboxLabel} skin in ${theme} mode`,
      );
      lightboxCaption.textContent = `${lightboxLabel} — ${theme} preview`;
      lightbox.showModal();
    });
  }

  lightbox?.querySelector(".lightbox-close")?.addEventListener("click", () => {
    lightbox.close();
  });

  lightbox?.addEventListener("click", (event) => {
    if (event.target === lightbox) lightbox.close();
  });

  for (const button of document.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", async () => {
      const target = document.querySelector(button.dataset.copy);
      if (!target) return;
      const text = target.textContent ?? "";
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.append(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      const old = button.textContent;
      button.textContent = "Copied";
      showToast("CSS copied to the clipboard.");
      window.setTimeout(() => {
        button.textContent = old;
      }, 1800);
    });
  }

  for (const link of document.querySelectorAll(".mobile-nav nav a")) {
    link.addEventListener("click", () => {
      document.querySelector(".mobile-nav")?.removeAttribute("open");
    });
  }

  // The download cards start on the release page. When the API is reachable,
  // upgrade them to the exact latest asset so the visitor does not have to
  // hunt through the asset list. Any failure leaves the static fallbacks.
  const releaseRepo = "free-domain-name/tauri-browser";
  const releaseAssets = {
    macos: /\.dmg$/i,
    "windows-msi": /\.msi$/i,
    "windows-exe": /-setup\.exe$/i,
    "linux-appimage": /\.AppImage$/i,
    "linux-deb": /\.deb$/i,
  };

  const armPattern = /aarch64|arm64/i;
  const x64Pattern = /x86_64|x64|amd64/i;

  // A release can ship more than one build for the same target. Taking the
  // first match would hand an x86-64 visitor an arm64 file, so the asset that
  // matches the CPU of the visitor wins.
  function pickAsset(assets, pattern) {
    const matches = assets.filter(
      (candidate) =>
        typeof candidate?.name === "string" && pattern.test(candidate.name),
    );
    if (matches.length <= 1) return matches[0] ?? null;

    const agent = navigator.userAgent || "";
    const wantsArm = armPattern.test(agent) && !x64Pattern.test(agent);
    const preferred = wantsArm
      ? matches.find((candidate) => armPattern.test(candidate.name))
      : matches.find((candidate) => x64Pattern.test(candidate.name));
    return preferred ?? matches[0];
  }

  async function loadLatestRelease() {
    const downloadSection = document.querySelector("#download");
    if (!downloadSection) return;

    try {
      const response = await fetch(
        `https://api.github.com/repos/${releaseRepo}/releases/latest`,
        { headers: { Accept: "application/vnd.github+json" } },
      );
      if (!response.ok) return;

      const release = await response.json();
      if (typeof release.tag_name === "string" && release.tag_name) {
        for (const label of document.querySelectorAll("[data-release-version]")) {
          label.textContent = release.tag_name;
        }
      }
      renderReleaseDate(release.published_at);
      renderReleaseNotes(release.body);

      const assets = Array.isArray(release.assets) ? release.assets : [];
      for (const [kind, pattern] of Object.entries(releaseAssets)) {
        const asset = pickAsset(assets, pattern);
        if (!asset || typeof asset.browser_download_url !== "string") continue;

        for (const link of downloadSection.querySelectorAll(
          `[data-release-asset="${kind}"]`,
        )) {
          link.href = asset.browser_download_url;
        }
      }
    } catch {
      /* Keep the release-page fallbacks. */
    }
  }

  // A small live count on the landing page. The registry has no index, so the
  // tree is the cheapest public count; cache it per session and keep the static
  // fallback if GitHub is unavailable or the tree is truncated.
  const registryRepo = "free-domain-name/registry";
  const registryCountKey = "fdn.registryCount.v1";
  const registryCountMaxAge = 60 * 60 * 1000;

  function setRegistryCount(count) {
    if (!Number.isFinite(count) || count < 0) return;
    const formatted = new Intl.NumberFormat().format(count);
    for (const node of document.querySelectorAll("[data-registry-count]")) {
      node.textContent = formatted;
    }
  }

  async function loadRegistryCount() {
    if (!document.querySelector("[data-registry-count]")) return;

    try {
      const cached = JSON.parse(sessionStorage.getItem(registryCountKey) || "null");
      if (
        cached &&
        typeof cached.count === "number" &&
        Date.now() - cached.at < registryCountMaxAge
      ) {
        setRegistryCount(cached.count);
        return;
      }
    } catch {
      /* Storage is optional. */
    }

    try {
      const response = await fetch(
        `https://api.github.com/repos/${registryRepo}/git/trees/main?recursive=1`,
        { headers: { Accept: "application/vnd.github+json" } },
      );
      if (!response.ok) return;

      const data = await response.json();
      if (data.truncated) return;

      // A record lives at <a>/<b>/<c>/<d>/<domain>.json, where the four
      // directories are the first four characters of the domain with the dots
      // removed, padded with "_". Checking that the shard letters match the
      // file name keeps other JSON in the repository out of the count.
      const recordPattern =
        /^[a-z0-9_]\/[a-z0-9_]\/[a-z0-9_]\/[a-z0-9_]\/([^/]+)\.json$/i;
      const isRecordPath = (path) => {
        const match = recordPattern.exec(path);
        if (!match) return false;
        const name = match[1].toLowerCase();
        const shard = path.split("/").slice(0, 4).join("").toLowerCase();
        const expected = name.replace(/\./g, "").padEnd(4, "_").slice(0, 4);
        return shard === expected;
      };
      const count = (Array.isArray(data.tree) ? data.tree : []).filter(
        (entry) => entry?.type === "blob" && isRecordPath(entry.path),
      ).length;

      setRegistryCount(count);
      try {
        sessionStorage.setItem(
          registryCountKey,
          JSON.stringify({ at: Date.now(), count }),
        );
      } catch {
        /* Storage is optional. */
      }
    } catch {
      /* Keep the static fallback. */
    }
  }

  // The release notes are written once, on the release page. Only a small,
  // safe subset of Markdown is rendered here: bullets, headings, bold, inline
  // code and links. The text is escaped before anything is added to it.
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function inlineMarkdown(text) {
    return text
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
      );
  }

  function renderReleaseDate(published) {
    const target = document.querySelector("[data-release-date]");
    if (!target || typeof published !== "string") return;
    const date = new Date(published);
    if (Number.isNaN(date.getTime())) return;
    const text = date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    target.textContent = `· ${text}`;
  }

  function renderReleaseNotes(body) {
    const target = document.querySelector("[data-release-notes]");
    if (!target || typeof body !== "string" || !body.trim()) return;

    const html = [];
    let inList = false;
    const flush = () => {
      if (!inList) return;
      html.push("</ul>");
      inList = false;
    };

    for (const raw of escapeHtml(body).split("\n")) {
      const line = raw.trim();
      if (!line) {
        flush();
        continue;
      }
      const bullet = /^[-*]\s+(.*)$/.exec(line);
      if (bullet) {
        if (!inList) {
          html.push("<ul>");
          inList = true;
        }
        html.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
        continue;
      }
      flush();
      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      if (heading) {
        html.push(`<h3>${inlineMarkdown(heading[2])}</h3>`);
        continue;
      }
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    }
    flush();
    target.innerHTML = html.join("");
  }

  // The rolling seven-day leaderboard comes from the registry's generated
  // index: a plain JSON file, so no API call and no token are needed.
  async function loadLeaderboard() {
    const target = document.querySelector("[data-leaderboard]");
    if (!target) return;

    try {
      const response = await fetch(
        "https://raw.githubusercontent.com/free-domain-name/registry/main/reviews/index.json",
        { cache: "no-cache" },
      );
      if (!response.ok) return;
      const data = await response.json();
      const domains = Array.isArray(data.domains) ? data.domains : [];
      const scored = domains
        .filter(
          (entry) =>
            entry && typeof entry.recent_score === "number" &&
            Number.isFinite(entry.recent_score),
        )
        .sort((a, b) => b.recent_score - a.recent_score)
        .slice(0, 6);

      if (!scored.length) {
        target.innerHTML =
          '<p class="pulse-empty">No scored reviews in the last seven days yet. ' +
          '<a href="https://github.com/free-domain-name/registry" target="_blank" rel="noreferrer">Review the first name</a>.</p>';
        return;
      }

      const rows = scored.map((entry) => {
        const score = Math.round(entry.recent_score);
        const votes = Number.isFinite(entry.recent_votes) ? entry.recent_votes : 0;
        const url =
          typeof entry.url === "string" &&
          /^https:\/\/github\.com\/free-domain-name\/registry\//.test(entry.url)
            ? entry.url
            : "#";
        const domain = escapeHtml(entry.domain || "unknown");
        return (
          `<li class="pulse-row"><a class="pulse-name" href="${url}" ` +
          `target="_blank" rel="noreferrer">${domain}</a>` +
          `<span class="pulse-score">${score}%</span>` +
          `<span class="pulse-votes">${votes} vote${votes === 1 ? "" : "s"} this week</span></li>`
        );
      });
      target.innerHTML = `<ul class="pulse-rows">${rows.join("")}</ul>`;
    } catch {
      /* Keep the loading text. */
    }
  }

  loadRegistryCount();
  loadLatestRelease();
  loadLeaderboard();
})();
