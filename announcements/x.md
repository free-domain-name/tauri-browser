# X (Twitter) thread

Six posts. The number prefix is part of the character count and every post is 280 characters or fewer. Post 1 is written to work on its own if it is posted alone.

The counts below are raw characters. X rewrites every link as a 23-character `t.co` URL, so the effective count of a post with a link is shorter than the raw count.

---

## 1/6

> 1/6 Free Domain Browser: an open-source desktop browser that resolves a name against a community registry before public DNS. With a record, the browser keeps your name and a resolver proxy fetches it. Without one: normal DNS. GPL-3.0-only. https://free-domain-name.github.io/

## 2/6

> 2/6 How it works: the registry is a public GitHub repo. Each domain has community reviews, and votes are GitHub reactions on public Discussions. The project maps names onto targets other people run. It does not host them, and review scores are opinions, not security audits.

## 3/6

> 3/6 Point a short name like `myproject` inside a community-run namespace instead of only owning `myproject.tld`. Type it in the address bar: if the registry has a record, the name stays in the address bar and the resolver proxy fetches from the record's target.

## 4/6

> 4/6 Two desktop apps. The first is Tauri v2 (Rust + a plain web chrome), v0.1.0: universal macOS DMG, Windows MSI + NSIS, Linux AppImage + Debian package. The second is a CEF-based rewrite: a preview, no public binaries yet. Android is built from source.

## 5/6

> 5/6 A Chrome and Firefox Manifest V3 extension, "Free Domain Name Resolver", does the same resolution in your browser, over an HTTP resolver verified in both. The app has a community chat: peer-to-peer over iroh-gossip via a public relay, plus a project chat server.

## 6/6

> 6/6 Two caveats: the desktop builds are ad-hoc signed and not notarized, so macOS and Windows ask you to confirm at first launch. And HTTPS with TLS for overridden names is out of scope: they are plain HTTP. Downloads: https://github.com/free-domain-name/tauri-browser
