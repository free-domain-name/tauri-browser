# Press kit — Free Domain Browser

Everything in this file is fact-checked against the repository. If you need something that is not here, ask; do not extrapolate.

---

## Fact sheet

| Field | Detail |
| --- | --- |
| Name | Free Domain Browser |
| What it is | A small open-source desktop browser that resolves names against the community Free Domain Name registry before public DNS. If the registry has a record for the name, the browser keeps the name you typed and a local resolver proxy fetches the content from the record's target. If there is no record, it falls back to normal DNS. |
| Who builds it | One maintainer, with community contributions. The registry and its reviews are run by the community. |
| License | GPL-3.0-only |
| Current version | v0.1.0 (Tauri v2 desktop app) |
| Platforms | macOS (universal DMG, Apple Silicon and Intel), Windows x64 (MSI and NSIS installer), Linux x64 (AppImage and Debian package). Android is currently built from source. A CEF-based rewrite is a preview without public binaries. |
| Extension | "Free Domain Name Resolver" — Manifest V3 for Chrome and Firefox, over an HTTP resolver verified in Chrome and Firefox. |
| Registry | Public GitHub repository, one record per name, with community reviews per domain. Votes are GitHub reactions on public GitHub Discussions. |
| Written in | Rust (Tauri v2 app), plain HTML/CSS/JS (browser chrome) |

### Features

- Registry-first resolution of names, with fallback to normal DNS.
- A local resolver proxy that fetches content from the record's target while the typed name stays in the address bar.
- Community reviews per domain in the public registry, with votes as GitHub reactions on public GitHub Discussions.
- A community chat inside the app, peer-to-peer over iroh-gossip through a public relay, plus a project chat server.
- Seven skins and a skin editor.
- System, light and dark themes, plus a compact density mode.
- Do Not Track.
- A custom-protocol proxy.
- Per-tab settings.
- A Chrome and Firefox Manifest V3 extension that resolves the same names in an existing browser.

### Honest limitations

- **The desktop builds are ad-hoc signed and are not notarized.** macOS may ask the user to allow the app under System Settings → Privacy & Security, and Windows SmartScreen may ask for confirmation. This is expected on first launch.
- **HTTPS with TLS for overridden names is out of scope.** Overridden names are served over plain HTTP. The same limitation applies to the extension.
- **The CEF-based rewrite is a preview.** There are no public binaries for it.
- **Android is built from source only.** There is no store package.
- **The review scores are opinions, not security audits.** They are GitHub reactions on public Discussions.
- **The project maps names; it does not run them.** Destinations are operated by other people, and the project does not host, monitor or endorse them.
- **Registry community rules are social, not technical.** No AI-generated domains, reviews or comments; no analytics, tracking pixels, ad scripts or third-party fonts on the sites.
- There are no user counts, download counts, benchmark numbers or third-party partnerships to quote, and there is no roadmap with dates in this press kit.

---

## Boilerplate

### 50 characters

**Length: 50 characters.**

> Browser that resolves free domain names before DNS

### 100 characters

**Length: 100 characters.**

> Free Domain Browser: an open-source desktop browser that resolves community names before public DNS.

### 500 characters

**Length: 500 characters.**

> Free Domain Browser is a small open-source desktop browser that resolves names against the community Free Domain Name registry before public DNS. If the registry has a record for the name you typed, the browser keeps it in the address bar and a local resolver proxy fetches the content from that target; otherwise it falls back to normal DNS. The registry is public on GitHub, with community reviews per domain. The Tauri v2 app (v0.1.0) ships for macOS, Windows and Linux. GPL-3.0-only.

---

## Links

| Purpose | URL |
| --- | --- |
| Project home | <https://free-domain-name.github.io/> |
| Browser page (docs, quick start, skin gallery) | <https://free-domain-name.github.io/tauri-browser/> |
| Reviews / stumble page | <https://free-domain-name.github.io/tauri-browser/stumble.html> |
| Releases (downloads) | <https://github.com/free-domain-name/tauri-browser/releases> |
| Registry (records and discussions) | <https://github.com/free-domain-name/registry> |
| Extension repository | <https://github.com/free-domain-name/free-domain-name-extension> |
| Repository | <https://github.com/free-domain-name/tauri-browser> |

---

## Media assets

All paths are relative to the repository root. Copy the files from there; do not re-encode the PNGs, they are already at publish size.

| Path | Size | Suggested use |
| --- | --- | --- |
| `docs/assets/og.png` | 1200×630 | Link preview / Open Graph card for any post that links to the project. Use it as-is, without cropping or text overlays. |
| `docs/assets/hero-default-dark.png` | Screenshot of the app start page in the dark Default skin | Hero image for pages and posts that use a dark background, and for video end cards. |
| `docs/assets/hero-default-light.png` | Screenshot of the app start page in the light Default skin | Hero image for pages and posts that use a light background, and for print. |
| `docs/assets/skins/default-dark.png` | Screenshot, Default skin, dark theme | Skin gallery: the default look. |
| `docs/assets/skins/default-light.png` | Screenshot, Default skin, light theme | Skin gallery: the default look. |
| `docs/assets/skins/amazon-dark.png` | Screenshot, Amazon skin, dark theme | Skin gallery. |
| `docs/assets/skins/amazon-light.png` | Screenshot, Amazon skin, light theme | Skin gallery. |
| `docs/assets/skins/futuristic-dark.png` | Screenshot, Futuristic skin, dark theme | Skin gallery. |
| `docs/assets/skins/futuristic-light.png` | Screenshot, Futuristic skin, light theme | Skin gallery. |
| `docs/assets/skins/high-tech-dark.png` | Screenshot, High Tech skin, dark theme | Skin gallery. |
| `docs/assets/skins/high-tech-light.png` | Screenshot, High Tech skin, light theme | Skin gallery. |
| `docs/assets/skins/historic-dark.png` | Screenshot, Historic skin, dark theme | Skin gallery. |
| `docs/assets/skins/historic-light.png` | Screenshot, Historic skin, light theme | Skin gallery. |
| `docs/assets/skins/terminal-dark.png` | Screenshot, Terminal skin, dark theme | Skin gallery. |
| `docs/assets/skins/terminal-light.png` | Screenshot, Terminal skin, light theme | Skin gallery. |
| `docs/assets/skins/victorian-dark.png` | Screenshot, Victorian skin, dark theme | Skin gallery. |
| `docs/assets/skins/victorian-light.png` | Screenshot, Victorian skin, light theme | Skin gallery. |
| `docs/assets/appearance-menu-crop.png` | Cropped screenshot of the appearance menu | Use for sentences about skins, themes and the skin editor. The crop is already tight; do not add borders. |
| `docs/assets/icon.svg` | Vector app icon (an open orbit around a teal planet) | App icon, favicon, avatar. It is vector, so it scales to any size. |

Seven skins, two themes each: `default`, `amazon`, `futuristic`, `high-tech`, `historic`, `terminal`, `victorian`.
