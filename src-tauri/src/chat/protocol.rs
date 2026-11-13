// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors

//! Signed chat envelopes.
//!
//! Gossip itself does not authenticate authors, so every payload is signed
//! with the sender's iroh/Ed25519 key and verified on receipt. Signatures cover
//! a domain tag plus a deterministic binary encoding of the fields, never the
//! JSON text, so a client cannot be tricked by duplicate keys or key order.

use std::time::{SystemTime, UNIX_EPOCH};

use iroh::{EndpointId, SecretKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_TEXT_CHARS: usize = 500;
pub const MAX_NICKNAME_CHARS: usize = 32;
/// Messages older or newer than this are dropped. Five minutes tolerates
/// ordinary clock skew without keeping a replay window open forever.
pub const MESSAGE_MAX_SKEW_MS: i64 = 5 * 60 * 1000;
/// Presence is much more time sensitive; it also expires after 45 s.
pub const PRESENCE_MAX_SKEW_MS: i64 = 2 * 60 * 1000;

const MESSAGE_DOMAIN: &[u8] = b"fdn-chat/message/v1\0";
const PRESENCE_DOMAIN: &[u8] = b"fdn-chat/presence/v1\0";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Wire {
    Message(Message),
    Presence(Presence),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub v: u8,
    pub room: String,
    pub sender: String,
    pub nickname: String,
    pub profile_version: u32,
    pub message_id: String,
    pub timestamp: i64,
    pub text: String,
    pub reply_to: Option<String>,
    pub sig: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Presence {
    pub v: u8,
    pub room: String,
    pub sender: String,
    pub nickname: String,
    pub profile_version: u32,
    pub timestamp: i64,
    pub sig: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ProtocolError {
    #[error("invalid envelope JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid sender ID: {0}")]
    Sender(String),
    #[error("unsupported protocol version {0}")]
    Version(u8),
    #[error("invalid message ID")]
    MessageId,
    #[error("empty message")]
    EmptyText,
    #[error("message is longer than {MAX_TEXT_CHARS} characters")]
    TextTooLong,
    #[error("nickname is longer than {MAX_NICKNAME_CHARS} characters")]
    NicknameTooLong,
    #[error("envelope is too large")]
    TooLarge,
    #[error("timestamp is outside the accepted window")]
    Timestamp,
    #[error("signature is malformed")]
    SignatureEncoding,
    #[error("signature does not verify")]
    Signature,
}

impl Wire {
    pub fn encode(&self) -> Result<Vec<u8>, ProtocolError> {
        let bytes = serde_json::to_vec(self)?;
        if bytes.len() > 16 * 1024 {
            return Err(ProtocolError::TooLarge);
        }
        Ok(bytes)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, ProtocolError> {
        if bytes.len() > 16 * 1024 {
            return Err(ProtocolError::TooLarge);
        }
        Ok(serde_json::from_slice(bytes)?)
    }
}

impl Message {
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        room: &str,
        sender: EndpointId,
        nickname: &str,
        profile_version: u32,
        text: &str,
        reply_to: Option<String>,
    ) -> Result<Self, ProtocolError> {
        validate_text(text)?;
        validate_nickname(nickname)?;
        let message_id = hex::encode(rand::random::<[u8; 16]>());
        Ok(Self {
            v: PROTOCOL_VERSION,
            room: room.to_string(),
            sender: sender.to_string(),
            nickname: nickname.trim().to_string(),
            profile_version,
            message_id,
            timestamp: now_ms(),
            text: text.to_string(),
            reply_to,
            sig: String::new(),
        })
    }

    pub fn sign(&mut self, key: &SecretKey) {
        let signature = key.sign(&self.signing_bytes(&key.public()));
        self.sig = hex::encode(signature.to_bytes());
    }

    pub fn verify(&self, now_ms: i64) -> Result<EndpointId, ProtocolError> {
        if self.v != PROTOCOL_VERSION {
            return Err(ProtocolError::Version(self.v));
        }
        validate_text(&self.text)?;
        validate_nickname(&self.nickname)?;
        if self.message_id.len() != 32
            || !self.message_id.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(ProtocolError::MessageId);
        }
        let sender = parse_sender(&self.sender)?;
        if (now_ms - self.timestamp).abs() > MESSAGE_MAX_SKEW_MS {
            return Err(ProtocolError::Timestamp);
        }
        verify_signature(&sender, &self.signing_bytes(&sender), &self.sig)?;
        Ok(sender)
    }

    fn signing_bytes(&self, sender: &EndpointId) -> Vec<u8> {
        let mut out = Vec::with_capacity(128 + self.text.len());
        out.extend_from_slice(MESSAGE_DOMAIN);
        out.push(self.v);
        put_str(&mut out, &self.room);
        out.extend_from_slice(sender.as_bytes());
        put_str(&mut out, &self.nickname);
        out.extend_from_slice(&self.profile_version.to_be_bytes());
        put_str(&mut out, &self.message_id);
        out.extend_from_slice(&self.timestamp.to_be_bytes());
        put_str(&mut out, &self.text);
        match &self.reply_to {
            Some(reply) => {
                out.push(1);
                put_str(&mut out, reply);
            }
            None => out.push(0),
        }
        out
    }
}

impl Presence {
    pub fn create(
        room: &str,
        sender: EndpointId,
        nickname: &str,
        profile_version: u32,
    ) -> Result<Self, ProtocolError> {
        validate_nickname(nickname)?;
        Ok(Self {
            v: PROTOCOL_VERSION,
            room: room.to_string(),
            sender: sender.to_string(),
            nickname: nickname.trim().to_string(),
            profile_version,
            timestamp: now_ms(),
            sig: String::new(),
        })
    }

    pub fn sign(&mut self, key: &SecretKey) {
        let signature = key.sign(&self.signing_bytes(&key.public()));
        self.sig = hex::encode(signature.to_bytes());
    }

    pub fn verify(&self, now_ms: i64) -> Result<EndpointId, ProtocolError> {
        if self.v != PROTOCOL_VERSION {
            return Err(ProtocolError::Version(self.v));
        }
        validate_nickname(&self.nickname)?;
        let sender = parse_sender(&self.sender)?;
        if (now_ms - self.timestamp).abs() > PRESENCE_MAX_SKEW_MS {
            return Err(ProtocolError::Timestamp);
        }
        verify_signature(&sender, &self.signing_bytes(&sender), &self.sig)?;
        Ok(sender)
    }

    fn signing_bytes(&self, sender: &EndpointId) -> Vec<u8> {
        let mut out = Vec::with_capacity(96 + self.nickname.len());
        out.extend_from_slice(PRESENCE_DOMAIN);
        out.push(self.v);
        put_str(&mut out, &self.room);
        out.extend_from_slice(sender.as_bytes());
        put_str(&mut out, &self.nickname);
        out.extend_from_slice(&self.profile_version.to_be_bytes());
        out.extend_from_slice(&self.timestamp.to_be_bytes());
        out
    }
}

pub fn fingerprint(sender: &EndpointId) -> String {
    let digest = Sha256::digest(sender.as_bytes());
    hex::encode(&digest[..2])
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn parse_sender(value: &str) -> Result<EndpointId, ProtocolError> {
    value
        .parse()
        .map_err(|error: iroh::KeyParsingError| ProtocolError::Sender(error.to_string()))
}

fn verify_signature(
    sender: &EndpointId,
    message: &[u8],
    signature: &str,
) -> Result<(), ProtocolError> {
    let bytes = hex::decode(signature).map_err(|_| ProtocolError::SignatureEncoding)?;
    let signature =
        Signature::try_from(bytes.as_slice()).map_err(|_| ProtocolError::SignatureEncoding)?;
    sender
        .verify(message, &signature)
        .map_err(|_| ProtocolError::Signature)
}

fn validate_text(text: &str) -> Result<(), ProtocolError> {
    if text.trim().is_empty() {
        return Err(ProtocolError::EmptyText);
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(ProtocolError::TextTooLong);
    }
    Ok(())
}

fn validate_nickname(nickname: &str) -> Result<(), ProtocolError> {
    if nickname.trim().is_empty() || nickname.chars().count() > MAX_NICKNAME_CHARS {
        return Err(ProtocolError::NicknameTooLong);
    }
    Ok(())
}

fn put_str(out: &mut Vec<u8>, value: &str) {
    let bytes = value.as_bytes();
    out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    out.extend_from_slice(bytes);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> SecretKey {
        SecretKey::generate()
    }

    #[test]
    fn message_signs_and_verifies() {
        let key = key();
        let mut message = Message::create("fdn:general:v1", key.public(), "alex", 0, "hello", None)
            .expect("create");
        message.sign(&key);
        assert_eq!(message.verify(now_ms()).expect("verify"), key.public());
    }

    #[test]
    fn tampered_message_is_rejected() {
        let key = key();
        let mut message = Message::create("fdn:general:v1", key.public(), "alex", 0, "hello", None)
            .expect("create");
        message.sign(&key);
        message.text = "hello there".to_string();
        assert!(message.verify(now_ms()).is_err());
    }

    #[test]
    fn presence_signs_and_verifies() {
        let key = key();
        let mut presence =
            Presence::create("fdn:general:v1", key.public(), "alex", 0).expect("create");
        presence.sign(&key);
        assert_eq!(presence.verify(now_ms()).expect("verify"), key.public());
    }

    #[test]
    fn stale_message_is_rejected() {
        let key = key();
        let mut message = Message::create("fdn:general:v1", key.public(), "alex", 0, "hello", None)
            .expect("create");
        message.sign(&key);
        assert!(message.verify(now_ms() + MESSAGE_MAX_SKEW_MS + 1).is_err());
    }

    #[test]
    fn wire_round_trips() {
        let key = key();
        let mut message =
            Message::create("fdn:general:v1", key.public(), "alex", 1, "hi", None).expect("create");
        message.sign(&key);
        let wire = Wire::Message(message.clone());
        let bytes = wire.encode().expect("encode");
        match Wire::decode(&bytes).expect("decode") {
            Wire::Message(decoded) => {
                assert_eq!(decoded.text, "hi");
                assert_eq!(decoded.verify(now_ms()).expect("verify"), key.public());
            }
            Wire::Presence(_) => panic!("wrong variant"),
        }
    }

    #[test]
    fn rejects_empty_and_oversized_text() {
        let key = key();
        assert!(Message::create("fdn:general:v1", key.public(), "alex", 0, "   ", None).is_err());
        let long = "x".repeat(MAX_TEXT_CHARS + 1);
        assert!(Message::create("fdn:general:v1", key.public(), "alex", 0, &long, None).is_err());
    }
}
