pub mod git;
pub mod models;
pub mod port_authority;
pub mod ports;
pub mod projects;
pub mod runner;
pub mod storage;

#[cfg(feature = "desktop")]
mod desktop {
    use super::*;
    use models::*;
    use std::sync::Arc;
    use tauri::{Emitter, Manager, State};
    type AppState = Arc<runner::Runner>;
    #[tauri::command]
    fn snapshot(state: State<AppState>) -> Result<Snapshot, String> {
        state.snapshot()
    }
    #[tauri::command]
    async fn detect_project(path: String) -> Result<Project, String> {
        tauri::async_runtime::spawn_blocking(move || projects::detect(&path))
            .await
            .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn scan_projects(path: String) -> Result<Vec<Project>, String> {
        tauri::async_runtime::spawn_blocking(move || projects::scan(&path))
            .await
            .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    fn suggest_actions(state: State<AppState>, project_id: String) -> Result<Vec<Preset>, String> {
        let project = state
            .store
            .projects()?
            .into_iter()
            .find(|p| p.id == project_id)
            .ok_or("Project not registered")?;
        projects::suggestions(&project)
    }
    #[tauri::command]
    fn save_project(state: State<AppState>, mut project: Project) -> Result<Project, String> {
        project.path = projects::resolve(&project.path)?.to_string_lossy().into();
        if project.name.trim().is_empty() {
            return Err("Project name is required.".into());
        }
        if state
            .store
            .projects()?
            .iter()
            .any(|p| p.path == project.path && p.id != project.id)
        {
            return Err("This directory is already registered.".into());
        }
        let mut ids = std::collections::HashSet::new();
        let mut shortcuts = std::collections::HashSet::new();
        for command in project.commands.iter().chain(project.suggestions.iter()) {
            if command.name.trim().is_empty()
                || command.command.trim().is_empty()
                || !ids.insert(&command.id)
            {
                return Err("Commands need unique IDs, a name, and a command.".into());
            }
            if !command.confirmation_mode.is_empty()
                && !["Never", "Always", "Only in Production"]
                    .contains(&command.confirmation_mode.as_str())
            {
                return Err("Unknown action confirmation mode.".into());
            }
            if !command.keyboard_shortcut.is_empty() {
                let shortcut = command.keyboard_shortcut.trim().to_uppercase();
                if shortcut.chars().count() != 1
                    || !shortcut.chars().all(|c| c.is_ascii_alphanumeric())
                {
                    return Err("Action shortcuts must be a single letter or number.".into());
                }
                if !shortcuts.insert(shortcut) {
                    return Err("Each project action needs a unique keyboard shortcut.".into());
                }
            }
        }
        for command in project.commands.iter().chain(project.suggestions.iter()) {
            let cwd = std::path::Path::new(&project.path)
                .join(&command.cwd)
                .canonicalize()
                .map_err(|e| e.to_string())?;
            if !cwd.starts_with(&project.path) {
                return Err("Command directories must be inside the project.".into());
            }
        }
        for (sort_order, action) in project.commands.iter_mut().enumerate() {
            action.sort_order = sort_order;
        }
        for (sort_order, action) in project.suggestions.iter_mut().enumerate() {
            action.sort_order = sort_order;
        }
        state.store.save_project(&project)?;
        Ok(project)
    }
    #[tauri::command]
    fn remove_project(state: State<AppState>, project_id: String) -> Result<(), String> {
        if state
            .active
            .lock()
            .map_err(|e| e.to_string())?
            .values()
            .any(|a| a.run.project_id == project_id)
        {
            return Err("Stop this project's commands before removing it.".into());
        }
        state.store.remove_project(&project_id)
    }
    #[tauri::command]
    async fn refresh_projects(state: State<'_, AppState>) -> Result<Snapshot, String> {
        let runner = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            for mut p in runner.store.projects()? {
                p.git = git::inspect(std::path::Path::new(&p.path));
                runner.store.save_project(&p)?;
            }
            runner.snapshot()
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn run_command(
        state: State<'_, AppState>,
        project_id: String,
        preset_id: String,
        confirmation: String,
    ) -> Result<Run, String> {
        state
            .inner()
            .start(&project_id, &preset_id, &confirmation)
            .await
    }
    #[tauri::command]
    async fn stop_command(state: State<'_, AppState>, run_id: String) -> Result<(), String> {
        state.stop(&run_id).await
    }
    #[tauri::command]
    async fn port_owner(port: u16) -> Result<String, String> {
        tauri::async_runtime::spawn_blocking(move || ports::conflict_owner(port))
            .await
            .map_err(|e| e.to_string())
    }
    #[tauri::command]
    fn open_project(
        state: State<AppState>,
        project_id: String,
        target: String,
    ) -> Result<(), String> {
        let p = state
            .store
            .projects()?
            .into_iter()
            .find(|p| p.id == project_id)
            .ok_or("Project not registered")?;
        let path = projects::resolve(&p.path)?;
        let mut command;
        match target.as_str() {
            "editor" => {
                command = std::process::Command::new("code");
                command.arg(&path);
            }
            "terminal" => {
                #[cfg(target_os = "macos")]
                {
                    command = std::process::Command::new("open");
                    command.args(["-a", "Terminal"]).arg(&path);
                }
                #[cfg(target_os = "linux")]
                {
                    command = std::process::Command::new("x-terminal-emulator");
                    command.current_dir(&path);
                }
                #[cfg(target_os = "windows")]
                {
                    command = std::process::Command::new("wt");
                    command.arg("-d").arg(&path);
                }
            }
            "repository" => {
                return open_url(p.git.remote);
            }
            _ => return Err("Unknown open target".into()),
        }
        let status = command
            .status()
            .map_err(|e| format!("Unable to open {target}: {e}"))?;
        if !status.success() {
            return Err(format!(
                "{target} returned an error. Ensure it is installed and on PATH."
            ));
        }
        Ok(())
    }
    #[tauri::command]
    fn open_url(url: String) -> Result<(), String> {
        let parsed = url::Url::parse(&url).map_err(|_| "Invalid URL")?;
        if !["http", "https"].contains(&parsed.scheme())
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err("Only HTTP(S) URLs without credentials can be opened.".into());
        }
        #[cfg(target_os = "macos")]
        let mut cmd = std::process::Command::new("open");
        #[cfg(target_os = "linux")]
        let mut cmd = std::process::Command::new("xdg-open");
        #[cfg(target_os = "windows")]
        let mut cmd = {
            let mut c = std::process::Command::new("rundll32");
            c.arg("url.dll,FileProtocolHandler");
            c
        };
        cmd.arg(parsed.as_str())
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn run() {
        let app = tauri::Builder::default()
            .plugin(tauri_plugin_dialog::init())
            .setup(|app| {
                let dir = app.path().app_data_dir()?;
                std::fs::create_dir_all(&dir)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
                }
                let store = Arc::new(
                    storage::Storage::new(&dir.join("pit-boss.sqlite"))
                        .map_err(std::io::Error::other)?,
                );
                let handle = app.handle().clone();
                app.manage(runner::Runner::new(
                    store,
                    Arc::new(move |run| {
                        let _ = handle.emit("run-update", run);
                    }),
                ));
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                snapshot,
                detect_project,
                scan_projects,
                suggest_actions,
                save_project,
                remove_project,
                refresh_projects,
                run_command,
                stop_command,
                port_owner,
                open_project,
                open_url
            ])
            .build(tauri::generate_context!())
            .expect("Could not start Pit Boss");
        app.run(|handle, event| {
            if let tauri::RunEvent::Exit = event {
                handle.state::<AppState>().shutdown();
            }
        });
    }
}
#[cfg(feature = "desktop")]
pub use desktop::run;
