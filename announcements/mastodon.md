# Mastodon

One standalone post, then a thread. Each block is a separate toot.

---

## Single post

**Intended length: 500 characters or fewer.**

> Free Domain Browser is a small open-source desktop browser that checks a name against a community registry before public DNS. If the registry has a record, the browser keeps the name you typed and a local resolver proxy fetches the content from that target. Otherwise it falls back to normal DNS. GPL-3.0-only.
>
> https://free-domain-name.github.io/tauri-browser/

---

## Thread

**Intended length: 6 posts, each 500 characters or fewer.**

### 1/6

> I built a small open-source desktop browser that resolves names in an unusual order: the community Free Domain Name registry first, public DNS second.
>
> It is one maintainer, GPL-3.0-only, and the code, the registry and the review discussions are all public. Here is how it works.

### 2/6

> You type a name. The browser checks the registry. If there is a record, the browser keeps the name you typed and a local resolver proxy fetches the content from the record's target. If there is no record, it falls back to normal DNS.
>
> So you can point a short name like `myproject` inside a community-run namespace, instead of only owning `myproject.tld`.

### 3/6

> The registry is a public GitHub repository. Each domain has community reviews, and votes are GitHub reactions on public GitHub Discussions — you can read the discussion and count the reactions yourself.
>
> The project maps names onto targets that other people run. It does not host them, and the review scores are opinions, not security audits.

### 4/6

> Two desktop apps. The first is Tauri v2 (Rust plus a plain web chrome), released as v0.1.0: universal macOS DMG, Windows MSI and NSIS, Linux AppImage and Debian package.
>
> The second is a CEF-based rewrite. That one is a preview — no public binaries yet.

### 5/6

> There is also a Chrome and Firefox Manifest V3 extension, "Free Domain Name Resolver", that does the same resolution in a browser you already have, over an HTTP resolver verified in both.
>
> The app also has a community chat: peer-to-peer over iroh-gossip through a public relay, plus a project chat server.

### 6/6

> Two caveats, stated plainly:
>
> 1. The desktop builds are ad-hoc signed and not notarized, so macOS may ask you to allow the app under System Settings → Privacy & Security, and Windows SmartScreen may ask you to confirm.
> 2. HTTPS with TLS for overridden names is out of scope — overridden names are plain HTTP.
>
> Source and downloads: https://github.com/free-domain-name/tauri-browser
>
> #FreeDomainName #opensource
