// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors

//! Development-only signed-message probe.
//!
//! Run two instances against a local `fdn-chatd` to verify that signed
//! envelopes survive the relay and verify on the receiving side:
//!
//! ```text
//! cargo run --example chat_probe -- --bootstrap /tmp/fdn/bootstrap.json --nickname a --message hi
//! ```

use std::time::Duration;

use anyhow::{Context, Result};
use clap::Parser;
use free_domain_browser_lib::chat::{
    config::BootstrapConfig,
    identity::Identity,
    protocol::{fingerprint, now_ms, Message, Presence, Wire},
    transport::Transport,
};
use iroh::SecretKey;
use n0_future::StreamExt;

#[derive(Debug, Parser)]
struct Args {
    #[arg(long)]
    bootstrap: std::path::PathBuf,
    #[arg(long, default_value = "probe")]
    nickname: String,
    #[arg(long)]
    message: Option<String>,
    #[arg(long, default_value_t = 5)]
    listen_seconds: u64,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let text = std::fs::read_to_string(&args.bootstrap)
        .with_context(|| format!("could not read {}", args.bootstrap.display()))?;
    let config: BootstrapConfig = serde_json::from_str(&text).context("parse bootstrap")?;

    let key = SecretKey::generate();
    let node_id = key.public();
    let identity = Identity {
        key,
        node_id,
        fingerprint: fingerprint(&node_id),
    };

    let transport = Transport::start(&identity, &config).await?;
    let mut topic = transport.subscribe_lobby().await?;
    tokio::time::timeout(Duration::from_secs(15), topic.joined())
        .await
        .context("timed out joining lobby")?
        .map_err(|error| anyhow::anyhow!("join failed: {error}"))?;
    println!(
        "{} joined as {}#{}",
        args.nickname, args.nickname, identity.fingerprint
    );
    let (sender, mut receiver) = topic.split();

    let mut presence =
        Presence::create(transport.lobby_room(), identity.node_id, &args.nickname, 0)?;
    presence.sign(&identity.key);
    sender
        .broadcast(Wire::Presence(presence).encode()?.into())
        .await
        .map_err(|error| anyhow::anyhow!("presence failed: {error}"))?;

    if let Some(message) = args.message {
        let mut message = Message::create(
            transport.lobby_room(),
            identity.node_id,
            &args.nickname,
            0,
            &message,
            None,
        )?;
        message.sign(&identity.key);
        sender
            .broadcast(Wire::Message(message).encode()?.into())
            .await
            .map_err(|error| anyhow::anyhow!("send failed: {error}"))?;
    }

    let deadline = tokio::time::Instant::now() + Duration::from_secs(args.listen_seconds);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, receiver.next()).await {
            Ok(Some(Ok(iroh_gossip::api::Event::Received(message)))) => {
                match Wire::decode(&message.content) {
                    Ok(Wire::Message(message)) => match message.verify(now_ms()) {
                        Ok(sender) => println!(
                            "verified {}#{}: {}",
                            message.nickname,
                            fingerprint(&sender),
                            message.text
                        ),
                        Err(error) => println!("dropped invalid message: {error}"),
                    },
                    Ok(Wire::Presence(presence)) => {
                        if let Ok(sender) = presence.verify(now_ms()) {
                            println!("presence {}#{}", presence.nickname, fingerprint(&sender));
                        }
                    }
                    Err(error) => println!("dropped malformed envelope: {error}"),
                }
            }
            Ok(Some(Ok(_))) => {}
            Ok(Some(Err(error))) => eprintln!("gossip error: {error}"),
            Ok(None) => break,
            Err(_) => break,
        }
    }

    drop(sender);
    transport.shutdown().await?;
    Ok(())
}
