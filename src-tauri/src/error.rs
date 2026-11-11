// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors

use serde::ser::{Serialize, Serializer};

/// Errors surfaced to the frontend as a single human-readable string.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("registry lookup failed: {0}")]
    Registry(String),

    #[error("network error: {0}")]
    Network(String),

    #[error("cache error: {0}")]
    Cache(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),

    #[error("invalid URL: {0}")]
    Url(#[from] url::ParseError),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(error: reqwest::Error) -> Self {
        AppError::Network(error.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
