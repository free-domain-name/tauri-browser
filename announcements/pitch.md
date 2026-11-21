# Free Domain Browser — pitch deck

Reusable copy blocks. Pick the block that fits the slot you are filling and paste it. Nothing here claims user counts, download counts, benchmarks, partnerships or dates that are not in the repository.

---

## One-liner

**Intended length: 77 characters (limit 90).**

> A desktop browser that resolves free domain registry names before public DNS.

---

## Short pitch

**Intended length: three sentences, about 80 words.**

> Free Domain Browser is a small open-source desktop browser that checks a name against the community Free Domain Name registry before public DNS. If the registry has a record for that name, the browser keeps the name you typed and a local resolver proxy fetches the content from the record's target; if there is no record, it falls back to normal DNS. That lets you point a name like `myproject` inside a community-run namespace, instead of only owning `myproject.tld`.

---

## One-paragraph pitch

**Intended length: about 120 words.**

> Free Domain Browser is a small open-source desktop browser that resolves names through the community Free Domain Name registry first, and public DNS second. Type `myproject` in the address bar: if the registry holds a record for it, the browser keeps the name you typed, and a local resolver proxy fetches the content from the record's target. If no record exists, the browser falls back to normal DNS. The registry is a public GitHub repository with community reviews per domain, and votes are GitHub reactions on public GitHub Discussions. The Tauri v2 build (v0.1.0) ships for macOS, Windows and Linux, and a Chrome and Firefox extension resolves the same names in a browser you already use. It is GPL-3.0-only.

---

## Long pitch

**Intended length: about 400 words.**

> Free Domain Browser is a small open-source desktop browser that resolves names in an order most browsers do not: the community Free Domain Name registry first, public DNS second.
>
> Type a name and the browser checks the registry. If the community registry has a record for that name, the browser keeps the name you typed, and a local resolver proxy fetches the content from the record's target — the name stays in the address bar instead of being replaced by an IP address. If the registry has no record, the browser falls back to normal DNS. The practical effect is that you can own or point a name like `myproject` inside a community-run namespace, rather than only owning `myproject.tld`.
>
> The registry is public and lives on GitHub. Every domain has a community review, and votes are GitHub reactions on public GitHub Discussions, so the discussion is public. The project does not operate or endorse the destinations people register, and the review scores are opinions, not security audits.
>
> There are two desktop apps. The first is a Tauri v2 app — Rust plus a plain web chrome — released as v0.1.0 with a universal macOS DMG, a Windows MSI and NSIS installer, and a Linux AppImage and Debian package. The second is a rewrite based on the Chromium Embedded Framework; it is a preview, with no public binaries. There is also a Chrome and Firefox Manifest V3 extension, "Free Domain Name Resolver", doing the same resolution inside a browser you already use, over an HTTP resolver verified in Chrome and Firefox.
>
> The app carries a community chat that is peer-to-peer over iroh-gossip through a public relay, plus a separate project chat server. It has seven skins, a skin editor, system, light and dark themes, a compact density mode, Do Not Track, a custom-protocol proxy and per-tab settings. Android is currently built from source.
>
> Two things stated plainly. The desktop builds are ad-hoc signed and are not notarized: macOS may ask you to allow the app under System Settings → Privacy & Security, and Windows SmartScreen may ask you to confirm. And HTTPS with TLS for overridden names is out of scope, so overridden names are plain HTTP.
>
> The code is GPL-3.0-only. The registry has community rules: no AI-generated domains, reviews or comments, and no analytics, tracking pixels, ad scripts or third-party fonts on the sites. The project maps names. It does not run them.

---

## What it is not

**Intended length: five bullets.**

- **Not a registrar.** It does not sell, renew or hold domain names, and it does not replace the public root or your normal DNS.
- **Not a security audit.** The review scores and comments on a registry record are community opinions, not vulnerability assessments.
- **Not a host.** The project maps names onto targets that people register. It does not run the sites behind them.
- **Not a new browser engine.** The desktop app is a Rust shell around a plain web chrome; the Chromium Embedded Framework rewrite is a preview without public binaries.
- **Not an anonymity guarantee.** Do Not Track sends a header. It does not hide your IP address, and the resolver proxy still has to talk to the registry and to the target.

---

## Who it is for

**Intended length: five bullets.**

- People who want a short name inside a community-run namespace and do not want to buy a TLD to get one.
- People already running a small site on a plain HTTP origin who want a memorable name in front of it.
- People who like reading a public registry, with community reviews per domain and votes that are GitHub reactions on public Discussions.
- People who would rather use Chrome or Firefox they already have, and install the Manifest V3 "Free Domain Name Resolver" extension instead of a separate browser.
- People who want to read the code, change it, or build it themselves: GPL-3.0-only, with an Android build that is currently compiled from source.

---

## Links

| Purpose | URL |
| --- | --- |
| Project home | <https://free-domain-name.github.io/> |
| Browser page | <https://free-domain-name.github.io/tauri-browser/> |
| Reviews / stumble page | <https://free-domain-name.github.io/tauri-browser/stumble.html> |
| Releases | <https://github.com/free-domain-name/tauri-browser/releases> |
| Registry | <https://github.com/free-domain-name/registry> |
| Extension repository | <https://github.com/free-domain-name/free-domain-name-extension> |
| Repository | <https://github.com/free-domain-name/tauri-browser> |
