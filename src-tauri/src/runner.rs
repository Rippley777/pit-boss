use crate::{git, models::*, port_authority, ports, projects, storage::Storage};
use std::{
    collections::HashMap,
    process::Stdio,
    sync::{Arc, Mutex},
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::mpsc,
};

pub type Notify = Arc<dyn Fn(Run) + Send + Sync>;
pub struct Active {
    pub run: Run,
    pub stop: mpsc::Sender<()>,
}
pub struct Runner {
    pub store: Arc<Storage>,
    pub active: Mutex<HashMap<String, Active>>,
    pub notify: Notify,
}
impl Runner {
    pub fn new(store: Arc<Storage>, notify: Notify) -> Arc<Self> {
        Arc::new(Self {
            store,
            active: Mutex::new(HashMap::new()),
            notify,
        })
    }
    pub fn snapshot(&self) -> Result<Snapshot, String> {
        let projects = self.store.projects()?;
        let mut runs = self.store.runs()?;
        for a in self.active.lock().map_err(|e| e.to_string())?.values() {
            if let Some(r) = runs.iter_mut().find(|r| r.id == a.run.id) {
                *r = a.run.clone();
            } else {
                runs.push(a.run.clone());
            }
        }
        runs.sort_by_key(|r| std::cmp::Reverse(r.started_at));
        Ok(Snapshot {
            projects,
            runs,
            port_authority: port_authority::status(),
        })
    }
    pub async fn start(
        self: &Arc<Self>,
        project_id: &str,
        preset_id: &str,
        confirmation: &str,
    ) -> Result<Run, String> {
        let p = self
            .store
            .projects()?
            .into_iter()
            .find(|p| p.id == project_id)
            .ok_or("Project not registered")?;
        let preset = p
            .commands
            .iter()
            .find(|c| c.id == preset_id)
            .ok_or("Command is not in this project's approved configuration")?
            .clone();
        let needs_review = preset.dangerous
            || preset.environment.eq_ignore_ascii_case("production")
            || preset.confirmation
            || preset.confirmation_mode == "Always";
        if confirmation != if needs_review { p.name.as_str() } else { "run" } {
            return Err("Review and confirm the command before execution.".into());
        }
        let base = projects::resolve(&p.path)?;
        let cwd = if preset.cwd.is_empty() {
            base.clone()
        } else {
            base.join(&preset.cwd)
                .canonicalize()
                .map_err(|e| e.to_string())?
        };
        if !cwd.starts_with(&base) || !cwd.is_dir() {
            return Err("Command directory must be inside the registered project.".into());
        }
        let mut secrets: Vec<String> = std::env::vars()
            .filter(|(k, _)| {
                let k = k.to_uppercase();
                [
                    "SECRET",
                    "TOKEN",
                    "PASSWORD",
                    "API_KEY",
                    "PRIVATE_KEY",
                    "CREDENTIAL",
                ]
                .iter()
                .any(|s| k.contains(s))
            })
            .map(|(_, v)| v)
            .filter(|v| !v.is_empty())
            .collect();
        let mut env = vec![];
        for (key, source) in &preset.env {
            if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                return Err(
                    "Environment variable names must contain letters, numbers, or underscores."
                        .into(),
                );
            }
            let value = std::env::var(source).map_err(|_| format!("Environment variable {source} is unavailable. Launch Pit Boss from a shell that exports it."))?;
            if !value.is_empty() {
                secrets.push(value.clone());
            }
            env.push((key.clone(), value));
        }
        secrets.sort_by_key(|s| std::cmp::Reverse(s.len()));
        secrets.dedup();
        let git = git::inspect(&base);
        #[cfg(unix)]
        let shell_path = login_shell_path().await;
        // Hold reservation through spawn so simultaneous starts cannot bypass concurrency policy.
        let mut active = self.active.lock().map_err(|e| e.to_string())?;
        if active
            .values()
            .any(|a| a.run.project_id == p.id && a.run.preset_id == preset.id)
            && !preset.concurrent
        {
            return Err(
                "This command is already running. Stop it or enable concurrent runs.".into(),
            );
        }
        #[cfg(unix)]
        let integration = port_authority::command_integration(&preset.command);
        #[cfg(unix)]
        let mut cmd = {
            let (shell, script) = integration
                .as_ref()
                .map(|integration| (integration.shell.as_os_str(), integration.script.as_str()))
                .unwrap_or_else(|| (std::ffi::OsStr::new("/bin/sh"), preset.command.as_str()));
            let mut c = Command::new(shell);
            c.args(["-c", script]);
            if let Some(path) = shell_path {
                c.env("PATH", path);
            }
            if let Some(integration) = &integration {
                c.env("PORT_AUTHORITY_BIN", &integration.binary);
            }
            c.process_group(0);
            c
        };
        #[cfg(windows)]
        let mut cmd = {
            let mut c = Command::new("cmd.exe");
            c.args(["/C", &preset.command]);
            c
        };
        cmd.current_dir(&cwd)
            .envs(env)
            .env("NO_COLOR", "1")
            .env("PYTHONUNBUFFERED", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Could not start command: {e}"))?;
        let pid = child.id();
        let run = Run {
            id: id(),
            project_id: p.id.clone(),
            project_name: p.name.clone(),
            preset_id: preset.id,
            name: preset.name,
            command: redact(&preset.command, &secrets),
            cwd: cwd.to_string_lossy().into(),
            category: preset.category,
            environment: preset.environment,
            branch: git.branch,
            commit: git.commit,
            started_at: now(),
            ended_at: None,
            exit_code: None,
            status: "running".into(),
            output: String::new(),
            pid,
            ports: vec![],
            cpu: 0.0,
            memory: 0,
        };
        if let Err(e) = self.store.save_run(&run) {
            if let Some(pid) = pid {
                kill_group(pid);
            }
            return Err(e);
        }
        let (stop, mut stop_rx) = mpsc::channel(1);
        active.insert(
            run.id.clone(),
            Active {
                run: run.clone(),
                stop,
            },
        );
        drop(active);
        (self.notify)(run.clone());
        let stdout = child.stdout.take().ok_or("Missing stdout")?;
        let stderr = child.stderr.take().ok_or("Missing stderr")?;
        let (tx, mut rx) = mpsc::channel::<String>(256);
        let tx2 = tx.clone();
        let secrets2 = secrets.clone();
        let out = tokio::spawn(async move { stream(stdout, tx, secrets, false).await });
        let err = tokio::spawn(async move { stream(stderr, tx2, secrets2, true).await });
        let this = self.clone();
        let run_id = run.id.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(2));
            let mut stopped = false;
            let mut streams_open = true;
            let mut flush = tokio::time::interval(std::time::Duration::from_millis(100));
            let mut last_output = String::new();
            let status = loop {
                tokio::select! {
                    line = rx.recv(), if streams_open => { if let Some(line) = line { this.append(&run_id, &line); } else { streams_open = false; } },
                    _ = flush.tick() => { if let Ok(active) = this.active.lock() { if let Some(a) = active.get(&run_id) { if a.run.output != last_output { last_output = a.run.output.clone(); (this.notify)(a.run.clone()); } } } },
                    _ = stop_rx.recv() => { stopped = true; if let Some(pid) = pid { kill_group(pid); } let _ = child.start_kill(); break child.wait().await; },
                    result = child.wait() => { break result; },
                    _ = ticker.tick() => {
                        if let Some(pid) = pid {
                            let metrics = tokio::task::spawn_blocking(move || ports::inspect(pid)).await.unwrap_or_default();
                            if let Ok(mut active) = this.active.lock() { if let Some(a) = active.get_mut(&run_id) { a.run.ports = metrics.ports; a.run.cpu = metrics.cpu; a.run.memory = metrics.memory; (this.notify)(a.run.clone()); let _ = this.store.save_run(&a.run); } }
                        }
                    }
                }
            };
            // A finished shell must not leave detached descendants holding pipes open.
            if let Some(pid) = pid {
                kill_group(pid);
            }
            while let Some(line) = rx.recv().await {
                this.append(&run_id, &line);
            }
            let _ = out.await;
            let _ = err.await;
            let conflict = this.active.lock().ok().and_then(|active| {
                active
                    .get(&run_id)
                    .and_then(|a| ports::conflict_port(&a.run.output, &a.run.command))
            });
            if let Some(port) = conflict {
                let owner = tokio::task::spawn_blocking(move || ports::conflict_owner(port))
                    .await
                    .unwrap_or_default();
                this.append(
                    &run_id,
                    &format!(
                        "\n[Pit Boss] Port {port} is already in use. Current listener:\n{owner}\n"
                    ),
                );
            }
            if let Ok(mut active) = this.active.lock() {
                if let Some(mut a) = active.remove(&run_id) {
                    a.run.exit_code = status.ok().and_then(|s| s.code());
                    a.run.ended_at = Some(now());
                    a.run.status = if stopped {
                        "stopped"
                    } else if a.run.exit_code == Some(0) {
                        "success"
                    } else {
                        "failed"
                    }
                    .into();
                    a.run.ports.clear();
                    a.run.cpu = 0.0;
                    a.run.memory = 0;
                    a.run.pid = None;
                    if let Err(e) = this.store.save_run(&a.run) {
                        a.run
                            .output
                            .push_str(&format!("\n[history persistence failed: {e}]\n"));
                    }
                    (this.notify)(a.run);
                }
            }
        });
        Ok(run)
    }
    fn append(&self, id: &str, text: &str) {
        if let Ok(mut active) = self.active.lock() {
            if let Some(a) = active.get_mut(id) {
                a.run.output.push_str(text);
                trim_output(&mut a.run.output);
            }
        }
    }
    pub async fn stop(&self, id: &str) -> Result<(), String> {
        let tx = self
            .active
            .lock()
            .map_err(|e| e.to_string())?
            .get(id)
            .map(|a| a.stop.clone())
            .ok_or("Process is no longer running")?;
        tx.send(()).await.map_err(|e| e.to_string())
    }
    pub fn shutdown(&self) {
        if let Ok(active) = self.active.lock() {
            for a in active.values() {
                if let Some(pid) = a.run.pid {
                    kill_group(pid);
                }
            }
        }
    }
}
#[cfg(unix)]
async fn login_shell_path() -> Option<String> {
    static PATH: tokio::sync::OnceCell<Option<String>> = tokio::sync::OnceCell::const_new();
    PATH.get_or_init(probe_login_shell_path).await.clone()
}
#[cfg(unix)]
async fn probe_login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| std::path::Path::new(s).is_absolute() && std::path::Path::new(s).is_file())
        .unwrap_or_else(|| "/bin/sh".into());
    let mut probe = unix_command(&shell, "printf '\\0%s\\0' \"$PATH\"");
    probe
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(std::time::Duration::from_secs(5), probe.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    // Startup scripts may print banners; delimit the requested value explicitly.
    let path = output.stdout.split(|b| *b == 0).nth(1)?;
    let path = String::from_utf8(path.to_vec()).ok()?;
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}
#[cfg(unix)]
fn unix_command(shell: &str, script: &str) -> Command {
    let mut command = Command::new(shell);
    // Desktop launches do not inherit terminal PATH additions. Load login and
    // interactive startup files, including NVM initialization in .zshrc/.bashrc.
    let flags = match std::path::Path::new(shell)
        .file_name()
        .and_then(|s| s.to_str())
    {
        Some("zsh" | "bash" | "fish") => "-lic",
        _ => "-lc",
    };
    command.args([flags, script]);
    command
}
fn kill_group(pid: u32) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output();
    }
}
fn trim_output(output: &mut String) {
    if output.len() > 1_048_576 {
        let mut cut = output.len() - 1_048_576;
        while !output.is_char_boundary(cut) {
            cut += 1;
        }
        output.drain(..cut);
    }
}
pub fn redact(text: &str, secrets: &[String]) -> String {
    let mut text = text.to_string();
    for s in secrets {
        if !s.is_empty() {
            text = text.replace(s, "[REDACTED]");
        }
    }
    text
}
async fn stream<R: tokio::io::AsyncRead + Unpin>(
    reader: R,
    tx: mpsc::Sender<String>,
    secrets: Vec<String>,
    stderr: bool,
) {
    // Keep a trailing window so a secret split across reads cannot escape redaction.
    let mut reader = BufReader::new(reader);
    let mut pending = Vec::new();
    while let Ok(buf) = reader.fill_buf().await {
        if buf.is_empty() {
            if !pending.is_empty() {
                let _ = tx
                    .send(format!(
                        "{}{}",
                        if stderr { "[stderr] " } else { "" },
                        redact(&String::from_utf8_lossy(&pending), &secrets)
                    ))
                    .await;
            }
            break;
        }
        let n = buf.len();
        pending.extend_from_slice(buf);
        reader.consume(n);
        let mut cut = pending.len();
        // Hold only a suffix that could still become a secret on the next read.
        for secret in &secrets {
            for len in (1..secret.len().min(pending.len() + 1)).rev() {
                if pending.ends_with(&secret.as_bytes()[..len]) {
                    cut = cut.min(pending.len() - len);
                    break;
                }
            }
        }
        // Match on bytes before decoding so both UTF-8 and secrets survive split reads.
        for secret in &secrets {
            if secret.is_empty() {
                continue;
            }
            for (start, window) in pending.windows(secret.len()).enumerate() {
                if window == secret.as_bytes() && start < cut && start + secret.len() > cut {
                    cut = start;
                }
            }
        }
        while cut > 0 && cut < pending.len() && pending[cut] & 0xc0 == 0x80 {
            cut -= 1;
        }
        if let Err(e) = std::str::from_utf8(&pending[..cut]) {
            if e.error_len().is_none() {
                cut = e.valid_up_to();
            }
        }
        if cut > 0 {
            let text = redact(&String::from_utf8_lossy(&pending[..cut]), &secrets);
            if tx
                .send(format!("{}{}", if stderr { "[stderr] " } else { "" }, text))
                .await
                .is_err()
            {
                break;
            }
            pending.drain(..cut);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[tokio::test]
    async fn loads_shell_startup_path_for_desktop_commands() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("bin");
        std::fs::create_dir(&bin).unwrap();
        std::fs::write(
            dir.path().join(".zshrc"),
            "export PATH=\"$ZDOTDIR/bin:$PATH\"\n",
        )
        .unwrap();
        for (name, script) in [
            ("yarn", "#!/bin/sh\nexec node\n"),
            ("node", "#!/bin/sh\nprintf startup-tools-found\n"),
        ] {
            let path = bin.join(name);
            std::fs::write(&path, script).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let output = unix_command("/bin/zsh", "yarn")
            .env("ZDOTDIR", dir.path())
            .env("PATH", "/usr/bin:/bin")
            .stdin(Stdio::null())
            .output()
            .await
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            String::from_utf8_lossy(&output.stdout),
            "startup-tools-found"
        );
    }
    #[tokio::test]
    async fn runner_streams_persists_and_rejects_unapproved_commands() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Storage::new(&dir.path().join("test.db")).unwrap());
        let mut p = projects::detect(dir.path().to_str().unwrap()).unwrap();
        p.commands.push(Preset {
            id: "test".into(),
            name: "Test".into(),
            description: String::new(),
            command:
                "printf 'first\\n'; sleep 0.2; printf 'second\\n'; printf 'error\\n' >&2; exit 3"
                    .into(),
            cwd: "".into(),
            category: "Test".into(),
            icon: "Terminal".into(),
            environment: "Local".into(),
            confirmation: false,
            confirmation_mode: "Never".into(),
            dangerous: false,
            pinned: false,
            sort_order: 0,
            keyboard_shortcut: String::new(),
            concurrent: false,
            persistent: false,
            env: Default::default(),
        });
        store.save_project(&p).unwrap();
        let events = Arc::new(Mutex::new(vec![]));
        let capture = events.clone();
        let runner = Runner::new(
            store.clone(),
            Arc::new(move |r| capture.lock().unwrap().push(r)),
        );
        assert!(runner.start(&p.id, "not-approved", "run").await.is_err());
        assert!(runner.start(&p.id, "test", "").await.is_err());
        let run = runner.start(&p.id, "test", "run").await.unwrap();
        assert!(runner.start(&p.id, "test", "run").await.is_err());
        for _ in 0..100 {
            if !runner.active.lock().unwrap().contains_key(&run.id) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        let history = store.runs().unwrap();
        assert_eq!(history[0].exit_code, Some(3));
        assert_eq!(history[0].status, "failed");
        assert!(history[0].output.contains("first"));
        assert!(history[0].output.contains("second"));
        assert!(history[0].output.contains("[stderr]"));
        assert!(events
            .lock()
            .unwrap()
            .iter()
            .any(|r| r.status == "running" && r.output.contains("first")));
    }
    #[tokio::test]
    async fn redacts_secrets_across_stream_chunks() {
        use tokio::io::AsyncWriteExt;
        let (mut writer, reader) = tokio::io::duplex(64);
        let (tx, mut rx) = mpsc::channel(32);
        let task = tokio::spawn(stream(reader, tx, vec!["super-secret".into()], false));
        writer.write_all(b"before super-").await.unwrap();
        tokio::task::yield_now().await;
        writer.write_all(b"secret after\n").await.unwrap();
        drop(writer);
        task.await.unwrap();
        let mut result = String::new();
        while let Some(s) = rx.recv().await {
            result.push_str(&s);
        }
        assert_eq!(result, "before [REDACTED] after\n");
    }
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    fn setup(script: &str) -> (tempfile::TempDir, Arc<Runner>, Project) {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Storage::new(&dir.path().join("history.sqlite")).unwrap());
        let mut project = projects::detect(dir.path().to_str().unwrap()).unwrap();
        project.commands.push(Preset {
            id: "lifecycle".into(),
            name: "Lifecycle".into(),
            description: String::new(),
            command: script.into(),
            cwd: "".into(),
            category: "Test".into(),
            icon: "Terminal".into(),
            environment: "Local".into(),
            confirmation: false,
            confirmation_mode: String::new(),
            dangerous: false,
            pinned: false,
            sort_order: 0,
            keyboard_shortcut: String::new(),
            persistent: false,
            concurrent: false,
            env: Default::default(),
        });
        store.save_project(&project).unwrap();
        (dir, Runner::new(store, Arc::new(|_| {})), project)
    }
    async fn finished(runner: &Arc<Runner>, id: &str) -> Run {
        tokio::time::timeout(std::time::Duration::from_secs(6), async {
            loop {
                if let Some(r) = runner
                    .snapshot()
                    .unwrap()
                    .runs
                    .into_iter()
                    .find(|r| r.id == id && r.status != "running")
                {
                    return r;
                }
                tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            }
        })
        .await
        .expect("Run should finish within six seconds")
    }
    #[tokio::test]
    async fn stop_kills_child_group_even_after_output_pipes_close() {
        let (_dir, runner, project) = setup("sleep 60 & echo $!; exec 1>&-; exec 2>&-; wait");
        let run = runner.start(&project.id, "lifecycle", "run").await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        runner.stop(&run.id).await.unwrap();
        let done = finished(&runner, &run.id).await;
        assert_eq!(done.status, "stopped");
        let child_pid = done.output.trim().parse::<i32>().unwrap();
        #[cfg(unix)]
        {
            for _ in 0..40 {
                if unsafe { libc::kill(child_pid, 0) } != 0 {
                    return;
                }
                tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            }
            panic!("Child process still alive after process-group stop");
        }
    }
    #[tokio::test]
    async fn production_and_directory_escape_are_rejected() {
        let (_dir, runner, mut p) = setup("echo should-not-run");
        p.commands[0].environment = "Production".into();
        runner.store.save_project(&p).unwrap();
        assert!(runner.start(&p.id, "lifecycle", "run").await.is_err());
        p.commands[0].cwd = "..".into();
        runner.store.save_project(&p).unwrap();
        assert!(runner.start(&p.id, "lifecycle", &p.name).await.is_err());
        assert!(runner.store.runs().unwrap().is_empty());
    }
    #[tokio::test]
    async fn history_survives_reopening_and_marks_interrupted_runs() {
        let (dir, runner, project) = setup("printf 'persisted output'");
        let run = runner.start(&project.id, "lifecycle", "run").await.unwrap();
        let mut done = finished(&runner, &run.id).await;
        assert_eq!(done.status, "success");
        done.status = "running".into();
        runner.store.save_run(&done).unwrap();
        drop(runner);
        let reopened = Storage::new(&dir.path().join("history.sqlite")).unwrap();
        let history = reopened.runs().unwrap();
        assert_eq!(history[0].status, "interrupted");
        assert_eq!(history[0].output, "persisted output");
        assert_eq!(reopened.projects().unwrap().len(), 1);
    }
    #[tokio::test]
    async fn unicode_survives_split_reads_without_holding_unrelated_output() {
        use tokio::io::AsyncWriteExt;
        let (mut writer, reader) = tokio::io::duplex(64);
        let (tx, mut rx) = mpsc::channel(32);
        let task = tokio::spawn(stream(reader, tx, vec!["secret-value".into()], false));
        writer.write_all(b"ready\n").await.unwrap();
        assert_eq!(
            tokio::time::timeout(std::time::Duration::from_secs(1), rx.recv())
                .await
                .unwrap()
                .unwrap(),
            "ready\n"
        );
        writer.write_all(&[0xe2, 0x9c]).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        writer.write_all(&[0x93, b'\n']).await.unwrap();
        drop(writer);
        task.await.unwrap();
        let mut result = String::new();
        while let Some(s) = rx.recv().await {
            result.push_str(&s);
        }
        assert_eq!(result, "✓\n");
    }
    #[tokio::test]
    async fn detects_ports_owned_by_spawned_descendants() {
        let (_dir, runner, p) = setup("python3 -u -c 'import socket,time; s=socket.socket(); s.bind((\"127.0.0.1\",0)); s.listen(); print(s.getsockname()[1], flush=True); time.sleep(30)' & wait");
        let run = runner.start(&p.id, "lifecycle", "run").await.unwrap();
        let result = tokio::time::timeout(std::time::Duration::from_secs(6), async {
            loop {
                let r = runner
                    .snapshot()
                    .unwrap()
                    .runs
                    .into_iter()
                    .find(|r| r.id == run.id)
                    .unwrap();
                if let Ok(port) = r.output.trim().parse::<u16>() {
                    if r.ports.contains(&port) {
                        return port;
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        })
        .await;
        runner.stop(&run.id).await.unwrap();
        finished(&runner, &run.id).await;
        assert!(
            result.is_ok(),
            "Listening port should be associated with its parent run"
        );
    }
}
