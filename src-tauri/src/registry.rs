//! Sharded, on-demand reader for the Free Domain Name registry.
//!
//! The registry is a GitHub repository where every name is one JSON file at a
//! deterministic path derived from the domain with its dots removed:
//!
//! ```text
//! example.com -> e/x/a/m/example.com.json
//! test.xyz    -> t/e/s/t/test.xyz.json
//! ```
//!
//! There is no global index. A lookup checks, in order:
//!
//! 1. a thread-safe in-memory cache,
//! 2. a TTL-scoped disk cache under the platform cache directory,
//! 3. the GitHub raw CDN.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::{AppError, AppResult};

/// GitHub raw base for the community registry.
pub const REGISTRY_RAW_BASE: &str =
    "https://raw.githubusercontent.com/free-domain-name/registry/main";

/// Number of one-character directories in the shard path.
pub const SHARD_DEPTH: usize = 4;

/// How long a "not found" result is cached, to avoid hammering the CDN for
/// names that do not exist.
pub const NEGATIVE_TTL_SECS: u64 = 300;

/// Upper bound accepted from a record; a malicious file must not pin a record
/// in the cache forever.
pub const MAX_TTL_SECS: u64 = 86_400;

pub const USER_AGENT: &str = concat!(
    "FreeDomainBrowser/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/free-domain-name/registry)"
);

/// Exactly the four fields a registry file may contain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegistryRecord {
    pub domain: String,
    pub target_url: String,
    pub owner_github: String,
    pub ttl: u64,
}

/// A cache entry can be negative (`record == None`) when the registry answered
/// 404 for a name.
#[derive(Debug, Clone)]
pub struct CachedRecord {
    pub record: Option<RegistryRecord>,
    pub stored_at: SystemTime,
    pub ttl: Duration,
}

impl CachedRecord {
    fn is_fresh(&self, now: SystemTime) -> bool {
        now.duration_since(self.stored_at)
            .map(|age| age < self.ttl)
            .unwrap_or(true)
    }

    fn effective_ttl(&self) -> u64 {
        self.ttl.as_secs().clamp(60, MAX_TTL_SECS)
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct DiskEntry {
    stored_at: u64,
    ttl: u64,
    record: Option<RegistryRecord>,
}

impl From<&CachedRecord> for DiskEntry {
    fn from(entry: &CachedRecord) -> Self {
        Self {
            stored_at: entry
                .stored_at
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            ttl: entry.effective_ttl(),
            record: entry.record.clone(),
        }
    }
}

impl DiskEntry {
    fn into_cached(self) -> Option<CachedRecord> {
        if self.ttl == 0 {
            return None;
        }
        let stored_at = UNIX_EPOCH.checked_add(Duration::from_secs(self.stored_at))?;
        Some(CachedRecord {
            record: self.record,
            stored_at,
            ttl: Duration::from_secs(self.ttl),
        })
    }
}

pub struct RegistryClient {
    http: reqwest::Client,
    cache_dir: PathBuf,
    memory: RwLock<HashMap<String, CachedRecord>>,
}

impl RegistryClient {
    pub fn new(cache_dir: PathBuf) -> AppResult<Self> {
        std::fs::create_dir_all(&cache_dir)?;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .user_agent(USER_AGENT)
            .build()?;
        Ok(Self {
            http,
            cache_dir,
            memory: RwLock::new(HashMap::new()),
        })
    }

    /// `example.com` -> `e/x/a/m/example.com.json`
    pub fn shard_path(domain: &str) -> String {
        let slug: Vec<char> = domain.chars().filter(|c| *c != '.').collect();
        let mut dirs = ['_'; SHARD_DEPTH];
        for (slot, character) in dirs.iter_mut().zip(slug.iter()) {
            *slot = *character;
        }
        format!(
            "{}/{}/{}/{}/{}.json",
            dirs[0], dirs[1], dirs[2], dirs[3], domain
        )
    }

    /// Fully qualified raw URL for a record.
    pub fn raw_url(domain: &str) -> String {
        format!("{REGISTRY_RAW_BASE}/{}", Self::shard_path(domain))
    }

    pub fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    /// Cache-only lookup used by redirect handling (never performs I/O).
    pub fn cached(&self, domain: &str) -> Option<RegistryRecord> {
        let now = SystemTime::now();
        let memory = self
            .memory
            .read()
            .unwrap_or_else(|poison| poison.into_inner());
        memory
            .get(domain)
            .filter(|entry| entry.is_fresh(now))
            .and_then(|entry| entry.record.clone())
    }

    /// Resolve one name. `Ok(None)` means the registry does not contain it.
    pub async fn lookup(&self, domain: &str) -> AppResult<Option<RegistryRecord>> {
        let domain = normalize_domain(domain)?;
        let now = SystemTime::now();

        if let Some(hit) = self.memory_get(&domain) {
            if hit.is_fresh(now) {
                return Ok(hit.record);
            }
        }

        let stale = self.memory_get(&domain);

        if let Some(entry) = self.read_disk(&domain).await {
            let record = entry.record.clone();
            let fresh = entry.is_fresh(now);
            self.memory_put(&domain, entry);
            if fresh {
                return Ok(record);
            }
        }

        match self.fetch(&domain).await {
            Ok(record) => {
                let ttl = record
                    .as_ref()
                    .map(|record| Duration::from_secs(record.ttl.clamp(60, MAX_TTL_SECS)))
                    .unwrap_or_else(|| Duration::from_secs(NEGATIVE_TTL_SECS));
                let entry = CachedRecord {
                    record: record.clone(),
                    stored_at: SystemTime::now(),
                    ttl,
                };
                self.memory_put(&domain, entry.clone());
                self.write_disk(&domain, &entry).await;
                Ok(record)
            }
            Err(error) => {
                // A stale positive record is better than failing the browser
                // when GitHub is unreachable.
                if let Some(stale) = stale.and_then(|entry| entry.record) {
                    eprintln!(
                        "[registry] stale record for {domain} served after fetch error: {error}"
                    );
                    Ok(Some(stale))
                } else {
                    Err(error)
                }
            }
        }
    }

    async fn fetch(&self, domain: &str) -> AppResult<Option<RegistryRecord>> {
        let url = Self::raw_url(domain);
        let response = self.http.get(&url).send().await?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(AppError::Registry(format!(
                "GitHub returned {} for {url}",
                response.status()
            )));
        }

        let bytes = response.bytes().await?;
        if bytes.len() > 64 * 1024 {
            return Err(AppError::Registry(format!(
                "record for {domain} is larger than 64 KiB"
            )));
        }
        let record: RegistryRecord = serde_json::from_slice(&bytes)?;
        validate_record(&record, domain)?;
        Ok(Some(record))
    }

    fn memory_get(&self, domain: &str) -> Option<CachedRecord> {
        let memory = self
            .memory
            .read()
            .unwrap_or_else(|poison| poison.into_inner());
        memory.get(domain).cloned()
    }

    fn memory_put(&self, domain: &str, entry: CachedRecord) {
        let mut memory = self
            .memory
            .write()
            .unwrap_or_else(|poison| poison.into_inner());
        memory.insert(domain.to_string(), entry);
    }

    fn disk_path(&self, domain: &str) -> PathBuf {
        self.cache_dir.join(Self::shard_path(domain))
    }

    async fn read_disk(&self, domain: &str) -> Option<CachedRecord> {
        let path = self.disk_path(domain);
        let bytes = tokio::fs::read(&path).await.ok()?;
        let entry: DiskEntry = serde_json::from_slice(&bytes).ok()?;
        let cached = entry.into_cached()?;
        if let Some(record) = &cached.record {
            if record.domain != domain {
                let _ = tokio::fs::remove_file(&path).await;
                return None;
            }
        }
        Some(cached)
    }

    async fn write_disk(&self, domain: &str, entry: &CachedRecord) {
        let path = self.disk_path(domain);
        let Some(parent) = path.parent() else {
            return;
        };
        if tokio::fs::create_dir_all(parent).await.is_err() {
            return;
        }
        let serialized = match serde_json::to_vec(&DiskEntry::from(entry)) {
            Ok(serialized) => serialized,
            Err(_) => return,
        };
        let tmp = path.with_extension("json.tmp");
        if tokio::fs::write(&tmp, serialized).await.is_err() {
            return;
        }
        if tokio::fs::rename(&tmp, &path).await.is_err() {
            let _ = tokio::fs::remove_file(&tmp).await;
        }
    }

    /// Drop both caches. Used by the "clear cache" command.
    pub async fn clear(&self) -> AppResult<()> {
        {
            let mut memory = self
                .memory
                .write()
                .unwrap_or_else(|poison| poison.into_inner());
            memory.clear();
        }
        match tokio::fs::remove_dir_all(&self.cache_dir).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(AppError::Cache(error.to_string())),
        }
        tokio::fs::create_dir_all(&self.cache_dir).await?;
        Ok(())
    }
}

/// Lowercase, IDNA-aware hostname normalization. Accepts a bare domain or a
/// full URL and returns the host only.
pub fn normalize_domain(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("empty domain".into()));
    }
    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let parsed = Url::parse(&candidate)
        .map_err(|error| AppError::InvalidInput(format!("invalid domain {raw:?}: {error}")))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::InvalidInput(format!("{raw:?} has no host")))?;
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() {
        return Err(AppError::InvalidInput(format!("{raw:?} has an empty host")));
    }
    Ok(host)
}

fn validate_record(record: &RegistryRecord, expected_domain: &str) -> AppResult<()> {
    let domain = normalize_domain(&record.domain)?;
    if domain != expected_domain {
        return Err(AppError::Registry(format!(
            "record for {expected_domain} claims domain {}",
            record.domain
        )));
    }
    let target = Url::parse(&record.target_url)
        .map_err(|error| AppError::Registry(format!("invalid target_url: {error}")))?;
    if target.scheme() != "http" && target.scheme() != "https" {
        return Err(AppError::Registry(format!(
            "target_url must be http(s), got {}",
            target.scheme()
        )));
    }
    if target.host_str().is_none() {
        return Err(AppError::Registry("target_url has no host".into()));
    }
    if !target.username().is_empty() || target.password().is_some() {
        return Err(AppError::Registry(
            "target_url must not contain credentials".into(),
        ));
    }
    if target.path() != "/" {
        return Err(AppError::Registry(
            "target_url must be an origin without a path".into(),
        ));
    }
    if target.query().is_some() || target.fragment().is_some() {
        return Err(AppError::Registry(
            "target_url must not contain a query or fragment".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shard_paths_match_the_registry_layout() {
        assert_eq!(
            RegistryClient::shard_path("example.com"),
            "e/x/a/m/example.com.json"
        );
        assert_eq!(
            RegistryClient::shard_path("test.xyz"),
            "t/e/s/t/test.xyz.json"
        );
        assert_eq!(
            RegistryClient::shard_path("google.com"),
            "g/o/o/g/google.com.json"
        );
        assert_eq!(RegistryClient::shard_path("a.co"), "a/c/o/_/a.co.json");
        assert_eq!(
            RegistryClient::shard_path("abc.fdn"),
            "a/b/c/f/abc.fdn.json"
        );
    }

    #[test]
    fn raw_url_is_built_from_the_base() {
        assert_eq!(
            RegistryClient::raw_url("example.com"),
            "https://raw.githubusercontent.com/free-domain-name/registry/main/e/x/a/m/example.com.json"
        );
    }

    #[test]
    fn normalizes_hosts_and_urls() {
        assert_eq!(normalize_domain("Example.COM.").unwrap(), "example.com");
        assert_eq!(
            normalize_domain("https://example.com/path").unwrap(),
            "example.com"
        );
        assert_eq!(
            normalize_domain("fdn://example.com/x").unwrap(),
            "example.com"
        );
        assert!(normalize_domain("   ").is_err());
    }

    #[test]
    fn rejects_non_origin_target_urls() {
        for target_url in [
            "http://192.0.2.1/app",
            "http://192.0.2.1?x=1",
            "http://192.0.2.1#top",
        ] {
            let record = RegistryRecord {
                domain: "example.com".into(),
                target_url: target_url.into(),
                owner_github: "someone".into(),
                ttl: 3600,
            };
            assert!(
                validate_record(&record, "example.com").is_err(),
                "{target_url} should be rejected"
            );
        }

        let record = RegistryRecord {
            domain: "example.com".into(),
            target_url: "http://192.0.2.1:8080".into(),
            owner_github: "someone".into(),
            ttl: 3600,
        };
        assert!(validate_record(&record, "example.com").is_ok());
    }

    #[test]
    fn rejects_a_record_claiming_another_domain() {
        let record = RegistryRecord {
            domain: "other.com".into(),
            target_url: "http://192.0.2.1".into(),
            owner_github: "someone".into(),
            ttl: 3600,
        };
        assert!(validate_record(&record, "example.com").is_err());
    }

    #[test]
    fn clamps_cache_ttls() {
        let entry = CachedRecord {
            record: None,
            stored_at: SystemTime::now(),
            ttl: Duration::from_secs(10_000_000),
        };
        assert_eq!(entry.effective_ttl(), MAX_TTL_SECS);
    }

    #[tokio::test]
    #[ignore = "network: reads the live GitHub registry"]
    async fn live_registry_lookup() {
        let dir = std::env::temp_dir().join(format!("fdn-registry-test-{}", std::process::id()));
        let client = RegistryClient::new(dir.clone()).expect("cache dir");
        let record = client.lookup("google.com").await.expect("lookup");
        assert_eq!(record.expect("record").target_url, "http://example.com");
        let missing = client
            .lookup("definitely-not-registered-xyz.fdn")
            .await
            .expect("negative lookup");
        assert!(missing.is_none());
        let _ = std::fs::remove_dir_all(dir);
    }
}
