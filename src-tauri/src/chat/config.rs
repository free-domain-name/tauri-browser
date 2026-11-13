// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors

//! Static lobby bootstrap for the client.
//!
//! Resolution order (first non-empty value wins):
//! 1. `FDN_CHAT_RELAY_URL` / `FDN_CHAT_LOBBY_ID` / `FDN_CHAT_LOBBY_ROOM`
//! 2. `<app-config-dir>/chat-bootstrap.json` (the shape `fdn-chatd` writes)
//! 3. compiled defaults.
//!
//! The lobby node ID is intentionally a static deployment value. Rotating it
//! requires a client release or a local config edit; that is the tradeoff the
//! plan accepts instead of adding a DNS/ticket service.

use std::path::Path;

use serde::{Deserialize, Serialize};

pub const DEFAULT_RELAY_URL: &str = "http://chat.vitrn.com:28443";
pub const DEFAULT_LOBBY_ROOM: &str = "fdn:general:v1";
/// Filled in when the production lobby key is generated. Empty means chat
/// cannot start until a bootstrap file or environment override is provided.
pub const DEFAULT_LOBBY_NODE_ID: &str = "";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BootstrapConfig {
    pub relay_url: String,
    pub lobby_node_id: String,
    pub lobby_room: String,
}

impl Default for BootstrapConfig {
    fn default() -> Self {
        Self {
            relay_url: DEFAULT_RELAY_URL.to_string(),
            lobby_node_id: DEFAULT_LOBBY_NODE_ID.to_string(),
            lobby_room: DEFAULT_LOBBY_ROOM.to_string(),
        }
    }
}

impl BootstrapConfig {
    /// Loads the effective bootstrap configuration.
    pub fn load(app_config_dir: Option<&Path>) -> Self {
        let mut config = Self::default();

        if let Some(path) = app_config_dir.map(|dir| dir.join("chat-bootstrap.json")) {
            if let Ok(text) = std::fs::read_to_string(path) {
                if let Ok(file) = serde_json::from_str::<Self>(&text) {
                    if !file.relay_url.is_empty() {
                        config.relay_url = file.relay_url;
                    }
                    if !file.lobby_node_id.is_empty() {
                        config.lobby_node_id = file.lobby_node_id;
                    }
                    if !file.lobby_room.is_empty() {
                        config.lobby_room = file.lobby_room;
                    }
                }
            }
        }

        if let Ok(value) = std::env::var("FDN_CHAT_RELAY_URL") {
            if !value.is_empty() {
                config.relay_url = value;
            }
        }
        if let Ok(value) = std::env::var("FDN_CHAT_LOBBY_ID") {
            if !value.is_empty() {
                config.lobby_node_id = value;
            }
        }
        if let Ok(value) = std::env::var("FDN_CHAT_LOBBY_ROOM") {
            if !value.is_empty() {
                config.lobby_room = value;
            }
        }

        config
    }

    pub fn is_configured(&self) -> bool {
        !self.lobby_node_id.trim().is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_plain_http() {
        let config = BootstrapConfig::default();
        assert_eq!(config.relay_url, "http://chat.vitrn.com:28443");
        assert_eq!(config.lobby_room, "fdn:general:v1");
        assert!(!config.is_configured());
    }
}
