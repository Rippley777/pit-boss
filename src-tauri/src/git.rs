use crate::models::GitInfo;
use std::{path::Path, process::Command};
fn git(path: &Path, args: &[&str]) -> String {
    Command::new("git")
        .args([
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
        ])
        .args(args)
        .current_dir(path)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .ok()
        .filter(|r| r.status.success())
        .map(|r| String::from_utf8_lossy(&r.stdout).trim().to_string())
        .unwrap_or_default()
}
pub fn inspect(path: &Path) -> GitInfo {
    let status = git(path, &["status", "--porcelain"]);
    let counts = git(
        path,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    );
    let parts: Vec<_> = counts.split_whitespace().collect();
    GitInfo {
        branch: git(path, &["branch", "--show-current"]),
        commit: git(path, &["rev-parse", "HEAD"]),
        message: git(path, &["log", "-1", "--format=%s"]),
        remote: safe_remote(&git(path, &["remote", "get-url", "origin"])),
        changes: status.lines().count(),
        ahead: parts.first().and_then(|s| s.parse().ok()).unwrap_or(0),
        behind: parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0),
    }
}
pub fn safe_remote(remote: &str) -> String {
    let remote = if let Some(s) = remote.strip_prefix("git@github.com:") {
        format!("https://github.com/{}", s.trim_end_matches(".git"))
    } else {
        remote.to_string()
    };
    match url::Url::parse(&remote) {
        Ok(mut u) if u.scheme() == "https" || u.scheme() == "http" => {
            let _ = u.set_username("");
            let _ = u.set_password(None);
            u.set_query(None);
            u.set_fragment(None);
            u.to_string().trim_end_matches(".git").to_string()
        }
        _ => String::new(),
    }
}
