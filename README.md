# Free Domain Browser

A small cross-platform browser (desktop + Android) that resolves **any** name
through the community [Free Domain Name registry](https://github.com/free-domain-name/registry)
first, then falls back to public ICANN DNS. When a name exists in both places, it
asks the user which destination they want and remembers the answer for the
session.

Built with Tauri v2 (Rust + system webview) and a vanilla HTML/CSS/JS chrome.
Tabs, the address bar, history and the resolution status all live in the chrome;
each tab owns its own iframe so switching tabs keeps the page and its form state
alive.

## How resolution works

```
address bar
    │
    ▼
parse input ──► registry lookup (memory → disk → raw.githubusercontent.com)
    │                         │
    │                         ├── no record ──► .fdn name ──► CLAIM PAGE
    │                         │                └── other ────► public https://
    │                         │
    │                         └── record ──► does public DNS resolve?
    │                                           │
    │                                           ├── yes ──► CONFLICT MODAL
    │                                           │             ├── registry → fdn://
    │                                           │             └── public   → https://
    │                                           │
    │                                           └── no ────► fdn:// (instant)
    ▼
render in the content view
```

The Rust side returns a **navigation plan** to the UI; the UI never performs DNS
or GitHub requests itself. Plans are one of:

| `kind`        | Meaning                                                        |
| ------------- | -------------------------------------------------------------- |
| `navigate`    | Load `url`; `source` is `github_registry` or `public_icann`.   |
| `unregistered`| A `.fdn` name is absent from the registry. Show the claim page.|
| `conflict`    | Both exist. Show the modal and call `choose_resolution`.       |
| `unavailable` | GitHub could not be read. Retry, or opt into the public web.   |
| `error`       | Invalid input (for example a `javascript:` URL).               |

## Registry contract

One JSON file per name, fetched on demand from the raw CDN:

```text
https://raw.githubusercontent.com/free-domain-name/registry/main/e/x/a/m/example.com.json
https://raw.githubusercontent.com/free-domain-name/registry/main/t/e/s/t/test.xyz.json
```

```json
{
  "domain": "example.com",
  "target_url": "http://203.0.113.10:8080",
  "owner_github": "username",
  "ttl": 3600
}
```

The shard path is the domain with dots removed, padded to four characters, split
one character per directory. A short name pads with `_` (`a.co` →
`a/c/o/_/a.co.json`). Four levels give 37⁴ buckets and keep directories small.

`target_url` can be an IP literal or a hostname; an IP is the simplest
registration and behaves like an A record for HTTP. Use `http://` for a bare
IP — HTTPS certificates are issued to names, not addresses (unless the
certificate has an IP SAN). A port and a path are optional.

`ttl` is the client cache lifetime in seconds. Records live in memory
(`Arc<RwLock<HashMap<String, CachedRecord>>>`) and in
`app_cache_dir()/registry/<shard path>`. Negative (404) results are cached for
5 minutes. A stale positive record is served if GitHub is temporarily
unreachable.

There is deliberately **no `client.json`** and no global index: a single generated
index was the previous iteration and does not scale.

## Custom protocol proxying

Tauri cannot register `http`/`https` as custom schemes or globally intercept every
webview request. Registry destinations are therefore served through the `fdn`
scheme:

| Platform        | URL the webview loads      | Request the Rust handler sees |
| --------------- | -------------------------- | ----------------------------- |
| macOS / Linux / iOS | `fdn://example.com/path` | `fdn://example.com/path`      |
| Windows / Android   | `http://fdn.example.com/path` | `fdn://example.com/path`  |

Tauri maps the workaround URL and reverts it before calling
`register_asynchronous_uri_scheme_protocol`. The handler then:

1. looks the name up in the registry (cache first),
2. requests `target_url` with the requested path. A **hostname target** is
   fetched as itself, so CDNs and normal virtual hosts see the site they serve;
   an **IP-literal target** receives the registry name as `Host`, so one address
   can virtual-host many free names,
3. follows redirects internally (max 5),
4. strips framing/CSP headers so the page can render in the content view,
5. rewrites absolute URLs for the registry name and the target host to the
   proxy scheme, so links, CSS, images and JS keep flowing through the
   interceptor,
6. injects a tiny bridge script that reports the full in-page URL and title to
   the chrome. The chrome updates the address bar, tab title and history entry;
   `pushState`/`replaceState`, `popstate`, hash changes, link clicks and title
   mutations are all observed.

Public fallback pages are loaded over normal `https://` and are not proxied.

### Available `.fdn` names

`.fdn` is the registry's own namespace. If a `.fdn` name has no record, the
browser does **not** try public DNS: it shows an **Available** claim page with the
exact shard path, an IP-first JSON template, and buttons to open the registry's
GitHub "new file" flow with that JSON prefilled. After the pull request merges, the re-check button clears the
negative cache and resolves the name normally. A name in both the registry and
public DNS still shows the conflict modal; the claim page is only for registry
misses.

## Project layout

```text
ui/                      browser chrome (tabs, address bar, history, claim, modal)
src-tauri/
  Cargo.toml
  tauri.conf.json
  capabilities/default.json
  icons/
  src/
    lib.rs               Tauri entry point, commands, shared state
    registry.rs          sharded fetcher + memory/disk cache
    resolver.rs          input parsing, registry/public plan, conflict detection
    proxy.rs             fdn:// handler, redirects, header/HTML rewriting
    error.rs             serializable error type
```

## Commands

| Command                        | Description                                    |
| ------------------------------ | ---------------------------------------------- |
| `navigate(input)`              | Resolve an address-bar input into a plan.      |
| `choose_resolution(domain, path, choice)` | Remember `registry`/`public` and return the URL. |
| `forget_resolution(domain)`    | Forget a session choice.                       |
| `clear_registry_cache()`       | Drop memory and disk registry caches.          |
| `open_external(url)`           | Send an http(s) URL to the system browser.     |
| `browser_info()`               | Version, proxy base, registry base, platform.  |

On a conflict the Rust command also emits the `conflict-detected` event with the
same payload.

## Tabs and keyboard

`Ctrl/Cmd+T` opens a tab, `Ctrl/Cmd+W` closes the active one, `Ctrl/Cmd+L`
focuses the address bar, `Ctrl/Cmd+R` reloads, `Ctrl+Tab` cycles tabs, and
`Alt+Left`/`Alt+Right` walk the tab's own history. Middle-clicking a tab closes
it. Tabs are intentionally in-memory; a restart starts with one new tab.

## Build

Prerequisites: Rust 1.82+, Node 18+, the platform's Tauri system dependencies,
and for Android the Android SDK/NDK plus `cargo tauri android init`.

```bash
npm install
npm run dev                 # desktop dev
npm run build               # desktop bundle
npm run android:init        # once, generates src-tauri/gen/android
npm run android:dev
npm run android:build
```

The webview loads `ui/` directly; there is no bundler or dev server.

### Android notes

- `http://fdn.<domain>` is intercepted by the Tauri webview client and never
  leaves the device. Android 9+ may still apply its cleartext policy before
  interception; if a request is blocked, set
  `android:usesCleartextTraffic="true"` in the generated
  `src-tauri/gen/android/app/src/main/AndroidManifest.xml`.
- The generated `gen/android` project is not committed; `npm run android:init`
  recreates it.
- Multi-webview layouts are not available on Android, which is why the content
  view is an iframe (see limitations).

## Security model

- The main window (local chrome) has `core:default` and `opener:default`.
  Remote pages render in a cross-origin iframe and are not granted Tauri IPC
  capabilities.
- Registry records are trusted input for routing, not for code execution: the
  proxy fetches the target over HTTP(S) and treats the body as untrusted.
- The proxy strips `Content-Security-Policy`, `X-Frame-Options`,
  `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` from proxied
  responses so a destination can render inside the content view. This means a
  malicious destination loses those protections **inside this browser**; only
  visit names you trust.
- `target_url` must be `http(s)` with no credentials; the registry validator
  rejects wildcards, loops, and unknown fields.
- HTTPS targets use `rustls` with normal certificate validation. There is no
  "ignore certificate errors" switch.
- Cookies are passed through, but `Domain=` and `Secure` attributes are dropped
  because the proxy origin is `fdn.<domain>` / `fdn://`. Sessions may not survive
  on every platform.

## Known limitations (v1)

- **Framing:** public sites that send `X-Frame-Options`/`frame-ancestors` refuse
  the iframe. Use the external-open button for those. Registry destinations are
  unaffected because the proxy strips those headers.
- **Interception scope:** only navigations that go through `fdn://` are proxied.
  A page on the public web that links to a registry name goes to the public web
  until the address bar is used again.
- **Buffered responses:** Tauri's URI-scheme responder needs a complete body, so
  large downloads and video are buffered up to 64 MiB. Streaming needs a
  different transport (local proxy or range-aware response).
- **Redirects:** followed inside the proxy, up to five. The final page is served
  under the registry name, so absolute links to a different host leave the proxy
  and are not tracked in the address bar.
- **History:** the chrome tracks address-bar navigations and registry in-page
  navigations reported by the bridge, per tab. Link clicks on public iframes
  cannot be observed because they are cross-origin.
- **Tabs:** each tab is an iframe in the single webview (multi-webview is not
  available on Android). A tab that navigates to a site which refuses framing
  shows the browser's blank/error frame; use the external-open button.
- **No wildcard records:** the current registry schema is exact-name only.
- **Session choices** are in memory and disappear when the app exits.

## Tests

```bash
cd src-tauri && cargo test --lib
```

20 tests cover shard-path derivation (Rust and Node must agree), input parsing,
the unregistered `.fdn` branch, URL rewriting, cookie sanitization, the bridge
and error-page escaping. Three `#[ignore]` live tests check the real registry
and DNS:

```bash
cd src-tauri && cargo test --lib -- --ignored
```

The registry validates itself with:

```bash
cd /path/to/registry && node scripts/validate.mjs
```

## License

GPL-3.0-only. See [LICENSE](LICENSE).
