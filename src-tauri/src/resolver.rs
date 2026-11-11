// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors

//! Resolution hierarchy and conflict detection.
//!
//! For every navigation the browser asks this module for a plan:
//!
//! 1. the registry is authoritative when it has a record and the name does not
//!    resolve through public DNS (case B),
//! 2. a name present in both worlds produces a `Conflict` outcome so the UI can
//!    ask the user (case A),
//! 3. a name absent from the registry but delegated in public DNS goes to the
//!    public web (case C),
//! 4. a name absent from both the registry and public DNS produces an
//!    `Unregistered` outcome so the UI can offer to claim it (case D).
//!
//! Availability is inferred only from a definitive public-DNS NXDOMAIN. A
//! timeout or an inconclusive answer must never turn a live domain into a
//! claim page.

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::Duration;

use hickory_resolver::config::{ResolverConfig, GOOGLE};
use hickory_resolver::net::runtime::TokioRuntimeProvider;
use hickory_resolver::net::{DnsError, NetError};
use hickory_resolver::proto::op::ResponseCode;
use hickory_resolver::proto::rr::RecordType;
use hickory_resolver::TokioResolver;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::{AppError, AppResult};
use crate::registry::{normalize_domain, RegistryClient};

/// How long to wait for the public DNS conflict or availability check. A
/// timeout is inconclusive: it never makes a name available and never blocks a
/// registry navigation.
const DNS_CONFLICT_TIMEOUT: Duration = Duration::from_secs(3);

/// Remembered per-session choice for a name that exists in both places.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Choice {
    Registry,
    Public,
}

/// What public DNS says about a name. `Missing` is the only state that is safe
/// to describe as available; an inconclusive lookup stays inconclusive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PublicDnsStatus {
    Present,
    Missing,
    Unknown,
}

fn classify_public_dns(result: Result<usize, NetError>) -> PublicDnsStatus {
    match result {
        Ok(count) if count > 0 => PublicDnsStatus::Present,
        // NODATA means the name exists but has no NS records at this label.
        // It is not evidence that the name can be claimed.
        Ok(_) => PublicDnsStatus::Unknown,
        Err(NetError::Dns(DnsError::ResponseCode(ResponseCode::NXDomain))) => {
            PublicDnsStatus::Missing
        }
        Err(NetError::Dns(DnsError::NoRecordsFound(no_records)))
            if no_records.response_code == ResponseCode::NXDomain =>
        {
            PublicDnsStatus::Missing
        }
        Err(_) => PublicDnsStatus::Unknown,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    GithubRegistry,
    PublicIcann,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OutcomeKind {
    Navigate,
    Conflict,
    Unavailable,
    /// A free-namespace name that the registry does not know yet.
    Unregistered,
    Error,
}

/// The complete answer to "where should this input go?".
#[derive(Debug, Clone, Serialize)]
pub struct NavigationOutcome {
    pub kind: OutcomeKind,
    pub domain: String,
    pub path: String,
    pub source: Source,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl NavigationOutcome {
    fn navigate(
        domain: &str,
        path: &str,
        source: Source,
        url: String,
        registry_url: Option<String>,
        public_url: Option<String>,
    ) -> Self {
        Self {
            kind: OutcomeKind::Navigate,
            domain: domain.to_string(),
            path: path.to_string(),
            source,
            url: Some(url),
            registry_url,
            public_url,
            registry_target: None,
            message: None,
        }
    }
}

/// The scheme prefix used to route a registry name through the custom protocol.
///
/// Android and Windows cannot register arbitrary URI schemes, so Tauri maps
/// `fdn://host/path` to `http://fdn.host/path` there and reverts it before the
/// Rust handler runs.
pub const fn proxy_base() -> &'static str {
    if cfg!(any(windows, target_os = "android")) {
        "http://fdn."
    } else {
        "fdn://"
    }
}

pub fn registry_url(domain: &str, path: &str) -> String {
    format!("{}{}{}", proxy_base(), domain, normalize_path(path))
}

/// `.fdn` is the registry's own namespace: a miss there is not a public DNS
/// failure, it means the name is still unclaimed.
fn is_free_namespace(domain: &str) -> bool {
    domain == "fdn" || domain.ends_with(".fdn")
}

pub fn public_url(domain: &str, path: &str, scheme: &str) -> String {
    let scheme = match scheme {
        "http" | "https" => scheme,
        _ => "https",
    };
    format!("{scheme}://{domain}{}", normalize_path(path))
}

fn normalize_path(raw: &str) -> String {
    let mut path = raw.trim().to_string();
    if path.is_empty() {
        return "/".to_string();
    }
    if !path.starts_with('/') {
        path.insert(0, '/');
    }
    path.retain(|character| !character.is_control());
    path
}

#[derive(Debug, Clone)]
struct ParsedInput {
    domain: String,
    path: String,
    public_scheme: String,
    search: bool,
}

fn parse_input(raw: &str) -> AppResult<ParsedInput> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err(AppError::InvalidInput("enter a domain or URL".into()));
    }

    // Bare words and phrases are searches, like a normal address bar.
    let looks_like_search = raw.contains(char::is_whitespace)
        || (!raw.contains('.') && !raw.contains(':') && raw != "localhost");
    if looks_like_search {
        let mut url = Url::parse("https://duckduckgo.com/")?;
        url.query_pairs_mut().append_pair("q", raw);
        let path = format!(
            "{}{}",
            url.path(),
            url.query()
                .map(|query| format!("?{query}"))
                .unwrap_or_default()
        );
        return Ok(ParsedInput {
            domain: "duckduckgo.com".to_string(),
            path,
            public_scheme: "https".to_string(),
            search: true,
        });
    }

    let with_scheme = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    let url = Url::parse(&with_scheme)?;
    let scheme = url.scheme().to_ascii_lowercase();
    if !matches!(scheme.as_str(), "http" | "https" | "fdn") {
        return Err(AppError::InvalidInput(format!(
            "unsupported scheme {scheme:?}; use http, https or fdn"
        )));
    }

    let mut host = url
        .host_str()
        .ok_or_else(|| AppError::InvalidInput(format!("{raw:?} has no host")))?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    // Accept Android/Windows style proxy URLs the same way as fdn:// URLs.
    if matches!(scheme.as_str(), "http" | "https") {
        if let Some(stripped) = host.strip_prefix("fdn.") {
            host = stripped.to_string();
        }
    }

    let mut path = String::from(url.path());
    if let Some(query) = url.query() {
        path.push('?');
        path.push_str(query);
    }
    if let Some(fragment) = url.fragment() {
        path.push('#');
        path.push_str(fragment);
    }

    let public_scheme = if scheme == "fdn" {
        "https".to_string()
    } else {
        scheme
    };

    Ok(ParsedInput {
        domain: host,
        path: normalize_path(&path),
        public_scheme,
        search: false,
    })
}

pub struct Navigator {
    /// `None` when neither the system resolver nor the public fallback could
    /// be built; conflict detection is then disabled and registry names
    /// resolve immediately.
    dns: Option<TokioResolver>,
    decisions: RwLock<HashMap<String, Choice>>,
}

impl Navigator {
    pub fn new() -> AppResult<Self> {
        let dns = Self::build_resolver();
        Ok(Self {
            dns,
            decisions: RwLock::new(HashMap::new()),
        })
    }

    /// Prefer the operating system resolver, then fall back to Google Public
    /// DNS. macOS ships an `/etc/resolv.conf` that explicitly does not describe
    /// its real configuration, so the fallback is not theoretical.
    fn build_resolver() -> Option<TokioResolver> {
        match TokioResolver::builder_tokio().and_then(|builder| builder.build()) {
            Ok(resolver) => Some(resolver),
            Err(error) => {
                eprintln!(
                    "[resolver] system DNS configuration unavailable ({error}); \
                     falling back to Google Public DNS"
                );
                let config = ResolverConfig::udp_and_tcp(&GOOGLE);
                let builder =
                    TokioResolver::builder_with_config(config, TokioRuntimeProvider::default());
                match builder.build() {
                    Ok(resolver) => Some(resolver),
                    Err(error) => {
                        eprintln!("[resolver] public DNS fallback failed: {error}");
                        None
                    }
                }
            }
        }
    }

    pub fn decision(&self, domain: &str) -> Option<Choice> {
        let decisions = self
            .decisions
            .read()
            .unwrap_or_else(|poison| poison.into_inner());
        decisions.get(domain).copied()
    }

    pub fn remember(&self, domain: &str, choice: Choice) {
        let mut decisions = self
            .decisions
            .write()
            .unwrap_or_else(|poison| poison.into_inner());
        decisions.insert(domain.to_string(), choice);
    }

    pub fn forget(&self, domain: &str) {
        let mut decisions = self
            .decisions
            .write()
            .unwrap_or_else(|poison| poison.into_inner());
        decisions.remove(domain);
    }

    /// Resolve one address-bar input into a navigation plan.
    pub async fn resolve(
        &self,
        registry: &RegistryClient,
        raw: &str,
    ) -> AppResult<NavigationOutcome> {
        let parsed = parse_input(raw)?;
        let registry_url = registry_url(&parsed.domain, &parsed.path);
        let public_url = public_url(&parsed.domain, &parsed.path, &parsed.public_scheme);

        if parsed.search {
            return Ok(NavigationOutcome::navigate(
                &parsed.domain,
                &parsed.path,
                Source::PublicIcann,
                public_url.clone(),
                None,
                Some(public_url),
            ));
        }

        let record = match registry.lookup(&parsed.domain).await {
            Ok(record) => record,
            Err(error) => {
                return Ok(NavigationOutcome {
                    kind: OutcomeKind::Unavailable,
                    domain: parsed.domain,
                    path: parsed.path,
                    source: Source::None,
                    url: None,
                    registry_url: None,
                    public_url: Some(public_url),
                    registry_target: None,
                    message: Some(error.to_string()),
                });
            }
        };

        let Some(record) = record else {
            let available = if is_free_namespace(&parsed.domain) {
                true
            } else {
                self.public_dns_status(&parsed.domain).await == PublicDnsStatus::Missing
            };
            if available {
                let message = if is_free_namespace(&parsed.domain) {
                    "This name is not registered in the Free Domain Registry yet."
                } else {
                    "This name is not registered in the Free Domain Registry, and public DNS has no delegation for it. You can claim it here."
                };
                return Ok(NavigationOutcome {
                    kind: OutcomeKind::Unregistered,
                    domain: parsed.domain.clone(),
                    path: parsed.path.clone(),
                    source: Source::None,
                    url: None,
                    registry_url: None,
                    public_url: Some(public_url),
                    registry_target: None,
                    message: Some(message.into()),
                });
            }
            return Ok(NavigationOutcome::navigate(
                &parsed.domain,
                &parsed.path,
                Source::PublicIcann,
                public_url.clone(),
                None,
                Some(public_url),
            ));
        };

        let registry_plan = NavigationOutcome {
            kind: OutcomeKind::Navigate,
            domain: parsed.domain.clone(),
            path: parsed.path.clone(),
            source: Source::GithubRegistry,
            url: Some(registry_url.clone()),
            registry_url: Some(registry_url.clone()),
            public_url: Some(public_url.clone()),
            registry_target: Some(record.target_url.clone()),
            message: None,
        };

        if let Some(choice) = self.decision(&parsed.domain) {
            return Ok(match choice {
                Choice::Registry => registry_plan,
                Choice::Public => NavigationOutcome::navigate(
                    &parsed.domain,
                    &parsed.path,
                    Source::PublicIcann,
                    public_url.clone(),
                    Some(registry_url),
                    Some(public_url),
                ),
            });
        }

        if self.public_dns_status(&parsed.domain).await == PublicDnsStatus::Present {
            return Ok(NavigationOutcome {
                kind: OutcomeKind::Conflict,
                domain: parsed.domain,
                path: parsed.path,
                source: Source::None,
                url: None,
                registry_url: Some(registry_url),
                public_url: Some(public_url),
                registry_target: Some(record.target_url),
                message: None,
            });
        }

        Ok(registry_plan)
    }

    /// Build the URL for a remembered choice and store that choice.
    pub fn choose_url(&self, domain: &str, path: &str, choice: Choice) -> AppResult<String> {
        let domain = normalize_domain(domain)?;
        let path = normalize_path(path);
        if path.len() > 2_048 {
            return Err(AppError::InvalidInput("path is too long".into()));
        }
        self.remember(&domain, choice);
        Ok(match choice {
            Choice::Registry => registry_url(&domain, &path),
            Choice::Public => public_url(&domain, &path, "https"),
        })
    }

    /// Ask public DNS whether a name is delegated. NS records are used instead
    /// of A/AAAA because a registered domain may have no web server, and a
    /// missing A record must not turn a live domain into a claim page.
    async fn public_dns_status(&self, domain: &str) -> PublicDnsStatus {
        let Some(resolver) = &self.dns else {
            return PublicDnsStatus::Unknown;
        };
        let result = tokio::time::timeout(
            DNS_CONFLICT_TIMEOUT,
            resolver.lookup(domain, RecordType::NS),
        )
        .await;
        match result {
            Ok(Ok(lookup)) => classify_public_dns(Ok(lookup.answers().len())),
            Ok(Err(error)) => classify_public_dns(Err(error)),
            // A timeout must never be read as "available".
            Err(_) => classify_public_dns(Err(NetError::Timeout)),
        }
    }

    /// Backwards-compatible name used by the live DNS test.
    #[cfg(test)]
    async fn resolves_publicly(&self, domain: &str) -> bool {
        self.public_dns_status(domain).await == PublicDnsStatus::Present
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hickory_resolver::net::NoRecords;
    use hickory_resolver::proto::op::Query;
    use hickory_resolver::proto::rr::Name;

    #[test]
    fn parses_bare_domains() {
        let parsed = parse_input("example.com/path?x=1#top").unwrap();
        assert_eq!(parsed.domain, "example.com");
        assert_eq!(parsed.path, "/path?x=1#top");
        assert_eq!(parsed.public_scheme, "https");
        assert!(!parsed.search);
    }

    #[test]
    fn parses_fdn_and_workaround_urls() {
        let parsed = parse_input("fdn://example.com/a").unwrap();
        assert_eq!(parsed.domain, "example.com");
        assert_eq!(parsed.path, "/a");
        assert_eq!(parsed.public_scheme, "https");

        let parsed = parse_input("http://fdn.example.com/b").unwrap();
        assert_eq!(parsed.domain, "example.com");
        assert_eq!(parsed.path, "/b");
    }

    #[test]
    fn treats_plain_words_as_searches() {
        let parsed = parse_input("free domain browser").unwrap();
        assert!(parsed.search);
        assert_eq!(parsed.domain, "duckduckgo.com");
        assert!(parsed.path.starts_with("/?q="));
    }

    #[test]
    fn rejects_javascript_urls() {
        assert!(parse_input("javascript:alert(1)").is_err());
    }

    #[test]
    fn builds_proxy_urls_for_the_platform() {
        let url = registry_url("example.com", "/x");
        assert!(url.starts_with(proxy_base()));
        assert!(url.ends_with("example.com/x"));
    }

    #[test]
    fn public_url_normalizes_paths() {
        assert_eq!(
            public_url("example.com", "x", "http"),
            "http://example.com/x"
        );
        assert_eq!(
            public_url("example.com", "", "https"),
            "https://example.com/"
        );
    }

    #[tokio::test]
    #[ignore = "network: queries public DNS"]
    async fn live_dns_conflict_check() {
        let navigator = Navigator::new().expect("navigator");
        assert!(navigator.resolves_publicly("google.com").await);
        assert!(!navigator.resolves_publicly("hello.fdn").await);
    }

    #[test]
    fn only_a_definitive_nxdomain_marks_a_name_available() {
        let query = || {
            Query::query(
                Name::from_ascii("missing.example").expect("name"),
                RecordType::NS,
            )
        };

        assert_eq!(classify_public_dns(Ok(2)), PublicDnsStatus::Present);
        assert_eq!(classify_public_dns(Ok(0)), PublicDnsStatus::Unknown);
        assert_eq!(
            classify_public_dns(Err(NetError::Timeout)),
            PublicDnsStatus::Unknown
        );
        assert_eq!(
            classify_public_dns(Err(NetError::Dns(DnsError::NoRecordsFound(
                NoRecords::new(query(), ResponseCode::NoError)
            )))),
            PublicDnsStatus::Unknown
        );
        assert_eq!(
            classify_public_dns(Err(NetError::Dns(DnsError::NoRecordsFound(
                NoRecords::new(query(), ResponseCode::NXDomain)
            )))),
            PublicDnsStatus::Missing
        );
    }

    #[test]
    fn recognises_the_free_namespace() {
        assert!(is_free_namespace("fdn"));
        assert!(is_free_namespace("hello.fdn"));
        assert!(is_free_namespace("denem111e.fdn"));
        assert!(!is_free_namespace("example.com"));
        assert!(!is_free_namespace("fdn.example.com"));
    }

    #[tokio::test]
    #[ignore = "network: reads the live GitHub registry and public DNS"]
    async fn live_unregistered_public_name_is_available() {
        let dir = std::env::temp_dir().join(format!(
            "fdn-unregistered-public-test-{}",
            std::process::id()
        ));
        let registry = RegistryClient::new(dir.clone()).expect("cache dir");
        let navigator = Navigator::new().expect("navigator");
        let outcome = navigator
            .resolve(&registry, "https://fvdfvdfvdfvdfvfv111.com/")
            .await
            .expect("resolve");
        assert_eq!(outcome.kind, OutcomeKind::Unregistered);
        assert_eq!(outcome.domain, "fvdfvdfvdfvdfvfv111.com");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    #[ignore = "network: reads the live GitHub registry and public DNS"]
    async fn live_registered_public_name_stays_public() {
        let dir =
            std::env::temp_dir().join(format!("fdn-registered-public-test-{}", std::process::id()));
        let registry = RegistryClient::new(dir.clone()).expect("cache dir");
        let navigator = Navigator::new().expect("navigator");
        let outcome = navigator
            .resolve(&registry, "https://iana.org/")
            .await
            .expect("resolve");
        assert_eq!(outcome.kind, OutcomeKind::Navigate);
        assert_eq!(outcome.source, Source::PublicIcann);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    #[ignore = "network: reads the live GitHub registry"]
    async fn live_unregistered_fdn_name_is_available() {
        let dir =
            std::env::temp_dir().join(format!("fdn-unregistered-test-{}", std::process::id()));
        let registry = RegistryClient::new(dir.clone()).expect("cache dir");
        let navigator = Navigator::new().expect("navigator");
        let outcome = navigator
            .resolve(&registry, "https://definitely-not-registered-xyz.fdn/")
            .await
            .expect("resolve");
        assert_eq!(outcome.kind, OutcomeKind::Unregistered);
        assert_eq!(outcome.domain, "definitely-not-registered-xyz.fdn");
        let _ = std::fs::remove_dir_all(dir);
    }
}
