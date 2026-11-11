/* SPDX-License-Identifier: GPL-3.0-only */
/* Copyright (C) 2026 Free Domain Name contributors */

/**
 * Appearance bootstrap.
 *
 * This is a classic script, loaded before the webview paints, so a saved dark
 * theme does not flash light first. `main.js` reads the same API for the
 * settings menu.
 */
(() => {
  const STORAGE_KEY = "fdn.appearance.v1";
  const root = document.documentElement;
  const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)");
  const themes = new Set(["system", "light", "dark"]);
  const densities = new Set(["comfortable", "compact"]);
  const skins = new Set([
    "default",
    "high-tech",
    "futuristic",
    "historic",
    "victorian",
    "amazon",
    "terminal",
  ]);
  const MAX_CSS = 24000;

  const defaults = { theme: "system", density: "comfortable", skin: "default", customCss: "" };

  function read() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return {
        theme: themes.has(saved?.theme) ? saved.theme : defaults.theme,
        density: densities.has(saved?.density) ? saved.density : defaults.density,
        skin: skins.has(saved?.skin) ? saved.skin : defaults.skin,
        customCss:
          typeof saved?.customCss === "string"
            ? saved.customCss.slice(0, MAX_CSS)
            : defaults.customCss,
      };
    } catch {
      return { ...defaults };
    }
  }

  let settings = read();

  function resolvedTheme() {
    if (settings.theme === "system") return systemDark?.matches ? "dark" : "light";
    return settings.theme;
  }

  function apply() {
    const theme = resolvedTheme();
    root.dataset.theme = theme;
    root.dataset.density = settings.density;
    root.dataset.skin = settings.skin;
    root.style.colorScheme = theme;

    const customStyle = document.querySelector("#customSkin");
    if (customStyle) customStyle.textContent = settings.customCss;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const background = getComputedStyle(root).getPropertyValue("--bg").trim();
      meta.content = background || (theme === "dark" ? "#0e1015" : "#f3f4f7");
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* storage can be disabled; appearance still works for this run */
    }
  }

  function update(patch) {
    settings = { ...settings, ...patch };
    persist();
    apply();
    window.dispatchEvent(
      new CustomEvent("fdn:appearance", {
        detail: { ...settings, resolvedTheme: resolvedTheme() },
      }),
    );
  }

  function onSystemChange() {
    if (settings.theme !== "system") return;
    apply();
    window.dispatchEvent(
      new CustomEvent("fdn:appearance", {
        detail: { ...settings, resolvedTheme: resolvedTheme() },
      }),
    );
  }

  apply();

  if (systemDark?.addEventListener) {
    systemDark.addEventListener("change", onSystemChange);
  } else {
    systemDark?.addListener?.(onSystemChange);
  }

  window.FDN_APPEARANCE = {
    get: () => ({ ...settings, resolvedTheme: resolvedTheme() }),
    setTheme(theme) {
      if (themes.has(theme)) update({ theme });
    },
    setDensity(density) {
      if (densities.has(density)) update({ density });
    },
    setSkin(skin) {
      if (skins.has(skin)) update({ skin });
    },
    setCustomCss(css) {
      update({ customCss: typeof css === "string" ? css.slice(0, MAX_CSS) : "" });
    },
  };
})();
