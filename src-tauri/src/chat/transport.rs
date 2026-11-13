// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors

//! iroh endpoint and gossip plumbing for the client chat service.
//!
//! The endpoint uses the self-hosted relay (plain HTTP/WebSocket) and a memory
//! address lookup that knows only the headless lobby peer. Direct IP transports
//! stay enabled, so peers can hole-punch once gossip introduces them.

use anyhow::{Context, Result};
use iroh::{
    address_lookup::memory::MemoryLookup, endpoint::presets, protocol::Router, Endpoint,
    EndpointAddr, EndpointId, RelayMap, RelayMode, RelayUrl,
};
use iroh_gossip::{api::GossipTopic, Gossip, ALPN};

use super::{config::BootstrapConfig, identity::Identity, protocol::PROTOCOL_VERSION};

pub struct Transport {
    endpoint: Endpoint,
    gossip: Gossip,
    router: Router,
    lobby_id: EndpointId,
    relay_url: RelayUrl,
    lobby_room: String,
}

impl Transport {
    /// Binds the endpoint and starts the gossip protocol. No subscription is
    /// made here; [`Self::subscribe_lobby`] does that.
    pub async fn start(identity: &Identity, config: &BootstrapConfig) -> Result<Self> {
        anyhow::ensure!(
            config.is_configured(),
            "chat bootstrap is missing the lobby node ID"
        );
        let relay_url: RelayUrl = config
            .relay_url
            .parse()
            .with_context(|| format!("invalid relay URL `{}`", config.relay_url))?;
        let lobby_id: EndpointId = config
            .lobby_node_id
            .parse()
            .with_context(|| format!("invalid lobby node ID `{}`", config.lobby_node_id))?;

        let lookup = MemoryLookup::new();
        lookup.add_endpoint_info(EndpointAddr::new(lobby_id).with_relay_url(relay_url.clone()));

        let endpoint = Endpoint::builder(presets::Minimal)
            .secret_key(identity.key.clone())
            .relay_mode(RelayMode::Custom(RelayMap::from_iter([relay_url.clone()])))
            .clear_address_lookup()
            .address_lookup(lookup)
            .bind()
            .await
            .map_err(|error| anyhow::anyhow!("could not bind chat endpoint: {error}"))?;

        let gossip = Gossip::builder().spawn(endpoint.clone());
        let router = Router::builder(endpoint.clone())
            .accept(ALPN, gossip.clone())
            .spawn();

        Ok(Self {
            endpoint,
            gossip,
            router,
            lobby_id,
            relay_url,
            lobby_room: config.lobby_room.clone(),
        })
    }

    pub fn node_id(&self) -> EndpointId {
        self.endpoint.id()
    }

    pub fn relay_url(&self) -> &RelayUrl {
        &self.relay_url
    }

    pub fn lobby_room(&self) -> &str {
        &self.lobby_room
    }

    pub fn lobby_id(&self) -> EndpointId {
        self.lobby_id
    }

    /// Subscribes to the shared lobby. The caller decides how long to wait for
    /// the first neighbor, so a relay outage can surface as "connecting".
    pub async fn subscribe_lobby(&self) -> Result<GossipTopic> {
        self.gossip
            .subscribe(super::room::topic_id(&self.lobby_room), vec![self.lobby_id])
            .await
            .map_err(|error| anyhow::anyhow!("could not subscribe to lobby: {error}"))
    }

    pub async fn shutdown(self) -> Result<()> {
        self.router
            .shutdown()
            .await
            .map_err(|error| anyhow::anyhow!("chat router shutdown failed: {error}"))?;
        self.gossip
            .shutdown()
            .await
            .map_err(|error| anyhow::anyhow!("chat gossip shutdown failed: {error}"))?;
        Ok(())
    }
}

/// Protocol/version marker used by the UI and diagnostics.
pub const WIRE_VERSION: u8 = PROTOCOL_VERSION;
