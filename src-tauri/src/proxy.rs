//! The `fdn://` custom-protocol handler.
//!
//! Registry-resolved pages are not loaded from the public web directly. The
//! browser navigates the content view to `fdn://<domain>/<path>` (mapped to
//! `http://fdn.<domain>/<path>` on Android and Windows by Tauri), and this
//! module:
//!
//! 1. looks the name up in the registry (cache first),
//! 2. requests the record's `target_url` with `Host: <domain>`,
//! 3. forwards the response, stripping headers that would prevent framing and
//!    rewriting same-domain URLs so links and assets stay inside the proxy.
//!
//! Responses are buffered because Tauri's URI-scheme responder takes a complete
//! body. See the README for the streaming roadmap.

use std::borrow::Cow;
use std::sync::OnceLock;

use regex::Regex;
use tauri::http::{header, HeaderMap, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};
use url::Url;

use crate::error::{AppError, AppResult};
use crate::registry::normalize_domain;
use crate::resolver::proxy_base;
use crate::AppState;

const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;

/// Small bridge injected into proxied HTML. It reports the current in-page URL
/// to the browser chrome so the address bar and status stay in sync, including
/// when the user follows a link inside the page.
const BRIDGE_SCRIPT: &str = r#"<script data-fdn-bridge="1">
(function () {
  if (window.top === window) return;
  function report() {
    try {
      parent.postMessage({
        fdn: "location",
        host: location.hostname,
        path: location.pathname + location.search + location.hash,
        title: document.title || ""
      }, "*");
    } catch (error) { /* the parent may be gone */ }
  }
  window.addEventListener("load", report);
  window.addEventListener("popstate", report);
  window.addEventListener("hashchange", report);
  document.addEventListener("click", function () { setTimeout(report, 60); }, true);
  report();
})();
</script>"#;

pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app: AppHandle<R> = ctx.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        let response = match proxy(&app, request).await {
            Ok(response) => response,
            Err(error) => error_page(
                StatusCode::BAD_GATEWAY,
                "Registry proxy error",
                &error.to_string(),
            ),
        };
        responder.respond(response);
    });
}

async fn proxy<R: Runtime>(
    app: &AppHandle<R>,
    request: Request<Vec<u8>>,
) -> AppResult<Response<Cow<'static, [u8]>>> {
    let (parts, body) = request.into_parts();
    let uri = &parts.uri;

    let raw_host = uri
        .host()
        .ok_or_else(|| AppError::InvalidInput("proxy request has no host".into()))?;
    // Tauri maps fdn://example.com to http://fdn.example.com on Windows and
    // Android, then reverts the URI before calling this handler. Be tolerant of
    // both shapes anyway.
    let host = if matches!(uri.scheme_str(), Some("http") | Some("https")) {
        raw_host.strip_prefix("fdn.").unwrap_or(raw_host)
    } else {
        raw_host
    };
    let domain = normalize_domain(host)?;
    let request_path = uri
        .path_and_query()
        .map(|path| path.as_str())
        .unwrap_or("/")
        .to_string();

    let state = app.state::<AppState>();
    let record = state
        .registry
        .lookup(&domain)
        .await?
        .ok_or_else(|| AppError::Registry(format!("{domain} is not in the Free Registry")))?;

    let mut target = Url::parse(&record.target_url)?;
    let (path_only, query) = split_path_and_query(&request_path);
    target.set_path(path_only);
    target.set_query(query);

    let method = reqwest::Method::from_bytes(parts.method.as_str().as_bytes())
        .map_err(|_| AppError::InvalidInput(format!("unsupported method {}", parts.method)))?;
    let is_head = method == reqwest::Method::HEAD;
    let original_target_host = target.host_str().map(str::to_string);
    let mut current = target;

    for hop in 0..=MAX_REDIRECTS {
        let response = send_hop(
            &state.http,
            &method,
            &current,
            &parts.headers,
            &domain,
            &request_path,
            &body,
        )
        .await?;

        if !response.status().is_redirection() {
            return build_response(
                response,
                &domain,
                original_target_host.as_deref(),
                current.host_str(),
                is_head,
            )
            .await;
        }

        let location = response
            .headers()
            .get(header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);

        let Some(location) = location else {
            return build_response(
                response,
                &domain,
                original_target_host.as_deref(),
                current.host_str(),
                is_head,
            )
            .await;
        };

        if hop == MAX_REDIRECTS {
            return Err(AppError::Network("too many redirects".into()));
        }

        let next = current
            .join(&location)
            .map_err(|error| AppError::Network(format!("invalid redirect target: {error}")))?;

        current = next;
    }

    Err(AppError::Network("redirect loop".into()))
}

async fn send_hop(
    client: &reqwest::Client,
    method: &reqwest::Method,
    url: &Url,
    headers: &HeaderMap,
    registry_domain: &str,
    request_path: &str,
    body: &[u8],
) -> AppResult<reqwest::Response> {
    let mut builder = client.request(method.clone(), url.clone());

    for (name, value) in headers {
        if skip_request_header(name.as_str()) {
            continue;
        }
        builder = builder.header(name, value);
    }

    // A hostname target is fetched as itself, exactly like a normal request.
    // A bare IP target has no name to send, so the registry name becomes the
    // Host and the server can virtual-host many free names on one address.
    let host_header = host_header_for(url, registry_domain);
    builder = builder.header(header::HOST, &host_header);

    // The webview sends fdn:// referers; upstream servers expect a normal URL.
    if headers.contains_key(header::REFERER) {
        let referer = format!("{}://{}{}", upstream_scheme(url), host_header, request_path);
        builder = builder.header(header::REFERER, referer);
    }
    if headers.contains_key(header::ORIGIN) {
        let origin = format!("{}://{}", upstream_scheme(url), host_header);
        builder = builder.header(header::ORIGIN, origin);
    }

    if !body.is_empty() && *method != reqwest::Method::GET && *method != reqwest::Method::HEAD {
        builder = builder.body(body.to_vec());
    }

    builder.send().await.map_err(AppError::from)
}

fn host_header_for(target: &Url, registry_domain: &str) -> String {
    match target.host() {
        Some(url::Host::Ipv4(_)) | Some(url::Host::Ipv6(_)) => registry_domain.to_string(),
        Some(url::Host::Domain(host)) => host.trim_end_matches('.').to_string(),
        None => registry_domain.to_string(),
    }
}

fn upstream_scheme(url: &Url) -> &'static str {
    if url.scheme() == "https" {
        "https"
    } else {
        "http"
    }
}

fn skip_request_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "host"
            | "connection"
            | "content-length"
            | "transfer-encoding"
            | "accept-encoding"
            | "origin"
            | "referer"
    )
}

fn skip_response_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "content-length"
            | "content-encoding"
            | "content-security-policy"
            | "content-security-policy-report-only"
            | "x-frame-options"
            | "cross-origin-embedder-policy"
            | "cross-origin-opener-policy"
            | "strict-transport-security"
            | "alt-svc"
    )
}

fn split_path_and_query(path: &str) -> (&str, Option<&str>) {
    let without_fragment = path.split('#').next().unwrap_or(path);
    match without_fragment.split_once('?') {
        Some((path, query)) => {
            let path = if path.is_empty() { "/" } else { path };
            (path, Some(query))
        }
        None => (without_fragment, None),
    }
}

async fn build_response(
    response: reqwest::Response,
    proxy_domain: &str,
    target_host: Option<&str>,
    final_host: Option<&str>,
    is_head: bool,
) -> AppResult<Response<Cow<'static, [u8]>>> {
    let status = response.status();
    let headers = response.headers().clone();
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let raw_body = if is_head {
        Vec::new()
    } else {
        let bytes = response.bytes().await?;
        if bytes.len() > MAX_BODY_BYTES {
            return Err(AppError::Network(format!(
                "response is larger than {} MiB",
                MAX_BODY_BYTES / (1024 * 1024)
            )));
        }
        bytes.to_vec()
    };

    let mut rewrite_hosts = vec![proxy_domain];
    if let Some(host) = target_host {
        rewrite_hosts.push(host);
    }
    if let Some(host) = final_host {
        rewrite_hosts.push(host);
    }

    let body =
        if !is_head && (content_type.contains("text/html") || content_type.contains("text/css")) {
            let text = String::from_utf8_lossy(&raw_body);
            let rewritten = rewrite_markup(&text, proxy_domain, &rewrite_hosts);
            let rewritten = if content_type.contains("text/html") {
                inject_bridge(rewritten)
            } else {
                rewritten
            };
            rewritten.into_bytes()
        } else {
            raw_body
        };

    let mut builder = Response::builder().status(status);
    for (name, value) in headers.iter() {
        if skip_response_header(name.as_str()) {
            continue;
        }
        if name == header::SET_COOKIE {
            if let Ok(value) = value.to_str() {
                builder = builder.header(name, sanitize_set_cookie(value));
            }
            continue;
        }
        if name == header::LOCATION {
            if let Ok(value) = value.to_str() {
                builder = builder.header(name, rewrite_markup(value, proxy_domain, &rewrite_hosts));
            }
            continue;
        }
        builder = builder.header(name, value);
    }
    builder = builder.header(header::CONTENT_LENGTH, body.len() as u64);
    builder = builder.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    builder
        .body(Cow::Owned(body))
        .map_err(|error| AppError::Network(error.to_string()))
}

fn sanitize_set_cookie(value: &str) -> String {
    // Cookies for a custom scheme are awkward: the webview's host is
    // fdn.<domain> (Android) or <domain> (macOS). Dropping Domain lets the
    // cookie become host-only for that proxy origin; Secure is dropped because
    // the proxy itself is not an https origin.
    value
        .split(';')
        .map(str::trim)
        .filter(|part| {
            let lower = part.to_ascii_lowercase();
            !lower.starts_with("domain=") && lower != "secure" && !lower.starts_with("partitioned")
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn rewrite_markup(input: &str, proxy_domain: &str, source_hosts: &[&str]) -> String {
    let mut output = input.to_string();
    let mut seen: Vec<String> = Vec::new();
    for host in source_hosts {
        let host = host.trim_end_matches('.');
        if host.is_empty() {
            continue;
        }
        let key = host.to_ascii_lowercase();
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);

        let pattern = format!(
            r#"(?i)(?:https?:)?//{}(?P<tail>[/'"?#\s]|$)"#,
            regex::escape(host)
        );
        let Ok(regex) = Regex::new(&pattern) else {
            continue;
        };
        let replacement = format!("{}{}${{tail}}", proxy_base(), proxy_domain);
        output = regex
            .replace_all(&output, replacement.as_str())
            .into_owned();
    }
    output
}

fn inject_bridge(mut html: String) -> String {
    static BODY_CLOSE: OnceLock<Regex> = OnceLock::new();
    let regex = BODY_CLOSE.get_or_init(|| Regex::new("(?i)</body>").expect("valid regex"));
    if let Some(found) = regex.find(&html) {
        html.insert_str(found.start(), BRIDGE_SCRIPT);
    } else {
        html.push_str(BRIDGE_SCRIPT);
    }
    html
}

fn error_page(status: StatusCode, title: &str, detail: &str) -> Response<Cow<'static, [u8]>> {
    let body = format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif;
         background: #f6f7f9; color: #16181d; }}
  main {{ max-width: 34rem; padding: 2rem; }}
  h1 {{ font-size: 1.2rem; margin: 0 0 .6rem; }}
  code {{ background: #eceef2; padding: .15rem .35rem; border-radius: .35rem; }}
  @media (prefers-color-scheme: dark) {{
    body {{ background: #101217; color: #e8eaf0; }}
    code {{ background: #1d2027; }}
  }}
</style>
</head>
<body><main>
<h1>{title}</h1>
<p><code>{detail}</code></p>
<p>The page could not be loaded through the Free Domain proxy. Go back and try
the public web instead, or retry in a moment.</p>
</main></body></html>"#,
        title = html_escape(title),
        detail = html_escape(detail),
    );
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Cow::Owned(body.into_bytes()))
        .expect("static error page is a valid response")
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_target_and_registry_hosts_to_the_proxy() {
        let html = r#"<a href="https://example.com/a">x</a><img src="//example.com/b.png"><a href="https://hello.fdn/c">y</a>"#;
        let rewritten = rewrite_markup(html, "hello.fdn", &["hello.fdn", "example.com"]);
        assert!(rewritten.contains(&format!("{}hello.fdn/a", proxy_base())));
        assert!(rewritten.contains(&format!("{}hello.fdn/b.png", proxy_base())));
        assert!(rewritten.contains(&format!("{}hello.fdn/c", proxy_base())));
        assert!(!rewritten.contains("https://example.com"));
        assert!(!rewritten.contains("https://hello.fdn"));
    }

    #[test]
    fn does_not_rewrite_a_lookalike_domain() {
        let html = r#"<a href="https://example.com.evil.test/">x</a>"#;
        let rewritten = rewrite_markup(html, "hello.fdn", &["example.com"]);
        assert!(rewritten.contains("https://example.com.evil.test/"));
    }

    #[test]
    fn host_header_uses_the_target_name_but_keeps_the_registry_name_for_ips() {
        let domain_target = Url::parse("https://example.com/landing").expect("url");
        assert_eq!(host_header_for(&domain_target, "hello.fdn"), "example.com");

        let ip_target = Url::parse("http://192.0.2.10:8080/").expect("url");
        assert_eq!(host_header_for(&ip_target, "hello.fdn"), "hello.fdn");
    }

    #[test]
    fn injects_the_bridge_before_body_close() {
        let html = inject_bridge("<html><body>hi</body></html>".into());
        assert!(html.contains("data-fdn-bridge"));
        assert!(html.find("data-fdn-bridge").unwrap() < html.find("</body>").unwrap());
    }

    #[test]
    fn strips_cookie_domain_and_secure_flags() {
        let cookie = sanitize_set_cookie("sid=abc; Domain=example.com; Path=/; Secure; HttpOnly");
        assert!(!cookie.to_ascii_lowercase().contains("domain="));
        assert!(!cookie.to_ascii_lowercase().contains("secure"));
        assert!(cookie.contains("HttpOnly"));
    }

    #[test]
    fn escapes_error_pages() {
        let page = error_page(
            StatusCode::BAD_GATEWAY,
            "Proxy error",
            "<script>alert(1)</script>",
        );
        let body = String::from_utf8_lossy(page.body());
        assert!(body.contains("&lt;script&gt;"));
        assert!(!body.contains("<script>alert(1)</script>"));
    }

    #[tokio::test]
    async fn fetches_hostname_targets_as_themselves() {
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("addr");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buffer = [0u8; 4096];
            let read = stream.read(&mut buffer).expect("read");
            let request = String::from_utf8_lossy(&buffer[..read]).to_ascii_lowercase();
            assert!(request.contains("host: target.test"), "got: {request}");
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nok",
                )
                .expect("write");
        });

        let client = reqwest::Client::builder()
            .resolve("target.test", address)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("client");
        let url = Url::parse("http://target.test/hello").expect("url");
        let response = send_hop(
            &client,
            &reqwest::Method::GET,
            &url,
            &HeaderMap::new(),
            "hello.fdn",
            "/hello",
            &[],
        )
        .await
        .expect("proxy request");

        assert_eq!(response.status(), reqwest::StatusCode::OK);
        server.join().expect("server thread");
    }

    #[tokio::test]
    async fn ip_targets_keep_the_registry_host_header() {
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("addr");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buffer = [0u8; 4096];
            let read = stream.read(&mut buffer).expect("read");
            let request = String::from_utf8_lossy(&buffer[..read]).to_ascii_lowercase();
            assert!(request.contains("host: example.com"), "got: {request}");
            assert!(request.contains("get /hello http/1.1"), "got: {request}");
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nok",
                )
                .expect("write");
        });

        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("client");
        let url = Url::parse(&format!("http://{address}/hello")).expect("url");
        let headers = HeaderMap::new();
        let response = send_hop(
            &client,
            &reqwest::Method::GET,
            &url,
            &headers,
            "example.com",
            "/hello",
            &[],
        )
        .await
        .expect("proxy request");

        assert_eq!(response.status(), reqwest::StatusCode::OK);
        assert_eq!(response.text().await.expect("body"), "ok");
        server.join().expect("server thread");
    }
}
