// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors

//! Native content webviews for desktop tabs.
//!
//! Public sites such as Yahoo send `Content-Security-Policy: frame-ancestors`,
//! so an iframe can never display them. Desktop tabs therefore own a child
//! [`tauri::Webview`] positioned over the chrome viewport. The webview is a
//! top-level browsing context, which is what the site expects.
//!
//! The chrome stays in the `main` webview. Tauri stacks child webviews above
//! their parent, so the chrome asks the Rust side to hide, show and resize the
//! active tab as the toolbar, chat panel and dialogs need the space.
//!
//! Mobile keeps the iframe path ([`content_mode`] reports `iframe` there):
//! Tauri's multiwebview support is desktop-only.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Rect};

use crate::error::{AppError, AppResult};

/// How the frontend should render page content.
pub const fn content_mode() -> &'static str {
    // Native desktop child webviews are disabled: they sit above the chrome
    // and can cover the address bar. Use the classic iframe tab path again.
    "iframe"
}

/// CSS-pixel rectangle of the content area, relative to the window viewport.
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct ContentBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl ContentBounds {
    fn top(self) -> f64 {
        // Belt-and-braces floor, independent of the chrome measurement. A
        // native child view must never be allowed above the address bar.
        const MIN_TOP: f64 = 86.0;
        self.y.max(MIN_TOP)
    }

    fn position(self) -> tauri::LogicalPosition<f64> {
        tauri::LogicalPosition::new(self.x, self.top())
    }

    fn size(self) -> tauri::LogicalSize<f64> {
        let height = (self.height - (self.top() - self.y)).max(1.0);
        tauri::LogicalSize::new(self.width.max(1.0), height)
    }

    fn rect(self) -> Rect {
        Rect {
            position: self.position().into(),
            size: self.size().into(),
        }
    }
}

#[derive(Clone, Serialize)]
struct TabUrlEvent {
    tab_id: String,
    url: String,
}

#[derive(Clone, Serialize)]
struct TabLoadEvent {
    tab_id: String,
    url: String,
    loading: bool,
}

#[derive(Clone, Serialize)]
struct TabTitleEvent {
    tab_id: String,
    title: String,
}

fn tab_label(tab_id: &str) -> AppResult<String> {
    let valid = !tab_id.is_empty()
        && tab_id.len() <= 64
        && tab_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-');
    if !valid {
        return Err(AppError::InvalidInput("invalid tab id".into()));
    }
    Ok(format!("content-{tab_id}"))
}

fn parse_content_url(raw: &str) -> AppResult<url::Url> {
    let url = url::Url::parse(raw)?;
    if !matches!(url.scheme(), "http" | "https" | "fdn") {
        return Err(AppError::InvalidInput(format!(
            "unsupported content scheme: {}",
            url.scheme()
        )));
    }
    Ok(url)
}

#[tauri::command]
pub async fn content_open(
    app: AppHandle,
    tab_id: String,
    url: String,
    bounds: ContentBounds,
) -> AppResult<()> {
    #[cfg(desktop)]
    {
        return desktop::open(app, tab_id, url, bounds);
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, tab_id, url, bounds);
        Err(AppError::InvalidInput(
            "native tab webviews are desktop-only".into(),
        ))
    }
}

#[tauri::command]
pub async fn content_show(app: AppHandle, tab_id: String, bounds: ContentBounds) -> AppResult<()> {
    #[cfg(desktop)]
    {
        let label = tab_label(&tab_id)?;
        if let Some(webview) = app.get_webview(&label) {
            webview.set_bounds(bounds.rect())?;
            webview.show()?;
        }
        return Ok(());
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, tab_id, bounds);
        Ok(())
    }
}

#[tauri::command]
pub async fn content_hide(app: AppHandle, tab_id: String) -> AppResult<()> {
    #[cfg(desktop)]
    {
        let label = tab_label(&tab_id)?;
        if let Some(webview) = app.get_webview(&label) {
            webview.hide()?;
        }
        return Ok(());
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, tab_id);
        Ok(())
    }
}

#[tauri::command]
pub async fn content_set_bounds(
    app: AppHandle,
    tab_id: String,
    bounds: ContentBounds,
) -> AppResult<()> {
    #[cfg(desktop)]
    {
        let label = tab_label(&tab_id)?;
        if let Some(webview) = app.get_webview(&label) {
            webview.set_bounds(bounds.rect())?;
        }
        return Ok(());
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, tab_id, bounds);
        Ok(())
    }
}

#[tauri::command]
pub async fn content_focus(app: AppHandle, tab_id: String) -> AppResult<()> {
    #[cfg(desktop)]
    {
        let label = tab_label(&tab_id)?;
        if let Some(webview) = app.get_webview(&label) {
            webview.set_focus()?;
        }
        return Ok(());
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, tab_id);
        Ok(())
    }
}

#[tauri::command]
pub async fn content_close(app: AppHandle, tab_id: String) -> AppResult<()> {
    #[cfg(desktop)]
    {
        let label = tab_label(&tab_id)?;
        if let Some(webview) = app.get_webview(&label) {
            webview.close()?;
        }
        return Ok(());
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, tab_id);
        Ok(())
    }
}

/// Focus the chrome webview, e.g. before the menu hands `Ctrl+L` to the page.
#[tauri::command]
pub async fn focus_chrome(app: AppHandle) -> AppResult<()> {
    if let Some(webview) = app.get_webview("main") {
        webview.set_focus()?;
    }
    Ok(())
}

#[cfg(desktop)]
pub fn install_menu(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    let back_accel = if cfg!(target_os = "macos") {
        "Cmd+["
    } else {
        "Alt+Left"
    };
    let forward_accel = if cfg!(target_os = "macos") {
        "Cmd+]"
    } else {
        "Alt+Right"
    };

    let back = MenuItemBuilder::with_id("cmd-back", "Back")
        .accelerator(back_accel)
        .build(app)?;
    let forward = MenuItemBuilder::with_id("cmd-forward", "Forward")
        .accelerator(forward_accel)
        .build(app)?;
    let reload = MenuItemBuilder::with_id("cmd-reload", "Reload")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let focus_address = MenuItemBuilder::with_id("cmd-focus-address", "Focus Address Bar")
        .accelerator("CmdOrCtrl+L")
        .build(app)?;
    let new_tab = MenuItemBuilder::with_id("cmd-new-tab", "New Tab")
        .accelerator("CmdOrCtrl+T")
        .build(app)?;
    let close_tab = MenuItemBuilder::with_id("cmd-close-tab", "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let prev_tab = MenuItemBuilder::with_id("cmd-prev-tab", "Previous Tab")
        .accelerator("Ctrl+Shift+Tab")
        .build(app)?;
    let next_tab = MenuItemBuilder::with_id("cmd-next-tab", "Next Tab")
        .accelerator("Ctrl+Tab")
        .build(app)?;
    let settings = MenuItemBuilder::with_id("cmd-settings", "Appearance")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let browser_menu = SubmenuBuilder::new(app, "Browser")
        .item(&back)
        .item(&forward)
        .item(&reload)
        .separator()
        .item(&focus_address)
        .separator()
        .item(&new_tab)
        .item(&close_tab)
        .item(&prev_tab)
        .item(&next_tab)
        .separator()
        .item(&settings)
        .build()?;

    // macOS expects an application menu as the first submenu; the other
    // platforms only need the browser commands. Keeping the Edit menu also
    // preserves the platform-native clipboard shortcuts.
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let mut menu_builder = MenuBuilder::new(app);
    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(app, "Free Domain Browser")
            .about(None)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        menu_builder = menu_builder.item(&app_menu);
    }
    menu_builder = menu_builder.item(&browser_menu).item(&edit_menu);
    let menu = menu_builder.build()?;

    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        let Some(command) = id.strip_prefix("cmd-") else {
            return;
        };

        // The menu is app-wide, so it also receives shortcuts while the review
        // window is focused. Keep browser commands scoped to the main window;
        // only the close shortcut follows the focused window.
        let other_focused = app
            .webview_windows()
            .into_values()
            .find(|window| window.label() != "main" && window.is_focused().unwrap_or(false));
        if let Some(window) = other_focused {
            if command == "close-tab" {
                let _ = window.close();
            }
            return;
        }

        let _ = app.emit_to("main", "browser-command", command);
    });

    Ok(())
}

#[cfg(desktop)]
mod desktop {
    use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
    use tauri::{Manager, WebviewUrl};

    use super::*;

    fn webview_url(url: &url::Url) -> WebviewUrl {
        if matches!(url.scheme(), "http" | "https") {
            WebviewUrl::External(url.clone())
        } else {
            WebviewUrl::CustomProtocol(url.clone())
        }
    }

    pub fn open(
        app: AppHandle,
        tab_id: String,
        raw_url: String,
        bounds: ContentBounds,
    ) -> AppResult<()> {
        let label = tab_label(&tab_id)?;
        let url = parse_content_url(&raw_url)?;

        if let Some(webview) = app.get_webview(&label) {
            webview.set_bounds(bounds.rect())?;
            webview.navigate(url)?;
            return Ok(());
        }

        let window = app
            .get_window("main")
            .ok_or_else(|| AppError::InvalidInput("main window is missing".into()))?;

        let load_app = app.clone();
        let load_tab = tab_id.clone();
        let title_app = app.clone();
        let title_tab = tab_id.clone();
        let nav_app = app.clone();
        let nav_tab = tab_id.clone();
        let popup_app = app.clone();
        let popup_tab = tab_id.clone();

        let builder = WebviewBuilder::new(label, webview_url(&url))
            .focused(false)
            .accept_first_mouse(true)
            .on_page_load(move |_webview, payload| {
                let loading = match payload.event() {
                    PageLoadEvent::Started => true,
                    PageLoadEvent::Finished => false,
                };
                let _ = load_app.emit_to(
                    "main",
                    "content://load",
                    TabLoadEvent {
                        tab_id: load_tab.clone(),
                        url: payload.url().to_string(),
                        loading,
                    },
                );
            })
            .on_document_title_changed(move |_webview, title| {
                let _ = title_app.emit_to(
                    "main",
                    "content://title",
                    TabTitleEvent {
                        tab_id: title_tab.clone(),
                        title,
                    },
                );
            })
            .on_navigation(move |url| {
                match url.scheme() {
                    "http" | "https" | "fdn" | "about" | "data" | "blob" => true,
                    _ => {
                        // Hand mailto:, tel:, custom-app schemes to the system
                        // instead of failing the navigation silently.
                        let _ = nav_app.emit_to(
                            "main",
                            "content://external",
                            TabUrlEvent {
                                tab_id: nav_tab.clone(),
                                url: url.to_string(),
                            },
                        );
                        false
                    }
                }
            })
            .on_new_window(move |url, _features| {
                let _ = popup_app.emit_to(
                    "main",
                    "content://open-tab",
                    TabUrlEvent {
                        tab_id: popup_tab.clone(),
                        url: url.to_string(),
                    },
                );
                NewWindowResponse::Deny
            });

        let webview = window.add_child(builder, bounds.position(), bounds.size())?;
        // content_show is queued right behind content_open; keeping the new
        // view hidden avoids a blank flash while the document loads.
        let _ = webview.hide();
        Ok(())
    }
}
