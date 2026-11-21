# Reddit posts

Three separate posts, one per community. Each is written to be self-contained and to be posted as-is: lead with the substance, no vote begging, no links to the other two posts. Only the project's own pages are linked.

---

# Post 1 — r/privacy

## Title

> Free Domain Browser: an open-source browser that resolves a community name registry before public DNS (GPL-3.0-only)

## Body

The technical part first, because it is the interesting part.

Free Domain Browser is a desktop browser that changes one thing about how a name is resolved: it checks a community registry first, and falls back to public DNS when there is no record. If the registry has a record for the name you typed, the browser keeps the name in the address bar and a local resolver proxy fetches the content from the record's target. The resolution path itself adds nothing: no search redirect, no injected scripts. The lookup is a read of a public JSON file in a public GitHub repository, and the fetch is an ordinary request to whatever host the record points at.

Privacy properties that are actually relevant here:

- **The registry is public and boring.** Records live in a public GitHub repository. Each domain has a discussion with community reviews, and votes are GitHub reactions on public GitHub Discussions. Nothing about the registry is hidden from you, and the reviews are opinions, not audits.
- **The project does not run the destinations.** The registry maps names to targets that other people operate. The project does not host, monitor or endorse them.
- **Do Not Track is shipped.** It is a header, and headers are advisory — it is not an anonymity guarantee and it does not hide your IP address. I would rather say that plainly than let the feature list imply more than it does.
- **Registry sites are held to rules.** No analytics, tracking pixels, ad scripts or third-party fonts on the sites. No AI-generated domains, reviews or comments. The rules are part of the registry's community process, and they are enforced by people, not by code.
- **The code is GPL-3.0-only.** If you want to know what the resolver does with your keystrokes, the answer is in the source. There is no closed binary doing the resolving; the Tauri v2 app is Rust plus a plain web chrome.
- **The in-app chat is peer-to-peer.** It runs over iroh-gossip through a public relay, so the relay is transport for the traffic rather than a place where the project keeps the conversation. There is also a separate project chat server for project discussion.
- **The extension requests the minimum.** The Chrome and Firefox Manifest V3 extension ("Free Domain Name Resolver") resolves names in a browser you already have. It needs permission to talk to the resolver and to store local cache and settings; it does not need access to your browsing history, cookies or downloads. The listing's permission justifications spell this out.

Two honest limits, so this is not read as more than it is:

- HTTPS and TLS for overridden names are out of scope. Overridden names are served over plain HTTP. That is a real weakness, not a footnote: an overridden name is not protected by transport security.
- The desktop builds are ad-hoc signed and are not notarized, so macOS and Windows will ask you to confirm the first launch. That friction is about packaging, not about the privacy properties above, but it is part of what you are installing.

The project page and the source are linked below. If you read the code and find something in the resolution path that does not match this description, I would rather know.

- Browser page: <https://free-domain-name.github.io/tauri-browser/>
- Source: <https://github.com/free-domain-name/tauri-browser>
- Registry: <https://github.com/free-domain-name/registry>

---

# Post 2 — r/netsec

## Title

> Threat model for a browser that resolves community-registered names to arbitrary HTTP targets

## Body

I maintain a small open-source browser called Free Domain Browser. It resolves names against a community registry before public DNS, and it is the kind of thing that deserves an honest threat model rather than a feature list. Here is mine.

**The mechanism.** The address bar takes a name. The browser checks the community registry, which is a public GitHub repository of JSON records. If a record exists, the browser keeps the name you typed and a local resolver proxy fetches the content from the record's target — an arbitrary host and port chosen by whoever registered the name. If no record exists, the browser falls back to normal DNS.

**What that means for a user.** The name you type is a pointer into a namespace controlled by a community, not by a registrar. A record can send you anywhere. There is no integrity guarantee on that path in this design: HTTPS and TLS for overridden names are out of scope, so an overridden name is plain HTTP. If you need transport security for what you load, do not rely on the registry path. This is the single most important thing to know about the project, and I put it in the README and the documentation rather than in a footnote.

**What the review scores are.** Each domain has a community review, and votes are GitHub reactions on public GitHub Discussions. They are opinions. They are not security audits, not penetration tests, and not a provenance check on the operator behind a record. The registry's disclaimer says the same. If you are using the scores as an input to a decision, treat them as reputation signals in the way you would treat a forum vote — not as assurance.

**Who can register.** The registry is open, and the community rules prohibit AI-generated domains, reviews and comments. Those rules are social, not cryptographic — they are conventions that people apply, not a technical control, and I do not want to imply otherwise.

**Supply chain.** The desktop builds are ad-hoc signed and are not notarized. macOS may ask you to allow the app under System Settings → Privacy & Security, and Windows SmartScreen may ask you to confirm. That means the platform's signing chain is not doing anything for you here. The mitigation is the boring one: GPL-3.0-only source, builds from GitHub Actions, and a version you can read before you run it. Android is currently built from source only.

**The extension.** There is a Chrome and Firefox Manifest V3 extension, "Free Domain Name Resolver", that does the same resolution over an HTTP resolver verified in Chrome and Firefox. It requests host access for the resolver and local storage for cache and settings; it does not need browsing history, cookies or download permissions. The store listing documents each permission.

**The chat.** The in-app community chat is peer-to-peer over iroh-gossip through a public relay. The relay is transport for the traffic; the project does not keep a central copy of the chat. There is a separate project chat server for project discussion.

If you want to pick at it, the resolution path is Rust in `src-tauri/` and the chrome is plain HTML/CSS/JS in `ui/`. Source and registry are linked below. Concrete criticism is more useful to me than applause.

- Source: <https://github.com/free-domain-name/tauri-browser>
- Registry and its disclaimer: <https://github.com/free-domain-name/registry>
- Browser page: <https://free-domain-name.github.io/tauri-browser/>

---

# Post 3 — r/opensource

## Title

> Free Domain Browser: a GPL-3.0-only desktop browser with a public, reviewable name registry

## Body

Free Domain Browser is a small open-source desktop browser that resolves names through a community registry first and public DNS second. It is a one-maintainer side project, GPL-3.0-only, with the code, the registry and the review discussions all public.

**What it does.** Type a name in the address bar. If the community registry has a record for it, the browser keeps the name you typed and a local resolver proxy fetches the content from the record's target. If there is no record, it falls back to normal DNS. The practical effect: you can point a short name like `myproject` inside a community-run namespace instead of only owning `myproject.tld`.

**What is in the repository.**

- The desktop app: Tauri v2, Rust plus a plain web chrome. v0.1.0 ships a universal macOS DMG, a Windows MSI and NSIS installer, and a Linux AppImage and Debian package.
- A CEF-based rewrite (Chromium Embedded Framework). It is a preview. There are no public binaries for it yet, and I am not pretending otherwise.
- A Chrome and Firefox Manifest V3 extension, "Free Domain Name Resolver", that does the same resolution in a browser you already have, over an HTTP resolver verified in Chrome and Firefox.
- The registry itself: a public GitHub repository of JSON records, one per name, with community reviews per domain. Votes are GitHub reactions on public GitHub Discussions, so the discussion and the counts are inspectable rather than proprietary.

**Platforms and features.** macOS, Windows and Linux from the release page; Android is currently built from source. Seven skins with a skin editor, system/light/dark themes, a compact density mode, Do Not Track, a custom-protocol proxy and per-tab settings. The in-app community chat is peer-to-peer over iroh-gossip through a public relay, plus a project chat server.

**Rules of the registry, for anyone who wants to contribute.** No AI-generated domains, reviews or comments. No analytics, tracking pixels, ad scripts or third-party fonts on the sites. Review scores are opinions, not security audits. The project maps names; it does not run them.

**What is not done.** The desktop builds are ad-hoc signed and are not notarized, so macOS and Windows ask you to confirm the first launch. HTTPS and TLS for overridden names are out of scope, so overridden names are plain HTTP. The CEF build has no public binaries. Android is a from-source build.

If you want to try it: the browser page has the quick start and the skin gallery, the releases page has the installers, and the repository has the source and the build instructions.

- Browser page: <https://free-domain-name.github.io/tauri-browser/>
- Releases: <https://github.com/free-domain-name/tauri-browser/releases>
- Source: <https://github.com/free-domain-name/tauri-browser>
- Registry: <https://github.com/free-domain-name/registry>
- Extension: <https://github.com/free-domain-name/free-domain-name-extension>
