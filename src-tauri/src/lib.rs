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

mod error;
mod proxy;
mod registry;
mod resolver;

use std::time::Duration;

use tauri::{Emitter, Manager};

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
}

#[tauri::command]
fn browser_info() -> BrowserInfo {
    BrowserInfo {
        version: env!("CARGO_PKG_VERSION"),
        proxy_base: resolver::proxy_base(),
        registry_base: registry::REGISTRY_RAW_BASE,
        platform: std::env::consts::OS,
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            navigate,
            choose_resolution,
            forget_resolution,
            clear_registry_cache,
            open_external,
            browser_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running Free Domain Browser");
}
