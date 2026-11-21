# Changelog

All notable changes to Free Domain Browser are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The release notes of the latest release are now shown on the documentation
  site, so the site and the release cannot drift apart.
- The documentation site shows the rolling seven-day review leaderboard and
  links to the registry, so a visitor can see what the community is doing
  before downloading anything.
- The community chat has its own section on the site.
- The Chrome and Firefox resolver extension is listed next to the desktop
  builds, because it needs no installer and no signature.

### Changed

- The download section now spells out the first-launch steps for macOS and
  Windows instead of mentioning the problem in one sentence.
- Every release publishes a `checksums.txt` with the SHA-256 of each asset.
- The release workflow signs and notarizes the macOS build when the Apple
  secrets are present, and signs the Windows installers when an Authenticode
  certificate is present.

## [0.1.0] - 2026-11-11

The first public release. Desktop builds for macOS, Windows and Linux, built
by GitHub Actions from the tagged commit.

### Added

- Registry-first resolution: every address-bar navigation is checked against
  the Free Domain Name registry before public DNS, and a registry record is
  fetched through the local `fdn://` proxy.
- Conflict handling: when the registry and public DNS both answer, a chooser
  shows both destinations and remembers the choice for the session.
- A claim page for names that are not registered anywhere.
- A tab strip with in-memory tabs, keyboard navigation and a status pill that
  says whether a name came from the registry, from public DNS, from a
  conflict, or is available to claim.
- Seven skins, a light/dark/system theme, a compact density mode and a CSS
  editor for the chrome.
- Community reviews per domain, rendered from the registry and linked to the
  GitHub discussion behind each review.
- A community chat panel that talks to the iroh gossip service.
- A settings overlay with the appearance, privacy and registry options.
- `fdn://` link handling, retry error pages and an external-open button for
  pages that refuse to be framed.
- Android builds from source.

### Known limitations

- The macOS build is ad-hoc signed and not notarized, and the Windows
  installers are unsigned, so both operating systems ask once on first
  launch.
- Downloads are buffered up to 64 MiB, because the URI-scheme responder needs
  a complete body.
- Tabs live in memory. A restart begins with one new tab.
- Public sites that send `X-Frame-Options` or `frame-ancestors` cannot be
  shown in the content view; use the external-open button instead.

[Unreleased]: https://github.com/free-domain-name/tauri-browser/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/free-domain-name/tauri-browser/releases/tag/v0.1.0
