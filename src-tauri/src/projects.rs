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
        description: String::new(),
        command: cmd.into(),
        cwd: String::new(),
        category: category.into(),
        icon: "Terminal".into(),
        environment: "Local".into(),
        confirmation: category == "Deploy",
        confirmation_mode: if category == "Deploy" {
            "Only in Production".into()
        } else {
            "Never".into()
        },
        dangerous: false,
        pinned: matches!(category, "Development" | "Build" | "Test" | "Deploy"),
        sort_order: 0,
        keyboard_shortcut: String::new(),
        persistent: category == "Development",
        concurrent: false,
        env: BTreeMap::new(),
    }
}
fn action_label(name: &str) -> String {
    match name.to_ascii_lowercase().as_str() {
        "dev" | "start" | "serve" => "Run Dev".into(),
        "build" => "Build".into(),
        "test" | "tests" | "check" => "Run Tests".into(),
        "lint" => "Run Linter".into(),
        "format" | "fmt" => "Format Code".into(),
        "typecheck" | "type-check" | "types" => "Type Check".into(),
        "db:seed" | "db-seed" | "seed" => "Seed Database".into(),
        "db:migrate" | "migrate" | "migration" => "Run Migrations".into(),
        "db:reset" | "reset-db" => "Reset Database".into(),
        "generate" | "gen" => "Generate Types".into(),
        "storybook" => "Open Storybook".into(),
        other => other
            .split([':', '-', '_'])
            .filter(|part| !part.is_empty())
            .map(|part| {
                let mut c = part.chars();
                c.next()
                    .map(|first| first.to_uppercase().to_string() + c.as_str())
                    .unwrap_or_default()
            })
            .collect::<Vec<_>>()
            .join(" "),
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
        suggestions: vec![],
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
                        &action_label(name),
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

pub fn suggestions(project: &Project) -> Result<Vec<Preset>, String> {
    let root = resolve(&project.path)?;
    let detected = detect(&project.path)?;
    let mut candidates = detected.commands;
    if let Ok(makefile) = fs::read_to_string(
        root.join("Makefile")
            .exists()
            .then_some("Makefile")
            .unwrap_or("makefile"),
    ) {
        for line in makefile.lines() {
            let Some((target, _)) = line.split_once(':') else {
                continue;
            };
            let target = target.trim();
            if target.is_empty()
                || target.starts_with('.')
                || target.contains([' ', '\t', '%', '='])
                || target.starts_with('#')
            {
                continue;
            }
            let category = if target.contains("test") {
                "Test"
            } else if target.contains("build") {
                "Build"
            } else if target.contains("deploy") {
                "Deploy"
            } else {
                "Utilities"
            };
            let mut action = preset(
                &action_label(target),
                &format!("make {}", shell_quote(target)),
                category,
            );
            action.description = format!("Run the `{target}` Make target.");
            action.pinned = false;
            candidates.push(action);
        }
    }
    fn visit(root: &Path, dir: &Path, depth: usize, project: &Project, out: &mut Vec<Preset>) {
        if depth > 5 || out.len() >= 80 {
            return;
        }
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            if out.len() >= 80 {
                break;
            }
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if ![
                    "node_modules",
                    "target",
                    "dist",
                    "build",
                    "vendor",
                    ".git",
                    ".venv",
                    "venv",
                    "__pycache__",
                ]
                .contains(&name.as_str())
                {
                    visit(root, &path, depth + 1, project, out);
                }
                continue;
            }
            let Some(ext) = path
                .extension()
                .and_then(|e| e.to_str())
                .map(str::to_ascii_lowercase)
            else {
                continue;
            };
            if !["sh", "py", "js", "mjs", "cjs", "ts"].contains(&ext.as_str()) {
                continue;
            }
            let Ok(relative) = path.strip_prefix(root) else {
                continue;
            };
            let rel = relative.to_string_lossy().replace('\\', "/");
            if !["scripts/", "tools/", "bin/"]
                .iter()
                .any(|prefix| rel.starts_with(prefix))
            {
                continue;
            }
            let quote = shell_quote(&rel);
            let command = match ext.as_str() {
                "sh" => format!("sh {quote}"),
                "py" => format!("python {quote}"),
                "js" | "mjs" | "cjs" => format!("node {quote}"),
                "ts" => format!(
                    "{} exec tsx {quote}",
                    if project.package_manager.is_empty() {
                        "npx"
                    } else {
                        &project.package_manager
                    }
                ),
                _ => continue,
            };
            let stem = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .replace('-', " ")
                .replace('_', " ");
            let name = stem
                .split_whitespace()
                .map(|s| {
                    let mut chars = s.chars();
                    chars
                        .next()
                        .map(|c| c.to_uppercase().to_string() + chars.as_str())
                        .unwrap_or_default()
                })
                .collect::<Vec<_>>()
                .join(" ");
            let category = if name.to_lowercase().contains("test") {
                "Test"
            } else if name.to_lowercase().contains("deploy") {
                "Deploy"
            } else if ["seed", "migrat", "database", "db "]
                .iter()
                .any(|needle| name.to_lowercase().contains(needle))
            {
                "Database"
            } else {
                "Utilities"
            };
            let mut action = preset(&name, &command, category);
            action.description = format!("Run {}", relative.display());
            action.icon = if category == "Database" {
                "Database"
            } else {
                "FileCode"
            }
            .into();
            action.cwd = relative
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .filter(|p| !p.is_empty())
                .unwrap_or_default();
            action.pinned = false;
            out.push(action);
        }
    }
    visit(&root, &root, 0, project, &mut candidates);
    candidates.retain(|candidate| {
        !project.commands.iter().any(|saved| {
            saved.name.eq_ignore_ascii_case(&candidate.name) && saved.command == candidate.command
        }) && !project.suggestions.iter().any(|saved| {
            saved.name.eq_ignore_ascii_case(&candidate.name) && saved.command == candidate.command
        })
    });
    let mut seen = std::collections::HashSet::new();
    candidates.retain(|c| seen.insert((c.name.to_lowercase(), c.command.clone())));
    for (i, c) in candidates.iter_mut().enumerate() {
        c.sort_order = project.commands.len() + i;
    }
    Ok(candidates)
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
