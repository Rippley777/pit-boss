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
    pub command: String,
    pub cwd: String,
    pub category: String,
    pub environment: String,
    pub confirmation: bool,
    pub persistent: bool,
    pub concurrent: bool,
    /// KEY -> inherited environment variable name. Values are never persisted.
    pub env: std::collections::BTreeMap<String, String>,
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
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub projects: Vec<Project>,
    pub runs: Vec<Run>,
}
