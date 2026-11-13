# Community chat for the Tauri browser — plan v2

Status: **implementation started — server, client core, lobby panel and
optional profiles are in place, and the deployed General lobby is verified. v1
scope is the General lobby only; site rooms are deferred.**
Decisions closed below; this file replaces `CHAT_PLAN.md` and keeps no revision
history or superseded options.

## 1. Shape

One `fdn-chatd` Rust binary on the VPS. No HTTPS, no gateway, no Caddy, no
Cloudflare, no web page, no stats API.

```text
Tauri client (a browser by default; chat panel off by default)
  per-tab chat side panel (local chrome only)
  Rust chat service: iroh Endpoint + gossip + policy + local state
        │ encrypted QUIC, only while chat is enabled
        ▼
VPS: fdn-chatd
  ├── embedded iroh relay   :28443 TCP (plain HTTP/WebSocket)
  └── headless iroh peer    bootstrap for the General lobby
```

The relay forwards opaque bytes and counts nothing. The headless peer keeps the
lobby findable; it stores nothing and never joins a site room. All counting
happens in clients. **A client with the chat panel hidden has no endpoint, no
subscription and no traffic.**

## 2. Goals / non-goals

**Goals:** a chat side panel per tab that the user enables from the toolbar; a
General lobby usable as a room list entry; a site room per eTLD+1 derived from
the tab's domain; free-form local nickname; optional profile; live user list;
ignore/unignore; text and emoji only; no central message history;
E2E-encrypted transport; spam limits at every layer; an online count read from
lobby presence; one small self-hosted binary.

**Out of scope for v1:** voice, video, images, files, **private messages and any
DM surface in the UI**, persistent history or search, exact age, GPS, global
username registry, central moderation DB, mobile.

## 3. What "no central storage" means

No server stores chat content or profiles. The only infrastructure is the iroh
relay (forwards encrypted QUIC when NAT traversal fails), the headless peer
(keeps the lobby discoverable, stores nothing) and DNS.

State three limits in the UI: peers can screenshot; the relay sees connection
metadata (timing, addresses, volume) even though payloads are encrypted; the
online count only includes clients that have chat enabled right now — it is
"people available to chat", not "people using the browser".

## 4. Rooms: lobby, room list, and when a client is present

**General `fdn:general:v1` is the lobby** and the first entry in the room list.

**Site `fdn:site:v1:<base32(sha256(eTLD+1))>`** is derived from the tab's
registrable domain, so `www.example.com` and `example.com` share a room. The
hash is not private — popular domains are guessable.

**Chat is opt-in.** A toolbar toggle reveals the side panel for that tab. Nothing
connects until the first panel is enabled; hiding the last panel leaves all rooms
and stops all traffic. Browsing works exactly as before, with no chat traffic and
no presence.

When at least one panel is enabled:

- The lobby is joined once, app-wide, and shared by every tab.
- Each enabled tab contributes its site room; the active tab takes priority, and
  at most **3 site rooms** are held at once with the least-recently-used evicted.
- Site room joins after the tab sits on one eTLD+1 for ~2 s; leaving starts a
  30 s grace period. Toggling is debounced so panel clicks cannot churn joins.
- Tabs on the same domain share one subscription and one presence entry.
- Start pages, `file://`, `about:` and non-web pages are lobby-only.
- Default: auto-join the active tab's site room, with a visible indicator and an
  off switch. "Ask first" is a setting.

## 5. Identity and profile

- Ed25519 keypair generated locally, private key in the OS keychain. Created on
  first chat enable, not on app start — a browser-only user never gets an
  identity.
- Nickname is local, free-form, not unique. Display as `alex#7f3c` (nickname plus
  short key fingerprint). Messages are signed; a peer verifies the key, not the
  human.
- No account, no email or phone.

Optional profile, all empty by default: description (160 chars), gender (free
text or "prefer not to say"), age band (`18–24` … `65+`, or prefer not to say),
country (ISO), city (48 chars). No exact age, no coordinates.

Rules: **18+ gate**; profile is sent only to the room it is shared with and only
when "show profile in rooms" is on; updates are signed and limited to one per
5 minutes; the server never stores it; warn that recipients can copy it.

## 6. Messages

Envelope: `v, room, sender, nickname, profile_version, message_id, timestamp,
text, reply_to, sig`.

- Plain text only, rendered as text, never HTML; max 500 chars.
- No attachments, link previews or autoplay.
- Signed; invalid or replayed messages are dropped.
- In-memory ring buffer for the session only, never written to disk.
- A late joiner sees nothing earlier; the UI says "live only." Restart clears it.
- Messages are only received for rooms the client is actually in; there is no
  background inbox and no offline delivery.

## 7. Presence, online count and ignore

- Signed heartbeat every 15 s per joined room, expires after 45 s.
- **The online count is the length of the lobby presence list**, so it counts
  clients with chat enabled. Computed locally; nothing is counted server-side.
- The site room's user list comes from that room's heartbeats, independently.
- Ignore is keyed by endpoint ID, not nickname, so renaming does not escape it.
- Ignoring removes that sender's messages immediately, filters future ones before
  render, and keeps them listed with an `ignored` marker and an unignore action.
- The list lives locally, is not synced across devices, and does not block the
  network — the client just drops the content.

## 8. Limits

| Layer | Limit |
| --- | --- |
| Per peer | 1 message / 5 s, 500 chars |
| Duplicate | same normalized text + key blocked 10 min (trim, collapse space, case-fold) |
| Per room per client | 30 messages / 10 s, then "room is noisy" and drop |
| Joins | 5 / minute / client, toggles debounced |
| Site rooms held | 3, LRU eviction |
| Relay | per-connection bytes/s, connection caps |
| Edge | no host firewall planned; OS connection limits only |

The lobby is the network-wide hot spot: every chat-enabled client receives its
traffic, so its per-peer and per-room caps protect everyone. Enforce them on
receipt, not only on send.

Honest limit: 5 s per peer does not stop a botnet with many keys. IP caps, room
caps and ignore reduce abuse; none eliminate it. Never claim the rate limit
"blocks any bot."

## 9. Encryption

QUIC + TLS 1.3 between endpoints, direct or relayed; the relay sees opaque bytes
and never the payload. Public rooms are readable by every member by design. The
headless peer is a lobby member for bootstrap, so it receives lobby traffic like
any client; it stores nothing and never joins a site room, so site-room content
never reaches the server.

## 10. Server: `fdn-chatd`

One binary, one config, one systemd unit, one log stream, one listener.

```text
:28443/tcp+udp  embedded iroh relay — relay protocol only, no web page, no REST API
```

- The relay URL carries no TLS: nothing terminates TLS in front of the relay, so
  the client is configured with a TLS-less relay URL and M1 verifies it accepts
  one. Chat payloads stay end-to-end encrypted between peers, so the relay still
  forwards opaque bytes.
- Relay rate limiting is off by default; set `limits.client.rx`
  (`bytes_per_second = 1_000_000`, `max_burst_bytes = 2_000_000`). Some connection
  caps are not enforced in current iroh versions, and with no firewall in front
  the byte limits are the only backstop — watch bandwidth.
- Tradeoff accepted: one crash or upgrade restarts relay and lobby bootstrap
  together, and connected clients reconnect.

## 11. Chat UI

- **Toolbar toggle** per tab reveals a side panel beside the page. Hidden is the
  default and means no chat subscription at all.
- **Room list** in the panel: General (lobby) first, then the site rooms currently
  held. Clicking General switches the panel to the lobby; clicking a site room
  switches back. The active tab's site room is pre-selected when the panel opens.
- Header: `<n> online` (lobby presence), `<m> here` for the open room, "live only",
  user-list toggle.
- Messages: `nickname#fingerprint`, text, time; ignored senders filtered.
- Composer: character count, 5 s cooldown, duplicate warning.
- Settings: nickname, profile fields, "show profile in rooms", "ask before
  joining site rooms", clear ignore list, clear local data (rotates identity,
  warns the old key is unrecoverable).
- No DM entry point anywhere. Before the lobby subscription is live, show
  "connecting…" instead of a number; never invent a count or leave a stale one
  after 45 s of silence.

## 12. Tauri integration

```text
src-tauri/src/chat/
  mod.rs        commands, events, lifecycle, panel enable/disable
  identity.rs   keypair + keychain (lazy on first enable)
  rooms.rs      lobby (app-wide) + per-tab site rooms with LRU cap
  gossip.rs     iroh endpoint + gossip subscription
  policy.rs     rate limits, duplicate blocking, ignore filtering
  profile.rs    local profile and validation
```

Commands: `chat_set_enabled` (per tab), `chat_join_room`, `chat_leave_room`,
`chat_send`, `chat_update_profile`, `chat_ignore`, `chat_unignore`,
`chat_snapshot`, `chat_set_active_tab`.
Events: `chat://state`, `chat://message`, `chat://presence`, `chat://error`,
`chat://rooms`.

The panel lives in local chrome, never injected into the remote iframe. Remote
pages stay cross-origin with no Tauri IPC, the app CSP stays local, and no chat
token or private key reaches page content. The endpoint starts on first
`chat_set_enabled(true)` and shuts down when the last panel closes.

## 13. Local storage

Persisted: identity key (keychain), nickname, optional profile, ignore list, UI
settings, panel preference (default off), "ask before joining" preference.
Not persisted: messages, history, presence, profiles received from peers, the
set of open site rooms.

## 14. Threats

Handled elsewhere: spam and botnets by the caps in §8; impersonation by signed
messages and fingerprints in §5; harassment by ignore in §7 plus the 18+ gate;
IP exposure by the relay and the metadata disclosure in §3; replay and payload
abuse by signed, plain-text, size-capped messages in §6.

Left open by design: a site room reveals domain interest to its participants
(switch to disable); presence can be inflated only by the key that sends it; and
there is no inbox, so nobody can contact you outside a room you joined. With no
firewall in front of the relay there is also no per-IP abuse control — client
caps and relay byte limits are the only limits.

## 15. Milestones

- **M0** — approve this plan (18+ gate, profile fields, opt-in panel, site-room
  auto-join, no DMs).
- **M1** — transport spike, no UI: identity, endpoint, embedded relay, headless
  lobby bootstrap, join on enable, leave on disable, signed message, relay-down
  behavior.
- **M2** — core chat: per-tab panel toggle, room list with General link, lobby +
  site rooms with the 3-room cap, nickname, user lists, online count,
  ignore/unignore, per-peer/duplicate/room caps, in-memory only.
- **M3** — profiles: optional fields with 18+ gate. Implemented: signed profile
  card, local persistence, five-minute update cooldown, in-memory received
  profiles, settings form and per-user profile viewer. Production-lobby
  verification remains pending the deployed `lobby_node_id`.
- **M4** — hardening: per-IP and edge limits, relay bandwidth, packaging,
  abuse/ignore UX, load test.
- **M5** — optional: typing, ephemeral reactions, room topic, off-by-default
  local transcript.
- **Post-v1** — proof of work at join, only if abuse demands it.

## 16. Acceptance tests

- With chat disabled, no endpoint connects, no presence is sent, no traffic is
  received, and the app is a plain browser.
- Enabling one panel joins the lobby and the active tab's site room; disabling the
  last panel leaves both and stops traffic.
- Two peers exchange signed messages through the relay; the relay cannot read
  content.
- A third peer ignores a sender: messages vanish at once, unignore restores
  future ones.
- Two messages within 5 s are refused; duplicate text is rejected.
- Rapid traffic is capped per room and the UI stays responsive.
- App/server restart: no transcript, history or profiles on the server.
- Navigating domains swaps the site room; the lobby stays joined while any panel
  is enabled. Opening a fourth domain's panel evicts the least recently used room.
- The room list navigates between General and site rooms, and the count matches
  the lobby's visible peers with no server endpoint; it reads zero after 45 s of
  silence.
- Profile fields stay hidden unless explicitly shared; there is no DM surface.
- Remote pages still have no Tauri IPC access.

### Verification log

- 2026-11-13: `cargo test --lib` — 39 passed, 5 network tests ignored.
- 2026-11-13: local `fdn-chatd` plus two `chat_probe` instances exchanged
  signed messages and signed profile cards in both directions.
- 2026-11-13: the same exchange succeeded through the production relay at
  `89.58.37.84:28443` using a temporary room and a local lobby peer.
- 2026-11-13: after `chat.vitrn.com` was changed to a DNS-only A record, two
  signed probes joined the deployed General lobby, saw each other's presence,
  verified each other's messages, and received each other's signed profile
  cards through `http://chat.vitrn.com:28443`.

## 17. Costs

Existing VPS ($0 incremental, or ~$5/month if new), existing `vitrn.com` DNS.
No TLS certificates, Caddy, Cloudflare, Workers, or separate gateway. Relay
bandwidth is the only recurring cost, proportional to chat-enabled clients.

## 18. Decisions

1. 18+ only, not minors with stricter rules.
2. Age band and coarse location, not exact age.
3. Site rooms auto-join for the active tab, with a visible indicator and an off
   switch.
4. Text only in v1.
5. Chat is opt-in per tab and off by default; hidden means no subscription, no
   presence and no traffic. The online count counts chat-enabled clients, and is
   computed locally from lobby presence; nothing is counted server-side.
6. One lobby, shared by all enabled tabs; at most 3 site rooms, LRU.
7. Local block plus a "copy report evidence" action; no central report intake.
8. `chat.vitrn.com` on the existing VPS: relay on 28443 tcp/udp only; no web page,
   no REST API, no HTTPS, no firewall, no Cloudflare, no Caddy.
9. No private messages in v1, and no DM UI to enable later without a new plan.

## 19. References

- [iroh gossip](https://docs.iroh.computer/connecting/gossip)
- [iroh self-hosted relay](https://docs.iroh.computer/iroh-services/relays/self-hosted)
- [iroh relay rate limiting](https://docs.iroh.computer/relays/rate-limiting)
- [iroh-relay embeddable server API](https://docs.rs/iroh-relay/latest/iroh_relay/server/index.html)

## 20. Implementation status and decisions

Implemented so far:

- `fdn-chatd`: plain HTTP/WebSocket relay on `28443/tcp`, headless lobby peer,
  stable lobby key, generated `bootstrap.json`, graceful shutdown, tests.
- Client: signed message/presence protocol, keychain identity, static bootstrap,
  rate limits and ignore list, settings, iroh transport, lobby lifecycle,
  Tauri commands/events, and the per-tab lobby side panel with an 18+ gate.
- End-to-end verified locally: a signed probe message reached the running
  browser, verified, and updated the online count.

Decisions taken during implementation:

1. **TCP-only relay.** `iroh-relay` needs TLS for its QUIC listener; the plan
   forbids TLS. v1 therefore serves HTTP/WebSocket on `28443/tcp` only. Direct
   endpoint-to-endpoint QUIC still works and is allowed by policy.
2. **Static bootstrap.** The client ships relay URL and lobby node ID as
   compiled defaults, overridable by environment or `chat-bootstrap.json`. There
   is no ticket service.
3. **Direct P2P allowed.** Peers are not forced through the relay and may learn
   each other's IP addresses.

Open design question, deferred: **site-room discovery.** The headless peer never
joins a site room, but iroh gossip needs an already-joined peer to bootstrap a
topic. The lobby user list is not a safe substitute because dialing arbitrary
lobby peers would pull them into the site room and reveal the domain. Options
are lobby hints (leaks site interest), a headless site-room relay (breaks the
content promise), a separate rendezvous service, or dropping site rooms from v1.
**Decision: v1 ships the General lobby only.** Site rooms need a new plan before
implementation; do not silently add lobby hints. Details and the checklist live
in `fdn-chatd/docs/IMPLEMENTATION.md`.
