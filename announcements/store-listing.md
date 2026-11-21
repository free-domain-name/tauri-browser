# Store listings — "Free Domain Name Resolver" extension

Copy for the Chrome Web Store and for Firefox Add-ons (AMO). Both listings describe the same extension: Manifest V3, doing Free Domain Name registry resolution in an existing browser, over an HTTP resolver that has been verified in Chrome and Firefox.

> **Placeholders.** The published listing URLs do not exist yet. Until the listings are reviewed and published, use the placeholders below and replace them with the real IDs as soon as the review is done. Nothing else in this file should be changed when that happens.
>
> - Chrome Web Store: `https://chromewebstore.google.com/detail/<EXTENSION-ID>/`
> - Firefox Add-ons: `https://addons.mozilla.org/firefox/addon/<ADDON-SLUG>/`
> - Source (stable, use this one in the meantime): `https://github.com/free-domain-name/free-domain-name-extension`

> **Before submitting.** The permission list in these listings must match the shipped `manifest.json` exactly. If the manifest asks for anything that is not justified below, either drop it from the manifest or justify it here — a mismatch is the most common reason a listing gets rejected.

---

## Name

**Chrome Web Store:** Free Domain Name Resolver
**Firefox Add-ons:** Free Domain Name Resolver

25 characters, inside the 45-character limit of the Chrome Web Store.

---

## Short description

**Length: 130 characters (the limit for both stores).**

> Resolve free domain names from the community registry before public DNS. Names stay as typed, and overridden names use plain HTTP.

---

## Category

| Store | Category |
| --- | --- |
| Chrome Web Store | Utilities (secondary: Accessibility) |
| Firefox Add-ons | Privacy & Security (secondary: Web Navigation) |

---

## Full description

Resolve free domain names from the community Free Domain Name registry, inside the browser you already use.

The address bar takes a name. The extension checks the community registry first. If the registry has a record for that name, the browser keeps the name you typed and the extension fetches the content through the resolver from the record's target. If there is no record, the browser falls back to normal DNS and everything behaves as usual.

The point is short names in a community-run namespace. Instead of only owning `myproject.tld`, you can point `myproject` at an origin you run.

The registry is a public GitHub repository. Every domain has community reviews, and votes are GitHub reactions on public GitHub Discussions, so you can read the discussion and count the reactions yourself. The project does not host or endorse the destinations that people register, and the review scores are opinions, not security audits.

What this extension does not do:

- It does not install anything, and it does not read your browsing history, cookies, downloads or bookmarks.
- It does not collect data for the developer. It sends the name you type to the resolver in order to perform the lookup, because that is the lookup. Nothing is sent to the developer.
- It does not add analytics, tracking pixels, ad scripts or third-party fonts.
- It does not add HTTPS or TLS to overridden names. Overridden names are plain HTTP, and that is out of scope.
- It does not run remotely hosted code. Everything it does is in the package.

Free and open source, GPL-3.0-only. The extension is one part of a larger project that also ships a desktop browser for macOS, Windows and Linux.

Links:

- Project page: https://free-domain-name.github.io/tauri-browser/
- Registry: https://github.com/free-domain-name/registry
- Extension source: https://github.com/free-domain-name/free-domain-name-extension

---

## Permissions justification

Use this section verbatim in the Chrome Web Store "single purpose" and permission declarations, and in the Firefox AMO per-permission justification fields.

| Permission | Why it is needed |
| --- | --- |
| `storage` | To keep the extension's own settings, and to cache registry lookups locally so the same name is not looked up on every visit. The cache stays on your device. |
| `declarativeNetRequest` | To redirect a request for a name that the registry knows to the resolver, so the page loads from the record's target while the name you typed stays in the address bar. |
| `webRequest` | To observe navigation requests in the tab so the extension can tell which of them are registry names that need resolving. It is used for observation only; it does not read response bodies. |
| Host permission for the resolver origin | The extension has to be able to reach the resolver it uses for lookups. The permission is scoped to the resolver origin only, not to all sites. |

Host permissions are limited to the resolver. The extension is not granted access to the pages you visit, and it does not need it: the browser loads those pages itself.

---

## Privacy disclosures

| Item | Disclosure |
| --- | --- |
| Data collected by the developer | None. The developer receives no data from the extension. |
| Data sold | None. |
| Data shared with third parties | None beyond the functional request described below. |
| Analytics, tracking pixels, ad scripts, third-party fonts | None. This is also a rule of the project's registry community rules. |
| Accounts | The extension has no account, no login and no user identifier. |
| Remote code | None. The extension does not download or execute code at runtime. |
| Functional network request | To answer a lookup, the extension sends the name you type to the resolver it is configured to use. The response is used to resolve that navigation and is not sent to the developer. |
| Storage on device | Extension settings and cached registry records, kept locally. Clearing extension data removes them. |
| Privacy policy | `https://free-domain-name.github.io/tauri-browser/` — the project page carries the full privacy statement and points at the source. Replace with a dedicated privacy-policy URL if one is published before submission. |

---

## Chrome Web Store data safety answers

| Question | Answer |
| --- | --- |
| Does your extension collect or use any of the required user data types? | No. |
| Browsing history | Not collected. |
| Website content | Not collected. |
| User activity | Not collected. |
| Website's identifying information | Not collected. |
| PII or health information | Not collected. |
| Financial information | Not collected. |
| Authentication information | Not collected. |
| Personal communications | Not collected. |
| Location | Not collected. |
| Web history | Not collected. |
| Is any of the collected data used for tracking? | No data is collected, so nothing is used for tracking. The extension declares no advertising ID and no tracking purpose. |
| Is any of the collected data sold or transferred? | No data is collected, so nothing is sold or transferred. |
| Is any data used for purposes unrelated to the single purpose? | No. |
| Single purpose of the extension | Resolve free domain names from the community Free Domain Name registry before public DNS, so that a registry name can be opened and stays as typed. |
| Remote code execution | The extension does not download, generate or execute remotely hosted code. All logic is in the reviewed package. |
| Privacy policy | Required for a "no data collected" declaration. Use the project page URL, or a dedicated privacy policy if one exists by submission time. |
| Notes for reviewers | The extension makes one kind of network request: the name you type is sent to the resolver the extension is configured to use, so the lookup can be answered. That request is the feature. The response is used locally to resolve the navigation and is not forwarded to the developer. Host permissions are limited to the resolver origin. The source is public at https://github.com/free-domain-name/free-domain-name-extension under GPL-3.0-only. |

---

## Firefox Add-ons data and privacy answers

| Question | Answer |
| --- | --- |
| Does your extension collect user data? | No. Check the "I do not collect user data" box in the AMO data-consent form. |
| Is all of the user's data stored locally? | The extension stores its own settings and cached registry records locally. It does not store the pages you visit. |
| Does your extension transmit user data? | Only the name you type, sent to the resolver in order to perform the lookup. No data is transmitted to the developer. |
| Does your extension make requests to third-party services? | Yes, to the resolver it is configured to use. No other third-party requests are made. |
| Does your extension use remote code? | No. |
| Why is the extension requesting the permissions listed above? | Use the per-permission reasons from the permissions table. `storage` for settings and the local cache, `declarativeNetRequest` to redirect a registry name to the resolver, `webRequest` to observe which navigations need resolving, and host access for the resolver origin only. |
| Privacy policy URL | `https://free-domain-name.github.io/tauri-browser/` — replace with a dedicated privacy-policy URL if one is published before submission. |
| Homepage URL | `https://free-domain-name.github.io/tauri-browser/` |
| Support URL / email | `https://github.com/free-domain-name/free-domain-name-extension` |
| Developer name | Free Domain Name contributors |

---

## Shared review notes

- Both listings should state that overridden names are plain HTTP. It is the one limitation a reviewer or user is most likely to be surprised by.
- Both listings should state that the project maps names and does not run the destinations behind them.
- Do not describe the review scores as safety ratings in either listing. They are community opinions.
- Once the listings are live, replace the placeholder URLs at the top of this file and in the shared "Links" section of the full description with the real ones.
