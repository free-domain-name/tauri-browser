# Free Domain Browser documentation site

This folder is the static GitHub Pages site for **Free Domain Browser**. It has
no build step and no package dependencies: `index.html`, `stumble.html`,
`styles.css`, `site.js`, `stumble.js` and `assets/` are the whole site.

Published URL: <https://free-domain-name.github.io/tauri-browser/>

## Preview locally

From the repository root:

```bash
python3 -m http.server 8766 --directory docs
```

Then open <http://127.0.0.1:8766/>. Opening `index.html` directly also works,
but a local server is closer to Pages behavior.

## Publishing

The site is published from the `docs/` directory on `main`:

1. Repository **Settings → Pages**.
2. **Build and deployment → Source: Deploy from a branch**.
3. Branch: **main**, folder: **/docs**.
4. Save. GitHub Pages builds the folder directly; `.nojekyll` disables Jekyll.

Any change under `docs/` on `main` is republished automatically. There is no
Actions workflow and no generated output to commit.

## Screenshots

The screenshots are captured from the real browser UI at 1200×800. They live in:

```text
docs/assets/hero-default-dark.png       hero preview, dark
docs/assets/hero-default-light.png      hero preview, light
docs/assets/skins/<skin>-<theme>.png    seven skins × two themes
docs/assets/appearance-menu-crop.png    Appearance panel crop
docs/assets/og.png                       social preview image
```

The skin gallery swaps between the light and dark files when the site theme is
toggled. Keep both files for every skin when adding a new one.

## Editing notes

- The site uses system fonts and local images. Do not add analytics, remote
  fonts or additional third-party scripts without a privacy review.
- `stumble.html` / `stumble.js` read the public `reviews/index.json` snapshot
  from the registry and embed the matching GitHub Discussion with
  [giscus](https://giscus.app). giscus loads a GitHub-backed iframe from
  `giscus.app`; GitHub sign-in and comments happen inside that iframe. The page
  itself never posts comments or votes and has no analytics or tracking.
- The giscus app must be installed once on `free-domain-name/registry`, and the
  registry must have Discussions enabled, for the inline thread to load. The
  repository root has a `giscus.json` origin allowlist. GitHub's terms and
  privacy policy apply inside the embedded thread.
- `site.js` is dependency-free and handles the theme, screenshot switching,
  skin lightbox, copy button and mobile menu closing.
- Keep the disclaimer section and the no-AI community policy visible when
  changing the Stumble or review copy.
- Keep `docs/index.html` and `README.md` in sync when the public feature set
  changes.

## License

The documentation and screenshots are part of the repository and are
GPL-3.0-only, like the browser.
