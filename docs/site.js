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
})();
