use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub branch: String,
    pub commit: String,
    pub message: String,
    pub remote: String,
    pub changes: usize,
    pub ahead: usize,
    pub behind: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub command: String,
    pub cwd: String,
    pub category: String,
    #[serde(default)]
    pub icon: String,
    pub environment: String,
    pub confirmation: bool,
    #[serde(default)]
    pub confirmation_mode: String,
    #[serde(default)]
    pub dangerous: bool,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub sort_order: usize,
    #[serde(default)]
    pub keyboard_shortcut: String,
    pub persistent: bool,
    pub concurrent: bool,
    /// KEY -> inherited environment variable name. Values are never persisted.
    pub env: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub policy: ExecutionPolicy,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub description: String,
    pub technologies: Vec<String>,
    pub package_manager: String,
    pub git: GitInfo,
    pub commands: Vec<Preset>,
    #[serde(default)]
    pub suggestions: Vec<Preset>,
    pub favorite: bool,
    pub group: String,
    pub color: String,
    pub env_files: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub preset_id: String,
    pub name: String,
    pub command: String,
    pub cwd: String,
    pub category: String,
    pub environment: String,
    pub branch: String,
    pub commit: String,
    pub started_at: u64,
    pub ended_at: Option<u64>,
    pub exit_code: Option<i32>,
    pub status: String,
    pub output: String,
    pub pid: Option<u32>,
    pub ports: Vec<u16>,
    pub cpu: f64,
    pub memory: u64,
    #[serde(default)]
    pub details: ExecutionDetails,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub projects: Vec<Project>,
    pub runs: Vec<Run>,
    pub port_authority: PortAuthorityStatus,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortAuthorityStatus {
    pub installed: bool,
    pub autopilot_enabled: bool,
    pub ready: bool,
    pub binary_path: Option<String>,
    pub detail: String,
}

/// Optional declarations are approved with the saved action, never loaded from repository metadata.
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ExecutionPolicy {
    pub risk: String,
    pub concurrency: String,
    pub timeout_seconds: u64,
    pub required_files: Vec<String>,
    pub required_tools: Vec<String>,
    pub required_env: Vec<String>,
    pub expected_artifacts: Vec<String>,
    pub deployment_branch: String,
    pub deny_warnings: bool,
    pub impact: String,
    pub rollback: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ExecutionDetails {
    pub revision: u64,
    pub transitions: Vec<Transition>,
    pub preflight: Vec<PreflightCheck>,
    pub risk: String,
    pub trigger_source: String,
    pub correlation_id: String,
    pub retry_of: Option<String>,
    pub confirmation: Option<Confirmation>,
    pub failure: Option<Failure>,
    pub signal: Option<i32>,
    pub duration_ms: Option<u64>,
    pub process_started_at: Option<u64>,
    pub log_reference: String,
    pub log_truncated: bool,
    pub output_events: Vec<OutputEvent>,
    pub artifacts: Vec<Artifact>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    pub state: String,
    pub at: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightCheck {
    pub id: String,
    pub description: String,
    pub result: String,
    pub explanation: String,
    pub resolution: String,
    pub duration_ms: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Confirmation {
    pub at: u64,
    pub expires_at: u64,
    pub warning_overrides: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub category: String,
    pub summary: String,
    pub evidence: String,
    pub next_step: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputEvent {
    pub at: u64,
    pub stream: String,
    pub text: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub path: String,
    pub size: u64,
}

pub fn is_active(status: &str) -> bool {
    matches!(
        status,
        "queued" | "preflighting" | "awaiting_confirmation" | "starting" | "running"
    )
}
impl Run {
    pub fn transition(&mut self, state: &str) -> Result<(), String> {
        let allowed = match self.status.as_str() {
            "queued" => matches!(state, "preflighting" | "cancelled" | "interrupted"),
            "preflighting" => matches!(state, "awaiting_confirmation" | "failed" | "interrupted"),
            "awaiting_confirmation" => {
                matches!(state, "starting" | "failed" | "cancelled" | "interrupted")
            }
            "starting" => matches!(state, "running" | "failed" | "interrupted"),
            "running" => matches!(
                state,
                "success" | "failed" | "cancelled" | "timed_out" | "interrupted"
            ),
            _ => false,
        };
        if !allowed {
            return Err(format!(
                "Invalid execution transition: {} → {state}",
                self.status
            ));
        }
        self.status = state.into();
        self.details.revision += 1;
        self.details.transitions.push(Transition {
            state: state.into(),
            at: now(),
        });
        if !is_active(state) {
            self.ended_at = Some(now());
            self.details.duration_ms = Some(
                now().saturating_sub(self.details.process_started_at.unwrap_or(self.started_at)),
            );
        }
        Ok(())
    }
}
