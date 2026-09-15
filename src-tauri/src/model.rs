//! On-disk data schema. Everything here is plain JSON; see README.md for the
//! human-readable description. `messages[]` is deliberately a replayable
//! `{role, content}` list so a session is a training trajectory as-is —
//! per-turn metadata hangs off the assistant message, never off the list.

use serde::{Deserialize, Serialize};

pub const SESSION_SCHEMA_VERSION: u32 = 1;
pub const PROVIDERS_SCHEMA_VERSION: u32 = 1;
pub const SETTINGS_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Protocol {
    /// OpenAI Chat Completions (`POST {base_url}/chat/completions`).
    Chat,
    /// Anthropic Messages (`POST {base_url}/messages`).
    Anthropic,
    /// OpenAI Responses (`POST {base_url}/responses`).
    Responses,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Usage {
    /// The whole prompt for this call, cached part included.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    /// How much of `input_tokens` was served from the provider's prompt cache.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_tokens: Option<u64>,
}

impl Usage {
    pub fn is_empty(&self) -> bool {
        self.input_tokens.is_none() && self.cached_input_tokens.is_none() && self.output_tokens.is_none() && self.reasoning_tokens.is_none()
    }
}

/// Generation metadata for one assistant turn.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TurnMeta {
    pub provider_id: String,
    pub protocol: Protocol,
    pub model: String,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    /// Time to first visible token (text or reasoning).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ttft_ms: Option<u64>,
    /// How long the model spent in reasoning before the answer started.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Usage::is_empty")]
    pub usage: Usage,
    /// Provider's own stop reason (`stop`, `end_turn`, `length`, …),
    /// or `cancelled` / `error` when the turn didn't finish normally.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Default for Protocol {
    fn default() -> Self {
        Protocol::Chat
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// Model reasoning captured from the stream, if the provider sent any.
    /// Named like the chat-completions field so a trajectory replays as-is.
    #[serde(default, alias = "reasoning", skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<TurnMeta>,
}

impl Message {
    pub fn user(content: impl Into<String>, now: String) -> Self {
        Message {
            role: Role::User,
            content: content.into(),
            created_at: Some(now),
            reasoning_content: None,
            meta: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub provider_id: String,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
    #[serde(default)]
    pub messages: Vec<Message>,
}

/// What the sidebar needs — derived from the session file, never stored separately.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    pub provider_id: String,
    pub model: String,
    pub message_count: usize,
}

impl From<&Session> for SessionSummary {
    fn from(s: &Session) -> Self {
        SessionSummary {
            id: s.id.clone(),
            title: s.title.clone(),
            updated_at: s.updated_at.clone(),
            provider_id: s.provider_id.clone(),
            model: s.model.clone(),
            message_count: s.messages.len(),
        }
    }
}

/// A configured endpoint. API keys live in `keys.json`, not here, so this
/// file and the sessions can be shared without leaking secrets.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub protocol: Protocol,
    /// Up to and including the version segment, e.g. `https://api.openai.com/v1`.
    pub base_url: String,
    #[serde(default)]
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ProvidersFile {
    pub schema_version: u32,
    #[serde(default)]
    pub providers: Vec<Provider>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Appearance {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    pub schema_version: u32,
    #[serde(default)]
    pub appearance: Appearance,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    /// Copied into new sessions as `system` so trajectories stay self-contained.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    /// Sent as `max_tokens` where the protocol requires one (Anthropic).
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    #[serde(default = "default_true")]
    pub sidebar_visible: bool,
    /// Column widths in CSS px; absent = the stylesheet default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sidebar_width: Option<u32>,
    /// The trajectory inspector (right column).
    #[serde(default)]
    pub inspector_visible: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inspector_width: Option<u32>,
    /// Width of the transcript/composer column in CSS px; absent = the stylesheet default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column_width: Option<u32>,
}

fn default_max_tokens() -> u32 {
    8192
}
fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            schema_version: SETTINGS_SCHEMA_VERSION,
            appearance: Appearance::System,
            default_provider_id: None,
            default_model: None,
            system_prompt: None,
            max_tokens: default_max_tokens(),
            sidebar_visible: true,
            sidebar_width: None,
            inspector_visible: false,
            inspector_width: None,
            column_width: None,
        }
    }
}

/// The provider view handed to the UI: same as `Provider` plus whether a key is set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProviderView {
    #[serde(flatten)]
    pub provider: Provider,
    pub has_key: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reasoning_field_reads_old_name_and_writes_new() {
        let old = r#"{"role":"assistant","content":"x","reasoning":"why"}"#;
        let m: Message = serde_json::from_str(old).unwrap();
        assert_eq!(m.reasoning_content.as_deref(), Some("why"));
        let out = serde_json::to_string(&m).unwrap();
        assert!(out.contains(r#""reasoning_content":"why""#) && !out.contains(r#""reasoning":"#));
    }
}
