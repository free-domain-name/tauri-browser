// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors

//! Lazily created local chat identity.
//!
//! The 32-byte Ed25519 secret lives in the OS keychain. A browser-only user
//! never gets one because this module is only touched after the first
//! `chat_set_enabled(true)`.

use iroh::{EndpointId, SecretKey};

use super::protocol::fingerprint;

const SERVICE: &str = "org.free-domain.browser.chat";
const ENTRY: &str = "identity-v1";

pub struct Identity {
    pub key: SecretKey,
    pub node_id: EndpointId,
    pub fingerprint: String,
}

impl Identity {
    /// Generates a throwaway identity. Used only by development/test launches
    /// where the OS keychain is unavailable; it is never persisted.
    pub fn generate() -> Self {
        let key = SecretKey::generate();
        let node_id = key.public();
        Self {
            fingerprint: fingerprint(&node_id),
            key,
            node_id,
        }
    }

    pub fn load_or_create() -> Result<Self, IdentityError> {
        let entry = keyring::Entry::new(SERVICE, ENTRY)?;
        let key = match entry.get_secret() {
            Ok(bytes) => parse_key(&bytes)?,
            Err(keyring::Error::NoEntry) => {
                let key = SecretKey::generate();
                entry.set_secret(&key.to_bytes())?;
                key
            }
            Err(error) => return Err(error.into()),
        };
        let node_id = key.public();
        Ok(Self {
            fingerprint: fingerprint(&node_id),
            key,
            node_id,
        })
    }

    /// Rotates the identity. The old key is unrecoverable, so callers must warn.
    pub fn rotate() -> Result<Self, IdentityError> {
        delete()?;
        Self::load_or_create()
    }
}

pub fn delete() -> Result<(), IdentityError> {
    let entry = keyring::Entry::new(SERVICE, ENTRY)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn parse_key(bytes: &[u8]) -> Result<SecretKey, IdentityError> {
    let raw: [u8; 32] = bytes
        .try_into()
        .map_err(|_| IdentityError::BadKey("keychain entry is not 32 bytes".to_string()))?;
    Ok(SecretKey::from_bytes(&raw))
}

#[derive(Debug, thiserror::Error)]
pub enum IdentityError {
    #[error("keychain error: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("invalid chat identity: {0}")]
    BadKey(String),
}
