use crate::models::GitInfo;
use std::{path::Path, process::Command};
fn git(path: &Path, args: &[&str]) -> String {
    // Git status can invoke configured clean/process filters. Disable them for inspection.
    // Reading configuration keys does not run the filter or expose its command/value.
    let keys = Command::new("git")
        .args([
            "config",
            "--null",
            "--name-only",
            "--get-regexp",
            r"^filter\..*\.(clean|smudge|process|required)$",
        ])
        .current_dir(path)
        .output()
        .ok();
    let mut command = Command::new("git");
    if let Some(keys) = keys {
        for key in String::from_utf8_lossy(&keys.stdout)
            .split('\0')
            .filter(|key| key.starts_with("filter."))
        {
            command.args([
                "-c",
                &format!(
                    "{key}={}",
                    if key.ends_with(".required") {
                        "false"
                    } else {
                        ""
                    }
                ),
            ]);
        }
    }
    command
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

#[cfg(test)]
mod inspection_tests {
    use super::*;
    #[test]
    fn inspection_does_not_execute_repository_clean_filters() {
        let dir = tempfile::tempdir().unwrap();
        let call = |args: &[&str]| {
            assert!(Command::new("git")
                .args(args)
                .current_dir(dir.path())
                .status()
                .unwrap()
                .success());
        };
        call(&["init", "--quiet"]);
        std::fs::write(dir.path().join(".gitattributes"), "*.txt filter=probe\n").unwrap();
        std::fs::write(dir.path().join("file.txt"), "before").unwrap();
        call(&["add", "."]);
        call(&["config", "filter.probe.clean", "touch filter-executed; cat"]);
        std::fs::write(dir.path().join("file.txt"), "after").unwrap();
        let info = inspect(dir.path());
        assert!(info.changes > 0);
        assert!(!dir.path().join("filter-executed").exists());
    }
}
