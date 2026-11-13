// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors

//! Local, non-secret chat preferences.
//!
//! The identity key is in the OS keychain; everything here is ordinary local
//! state that the plan persists: nickname, optional profile, ignore list and
//! UI preferences. Messages and presence are never written to disk.

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

use super::profile::Profile;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub nickname: String,
    pub age_confirmed: bool,
    pub show_profile_in_rooms: bool,
    pub ask_before_joining_site_rooms: bool,
    pub profile: Profile,
    pub profile_version: u32,
    pub ignored: Vec<String>,
    /// Last panel visibility preference. The plan defaults to off.
    pub panel_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            nickname: "anon".to_string(),
            age_confirmed: false,
            show_profile_in_rooms: false,
            ask_before_joining_site_rooms: false,
            profile: Profile::default(),
            profile_version: 0,
            ignored: Vec::new(),
            panel_enabled: false,
        }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        let nickname = self.nickname.trim();
        if nickname.is_empty() || nickname.chars().count() > 32 {
            return Err("nickname must be 1–32 characters".to_string());
        }
        self.profile.validate()
    }
}

/// Thread-safe settings file. Writes are atomic (temp file + rename).
pub struct SettingsStore {
    path: PathBuf,
    settings: Mutex<Settings>,
}

impl SettingsStore {
    pub fn load(app_config_dir: Option<&Path>) -> Self {
        let path = app_config_dir
            .map(|dir| dir.join("chat-settings.json"))
            .unwrap_or_else(|| PathBuf::from("chat-settings.json"));
        let settings = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
            .unwrap_or_default();
        Self {
            path,
            settings: Mutex::new(settings),
        }
    }

    pub fn get(&self) -> Settings {
        self.settings.lock().expect("settings lock").clone()
    }

    pub fn update(&self, change: impl FnOnce(&mut Settings)) -> Result<Settings, String> {
        let mut guard = self.settings.lock().expect("settings lock");
        change(&mut guard);
        guard.validate()?;
        let body = serde_json::to_string_pretty(&*guard).map_err(|error| error.to_string())?;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, format!("{body}\n")).map_err(|error| error.to_string())?;
        std::fs::rename(&tmp, &self.path).map_err(|error| error.to_string())?;
        Ok(guard.clone())
    }
}
