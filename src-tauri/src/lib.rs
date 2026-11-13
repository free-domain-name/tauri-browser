// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors

//! Free Domain Browser — Tauri v2 entry point.
//!
//! The Rust side owns three things:
//!
//! * [`registry`] fetches one sharded JSON record at a time from GitHub and
//!   caches it in memory and on disk,
//! * [`resolver`] decides between the Free Registry, the public web, and asking
//!   the user when a name exists in both,
//! * [`proxy`] serves registry destinations through the `fdn://` custom
//!   protocol while preserving the original `Host` header.

pub mod browser;
pub mod chat;
mod error;
mod proxy;
mod registry;
mod resolver;

use std::time::Duration;

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub use resolver::NavigationOutcome;

/// Shared process-wide state, managed by Tauri.
pub struct AppState {
    pub registry: registry::RegistryClient,
    pub navigator: resolver::Navigator,
    /// Client used for proxied upstream requests. Redirects are followed by
    /// [`proxy`] itself so registry names can be re-entered.
    pub http: reqwest::Client,
}

#[tauri::command]
async fn navigate(
    input: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<NavigationOutcome, error::AppError> {
    let outcome = state.navigator.resolve(&state.registry, &input).await?;
    if outcome.kind == resolver::OutcomeKind::Conflict {
        // The UI also receives this in the command result; the event lets other
        // frontends (or future windows) react to a clash.
        let _ = app.emit("conflict-detected", &outcome);
    }
    Ok(outcome)
}

#[tauri::command]
fn choose_resolution(
    domain: String,
    path: String,
    choice: resolver::Choice,
    state: tauri::State<'_, AppState>,
) -> Result<String, error::AppError> {
    state.navigator.choose_url(&domain, &path, choice)
}

#[tauri::command]
fn forget_resolution(domain: String, state: tauri::State<'_, AppState>) {
    state.navigator.forget(&domain);
}

#[tauri::command]
async fn clear_registry_cache(state: tauri::State<'_, AppState>) -> Result<(), error::AppError> {
    state.registry.clear().await
}

fn review_domain(value: &str) -> Result<String, error::AppError> {
    let domain = value.trim().trim_end_matches('.').to_ascii_lowercase();
    let valid = !domain.is_empty()
        && domain.len() <= 253
        && !domain.starts_with('.')
        && !domain.contains("..")
        && domain
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '.');

    if !valid {
        return Err(error::AppError::InvalidInput(
            "invalid review domain".into(),
        ));
    }
    Ok(domain)
}

/// Open the review surface in its own window.
///
/// The review page embeds giscus and GitHub OAuth. Keeping it in a dedicated
/// window means a GitHub sign-in can navigate that window without replacing the
/// browser chrome or its open tabs.
#[tauri::command]
fn open_review_window(app: tauri::AppHandle, domain: String) -> Result<(), error::AppError> {
    let domain = review_domain(&domain)?;
    let mut review_url =
        url::Url::parse("https://free-domain-name.github.io/tauri-browser/stumble.html")?;
    review_url.query_pairs_mut().append_pair("domain", &domain);

    let window_error = |error: tauri::Error| {
        error::AppError::InvalidInput(format!("could not open review window: {error}"))
    };

    if let Some(window) = app.get_webview_window("review") {
        window.navigate(review_url).map_err(window_error)?;
        let _ = window.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, "review", WebviewUrl::External(review_url))
        .title(format!("Review — {domain}"))
        .inner_size(1000.0, 820.0)
        .min_inner_size(520.0, 420.0)
        .build()
        .map_err(window_error)?;
    Ok(())
}

#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), error::AppError> {
    let parsed = url::Url::parse(&url)?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(error::AppError::InvalidInput(
            "only http(s) URLs can be opened externally".into(),
        ));
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(parsed.to_string(), None::<&str>)
        .map_err(|error| error::AppError::InvalidInput(error.to_string()))
}

#[derive(serde::Serialize)]
struct BrowserInfo {
    version: &'static str,
    proxy_base: &'static str,
    registry_base: &'static str,
    platform: &'static str,
    content_mode: &'static str,
}

#[tauri::command]
fn browser_info() -> BrowserInfo {
    BrowserInfo {
        version: env!("CARGO_PKG_VERSION"),
        proxy_base: resolver::proxy_base(),
        registry_base: registry::REGISTRY_RAW_BASE,
        platform: std::env::consts::OS,
        content_mode: browser::content_mode(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol("fdn", |ctx, request, responder| {
            proxy::handle(ctx, request, responder);
        })
        .setup(|app| {
            let cache_dir = app.path().app_cache_dir()?.join("registry");
            let registry = registry::RegistryClient::new(cache_dir)?;
            let navigator = resolver::Navigator::new()?;
            let http = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(90))
                .user_agent(registry::USER_AGENT)
                .build()?;
            app.manage(AppState {
                registry,
                navigator,
                http,
            });
            app.manage(chat::ChatService::new(app.handle().clone()));

            #[cfg(desktop)]
            browser::install_menu(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            navigate,
            choose_resolution,
            forget_resolution,
            clear_registry_cache,
            open_review_window,
            open_external,
            browser_info,
            browser::content_open,
            browser::content_show,
            browser::content_hide,
            browser::content_set_bounds,
            browser::content_focus,
            browser::content_close,
            browser::focus_chrome,
            chat::chat_set_enabled,
            chat::chat_snapshot,
            chat::chat_send,
            chat::chat_set_nickname,
            chat::chat_update_profile,
            chat::chat_confirm_age,
            chat::chat_set_active_tab,
            chat::chat_ignore,
            chat::chat_unignore,
            chat::chat_clear_local_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running Free Domain Browser");
}
