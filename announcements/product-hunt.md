# Product Hunt listing

---

## Tagline

**Length: 41 characters (limit 60).**

> Resolve community names before public DNS

---

## Listing description

Free Domain Browser is a small open-source desktop browser that resolves names through a community registry before it asks public DNS.

You type a name in the address bar. If the community Free Domain Name registry has a record for it, the browser keeps the name you typed and a local resolver proxy fetches the content from the record's target. If there is no record, the browser falls back to normal DNS. The practical effect: you can point a short name like `myproject` inside a community-run namespace, instead of only owning `myproject.tld`.

The registry is a public GitHub repository. Every domain has community reviews, and votes are GitHub reactions on public GitHub Discussions, so the discussion and the counts are readable by anyone. The project maps names onto targets that other people operate — it does not host them, and the review scores are opinions, not security audits.

Two desktop apps exist. The first is a Tauri v2 app (Rust plus a plain web chrome), released as v0.1.0 with a universal macOS DMG, a Windows MSI and NSIS installer, and a Linux AppImage and Debian package. The second is a CEF-based rewrite (Chromium Embedded Framework), which is a preview without public binaries. There is also a Chrome and Firefox Manifest V3 extension, "Free Domain Name Resolver", that does the same resolution inside a browser you already use, over an HTTP resolver verified in Chrome and Firefox.

Also included: a community chat that is peer-to-peer over iroh-gossip through a public relay, plus a project chat server; seven skins with a skin editor; system, light and dark themes; a compact density mode; Do Not Track; a custom-protocol proxy; and per-tab settings. Android is currently built from source.

Worth knowing before you install: the desktop builds are ad-hoc signed and are not notarized, so macOS may ask you to allow the app under System Settings → Privacy & Security, and Windows SmartScreen may ask you to confirm. HTTPS with TLS for overridden names is out of scope, so overridden names are plain HTTP. The license is GPL-3.0-only.

Links:

- Browser page and quick start: https://free-domain-name.github.io/tauri-browser/
- Downloads: https://github.com/free-domain-name/tauri-browser/releases
- Registry: https://github.com/free-domain-name/registry
- Extension: https://github.com/free-domain-name/free-domain-name-extension

---

## Maker's first comment

> Thanks for looking. A bit more detail on how the resolution actually works, since that is the whole idea.
>
> The address bar takes a name. The browser checks the community Free Domain Name registry, which is a public GitHub repository of JSON records. Two outcomes:
>
> 1. **There is a record.** The browser keeps the name you typed, and a local resolver proxy fetches the content from the record's target. The name stays in the address bar instead of being replaced by an IP address or a hostname. A record's target is an origin — host and optional port — chosen by whoever registered the name.
> 2. **There is no record.** The browser falls back to normal DNS, so ordinary sites behave the way they always have.
>
> A few things I want to be clear about, because they are easy to oversell:
>
> - **The review scores are opinions.** They are GitHub reactions on public GitHub Discussions. They are not security audits, and the registry's own disclaimer says so.
> - **The project maps names, it does not run them.** Destinations are operated by other people. The project does not host or endorse them.
> - **HTTPS with TLS for overridden names is out of scope.** Overridden names are plain HTTP. If you need transport security, use ordinary DNS.
> - **The desktop builds are ad-hoc signed and not notarized.** macOS and Windows will ask you to confirm the first launch. That is the packaging reality of an unsigned hobby build.
>
> The code is GPL-3.0-only, so if the resolution path matters to you, it is there to read. The registry repository is the best place to start: read a few records, read the discussions, and see whether the whole idea makes sense to you.
>
> If you try it, the thing I would most like feedback on is whether a registry name inside a community namespace is useful to you at all — and if not, why not. That is more useful to me than feature requests.

---

## Maker update comment

> Update on where the project stands, so the listing text and the state of the repo do not drift apart.
>
> **Live now**
>
> - Tauri v2 desktop app, v0.1.0: universal macOS DMG, Windows MSI and NSIS installer, Linux AppImage and Debian package, on the releases page.
> - The public registry on GitHub, with per-domain community reviews. Votes are GitHub reactions on public GitHub Discussions, so you can read the discussion and count the reactions yourself.
> - The community chat inside the app, peer-to-peer over iroh-gossip through a public relay, plus a project chat server for project discussion.
> - Seven skins with a skin editor, system/light/dark themes, a compact density mode, Do Not Track, a custom-protocol proxy and per-tab settings.
> - The Chrome and Firefox Manifest V3 extension, "Free Domain Name Resolver", doing the same resolution over an HTTP resolver verified in both browsers. The store listings are going up now, so the published URLs are placeholders until then.
>
> **Still not done**
>
> - The CEF-based rewrite (Chromium Embedded Framework) is a preview. There are no public binaries for it, and I would rather say that than ship something half-built.
> - The desktop builds remain ad-hoc signed and not notarized, so the first-launch confirmation on macOS and Windows is expected.
> - HTTPS with TLS for overridden names is out of scope for now; overridden names are plain HTTP.
> - Android is a from-source build only; there is no store package.
>
> **Rules the registry runs on**, since they shape what you will find there: no AI-generated domains, reviews or comments, and no analytics, tracking pixels, ad scripts or third-party fonts on the sites.
>
> Questions, corrections or something that does not work on your machine are all useful. The registry discussions and the project chat server are the places for them.

---

## FAQ

**1. How do I get a name for my own site?**
A registry record points at a target you control — an origin you run, reachable over HTTP. Records live in the public registry repository on GitHub, one file per name, with a community review and a discussion thread for each. You claim the name in the registry, point it at your server, and the name then resolves in browsers that use this resolver or the extension.

**2. Are the review scores and comments a security audit?**
No. They are community opinions, expressed as GitHub reactions on public GitHub Discussions. They are useful as reputation signals, in the same way a forum vote is. They are not vulnerability assessments, and no one on the project has audited the destinations that people register.

**3. Why does macOS or Windows ask me to confirm the first launch?**
The desktop builds are ad-hoc signed and are not notarized. macOS may ask you to allow the app under System Settings → Privacy & Security, and Windows SmartScreen may ask you to confirm. The code is GPL-3.0-only, so it is there to read before you run it.

**4. Can I use this in Chrome or Firefox instead of the desktop app?**
Yes. The "Free Domain Name Resolver" extension is a Manifest V3 extension for Chrome and Firefox. It does the same resolution over an HTTP resolver that has been verified in both browsers. HTTPS with TLS for overridden names is out of scope, so overridden names are plain HTTP.

**5. Is the project open source, and under what license?**
GPL-3.0-only. The desktop app is a Tauri v2 project (Rust plus a plain web chrome); the CEF-based rewrite is a preview without public binaries. Android is currently built from source, and the source for everything is in the repository.
