// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors

//! Room identifiers shared with `fdn-chatd`.

use iroh_gossip::TopicId;
use sha2::{Digest, Sha256};

pub const LOBBY_ROOM: &str = "fdn:general:v1";

/// `sha256(room)` is the gossip topic. This mapping must match the server and
/// every client version; changing it creates a different room.
pub fn topic_id(room: &str) -> TopicId {
    let digest: [u8; 32] = Sha256::digest(room.as_bytes()).into();
    TopicId::from_bytes(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lobby_matches_server_mapping() {
        assert_eq!(
            hex::encode(topic_id(LOBBY_ROOM).as_bytes()),
            "2bf5b809cdde7ceeaf3abb1f1e260dd1fcb2089d259389cc1b622ec70bfd72de"
        );
    }
}
