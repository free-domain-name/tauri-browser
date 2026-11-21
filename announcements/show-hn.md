# Show HN — Free Domain Browser

Post the title as written, then the body. Nothing below is marketing copy; it is the plain description of what the project does.

---

## Title

**Length: 69 characters (limit 80).**

> Show HN: Free Domain Browser – resolve community registry names first

---

## Body

> Hi — I built a small desktop browser that resolves names through a community registry before it asks public DNS.
>
> **What it is.** Free Domain Browser is an open-source browser where you can point a short name, like `myproject`, inside a community-run namespace instead of only owning `myproject.tld`. It is a Tauri v2 app (Rust plus a plain web chrome), GPL-3.0-only, with a Chrome and Firefox extension that does the same thing inside a browser you already have.
>
> **How it works.** The address bar takes a name and the browser looks it up in the Free Domain Name registry, which is a public GitHub repository.
>
> - Registry has a record: the browser keeps the name you typed, and a local resolver proxy fetches the content from the record's target. The address bar still shows the name, not an IP address.
> - No record: it falls back to normal DNS, so ordinary sites behave normally.
>
> The registry is public and per-domain community reviews live in GitHub Discussions. Votes are GitHub reactions on those Discussions, so you can read the discussion and count the votes yourself.
>
> **Why it exists.** I wanted a name inside a community namespace without buying a TLD for it, and I wanted the mapping to be public and reviewable instead of sitting behind a registrar. A registry record points to a target that someone else runs; the browser only maps the name and fetches it. The project does not operate the sites, and the review scores are opinions, not security audits.
>
> **What is not done yet.**
>
> - The CEF-based rewrite (Chromium Embedded Framework) is a preview. There are no public binaries for it.
> - The desktop builds are ad-hoc signed and are not notarized. On macOS you may have to allow the app under System Settings → Privacy & Security; on Windows SmartScreen may ask you to confirm the first launch. This is the usual friction with an unsigned hobby build.
> - HTTPS and TLS for overridden names are out of scope, so overridden names are plain HTTP.
> - Android is currently built from source.
>
> **Downloads.** v0.1.0 ships a universal macOS DMG, a Windows MSI and NSIS installer, and a Linux AppImage and Debian package: <https://github.com/free-domain-name/tauri-browser/releases>
>
> **Links.**
>
> - Browser page and quick start: <https://free-domain-name.github.io/tauri-browser/>
> - Registry (records and discussions): <https://github.com/free-domain-name/registry>
> - Extension for Chrome and Firefox: <https://github.com/free-domain-name/free-domain-name-extension>
> - Source: <https://github.com/free-domain-name/tauri-browser>
>
> The app also has a community chat (peer-to-peer over iroh-gossip through a public relay, plus a project chat server), seven skins with a skin editor, light/dark/system themes, a compact density mode, Do Not Track and per-tab settings.
>
> I am one maintainer and this is a side project. The registry rules say no AI-generated domains, reviews or comments, and no analytics, tracking pixels, ad scripts or third-party fonts on the sites. If something in it is useful to you, the registry and the discussions are the places to look around.
