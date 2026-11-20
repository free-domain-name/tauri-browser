// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors

//! Destination checks for proxied requests.
//!
//! A registry record points at a public web page, but a record — or a redirect
//! that record serves — could point back at the machine running the browser.
//! The proxy therefore refuses to fetch loopback, private, link-local and
//! other non-public addresses.
//!
//! The check is literal-address only. A public hostname that resolves to a
//! private address is not detected: resolving every hop would add a DNS round
//! trip to each request and would still leave a race between the check and the
//! connection. The registry is community-reviewed, so a record that names a
//! private literal is rejected outright instead.
//!
//! Documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`,
//! `203.0.113.0/24`) are *not* blocked. They are not routable, and the claim
//! template in the chrome uses `203.0.113.10` as a placeholder.

use std::net::{Ipv4Addr, Ipv6Addr};

use url::{Host, Url};

/// Host names that never point at a public web server.
const BLOCKED_NAMES: &[&str] = &["localhost", "local"];

/// Whether a URL points at a public destination.
pub fn is_public_destination(url: &Url) -> bool {
    match url.host() {
        Some(Host::Ipv4(ip)) => is_public_ipv4(ip),
        Some(Host::Ipv6(ip)) => is_public_ipv6(ip),
        Some(Host::Domain(name)) => is_public_name(name),
        None => false,
    }
}

/// The host of a URL, for error messages.
pub fn host_of(url: &Url) -> String {
    url.host_str().unwrap_or("(no host)").to_string()
}

fn is_public_name(name: &str) -> bool {
    let name = name.trim_end_matches('.').to_ascii_lowercase();
    if BLOCKED_NAMES.contains(&name.as_str()) {
        return false;
    }
    // `*.localhost` is reserved by RFC 6761 and `*.local` by mDNS.
    if name.ends_with(".localhost") || name.ends_with(".local") {
        return false;
    }
    true
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    !(o[0] == 0 // 0.0.0.0/8 "this network"
        || o[0] == 10 // 10.0.0.0/8 private
        || o[0] == 127 // 127.0.0.0/8 loopback
        || (o[0] == 100 && (64..=127).contains(&o[1])) // 100.64.0.0/10 shared
        || (o[0] == 169 && o[1] == 254) // 169.254.0.0/16 link-local, cloud metadata
        || (o[0] == 172 && (16..=31).contains(&o[1])) // 172.16.0.0/12 private
        || (o[0] == 192 && o[1] == 168) // 192.168.0.0/16 private
        || (o[0] == 198 && (o[1] == 18 || o[1] == 19)) // 198.18.0.0/15 benchmarking
        || o[0] >= 224) // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved
}

fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_public_ipv4(v4);
    }
    let s = ip.segments();
    !(s[0] == 0 // ::/16 unspecified, loopback and other reserved space
        || (s[0] & 0xfe00) == 0xfc00 // fc00::/7 unique local
        || (s[0] & 0xffc0) == 0xfe80 // fe80::/10 link-local
        || (s[0] & 0xff00) == 0xff00 // ff00::/8 multicast
        || (s[0] == 0x0064 && s[1] == 0xff9b)) // 64:ff9b::/96 NAT64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host(url: &str) -> Url {
        Url::parse(url).expect("valid url")
    }

    #[test]
    fn public_destinations_are_allowed() {
        assert!(is_public_destination(&host("https://example.com/")));
        assert!(is_public_destination(&host("https://8.8.8.8/")));
        assert!(is_public_destination(&host(
            "https://[2606:4700:4700::1111]/"
        )));
        assert!(is_public_destination(&host("http://203.0.113.10:8080/")));
    }

    #[test]
    fn private_addresses_are_blocked() {
        for url in [
            "http://127.0.0.1/",
            "http://127.1.2.3/",
            "http://10.0.0.1/",
            "http://172.16.0.1/",
            "http://172.31.255.254/",
            "http://192.168.1.1/",
            "http://169.254.169.254/latest/meta-data/",
            "http://0.0.0.0/",
            "http://100.64.0.1/",
            "http://198.18.0.1/",
            "http://224.0.0.1/",
            "http://255.255.255.255/",
            "http://[::1]/",
            "http://[::]/",
            "http://[fc00::1]/",
            "http://[fe80::1]/",
            "http://[ff02::1]/",
            "http://[::ffff:127.0.0.1]/",
            "http://[64:ff9b::7f00:1]/",
        ] {
            assert!(
                !is_public_destination(&host(url)),
                "{url} should not be a public destination"
            );
        }
    }

    #[test]
    fn local_names_are_blocked() {
        for url in [
            "http://localhost/",
            "http://localhost:8080/",
            "http://LOCALHOST/",
            "http://foo.localhost/",
            "http://printer.local/",
        ] {
            assert!(
                !is_public_destination(&host(url)),
                "{url} should not be a public destination"
            );
        }
    }
}
