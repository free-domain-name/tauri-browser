// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors

//! Local send/receive limits from §8 of the plan.
//!
//! These are enforced on receipt as well as on send. A hostile peer can ignore
//! its own client's cooldown, so the receive path is the one that matters for
//! everyone else.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    time::{Duration, Instant},
};

use iroh::EndpointId;

use super::protocol::{MAX_TEXT_CHARS, MESSAGE_MAX_SKEW_MS};

pub const SEND_COOLDOWN: Duration = Duration::from_secs(5);
pub const DUPLICATE_WINDOW: Duration = Duration::from_secs(10 * 60);
pub const ROOM_WINDOW: Duration = Duration::from_secs(10);
pub const ROOM_MESSAGES_PER_WINDOW: usize = 30;
pub const PEER_COOLDOWN: Duration = Duration::from_secs(5);
const SEEN_MESSAGE_CAP: usize = 4096;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LimitError {
    #[error("wait {0} ms before sending again")]
    Cooldown(u64),
    #[error("you already sent that message recently")]
    Duplicate,
    #[error("peer is sending too fast")]
    PeerRate,
    #[error("room is noisy")]
    RoomNoisy,
    #[error("message was already seen")]
    Replay,
    #[error("message is longer than {MAX_TEXT_CHARS} characters")]
    TextTooLong,
    #[error("message is empty")]
    Empty,
}

#[derive(Debug, Default)]
pub struct Policy {
    last_send: Option<Instant>,
    recent_sent: HashMap<String, Instant>,
    last_received: HashMap<EndpointId, Instant>,
    recent_received: HashMap<(EndpointId, String), Instant>,
    room_window: VecDeque<Instant>,
    seen: HashSet<String>,
    seen_order: VecDeque<String>,
    ignored: HashSet<String>,
}

impl Policy {
    pub fn new(ignored: impl IntoIterator<Item = String>) -> Self {
        Self {
            ignored: ignored.into_iter().collect(),
            ..Self::default()
        }
    }

    pub fn is_ignored(&self, sender: &EndpointId) -> bool {
        self.ignored.contains(&sender.to_string())
    }

    pub fn ignore(&mut self, sender: &EndpointId) {
        self.ignored.insert(sender.to_string());
    }

    pub fn unignore(&mut self, sender: &EndpointId) -> bool {
        self.ignored.remove(&sender.to_string())
    }

    pub fn ignored(&self) -> Vec<String> {
        self.ignored.iter().cloned().collect()
    }

    pub fn check_send(&mut self, text: &str) -> Result<(), LimitError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(LimitError::Empty);
        }
        if text.chars().count() > MAX_TEXT_CHARS {
            return Err(LimitError::TextTooLong);
        }
        let now = Instant::now();
        if let Some(last) = self.last_send {
            let elapsed = now.saturating_duration_since(last);
            if elapsed < SEND_COOLDOWN {
                return Err(LimitError::Cooldown(
                    (SEND_COOLDOWN - elapsed).as_millis() as u64
                ));
            }
        }
        let normalized = normalize(text);
        if self
            .recent_sent
            .get(&normalized)
            .is_some_and(|last| now.saturating_duration_since(*last) < DUPLICATE_WINDOW)
        {
            return Err(LimitError::Duplicate);
        }
        self.last_send = Some(now);
        self.recent_sent.insert(normalized, now);
        self.recent_sent
            .retain(|_, last| now.saturating_duration_since(*last) < DUPLICATE_WINDOW);
        Ok(())
    }

    /// Validates a received message and records it against the limits.
    pub fn check_receive(
        &mut self,
        sender: EndpointId,
        message_id: &str,
        text: &str,
    ) -> Result<(), LimitError> {
        if text.trim().is_empty() {
            return Err(LimitError::Empty);
        }
        if text.chars().count() > MAX_TEXT_CHARS {
            return Err(LimitError::TextTooLong);
        }
        if self.seen.contains(message_id) {
            return Err(LimitError::Replay);
        }

        let now = Instant::now();
        if let Some(last) = self.last_received.get(&sender) {
            if now.saturating_duration_since(*last) < PEER_COOLDOWN {
                return Err(LimitError::PeerRate);
            }
        }

        let normalized = normalize(text);
        if self
            .recent_received
            .get(&(sender, normalized.clone()))
            .is_some_and(|last| now.saturating_duration_since(*last) < DUPLICATE_WINDOW)
        {
            return Err(LimitError::Duplicate);
        }

        while let Some(first) = self.room_window.front() {
            if now.saturating_duration_since(*first) >= ROOM_WINDOW {
                self.room_window.pop_front();
            } else {
                break;
            }
        }
        if self.room_window.len() >= ROOM_MESSAGES_PER_WINDOW {
            return Err(LimitError::RoomNoisy);
        }

        self.last_received.insert(sender, now);
        self.recent_received.insert((sender, normalized), now);
        self.recent_received
            .retain(|_, last| now.saturating_duration_since(*last) < DUPLICATE_WINDOW);
        self.room_window.push_back(now);
        self.mark_seen(message_id.to_string());
        Ok(())
    }

    pub fn mark_seen(&mut self, message_id: String) {
        if self.seen.insert(message_id.clone()) {
            self.seen_order.push_back(message_id);
        }
        while self.seen_order.len() > SEEN_MESSAGE_CAP {
            if let Some(old) = self.seen_order.pop_front() {
                self.seen.remove(&old);
            }
        }
    }

    /// Number of milliseconds until the local composer can send again.
    pub fn send_cooldown_ms(&self) -> u64 {
        self.last_send
            .map(|last| {
                SEND_COOLDOWN
                    .saturating_sub(Instant::now().saturating_duration_since(last))
                    .as_millis() as u64
            })
            .unwrap_or(0)
    }
}

pub fn normalize(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Timestamp tolerance helper shared by the receive path.
pub fn timestamp_is_fresh(timestamp_ms: i64, now_ms: i64) -> bool {
    (now_ms - timestamp_ms).abs() <= MESSAGE_MAX_SKEW_MS
}

#[cfg(test)]
mod tests {
    use super::*;
    use iroh::SecretKey;

    fn sender() -> EndpointId {
        SecretKey::generate().public()
    }

    #[test]
    fn send_cooldown_blocks_second_message() {
        let mut policy = Policy::default();
        policy.check_send("one").expect("first");
        assert!(matches!(
            policy.check_send("two"),
            Err(LimitError::Cooldown(_))
        ));
    }

    #[test]
    fn duplicate_text_is_blocked() {
        let mut policy = Policy::default();
        policy.check_send("Hello   World").expect("first");
        policy.last_send = None;
        assert_eq!(policy.check_send("hello world"), Err(LimitError::Duplicate));
    }

    #[test]
    fn receive_caps_peer_and_room() {
        let peer = sender();
        let mut policy = Policy::default();
        policy
            .check_receive(peer, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "one")
            .expect("first");
        assert_eq!(
            policy.check_receive(peer, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "two"),
            Err(LimitError::PeerRate)
        );
    }

    #[test]
    fn replay_is_rejected() {
        let peer = sender();
        let id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let mut policy = Policy::default();
        policy.check_receive(peer, id, "one").expect("first");
        policy.last_received.clear();
        assert_eq!(
            policy.check_receive(peer, id, "one"),
            Err(LimitError::Replay)
        );
    }

    #[test]
    fn ignore_is_keyed_by_endpoint() {
        let peer = sender();
        let mut policy = Policy::default();
        assert!(!policy.is_ignored(&peer));
        policy.ignore(&peer);
        assert!(policy.is_ignored(&peer));
        assert!(policy.unignore(&peer));
        assert!(!policy.is_ignored(&peer));
    }
}
