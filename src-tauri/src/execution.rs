//! Declarative, read-only preflight and conservative diagnostics. No project script is run here.
use crate::{git, models::*, projects};
use std::path::{Path, PathBuf};

pub fn risk(p: &Preset) -> String {
    if p.environment.eq_ignore_ascii_case("production") || p.policy.risk == "production_critical" {
        "production_critical"
    } else if p.dangerous || p.policy.risk == "destructive" {
        "destructive"
    } else if p.policy.risk == "safe" {
        "safe"
    } else {
        "caution"
    }
    .into()
}
pub fn protected(p: &Preset) -> bool {
    matches!(risk(p).as_str(), "destructive" | "production_critical")
        || p.confirmation
        || p.confirmation_mode == "Always"
}
pub fn cwd(p: &Project, a: &Preset) -> Result<PathBuf, String> {
    let base = projects::resolve(&p.path)?;
    let cwd = base
        .join(&a.cwd)
        .canonicalize()
        .map_err(|_| "Working directory is missing or inaccessible")?;
    if !cwd.is_dir() || !cwd.starts_with(&base) {
        return Err("Working directory must be inside the registered project".into());
    }
    std::fs::read_dir(&cwd).map_err(|_| "Working directory is not readable")?;
    Ok(cwd)
}
fn local_path(base: &Path, path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(path);
    if path.is_empty()
        || relative.is_absolute()
        || relative.components().any(|c| {
            !matches!(
                c,
                std::path::Component::Normal(_) | std::path::Component::CurDir
            )
        })
    {
        return Err("Use a relative path without parent traversal".into());
    }
    let target = base.join(relative);
    let mut existing = target.as_path();
    while !existing.exists() {
        existing = existing.parent().ok_or("Invalid path")?;
    }
    if !existing
        .canonicalize()
        .map_err(|_| "Path inaccessible")?
        .starts_with(base)
    {
        return Err("Path escapes the working directory".into());
    }
    Ok(target)
}
pub fn validate_policy(a: &Preset) -> Result<(), String> {
    if !["", "safe", "caution", "destructive", "production_critical"]
        .contains(&a.policy.risk.as_str())
    {
        return Err("Unknown risk level".into());
    }
    if !["", "parallel", "project", "action", "deployment", "global"]
        .contains(&a.policy.concurrency.as_str())
    {
        return Err("Unknown concurrency policy".into());
    }
    if a.command.trim().is_empty() || a.command.contains('\0') || a.name.trim().is_empty() {
        return Err("Action needs a valid name and shell command".into());
    }
    if a.policy.timeout_seconds > 604800 {
        return Err("Timeout must not exceed seven days".into());
    }
    for name in a
        .policy
        .required_env
        .iter()
        .chain(a.env.keys())
        .chain(a.env.values())
    {
        if name.is_empty()
            || !name
                .chars()
                .enumerate()
                .all(|(i, c)| c == '_' || c.is_ascii_alphabetic() || (i > 0 && c.is_ascii_digit()))
        {
            return Err("Environment bindings must contain variable names only".into());
        }
    }
    Ok(())
}
pub fn checks(p: &Project, a: &Preset, path: &str) -> Vec<PreflightCheck> {
    let mut results = vec![];
    let mut check = |id: &str,
                     description: &str,
                     result: &str,
                     explanation: String,
                     resolution: &str,
                     began: u64| {
        results.push(PreflightCheck {
            id: id.into(),
            description: description.into(),
            result: result.into(),
            explanation,
            resolution: resolution.into(),
            duration_ms: now().saturating_sub(began),
        });
    };
    let began = now();
    let directory = cwd(p, a);
    check(
        "directory",
        "Project and working directory",
        if directory.is_ok() { "pass" } else { "blocked" },
        directory
            .as_ref()
            .map(|d| d.display().to_string())
            .unwrap_or_else(|e| e.clone()),
        "Choose an accessible directory inside the project.",
        began,
    );
    let began = now();
    let valid = validate_policy(a);
    check(
        "definition",
        "Approved action configuration",
        if valid.is_ok() { "pass" } else { "blocked" },
        valid.err().unwrap_or_else(|| {
            "Saved shell action is valid; shell scripts run only after confirmation.".into()
        }),
        "Edit this action's configuration.",
        began,
    );
    if [
        "rm -",
        "git reset --hard",
        "git push --force",
        "docker volume rm",
        "drop database",
        "terraform destroy",
    ]
    .iter()
    .any(|pattern| a.command.to_lowercase().contains(pattern))
    {
        check("command-impact", "Potentially destructive shell operation", "warning", "Command analysis found an operation that can remove or replace data. This analysis is advisory and cannot prove a command safe.".into(), "Review affected resources and rollback instructions; set an explicit destructive risk policy.", now());
    }
    for name in a.policy.required_env.iter().chain(a.env.values()) {
        let present = std::env::var_os(name).is_some_and(|v| !v.is_empty());
        check(
            &format!("env:{name}"),
            "Required environment variable",
            if present { "pass" } else { "blocked" },
            format!(
                "{name}: {}",
                if present {
                    "present (value hidden)"
                } else {
                    "missing"
                }
            ),
            "Export this variable before launching Pit Boss.",
            now(),
        );
    }
    let mut tools = a.policy.required_tools.clone();
    // Only infer a plain first executable. Complex shell syntax stays explicitly unverified.
    let first = a.command.split_whitespace().next().unwrap_or("");
    let plain = !first.is_empty()
        && first
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_-./".contains(c));
    #[cfg(unix)]
    let builtins = [
        ".", "echo", "printf", "exit", "true", "false", "cd", "export", "exec", "test", "set",
        "wait", "read", "if", "for", "while", "trap", "umask", "unset", "shift", "break",
        "continue", "return", "case", "command", "type", "pwd",
    ];
    #[cfg(windows)]
    let builtins = [
        "echo", "exit", "cd", "set", "if", "for", "call", "dir", "copy", "del", "move", "start",
        "setlocal", "endlocal", "cls", "type", "md", "mkdir", "rd", "rmdir", "ren", "pause", "rem",
    ];
    if plain && !builtins.contains(&first) && !tools.contains(&first.to_string()) {
        tools.push(first.into());
    }
    for tool in tools {
        let began = now();
        let available = if tool.contains('/') || tool.contains('\\') {
            if Path::new(&tool).is_absolute() {
                executable(Path::new(&tool))
            } else {
                directory
                    .as_ref()
                    .ok()
                    .and_then(|d| local_path(d, &tool).ok())
                    .is_some_and(|p| executable(&p))
            }
        } else {
            std::env::split_paths(path).any(|d| {
                if executable(&d.join(&tool)) {
                    return true;
                }
                #[cfg(windows)]
                {
                    for ext in ["exe", "cmd", "bat", "com"] {
                        if executable(&d.join(format!("{tool}.{ext}"))) {
                            return true;
                        }
                    }
                }
                false
            })
        };
        check(
            &format!("tool:{tool}"),
            "Required executable",
            if available { "pass" } else { "blocked" },
            format!(
                "{tool}: {}",
                if available {
                    "available"
                } else {
                    "not found or not executable"
                }
            ),
            "Install the tool or correct the desktop launch PATH.",
            began,
        );
    }
    if !plain {
        check(
            "shell-analysis",
            "Shell command analysis",
            "skipped",
            "Complex shell expression; declare required tools and files explicitly.".into(),
            "Review the complete shell command.",
            now(),
        );
    }
    if let Ok(dir) = directory {
        if matches!(a.category.as_str(), "Build" | "Deploy")
            || !a.policy.expected_artifacts.is_empty()
        {
            let free = available_space(&dir);
            check(
                "disk-space",
                "Available disk space",
                match free {
                    Some(bytes) if bytes < 100 * 1024 * 1024 => "warning",
                    Some(_) => "pass",
                    None => "skipped",
                },
                free.map(|bytes| {
                    format!(
                        "{} MiB available; build size is not estimated.",
                        bytes / 1024 / 1024
                    )
                })
                .unwrap_or_else(|| "Disk space could not be inspected on this platform.".into()),
                "Free space or choose another project volume before a large build.",
                now(),
            );
        }
        let words: Vec<_> = a.command.split_whitespace().collect();
        if matches!(
            words.first().copied(),
            Some("sh" | "bash" | "zsh" | "node" | "python" | "python3" | "ruby" | "perl")
        ) {
            if let Some(script) = words.get(1).filter(|s| {
                !s.starts_with('-')
                    && s.chars()
                        .all(|c| c.is_ascii_alphanumeric() || "_/.-".contains(c))
            }) {
                let found = local_path(&dir, script)
                    .is_ok_and(|p| p.is_file() && std::fs::File::open(p).is_ok());
                check(
                    "script-file",
                    "Interpreter script",
                    if found { "pass" } else { "blocked" },
                    format!(
                        "{script}: {}",
                        if found {
                            "readable"
                        } else {
                            "missing or inaccessible"
                        }
                    ),
                    "Correct the script path or working directory.",
                    now(),
                );
            }
        }
        if matches!(
            words.first().copied(),
            Some("npm" | "pnpm" | "yarn" | "bun")
        ) {
            let script = if words.get(1) == Some(&"run") {
                words.get(2).copied()
            } else if matches!(
                words.get(1).copied(),
                Some("test" | "start" | "build" | "dev" | "lint")
            ) {
                words.get(1).copied()
            } else {
                None
            };
            if let Some(script) = script.filter(|s| {
                s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "_-:.".contains(c))
            }) {
                let package = std::fs::read(dir.join("package.json"))
                    .ok()
                    .filter(|v| v.len() <= 1_048_576)
                    .and_then(|v| serde_json::from_slice::<serde_json::Value>(&v).ok());
                let exists = package
                    .as_ref()
                    .and_then(|p| p.get("scripts"))
                    .and_then(|scripts| scripts.get(script))
                    .and_then(|s| s.as_str())
                    .is_some_and(|s| !s.trim().is_empty());
                // Package manager workspaces may legitimately resolve scripts elsewhere; explicit declarations are available.
                check(
                    "package-script",
                    "Package script",
                    if exists { "pass" } else { "warning" },
                    format!(
                        "Script {script}: {}",
                        if exists {
                            "declared in package.json"
                        } else {
                            "not found in this directory; workspace or package-manager resolution may differ"
                        }
                    ),
                    "Check the script name, working directory and workspace options.",
                    now(),
                );
            }
        }
        for file in &a.policy.required_files {
            let ok =
                local_path(&dir, file).is_ok_and(|p| p.is_file() && std::fs::File::open(p).is_ok());
            check(
                &format!("file:{file}"),
                "Required configuration or script",
                if ok { "pass" } else { "blocked" },
                format!(
                    "{file}: {}",
                    if ok {
                        "readable"
                    } else {
                        "missing, inaccessible or outside project"
                    }
                ),
                "Restore the required file.",
                now(),
            );
        }
        for file in &a.policy.expected_artifacts {
            let valid = local_path(&dir, file).and_then(|path| {
                if path == dir || path.starts_with(dir.join(".pit-boss-backups")) {
                    return Err("Artifact path must name a specific output".into());
                }
                Ok(path)
            });
            check(&format!("artifact:{file}"), "Expected output and preservation", if valid.is_err() { "blocked" } else if valid.as_ref().is_ok_and(|p| p.exists()) { "warning" } else { "pass" }, valid.map(|p| if p.exists() { format!("{file} exists; a verified timestamped copy is required before launch.") } else { format!("{file} must exist after successful exit.") }).unwrap_or_else(|e| e), "Use a project-relative output path. Existing output is backed up before execution.", now());
        }
        let began = now();
        let info = git::inspect(&dir);
        if info.branch.is_empty() && info.commit.is_empty() {
            check(
                "git",
                "Git state",
                "skipped",
                "No readable Git branch; this may not be a Git repository.".into(),
                "",
                began,
            );
        } else {
            check(
                "git",
                "Git branch and working tree",
                if info.changes > 0 || info.branch.is_empty() {
                    "warning"
                } else {
                    "pass"
                },
                format!(
                    "Branch: {}; changed/untracked entries: {}; remote: {}",
                    info.branch,
                    info.changes,
                    if info.remote.is_empty() {
                        "none"
                    } else {
                        "configured"
                    }
                ),
                "Review uncommitted changes before proceeding.",
                began,
            );
        }
        if !a.policy.deployment_branch.is_empty() {
            check(
                "deployment-branch",
                "Deployment branch policy",
                if info.branch == a.policy.deployment_branch {
                    "pass"
                } else {
                    "blocked"
                },
                format!("Required branch: {}", a.policy.deployment_branch),
                "Check out the configured deployment branch.",
                now(),
            );
        }
    }
    if a.category == "Deploy" {
        check(
            "deployment-target",
            "Deployment target",
            if a.environment.trim().is_empty() {
                "blocked"
            } else {
                "pass"
            },
            format!("Target: {}", a.environment),
            "Set an explicit target environment.",
            now(),
        );
        check("deployment-auth", "Provider authentication", "skipped", "Provider-specific authentication is not probed automatically. Declare required environment names and configuration files; provider rejection is captured from execution.".into(), "Verify the provider's login context before deploying.", now());
    }
    results
}
fn available_space(path: &Path) -> Option<u64> {
    #[cfg(unix)]
    {
        let path = std::ffi::CString::new(path.as_os_str().as_encoded_bytes()).ok()?;
        let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
        if unsafe { libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) } != 0 {
            return None;
        }
        let stat = unsafe { stat.assume_init() };
        // libc field widths differ across supported Unix targets.
        #[allow(clippy::unnecessary_cast)]
        let bytes = (stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64);
        Some(bytes)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        None
    }
}
fn executable(path: &Path) -> bool {
    let Ok(meta) = path.metadata() else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}
pub fn concurrency(a: &Preset) -> &str {
    if a.policy.concurrency == "global" {
        return "global";
    }
    if a.environment.eq_ignore_ascii_case("production") || a.policy.risk == "production_critical" {
        return "deployment";
    }
    if !a.policy.concurrency.is_empty() {
        &a.policy.concurrency
    } else if a.concurrent {
        "parallel"
    } else {
        "action"
    }
}
pub fn conflicts(p: &Project, a: &Preset, other: &Run, other_policy: &str) -> bool {
    let policy = concurrency(a);
    policy == "global"
        || other_policy == "global"
        || (p.id == other.project_id && (policy == "project" || other_policy == "project"))
        || (p.id == other.project_id
            && a.id == other.preset_id
            && (policy == "action" || other_policy == "action"))
        || ((policy == "deployment" || other_policy == "deployment" && a.category == "Deploy")
            && (other.category == "Deploy" || other_policy == "deployment")
            && a.environment.eq_ignore_ascii_case(&other.environment))
}
pub fn failure(run: &Run) -> Failure {
    let output = run.output.to_lowercase();
    let patterns = [
        (
            "permission denied",
            "permission_denied",
            "Permission denied",
            "Check filesystem or executable permissions.",
        ),
        (
            "command not found",
            "missing_executable",
            "Executable not found",
            "Install the required tool and check PATH.",
        ),
        (
            "could not resolve host",
            "network",
            "Host lookup failed",
            "Check the hostname and network connection.",
        ),
        (
            "connection refused",
            "network",
            "Connection refused",
            "Check that the target service is available.",
        ),
        (
            "unauthorized",
            "authentication",
            "Authentication was rejected",
            "Check the provider's login context and permissions.",
        ),
        (
            "authentication failed",
            "authentication",
            "Authentication failed",
            "Refresh provider authentication.",
        ),
        (
            "error[e",
            "compilation",
            "Rust compiler diagnostic",
            "Open the first compiler diagnostic and inspect the referenced file.",
        ),
        (
            "error ts",
            "compilation",
            "TypeScript compiler diagnostic",
            "Inspect the referenced TypeScript diagnostic.",
        ),
        (
            "test result: failed",
            "test",
            "Tests reported failure",
            "Inspect the failing test and its assertion.",
        ),
        (
            "cannot find module",
            "missing_dependency",
            "Module could not be resolved",
            "Check dependency installation and the referenced module path.",
        ),
    ];
    for (pattern, category, summary, next) in patterns {
        if run.status == "failed" && output.contains(pattern) {
            let evidence = run
                .output
                .lines()
                .find(|line| line.to_lowercase().contains(pattern))
                .unwrap_or("")
                .chars()
                .take(1000)
                .collect();
            return Failure {
                category: category.into(),
                summary: format!("Likely cause: {summary}"),
                evidence,
                next_step: next.into(),
            };
        }
    }
    let (category, summary, next) = match run.status.as_str() {
        "timed_out" => (
            "timeout",
            "Execution exceeded its configured timeout.",
            "Inspect partial output before increasing the timeout or retrying.",
        ),
        "cancelled" => (
            "user_cancellation",
            "Execution was cancelled.",
            "Check partial side effects and backups before retrying.",
        ),
        "interrupted" => (
            "unexpected_termination",
            "Execution was interrupted; completion could not be confirmed.",
            "Check external processes and side effects before retrying.",
        ),
        _ => (
            "unknown",
            "Execution failed. The exact cause could not be determined from the available output.",
            "Inspect output and exit status; verify side effects before retrying.",
        ),
    };
    Failure {
        category: category.into(),
        summary: summary.into(),
        evidence: format!(
            "Exit code: {:?}; signal: {:?}",
            run.exit_code, run.details.signal
        ),
        next_step: next.into(),
    }
}

// Copy only declared outputs; refuse symlinks and special files. A failed copy never touches the source.
fn copy_verified(source: &Path, destination: &Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(source).map_err(|e| e.to_string())?;
    if meta.is_symlink() {
        return Err("Generic artifact backups do not follow symlinks. Use the verified release script for app bundles.".into());
    }
    if meta.is_dir() {
        std::fs::create_dir_all(destination).map_err(|e| e.to_string())?;
        for entry in std::fs::read_dir(source).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            copy_verified(&entry.path(), &destination.join(entry.file_name()))?;
        }
    } else if meta.is_file() {
        use std::io::Read;
        std::fs::create_dir_all(destination.parent().ok_or("Invalid backup destination")?)
            .map_err(|e| e.to_string())?;
        let mut input = std::fs::File::open(source).map_err(|e| e.to_string())?;
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)
            .map_err(|e| e.to_string())?;
        std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
        let mut left = std::fs::File::open(source).map_err(|e| e.to_string())?;
        let mut right = std::fs::File::open(destination).map_err(|e| e.to_string())?;
        let mut a = [0; 8192];
        let mut b = [0; 8192];
        loop {
            let n = left.read(&mut a).map_err(|e| e.to_string())?;
            right.read_exact(&mut b[..n]).map_err(|e| e.to_string())?;
            if a[..n] != b[..n] {
                return Err("Backup verification failed".into());
            }
            if n == 0 {
                break;
            }
        }
        if left.metadata().map_err(|e| e.to_string())?.len()
            != right.metadata().map_err(|e| e.to_string())?.len()
        {
            return Err("Backup size changed during copy".into());
        }
        std::fs::set_permissions(destination, meta.permissions()).map_err(|e| e.to_string())?;
    } else {
        return Err("Artifact is not a regular file or directory".into());
    }
    Ok(())
}
pub fn backup(cwd: &Path, a: &Preset, run: &Run) -> Result<Vec<Artifact>, String> {
    let mut artifacts = vec![];
    for file in &a.policy.expected_artifacts {
        let source = local_path(cwd, file)?;
        if source == cwd || source.starts_with(cwd.join(".pit-boss-backups")) {
            return Err("Unsafe artifact path".into());
        }
        if source.exists() {
            let path = local_path(
                cwd,
                &format!(".pit-boss-backups/{}-{}/{}", run.started_at, run.id, file),
            )?;
            copy_verified(&source, &path)?;
            artifacts.push(Artifact {
                path: path.display().to_string(),
                size: artifact_size(&path)?,
            });
        }
    }
    Ok(artifacts)
}
fn artifact_size(path: &Path) -> Result<u64, String> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.is_symlink() {
        return Err("Artifact symlinks require release-script verification".into());
    }
    if meta.is_file() {
        return Ok(meta.len());
    }
    let mut size = 0;
    for entry in std::fs::read_dir(path).map_err(|e| e.to_string())? {
        size += artifact_size(&entry.map_err(|e| e.to_string())?.path())?;
    }
    Ok(size)
}
pub fn artifacts(cwd: &Path, a: &Preset) -> Result<Vec<Artifact>, String> {
    a.policy
        .expected_artifacts
        .iter()
        .map(|file| {
            let path = local_path(cwd, file)?;
            Ok(Artifact {
                size: artifact_size(&path)
                    .map_err(|_| format!("Expected artifact missing or unverifiable: {file}"))?,
                path: path.display().to_string(),
            })
        })
        .collect()
}

/// Export plain text: strip active terminal escape sequences as well as controls.
pub fn plain_log(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            match chars.next() {
                Some('[') => {
                    for c in chars.by_ref() {
                        if ('@'..='~').contains(&c) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    while let Some(c) = chars.next() {
                        if c == '\u{7}' {
                            break;
                        }
                        if c == '\u{1b}' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                }
                _ => {}
            }
        } else if !c.is_control() || matches!(c, '\n' | '\r' | '\t') {
            result.push(c);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exports_strip_colors_and_active_terminal_sequences() {
        assert_eq!(
            plain_log("\u{1b}[31merror\u{1b}[0m\n\u{1b}]52;c;payload\u{7}safe"),
            "error\nsafe"
        );
        assert_eq!(plain_log("✓ café\n"), "✓ café\n");
    }
    #[test]
    fn timeout_is_not_misdiagnosed_from_an_earlier_compiler_message() {
        let run: Run = serde_json::from_value(serde_json::json!({"id":"test","projectId":"p","projectName":"Test","presetId":"a","name":"Build","command":"test","cwd":".","category":"Build","environment":"Local","branch":"","commit":"","startedAt":0,"endedAt":1,"exitCode":null,"status":"timed_out","output":"error[E0308]","pid":null,"ports":[],"cpu":0,"memory":0})).unwrap();
        assert_eq!(failure(&run).category, "timeout");
    }
}
