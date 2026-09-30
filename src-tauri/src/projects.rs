use crate::{git, models::*};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

pub fn resolve(raw: &str) -> Result<PathBuf, String> {
    let p = if raw == "~" || raw.starts_with("~/") {
        PathBuf::from(
            std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .map_err(|_| "Home directory unavailable")?,
        )
        .join(raw.trim_start_matches('~').trim_start_matches('/'))
    } else {
        PathBuf::from(raw)
    };
    p.canonicalize()
        .map_err(|e| format!("Cannot access directory: {e}"))
}
fn preset(name: &str, cmd: &str, category: &str) -> Preset {
    Preset {
        id: id(),
        name: name.into(),
        command: cmd.into(),
        cwd: String::new(),
        category: category.into(),
        environment: "Local".into(),
        confirmation: category == "Deploy",
        persistent: category == "Development",
        concurrent: false,
        env: BTreeMap::new(),
    }
}
pub fn detect(raw: &str) -> Result<Project, String> {
    let path = resolve(raw)?;
    if !path.is_dir() {
        return Err("Select a directory, not a file.".into());
    }
    let mut p = Project {
        id: id(),
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        path: path.to_string_lossy().into(),
        description: String::new(),
        technologies: vec![],
        package_manager: String::new(),
        git: git::inspect(&path),
        commands: vec![],
        favorite: false,
        group: "My projects".into(),
        color: "lime".into(),
        env_files: vec![],
    };
    if let Ok(text) = fs::read_to_string(path.join("package.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(name) = v["name"].as_str() {
                p.name = name.into();
            }
            p.description = v["description"].as_str().unwrap_or("").into();
            let pm = if path.join("pnpm-lock.yaml").exists() {
                "pnpm"
            } else if path.join("yarn.lock").exists() {
                "yarn"
            } else if path.join("bun.lockb").exists() || path.join("bun.lock").exists() {
                "bun"
            } else {
                "npm"
            };
            p.package_manager = pm.into();
            p.technologies.push("Node.js".into());
            for (dep, label) in [
                ("react", "React"),
                ("next", "Next.js"),
                ("vite", "Vite"),
                ("vue", "Vue"),
                ("typescript", "TypeScript"),
                ("svelte", "Svelte"),
                ("express", "Express"),
            ] {
                if !v["dependencies"][dep].is_null() || !v["devDependencies"][dep].is_null() {
                    p.technologies.push(label.into());
                }
            }
            if let Some(scripts) = v["scripts"].as_object() {
                for name in scripts.keys() {
                    let category = if name.contains("deploy") {
                        "Deploy"
                    } else if name.starts_with("test") {
                        "Test"
                    } else if name.starts_with("build") {
                        "Build"
                    } else if name == "dev" || name == "start" {
                        "Development"
                    } else {
                        "Custom"
                    };
                    p.commands.push(preset(
                        name,
                        &format!("{pm} run {}", shell_quote(name)),
                        category,
                    ));
                }
            }
        }
    }
    if path.join("Cargo.toml").exists() {
        p.technologies.push("Rust".into());
        for (name, cmd, cat) in [
            ("Run", "cargo run", "Development"),
            ("Build Rust", "cargo build", "Build"),
            ("Test Rust", "cargo test", "Test"),
        ] {
            p.commands.push(preset(name, cmd, cat));
        }
    }
    if path.join("pyproject.toml").exists() || path.join("requirements.txt").exists() {
        p.technologies.push("Python".into());
        p.commands
            .push(preset("Test Python", "python -m pytest", "Test"));
    }
    if path.join("go.mod").exists() {
        p.technologies.push("Go".into());
        p.commands.push(preset("Run Go", "go run .", "Development"));
        p.commands.push(preset("Test Go", "go test ./...", "Test"));
    }
    if path.join("Dockerfile").exists() {
        p.technologies.push("Docker".into());
    }
    if [
        "compose.yaml",
        "compose.yml",
        "docker-compose.yml",
        "docker-compose.yaml",
    ]
    .iter()
    .any(|f| path.join(f).exists())
    {
        if !p.technologies.contains(&"Docker".into()) {
            p.technologies.push("Docker".into());
        }
        p.commands
            .push(preset("Compose up", "docker compose up", "Development"));
        p.commands
            .push(preset("Compose down", "docker compose down", "Maintenance"));
    }
    if !p.git.commit.is_empty() {
        p.commands
            .push(preset("Pull", "git pull --ff-only", "Maintenance"));
        p.commands
            .push(preset("Fetch", "git fetch --all --prune", "Maintenance"));
    }
    if let Ok(entries) = fs::read_dir(&path) {
        p.env_files = entries
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with(".env") {
                    Some(name)
                } else {
                    None
                }
            })
            .collect();
    }
    Ok(p)
}
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
pub fn scan(raw: &str) -> Result<Vec<Project>, String> {
    let root = resolve(raw)?;
    let mut paths = vec![];
    fn walk(path: &Path, depth: usize, paths: &mut Vec<PathBuf>) {
        if depth > 5 || paths.len() >= 100 {
            return;
        }
        if [
            ".git",
            "package.json",
            "Cargo.toml",
            "pyproject.toml",
            "requirements.txt",
            "Dockerfile",
            "go.mod",
            "Makefile",
        ]
        .iter()
        .any(|f| path.join(f).exists())
        {
            paths.push(path.into());
        }
        if let Ok(entries) = fs::read_dir(path) {
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with('.')
                    || [
                        "node_modules",
                        "target",
                        "dist",
                        "build",
                        "vendor",
                        "venv",
                        "__pycache__",
                    ]
                    .contains(&name.as_str())
                {
                    continue;
                }
                if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    walk(&e.path(), depth + 1, paths);
                }
            }
        }
    }
    walk(&root, 0, &mut paths);
    Ok(paths
        .iter()
        .filter_map(|p| detect(&p.to_string_lossy()).ok())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detection_proposes_without_execution() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("package.json"), r#"{"name":"test-app","scripts":{"dev":"touch should-not-exist","build":"vite build"},"dependencies":{"react":"19"}}"#).unwrap();
        fs::write(dir.path().join("pnpm-lock.yaml"), "").unwrap();
        let p = detect(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(p.name, "test-app");
        assert_eq!(p.package_manager, "pnpm");
        assert!(p.technologies.contains(&"React".into()));
        assert_eq!(p.commands.len(), 2);
        assert!(!dir.path().join("should-not-exist").exists());
    }
    #[test]
    fn scan_ignores_dependencies_and_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("node_modules/dependency")).unwrap();
        fs::write(
            dir.path().join("node_modules/dependency/package.json"),
            "{}",
        )
        .unwrap();
        fs::create_dir(dir.path().join("app")).unwrap();
        fs::write(dir.path().join("app/Cargo.toml"), "").unwrap();
        assert_eq!(scan(dir.path().to_str().unwrap()).unwrap().len(), 1);
    }
}
