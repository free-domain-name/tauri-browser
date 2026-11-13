// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors

//! Community chat service for the Free Domain Browser.
//!
//! Chat is opt-in per tab. The first enabled panel creates an iroh identity and
//! endpoint; hiding the last panel drops every room and stops traffic. This
//! module keeps all state in memory except the identity (keychain) and the
//! settings file (nickname, profile, ignore list, UI preferences).

pub mod config;
pub mod identity;
pub mod policy;
pub mod profile;
pub mod protocol;
pub mod room;
pub mod settings;
pub mod transport;

use std::{
    collections::{BTreeMap, BTreeSet, HashSet, VecDeque},
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use iroh::EndpointId;
use iroh_gossip::api::{Event, GossipSender};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::task::JoinHandle;

use self::{
    config::BootstrapConfig,
    identity::Identity,
    policy::{LimitError, Policy},
    profile::Profile,
    protocol::{
        fingerprint, now_ms, Message, Presence, ProfileCard, ProtocolError, Wire, MAX_TEXT_CHARS,
    },
    settings::{Settings, SettingsStore},
    transport::Transport,
};

pub const EVENT_STATE: &str = "chat://state";
pub const EVENT_MESSAGE: &str = "chat://message";
pub const EVENT_PRESENCE: &str = "chat://presence";
pub const EVENT_ERROR: &str = "chat://error";
pub const EVENT_ROOMS: &str = "chat://rooms";

const HEARTBEAT: Duration = Duration::from_secs(15);
const PRESENCE_TTL_MS: i64 = 45_000;
const MESSAGE_RING: usize = 200;
const PROFILE_COOLDOWN: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, thiserror::Error)]
pub enum ChatError {
    #[error("18+ confirmation is required before enabling chat")]
    AgeGate,
    #[error("chat bootstrap is not configured (missing lobby node ID)")]
    NotConfigured,
    #[error("chat is not enabled")]
    NotEnabled,
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("profile updates are limited; try again in {0} ms")]
    ProfileCooldown(u64),
    #[error("chat transport error: {0}")]
    Transport(String),
    #[error("chat protocol error: {0}")]
    Protocol(#[from] ProtocolError),
    #[error("{0}")]
    Limit(#[from] LimitError),
    #[error("chat storage error: {0}")]
    Storage(String),
}

impl Serialize for ChatError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MessageView {
    pub id: String,
    pub sender: String,
    pub nickname: String,
    pub fingerprint: String,
    pub text: String,
    pub timestamp: i64,
    pub mine: bool,
    pub ignored: bool,
    pub profile_version: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct UserView {
    pub sender: String,
    pub nickname: String,
    pub fingerprint: String,
    pub ignored: bool,
    pub is_me: bool,
    pub last_seen_ms: i64,
    pub has_profile: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileView {
    pub sender: String,
    pub nickname: String,
    pub fingerprint: String,
    pub description: String,
    pub gender: String,
    pub age_band: String,
    pub country: String,
    pub city: String,
    pub profile_version: u32,
    pub received_ms: i64,
    pub ignored: bool,
    pub is_me: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub enabled: bool,
    pub connected: bool,
    pub node_id: Option<String>,
    pub fingerprint: Option<String>,
    pub room: String,
    pub online: usize,
    pub users: Vec<UserView>,
    pub messages: Vec<MessageView>,
    pub profiles: Vec<ProfileView>,
    pub profile: Profile,
    pub show_profile_in_rooms: bool,
    pub nickname: String,
    pub cooldown_ms: u64,
    pub profile_cooldown_ms: u64,
    pub age_confirmed: bool,
    pub error: Option<String>,
    pub relay_url: String,
}

struct Shared {
    node_id: EndpointId,
    room: String,
    relay_url: String,
    nickname: Mutex<String>,
    profile_version: AtomicU32,
    connected: AtomicBool,
    error: Mutex<Option<String>>,
    users: Mutex<BTreeMap<String, UserView>>,
    profiles: Mutex<BTreeMap<String, ProfileView>>,
    messages: Mutex<VecDeque<MessageView>>,
    policy: Mutex<Policy>,
    last_noise_ms: AtomicI64,
    last_profile_ms: AtomicI64,
}

struct Session {
    transport: Transport,
    sender: GossipSender,
    identity: Arc<Identity>,
    tasks: Vec<JoinHandle<()>>,
    shared: Arc<Shared>,
}

struct Inner {
    enabled_tabs: BTreeSet<String>,
    active_tab: Option<String>,
    session: Option<Session>,
    error: Option<String>,
}

pub struct ChatService {
    app: AppHandle,
    inner: tokio::sync::Mutex<Inner>,
    lifecycle: tokio::sync::Mutex<()>,
    settings: Arc<SettingsStore>,
    bootstrap: BootstrapConfig,
}

impl ChatService {
    pub fn new(app: AppHandle) -> Self {
        let config_dir = std::env::var_os("FDN_CHAT_CONFIG_DIR")
            .map(std::path::PathBuf::from)
            .or_else(|| app.path().app_config_dir().ok());
        let settings = SettingsStore::load(config_dir.as_deref());
        let bootstrap = BootstrapConfig::load(config_dir.as_deref());
        Self {
            app,
            inner: tokio::sync::Mutex::new(Inner {
                enabled_tabs: BTreeSet::new(),
                active_tab: None,
                session: None,
                error: None,
            }),
            lifecycle: tokio::sync::Mutex::new(()),
            settings: Arc::new(settings),
            bootstrap,
        }
    }

    async fn set_enabled(&self, tab_id: String, enabled: bool) -> Result<Snapshot, ChatError> {
        if enabled {
            let settings = self.settings.get();
            if !settings.age_confirmed {
                return Err(ChatError::AgeGate);
            }
            if !self.bootstrap.is_configured() {
                return Err(ChatError::NotConfigured);
            }
        }

        let _lifecycle = self.lifecycle.lock().await;
        {
            let mut inner = self.inner.lock().await;
            if enabled {
                inner.enabled_tabs.insert(tab_id.clone());
                inner.active_tab = Some(tab_id.clone());
            } else {
                inner.enabled_tabs.remove(&tab_id);
                if inner.active_tab.as_deref() == Some(tab_id.as_str()) {
                    inner.active_tab = inner.enabled_tabs.iter().next().cloned();
                }
            }
        }

        let should_run = {
            let inner = self.inner.lock().await;
            !inner.enabled_tabs.is_empty()
        };
        if should_run {
            if let Err(error) = self.start_session().await {
                let mut inner = self.inner.lock().await;
                if inner.session.is_none() {
                    inner.enabled_tabs.remove(&tab_id);
                    inner.error = Some(error.to_string());
                }
                drop(inner);
                let snapshot = self.snapshot().await;
                let _ = self.app.emit(EVENT_STATE, snapshot);
                return Err(error);
            }
        } else {
            self.stop_session().await;
        }

        let _ = self.settings.update(|settings| {
            settings.panel_enabled = should_run;
        });

        Ok(self.snapshot().await)
    }

    async fn start_session(&self) -> Result<(), ChatError> {
        {
            let inner = self.inner.lock().await;
            if inner.session.is_some() {
                return Ok(());
            }
        }

        let settings = self.settings.get();
        let bootstrap = self.bootstrap.clone();
        let identity = if ephemeral_identity() {
            Identity::generate()
        } else {
            tokio::task::spawn_blocking(Identity::load_or_create)
                .await
                .map_err(|error| ChatError::Storage(error.to_string()))?
                .map_err(|error| ChatError::Storage(error.to_string()))?
        };
        let identity = Arc::new(identity);

        let transport = Transport::start(&identity, &bootstrap)
            .await
            .map_err(|error| ChatError::Transport(format!("{error:#}")))?;
        let topic = transport
            .subscribe_lobby()
            .await
            .map_err(|error| ChatError::Transport(format!("{error:#}")))?;
        let (sender, receiver) = topic.split();

        let shared = Arc::new(Shared {
            node_id: identity.node_id,
            room: bootstrap.lobby_room.clone(),
            relay_url: bootstrap.relay_url.clone(),
            nickname: Mutex::new(settings.nickname.clone()),
            profile_version: AtomicU32::new(settings.profile_version),
            connected: AtomicBool::new(false),
            error: Mutex::new(None),
            users: Mutex::new(BTreeMap::new()),
            profiles: Mutex::new(BTreeMap::new()),
            messages: Mutex::new(VecDeque::new()),
            policy: Mutex::new(Policy::new(settings.ignored.clone())),
            last_noise_ms: AtomicI64::new(0),
            last_profile_ms: AtomicI64::new(0),
        });

        let me = UserView {
            sender: identity.node_id.to_string(),
            nickname: settings.nickname.clone(),
            fingerprint: identity.fingerprint.clone(),
            ignored: false,
            is_me: true,
            last_seen_ms: now_ms(),
            has_profile: false,
        };
        shared
            .users
            .lock()
            .expect("users lock")
            .insert(me.sender.clone(), me);

        if let Err(error) =
            broadcast_profile(&self.app, &shared, &sender, &identity, &settings).await
        {
            *shared.error.lock().expect("error lock") = Some(error.to_string());
            emit_error(&self.app, &error.to_string());
        }

        let receiver_task = {
            let app = self.app.clone();
            let shared = Arc::clone(&shared);
            let settings = Arc::clone(&self.settings);
            tokio::spawn(async move {
                run_receiver(app, shared, receiver, settings).await;
            })
        };
        let heartbeat_task = {
            let app = self.app.clone();
            let shared = Arc::clone(&shared);
            let sender = sender.clone();
            let key = Arc::clone(&identity);
            tokio::spawn(async move {
                run_heartbeat(app, shared, sender, key).await;
            })
        };

        let mut inner = self.inner.lock().await;
        inner.session = Some(Session {
            transport,
            sender,
            identity: Arc::clone(&identity),
            tasks: vec![receiver_task, heartbeat_task],
            shared: Arc::clone(&shared),
        });
        inner.error = None;
        drop(inner);

        emit_state(&self.app, &shared, &settings, true);
        Ok(())
    }

    async fn stop_session(&self) {
        let session = {
            let mut inner = self.inner.lock().await;
            inner.session.take()
        };
        let Some(session) = session else {
            return;
        };
        for task in &session.tasks {
            task.abort();
        }
        for task in session.tasks {
            let _ = task.await;
        }
        drop(session.sender);
        let _ = session.transport.shutdown().await;
        let snapshot = self.snapshot().await;
        let _ = self.app.emit(EVENT_STATE, snapshot);
    }

    async fn snapshot(&self) -> Snapshot {
        let settings = self.settings.get();
        let inner = self.inner.lock().await;
        let enabled = !inner.enabled_tabs.is_empty();
        match &inner.session {
            Some(session) => snapshot_from(&session.shared, &settings, enabled),
            None => Snapshot {
                enabled,
                connected: false,
                node_id: None,
                fingerprint: None,
                room: self.bootstrap.lobby_room.clone(),
                online: 0,
                users: Vec::new(),
                messages: Vec::new(),
                profiles: Vec::new(),
                profile: settings.profile.clone(),
                show_profile_in_rooms: settings.show_profile_in_rooms,
                nickname: settings.nickname.clone(),
                cooldown_ms: 0,
                profile_cooldown_ms: 0,
                age_confirmed: settings.age_confirmed,
                error: inner.error.clone(),
                relay_url: self.bootstrap.relay_url.clone(),
            },
        }
    }

    async fn send(&self, text: String) -> Result<(), ChatError> {
        let text = text.trim().to_string();
        if text.chars().count() > MAX_TEXT_CHARS {
            return Err(ChatError::Invalid(format!(
                "message is longer than {MAX_TEXT_CHARS} characters"
            )));
        }

        let (sender, shared, key, nickname) = {
            let inner = self.inner.lock().await;
            let session = inner.session.as_ref().ok_or(ChatError::NotEnabled)?;
            let shared = Arc::clone(&session.shared);
            let sender = session.sender.clone();
            let key = Arc::clone(&session.identity);
            let nickname = shared.nickname.lock().expect("nickname lock").clone();
            (sender, shared, key, nickname)
        };

        {
            let mut policy = shared.policy.lock().expect("policy lock");
            policy.check_send(&text)?;
        }

        let mut message = Message::create(
            &shared.room,
            shared.node_id,
            &nickname,
            shared.profile_version.load(Ordering::Relaxed),
            &text,
            None,
        )?;
        message.sign(&key.key);
        let bytes = Wire::Message(message.clone()).encode()?;
        sender
            .broadcast(bytes.into())
            .await
            .map_err(|error| ChatError::Transport(error.to_string()))?;

        let view = MessageView {
            id: message.message_id.clone(),
            sender: message.sender.clone(),
            nickname: message.nickname.clone(),
            fingerprint: fingerprint(&shared.node_id),
            text: message.text.clone(),
            timestamp: message.timestamp,
            mine: true,
            ignored: false,
            profile_version: message.profile_version,
        };
        shared
            .policy
            .lock()
            .expect("policy lock")
            .mark_seen(message.message_id.clone());
        push_message(&self.app, &shared, view);
        emit_state(&self.app, &shared, &self.settings.get(), true);
        Ok(())
    }

    async fn set_nickname(&self, nickname: String) -> Result<Snapshot, ChatError> {
        let nickname = nickname.trim().to_string();
        if nickname.is_empty() || nickname.chars().count() > 32 {
            return Err(ChatError::Invalid(
                "nickname must be 1–32 characters".to_string(),
            ));
        }
        self.settings
            .update(|settings| settings.nickname = nickname.clone())
            .map_err(ChatError::Storage)?;

        let shared = {
            let inner = self.inner.lock().await;
            inner
                .session
                .as_ref()
                .map(|session| Arc::clone(&session.shared))
        };
        if let Some(shared) = shared {
            *shared.nickname.lock().expect("nickname lock") = nickname.clone();
            let node_id = shared.node_id;
            if let Some(user) = shared
                .users
                .lock()
                .expect("users lock")
                .get_mut(&node_id.to_string())
            {
                user.nickname = nickname;
                user.last_seen_ms = now_ms();
            }
            let settings = self.settings.get();
            emit_state(&self.app, &shared, &settings, true);
        }
        Ok(self.snapshot().await)
    }

    async fn confirm_age(&self) -> Result<Snapshot, ChatError> {
        self.settings
            .update(|settings| settings.age_confirmed = true)
            .map_err(ChatError::Storage)?;
        Ok(self.snapshot().await)
    }

    async fn set_active_tab(&self, tab_id: Option<String>) -> Snapshot {
        {
            let mut inner = self.inner.lock().await;
            inner.active_tab = tab_id;
        }
        self.snapshot().await
    }

    async fn ignore(&self, sender: String) -> Result<Snapshot, ChatError> {
        let sender: EndpointId = sender
            .parse()
            .map_err(|_| ChatError::Invalid("invalid sender ID".to_string()))?;
        let shared = self.session_shared().await.ok_or(ChatError::NotEnabled)?;
        shared.policy.lock().expect("policy lock").ignore(&sender);
        self.settings
            .update(|settings| {
                let value = sender.to_string();
                if !settings.ignored.contains(&value) {
                    settings.ignored.push(value);
                }
            })
            .map_err(ChatError::Storage)?;
        {
            let mut messages = shared.messages.lock().expect("messages lock");
            messages.retain(|message| message.sender != sender.to_string());
        }
        {
            let mut users = shared.users.lock().expect("users lock");
            if let Some(user) = users.get_mut(&sender.to_string()) {
                user.ignored = true;
            }
        }
        if let Some(profile) = shared
            .profiles
            .lock()
            .expect("profiles lock")
            .get_mut(&sender.to_string())
        {
            profile.ignored = true;
        }
        emit_presence(&self.app, &shared);
        emit_state(&self.app, &shared, &self.settings.get(), true);
        Ok(self.snapshot().await)
    }

    async fn unignore(&self, sender: String) -> Result<Snapshot, ChatError> {
        let sender: EndpointId = sender
            .parse()
            .map_err(|_| ChatError::Invalid("invalid sender ID".to_string()))?;
        let shared = self.session_shared().await.ok_or(ChatError::NotEnabled)?;
        shared.policy.lock().expect("policy lock").unignore(&sender);
        self.settings
            .update(|settings| {
                settings
                    .ignored
                    .retain(|value| value != &sender.to_string())
            })
            .map_err(ChatError::Storage)?;
        {
            let mut users = shared.users.lock().expect("users lock");
            if let Some(user) = users.get_mut(&sender.to_string()) {
                user.ignored = false;
            }
        }
        if let Some(profile) = shared
            .profiles
            .lock()
            .expect("profiles lock")
            .get_mut(&sender.to_string())
        {
            profile.ignored = false;
        }
        emit_presence(&self.app, &shared);
        Ok(self.snapshot().await)
    }

    async fn update_profile(
        &self,
        profile: Profile,
        show_in_rooms: bool,
    ) -> Result<Snapshot, ChatError> {
        let profile = profile.normalized();
        profile.validate().map_err(ChatError::Invalid)?;
        let session = {
            let inner = self.inner.lock().await;
            inner.session.as_ref().map(|session| {
                (
                    Arc::clone(&session.shared),
                    session.sender.clone(),
                    Arc::clone(&session.identity),
                )
            })
        };
        if show_in_rooms && !profile.is_empty() {
            if let Some((shared, _, _)) = &session {
                let left = profile_cooldown_ms(shared);
                if left > 0 {
                    return Err(ChatError::ProfileCooldown(left));
                }
            }
        }

        let next_version = self.settings.get().profile_version.wrapping_add(1).max(1);
        let updated = self
            .settings
            .update(|settings| {
                settings.profile = profile.clone();
                settings.show_profile_in_rooms = show_in_rooms;
                settings.profile_version = next_version;
            })
            .map_err(ChatError::Storage)?;

        if let Some((shared, sender, identity)) = &session {
            shared
                .profile_version
                .store(next_version, Ordering::Relaxed);
            if show_in_rooms && !profile.is_empty() {
                broadcast_profile(&self.app, shared, sender, identity, &updated).await?;
            } else {
                shared
                    .profiles
                    .lock()
                    .expect("profiles lock")
                    .remove(&shared.node_id.to_string());
                mark_user_profile(shared, shared.node_id, false);
                emit_state(&self.app, shared, &updated, true);
            }
        }
        Ok(self.snapshot().await)
    }

    async fn clear_local_data(&self) -> Result<Snapshot, ChatError> {
        let _lifecycle = self.lifecycle.lock().await;
        self.stop_session().await;
        if !ephemeral_identity() {
            tokio::task::spawn_blocking(identity::delete)
                .await
                .map_err(|error| ChatError::Storage(error.to_string()))?
                .map_err(|error| ChatError::Storage(error.to_string()))?;
        }
        self.settings
            .update(|settings| *settings = Settings::default())
            .map_err(ChatError::Storage)?;
        {
            let mut inner = self.inner.lock().await;
            inner.enabled_tabs.clear();
            inner.active_tab = None;
        }
        let snapshot = self.snapshot().await;
        let _ = self.app.emit(EVENT_STATE, snapshot.clone());
        Ok(snapshot)
    }

    async fn session_shared(&self) -> Option<Arc<Shared>> {
        let inner = self.inner.lock().await;
        inner
            .session
            .as_ref()
            .map(|session| Arc::clone(&session.shared))
    }
}

fn ephemeral_identity() -> bool {
    cfg!(debug_assertions) && std::env::var_os("FDN_CHAT_EPHEMERAL_IDENTITY").is_some()
}

async fn run_receiver(
    app: AppHandle,
    shared: Arc<Shared>,
    mut receiver: iroh_gossip::api::GossipReceiver,
    settings: Arc<SettingsStore>,
) {
    use n0_future::StreamExt;

    let mut neighbors: HashSet<EndpointId> = HashSet::new();
    let mut warned = false;
    let mut ticker = tokio::time::interval(Duration::from_secs(5));
    ticker.tick().await;

    loop {
        tokio::select! {
            event = receiver.next() => {
                let Some(event) = event else { break };
                match event {
                    Ok(Event::NeighborUp(peer)) => {
                        neighbors.insert(peer);
                        shared.connected.store(true, Ordering::Relaxed);
                        *shared.error.lock().expect("error lock") = None;
                        warned = false;
                        emit_state(&app, &shared, &settings.get(), true);
                    }
                    Ok(Event::NeighborDown(peer)) => {
                        neighbors.remove(&peer);
                        if neighbors.is_empty() {
                            shared.connected.store(false, Ordering::Relaxed);
                        }
                        emit_state(&app, &shared, &settings.get(), true);
                    }
                    Ok(Event::Received(message)) => {
                        handle_payload(&app, &shared, &message.content, &settings);
                    }
                    Ok(Event::Lagged) => {
                        emit_error(&app, "chat receiver fell behind; presence may be stale");
                    }
                    Ok(_) => {}
                    Err(error) => {
                        *shared.error.lock().expect("error lock") =
                            Some(format!("chat stream ended: {error}"));
                        emit_error(&app, &format!("chat stream ended: {error}"));
                        break;
                    }
                }
            }
            _ = ticker.tick() => {
                if neighbors.is_empty() && !warned {
                    warned = true;
                    let message = "connecting… relay has not answered yet";
                    *shared.error.lock().expect("error lock") = Some(message.to_string());
                    emit_error(&app, message);
                    emit_state(&app, &shared, &settings.get(), true);
                }
            }
        }
    }
    shared.connected.store(false, Ordering::Relaxed);
    emit_state(&app, &shared, &settings.get(), true);
}

fn handle_payload(app: &AppHandle, shared: &Arc<Shared>, content: &[u8], settings: &SettingsStore) {
    let wire = match Wire::decode(content) {
        Ok(wire) => wire,
        Err(error) => {
            emit_error(app, &format!("dropped malformed chat envelope: {error}"));
            return;
        }
    };
    let now = now_ms();

    match wire {
        Wire::Message(message) => {
            if message.room != shared.room {
                return;
            }
            let sender = match message.verify(now) {
                Ok(sender) => sender,
                Err(error) => {
                    emit_error(app, &format!("dropped unsigned message: {error}"));
                    return;
                }
            };
            {
                let mut policy = shared.policy.lock().expect("policy lock");
                if policy.is_ignored(&sender) {
                    return;
                }
                if let Err(error) = policy.check_receive(sender, &message.message_id, &message.text)
                {
                    if matches!(error, LimitError::RoomNoisy) {
                        let last = shared.last_noise_ms.load(Ordering::Relaxed);
                        if now - last > 5_000 {
                            shared.last_noise_ms.store(now, Ordering::Relaxed);
                            emit_error(app, "room is noisy; some messages were dropped");
                        }
                    }
                    return;
                }
            }

            let view = MessageView {
                id: message.message_id.clone(),
                sender: message.sender.clone(),
                nickname: message.nickname.clone(),
                fingerprint: fingerprint(&sender),
                text: message.text.clone(),
                timestamp: message.timestamp,
                mine: sender == shared.node_id,
                ignored: false,
                profile_version: message.profile_version,
            };
            touch_user(shared, sender, &message.nickname, None);
            push_message(app, shared, view);
            emit_state(app, shared, &settings.get(), true);
        }
        Wire::Presence(presence) => {
            if presence.room != shared.room {
                return;
            }
            let sender = match presence.verify(now) {
                Ok(sender) => sender,
                Err(error) => {
                    emit_error(app, &format!("dropped unsigned presence: {error}"));
                    return;
                }
            };
            let ignored = shared
                .policy
                .lock()
                .expect("policy lock")
                .is_ignored(&sender);
            touch_user(shared, sender, &presence.nickname, Some(ignored));
            emit_presence(app, shared);
            emit_state(app, shared, &settings.get(), true);
        }
        Wire::Profile(card) => {
            if card.room != shared.room {
                return;
            }
            let sender = match card.verify(now) {
                Ok(sender) => sender,
                Err(error) => {
                    emit_error(app, &format!("dropped unsigned profile: {error}"));
                    return;
                }
            };
            let ignored = shared
                .policy
                .lock()
                .expect("policy lock")
                .is_ignored(&sender);
            {
                let profiles = shared.profiles.lock().expect("profiles lock");
                if profiles
                    .get(&sender.to_string())
                    .is_some_and(|existing| existing.profile_version >= card.profile_version)
                {
                    return;
                }
            }
            let view = ProfileView {
                sender: sender.to_string(),
                nickname: card.nickname.clone(),
                fingerprint: fingerprint(&sender),
                description: card.description.clone(),
                gender: card.gender.clone(),
                age_band: card.age_band.clone(),
                country: card.country.clone(),
                city: card.city.clone(),
                profile_version: card.profile_version,
                received_ms: now,
                ignored,
                is_me: sender == shared.node_id,
            };
            shared
                .profiles
                .lock()
                .expect("profiles lock")
                .insert(sender.to_string(), view);
            touch_user(shared, sender, &card.nickname, Some(ignored));
            mark_user_profile(shared, sender, true);
            emit_state(app, shared, &settings.get(), true);
        }
    }
}

fn touch_user(shared: &Shared, sender: EndpointId, nickname: &str, ignored: Option<bool>) {
    let now = now_ms();
    let mut users = shared.users.lock().expect("users lock");
    let entry = users.entry(sender.to_string()).or_insert_with(|| UserView {
        sender: sender.to_string(),
        nickname: nickname.to_string(),
        fingerprint: fingerprint(&sender),
        ignored: false,
        is_me: sender == shared.node_id,
        last_seen_ms: now,
        has_profile: false,
    });
    entry.nickname = nickname.to_string();
    entry.last_seen_ms = now;
    if let Some(ignored) = ignored {
        entry.ignored = ignored;
    }
}

async fn run_heartbeat(
    app: AppHandle,
    shared: Arc<Shared>,
    sender: GossipSender,
    identity: Arc<Identity>,
) {
    loop {
        let nickname = shared.nickname.lock().expect("nickname lock").clone();
        let presence = Presence::create(
            &shared.room,
            shared.node_id,
            &nickname,
            shared.profile_version.load(Ordering::Relaxed),
        );
        match presence {
            Ok(mut presence) => {
                presence.sign(&identity.key);
                match Wire::Presence(presence).encode() {
                    Ok(bytes) => {
                        if let Err(error) = sender.broadcast(bytes.into()).await {
                            let message = format!("presence send failed: {error}");
                            *shared.error.lock().expect("error lock") = Some(message.clone());
                            emit_error(&app, &message);
                        }
                    }
                    Err(error) => emit_error(&app, &format!("presence encode failed: {error}")),
                }
            }
            Err(error) => emit_error(&app, &format!("presence create failed: {error}")),
        }

        let now = now_ms();
        let (changed, active_users) = {
            let mut users = shared.users.lock().expect("users lock");
            let before = users.len();
            users.retain(|_, user| {
                user.is_me || now.saturating_sub(user.last_seen_ms) <= PRESENCE_TTL_MS
            });
            (
                users.len() != before,
                users.keys().cloned().collect::<HashSet<_>>(),
            )
        };
        shared
            .profiles
            .lock()
            .expect("profiles lock")
            .retain(|sender, _| active_users.contains(sender));
        if changed {
            emit_presence(&app, &shared);
        }

        tokio::time::sleep(HEARTBEAT).await;
    }
}

async fn broadcast_profile(
    app: &AppHandle,
    shared: &Arc<Shared>,
    sender: &GossipSender,
    identity: &Arc<Identity>,
    settings: &Settings,
) -> Result<(), ChatError> {
    if !settings.show_profile_in_rooms || settings.profile.is_empty() {
        return Ok(());
    }
    let mut card = ProfileCard::create(
        &shared.room,
        shared.node_id,
        &settings.nickname,
        settings.profile_version,
        &settings.profile,
    )?;
    card.sign(&identity.key);
    let bytes = Wire::Profile(card.clone()).encode()?;
    sender
        .broadcast(bytes.into())
        .await
        .map_err(|error| ChatError::Transport(error.to_string()))?;
    let now = now_ms();
    shared.last_profile_ms.store(now, Ordering::Relaxed);
    let view = ProfileView {
        sender: shared.node_id.to_string(),
        nickname: card.nickname,
        fingerprint: fingerprint(&shared.node_id),
        description: card.description,
        gender: card.gender,
        age_band: card.age_band,
        country: card.country,
        city: card.city,
        profile_version: card.profile_version,
        received_ms: now,
        ignored: false,
        is_me: true,
    };
    shared
        .profiles
        .lock()
        .expect("profiles lock")
        .insert(shared.node_id.to_string(), view);
    mark_user_profile(shared, shared.node_id, true);
    emit_state(app, shared, settings, true);
    Ok(())
}

fn mark_user_profile(shared: &Shared, sender: EndpointId, visible: bool) {
    if let Some(user) = shared
        .users
        .lock()
        .expect("users lock")
        .get_mut(&sender.to_string())
    {
        user.has_profile = visible;
        user.last_seen_ms = now_ms();
    }
}

fn profile_cooldown_ms(shared: &Shared) -> u64 {
    let last = shared.last_profile_ms.load(Ordering::Relaxed);
    if last <= 0 {
        return 0;
    }
    let elapsed = now_ms().saturating_sub(last).max(0) as u64;
    (PROFILE_COOLDOWN.as_millis() as u64).saturating_sub(elapsed)
}

fn push_message(app: &AppHandle, shared: &Shared, view: MessageView) {
    {
        let mut messages = shared.messages.lock().expect("messages lock");
        messages.push_back(view.clone());
        while messages.len() > MESSAGE_RING {
            messages.pop_front();
        }
    }
    let _ = app.emit(EVENT_MESSAGE, view);
}

fn emit_presence(app: &AppHandle, shared: &Shared) {
    let users = sorted_users(shared);
    let _ = app.emit(
        EVENT_PRESENCE,
        serde_json::json!({
            "room": shared.room,
            "users": users,
        }),
    );
}

fn emit_state(app: &AppHandle, shared: &Shared, settings: &Settings, enabled: bool) {
    let snapshot = snapshot_from(shared, settings, enabled);
    let _ = app.emit(EVENT_STATE, snapshot);
}

fn emit_error(app: &AppHandle, message: &str) {
    let _ = app.emit(EVENT_ERROR, serde_json::json!({ "message": message }));
}

fn snapshot_from(shared: &Shared, settings: &Settings, enabled: bool) -> Snapshot {
    let users = sorted_users(shared);
    let online = users.iter().filter(|user| !user.is_me).count();
    let messages = shared
        .messages
        .lock()
        .expect("messages lock")
        .iter()
        .cloned()
        .collect();
    Snapshot {
        enabled,
        connected: shared.connected.load(Ordering::Relaxed),
        node_id: Some(shared.node_id.to_string()),
        fingerprint: Some(fingerprint(&shared.node_id)),
        room: shared.room.clone(),
        online,
        users,
        messages,
        profiles: shared
            .profiles
            .lock()
            .expect("profiles lock")
            .values()
            .cloned()
            .collect(),
        profile: settings.profile.clone(),
        show_profile_in_rooms: settings.show_profile_in_rooms,
        nickname: shared.nickname.lock().expect("nickname lock").clone(),
        cooldown_ms: shared
            .policy
            .lock()
            .expect("policy lock")
            .send_cooldown_ms(),
        profile_cooldown_ms: profile_cooldown_ms(shared),
        age_confirmed: settings.age_confirmed,
        error: shared.error.lock().expect("error lock").clone(),
        relay_url: shared.relay_url.clone(),
    }
}

fn sorted_users(shared: &Shared) -> Vec<UserView> {
    let mut users: Vec<UserView> = shared
        .users
        .lock()
        .expect("users lock")
        .values()
        .cloned()
        .collect();
    users.sort_by(|a, b| {
        b.is_me
            .cmp(&a.is_me)
            .then_with(|| a.nickname.to_lowercase().cmp(&b.nickname.to_lowercase()))
            .then_with(|| a.sender.cmp(&b.sender))
    });
    users
}

/* ------------------------------------------------------------------ commands */

#[tauri::command]
pub async fn chat_set_enabled(
    service: State<'_, ChatService>,
    tab_id: String,
    enabled: bool,
) -> Result<Snapshot, ChatError> {
    service.set_enabled(tab_id, enabled).await
}

#[tauri::command]
pub async fn chat_snapshot(service: State<'_, ChatService>) -> Result<Snapshot, ChatError> {
    Ok(service.snapshot().await)
}

#[tauri::command]
pub async fn chat_send(service: State<'_, ChatService>, text: String) -> Result<(), ChatError> {
    service.send(text).await
}

#[tauri::command]
pub async fn chat_set_nickname(
    service: State<'_, ChatService>,
    nickname: String,
) -> Result<Snapshot, ChatError> {
    service.set_nickname(nickname).await
}

#[tauri::command]
pub async fn chat_update_profile(
    service: State<'_, ChatService>,
    profile: Profile,
    show_profile_in_rooms: bool,
) -> Result<Snapshot, ChatError> {
    service.update_profile(profile, show_profile_in_rooms).await
}

#[tauri::command]
pub async fn chat_confirm_age(service: State<'_, ChatService>) -> Result<Snapshot, ChatError> {
    service.confirm_age().await
}

#[tauri::command]
pub async fn chat_set_active_tab(
    service: State<'_, ChatService>,
    tab_id: Option<String>,
) -> Result<Snapshot, ChatError> {
    Ok(service.set_active_tab(tab_id).await)
}

#[tauri::command]
pub async fn chat_ignore(
    service: State<'_, ChatService>,
    sender: String,
) -> Result<Snapshot, ChatError> {
    service.ignore(sender).await
}

#[tauri::command]
pub async fn chat_unignore(
    service: State<'_, ChatService>,
    sender: String,
) -> Result<Snapshot, ChatError> {
    service.unignore(sender).await
}

#[tauri::command]
pub async fn chat_clear_local_data(service: State<'_, ChatService>) -> Result<Snapshot, ChatError> {
    service.clear_local_data().await
}
