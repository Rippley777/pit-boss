#[cfg(test)]
use crate::projects;
use crate::{execution, git, models::*, port_authority, ports, storage::Storage};
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
    pub concurrency: String,
}
pub struct Runner {
    pub store: Arc<Storage>,
    pub active: Mutex<HashMap<String, Active>>,
    pub notify: Notify,
    pending: Mutex<HashMap<String, (Run, Project, Preset)>>,
}
impl Runner {
    pub fn new(store: Arc<Storage>, notify: Notify) -> Arc<Self> {
        Arc::new(Self {
            store,
            active: Mutex::new(HashMap::new()),
            notify,
            pending: Mutex::new(HashMap::new()),
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
    fn record(&self, run: &Run) -> Result<(), String> {
        self.store.save_run(run)?;
        (self.notify)(run.clone());
        Ok(())
    }
    fn fail(&self, mut run: Run, category: &str, message: &str) -> Result<Run, String> {
        run.transition("failed")?;
        run.details.failure = Some(Failure {
            category: category.into(),
            summary: message.into(),
            evidence: message.into(),
            next_step: "Resolve the reported check, then create a new attempt with Retry.".into(),
        });
        self.record(&run)?;
        Ok(run)
    }
    pub async fn prepare(
        &self,
        project_id: &str,
        preset_id: &str,
        retry_of: Option<String>,
    ) -> Result<Run, String> {
        let p = self
            .store
            .projects()?
            .into_iter()
            .find(|p| p.id == project_id)
            .ok_or("Project not registered")?;
        let a = p
            .commands
            .iter()
            .find(|a| a.id == preset_id)
            .ok_or("Action is not approved for this project")?
            .clone();
        if let Some(previous) = &retry_of {
            let original = self
                .store
                .run(previous)?
                .ok_or("Original execution is unavailable")?;
            if original.project_id != p.id || original.preset_id != a.id {
                return Err("Retry must reference the same project and action".into());
            }
        }
        let secrets = known_secrets(&a);
        let mut run = Run {
            id: id(),
            project_id: p.id.clone(),
            project_name: p.name.clone(),
            preset_id: a.id.clone(),
            name: a.name.clone(),
            command: redact(&a.command, &secrets),
            cwd: p.path.clone(),
            category: a.category.clone(),
            environment: a.environment.clone(),
            branch: String::new(),
            commit: String::new(),
            started_at: now(),
            ended_at: None,
            exit_code: None,
            status: "queued".into(),
            output: String::new(),
            pid: None,
            ports: vec![],
            cpu: 0.0,
            memory: 0,
            details: ExecutionDetails {
                risk: execution::risk(&a),
                trigger_source: "manual".into(),
                correlation_id: id(),
                retry_of,
                ..Default::default()
            },
        };
        run.details.log_reference = format!("sqlite:runs/{}", run.id);
        run.details.transitions.push(Transition {
            state: "queued".into(),
            at: now(),
        });
        self.record(&run)?;
        run.transition("preflighting")?;
        self.record(&run)?;
        let path = execution_path().await;
        let project = p.clone();
        let action = a.clone();
        let (checks, directory, git) = tokio::task::spawn_blocking(move || {
            let checks = execution::checks(&project, &action, &path);
            let directory = execution::cwd(&project, &action).ok();
            let git = directory
                .as_ref()
                .map(|d| git::inspect(d))
                .unwrap_or_default();
            (checks, directory, git)
        })
        .await
        .map_err(|e| e.to_string())?;
        run.details.preflight = checks;
        for check in &mut run.details.preflight {
            check.explanation = redact(&check.explanation, &secrets);
        }
        if let Some(cwd) = directory {
            run.cwd = cwd.display().to_string();
        }
        run.branch = git.branch;
        run.commit = git.commit;
        if run
            .details
            .preflight
            .iter()
            .any(|c| c.result == "blocked" || (a.policy.deny_warnings && c.result == "warning"))
        {
            return self.fail(
                run,
                "preflight",
                "Preflight blocked execution. No command was started.",
            );
        }
        run.transition("awaiting_confirmation")?;
        self.record(&run)?;
        let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
        let expired: Vec<_> = pending
            .iter()
            .filter(|(_, (r, _, _))| now().saturating_sub(r.started_at) > 300_000)
            .map(|(id, _)| id.clone())
            .collect();
        for id in expired {
            if let Some((old, _, _)) = pending.remove(&id) {
                self.fail(
                    old,
                    "confirmation_expired",
                    "Confirmation expired. Review a new execution request.",
                )?;
            }
        }
        if pending.len() >= 100 {
            return self.fail(
                run,
                "capacity",
                "Too many pending requests. Cancel an existing review.",
            );
        }
        pending.insert(run.id.clone(), (run.clone(), p, a));
        Ok(run)
    }
    /// Only the trusted local window can confirm. No caller-supplied shell text is accepted.
    pub async fn confirm(
        self: &Arc<Self>,
        execution_id: &str,
        confirmation: &str,
        warnings: bool,
    ) -> Result<Run, String> {
        let (mut run, reviewed_project, preset) = self
            .pending
            .lock()
            .map_err(|e| e.to_string())?
            .remove(execution_id)
            .ok_or("Execution review is expired or already used; prepare a new request")?;
        let p = match self
            .store
            .projects()?
            .into_iter()
            .find(|p| p.id == run.project_id)
        {
            Some(p) => p,
            None => return self.fail(run, "authorization", "Project was removed after review."),
        };
        let current = p.commands.iter().find(|a| a.id == preset.id);
        if p.path != reviewed_project.path
            || p.name != reviewed_project.name
            || current.is_none()
            || serde_json::to_string(current.unwrap()).ok() != serde_json::to_string(&preset).ok()
        {
            return self.fail(
                run,
                "confirmation_changed",
                "Action configuration changed after review. Review the new configuration.",
            );
        }
        if now().saturating_sub(run.started_at) > 300_000 {
            return self.fail(
                run,
                "confirmation_expired",
                "Confirmation expired after five minutes.",
            );
        }
        if confirmation
            != if execution::protected(&preset) {
                p.name.as_str()
            } else {
                "run"
            }
        {
            return self.fail(
                run,
                "confirmation",
                "Explicit confirmation did not match this execution request.",
            );
        }
        let overrides: Vec<String> = run
            .details
            .preflight
            .iter()
            .filter(|c| c.result == "warning")
            .map(|c| c.id.clone())
            .collect();
        if !overrides.is_empty() && (!warnings || preset.policy.deny_warnings) {
            return self.fail(
                run,
                "warning_policy",
                "Preflight warnings were not approved.",
            );
        }
        let path = execution_path().await;
        let project = p.clone();
        let action = preset.clone();
        let check_path = path.clone();
        let mut current_checks =
            tokio::task::spawn_blocking(move || execution::checks(&project, &action, &check_path))
                .await
                .map_err(|e| e.to_string())?;
        let check_secrets = known_secrets(&preset);
        for check in &mut current_checks {
            check.explanation = redact(&check.explanation, &check_secrets);
        }
        // Recheck read-only requirements; never silently authorize new warnings.
        if current_checks
            .iter()
            .any(|c| c.result == "blocked" || (c.result == "warning" && !overrides.contains(&c.id)))
        {
            run.details.preflight = current_checks;
            return self.fail(
                run,
                "preflight_changed",
                "Preflight conditions changed. Review a new request.",
            );
        }
        let cwd = match execution::cwd(&p, &preset) {
            Ok(cwd) => cwd,
            Err(e) => return self.fail(run, "invalid_working_directory", &e),
        };
        if cwd.to_string_lossy() != run.cwd {
            return self.fail(
                run,
                "confirmation_changed",
                "Working directory changed after review.",
            );
        }
        run.details.confirmation = Some(Confirmation {
            at: now(),
            expires_at: run.started_at + 300_000,
            warning_overrides: overrides,
        });
        run.transition("starting")?;
        self.record(&run)?;
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
                return self.fail(run, "configuration", "Invalid environment variable name.");
            }
            let value = match std::env::var(source) {
                Ok(v) => v,
                Err(_) => {
                    return self.fail(
                        run,
                        "missing_environment",
                        &format!("Environment variable {source} is unavailable."),
                    )
                }
            };
            if !value.is_empty() {
                secrets.push(value.clone());
            }
            env.push((key.clone(), value));
        }
        secrets.sort_by_key(|s| std::cmp::Reverse(s.len()));
        secrets.dedup();
        // Hold reservation through spawn so simultaneous starts cannot bypass concurrency policy.
        let mut active = self.active.lock().map_err(|e| e.to_string())?;
        // IPC action edits use this mutex too. Revalidate immediately before spawn.
        let latest = self
            .store
            .projects()?
            .into_iter()
            .find(|project| project.id == p.id);
        if !latest.as_ref().is_some_and(|project| {
            project.path == p.path
                && project.name == p.name
                && project
                    .commands
                    .iter()
                    .find(|action| action.id == preset.id)
                    .is_some_and(|action| {
                        serde_json::to_string(action).ok() == serde_json::to_string(&preset).ok()
                    })
        }) {
            return self.fail(
                run,
                "confirmation_changed",
                "Action changed while preflight was running. Review a new request.",
            );
        }
        if active
            .values()
            .any(|a| execution::conflicts(&p, &preset, &a.run, &a.concurrency))
        {
            return self.fail(
                run,
                "concurrency",
                "A conflicting execution is active. Wait for it to finish before retrying.",
            );
        }
        match execution::backup(&cwd, &preset, &run) {
            Ok(backups) => run.details.artifacts = backups,
            Err(e) => {
                return self.fail(
                    run,
                    "backup",
                    &format!("Backup failed; command was not started: {e}"),
                )
            }
        }
        self.store.save_run(&run)?;
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
            c.env("PATH", &path);
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
        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(e) => {
                return self.fail(
                    run,
                    match e.kind() {
                        std::io::ErrorKind::NotFound => "missing_executable",
                        std::io::ErrorKind::PermissionDenied => "permission_denied",
                        _ => "spawn",
                    },
                    &format!("Could not start command: {e}"),
                )
            }
        };
        let pid = child.id();
        run.pid = pid;
        run.details.process_started_at = Some(now());
        run.transition("running")?;
        if let Err(e) = self.store.save_run(&run) {
            if let Some(pid) = pid {
                kill_group(pid);
            }
            run.transition("interrupted")?;
            run.details.failure = Some(Failure {
                category: "persistence".into(),
                summary: "Command was terminated because its start could not be saved.".into(),
                evidence: e,
                next_step: "Check disk space and database permissions before retrying.".into(),
            });
            (self.notify)(run.clone());
            return Ok(run);
        }
        let (stop, mut stop_rx) = mpsc::channel(1);
        active.insert(
            run.id.clone(),
            Active {
                run: run.clone(),
                stop,
                concurrency: execution::concurrency(&preset).into(),
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
            let (metrics_tx, mut metrics_rx) = mpsc::channel::<ports::Metrics>(1);
            let mut metrics_pending = false;
            let mut stopped = false;
            let mut timed_out = false;
            let timeout = tokio::time::sleep(std::time::Duration::from_secs(
                if preset.policy.timeout_seconds == 0 {
                    604800 * 100
                } else {
                    preset.policy.timeout_seconds
                },
            ));
            tokio::pin!(timeout);
            let mut streams_open = true;
            let mut flush = tokio::time::interval(std::time::Duration::from_millis(100));
            let mut last_output = String::new();
            let status = loop {
                tokio::select! {
                    line = rx.recv(), if streams_open => { if let Some(line) = line { this.append(&run_id, &line); } else { streams_open = false; } },
                    _ = flush.tick() => { if let Ok(active) = this.active.lock() { if let Some(a) = active.get(&run_id) { if a.run.output != last_output { last_output = a.run.output.clone(); (this.notify)(a.run.clone()); } } } },
                    _ = stop_rx.recv() => { stopped = true; break terminate(&mut child, pid).await; },
                    _ = &mut timeout, if preset.policy.timeout_seconds > 0 => { timed_out = true; break terminate(&mut child, pid).await; },
                    result = child.wait() => { break result; },
                    metrics = metrics_rx.recv(), if metrics_pending => {
                        metrics_pending = false;
                        if let Some(metrics) = metrics { if let Ok(mut active) = this.active.lock() { if let Some(a) = active.get_mut(&run_id) { a.run.ports = metrics.ports; a.run.cpu = metrics.cpu; a.run.memory = metrics.memory; a.run.details.revision += 1; (this.notify)(a.run.clone()); } } }
                    },
                    _ = ticker.tick() => {
                        if !metrics_pending { if let Some(pid) = pid {
                            metrics_pending = true;
                            let tx = metrics_tx.clone();
                            tokio::task::spawn_blocking(move || { let _ = tx.blocking_send(ports::inspect(pid)); });
                        } }
                        if let Ok(active) = this.active.lock() { if let Some(a) = active.get(&run_id) { let _ = this.store.save_run(&a.run); } }
                    }

                }
            };
            // A finished shell must not leave detached descendants holding pipes open.
            if let Some(pid) = pid {
                kill_group(pid);
            }
            let mut drained = tokio::time::timeout(std::time::Duration::from_secs(5), async {
                while let Some(line) = rx.recv().await {
                    this.append(&run_id, &line);
                }
            })
            .await
            .is_ok();
            if !drained {
                out.abort();
                err.abort();
            }
            drained &= matches!(out.await, Ok(Ok(())));
            drained &= matches!(err.await, Ok(Ok(())));
            let tree_stopped = if stopped || timed_out {
                if let Some(pid) = pid {
                    group_stopped(pid).await
                } else {
                    false
                }
            } else {
                true
            };
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
                    a.run.exit_code = status.as_ref().ok().and_then(|s| s.code());
                    #[cfg(unix)]
                    {
                        use std::os::unix::process::ExitStatusExt;
                        a.run.details.signal = status.as_ref().ok().and_then(|s| s.signal());
                    }
                    let final_state = if status.is_err() || !drained || !tree_stopped {
                        "interrupted"
                    } else if timed_out {
                        "timed_out"
                    } else if stopped {
                        "cancelled"
                    } else if a.run.exit_code == Some(0) {
                        "success"
                    } else {
                        "failed"
                    };
                    let mut final_state = final_state;
                    if final_state == "success" {
                        match execution::artifacts(&cwd, &preset) {
                            Ok(artifacts) => a.run.details.artifacts.extend(artifacts),
                            Err(e) => {
                                final_state = "failed";
                                a.run.details.failure = Some(Failure {
                                    category: "artifact".into(),
                                    summary: e.clone(),
                                    evidence: e,
                                    next_step: "Check the build's output paths before retrying."
                                        .into(),
                                });
                            }
                        }
                    }
                    let _ = a.run.transition(final_state);
                    if final_state == "interrupted" {
                        a.run.details.failure = Some(Failure {
                            category: "unexpected_termination".into(),
                            summary: "Execution ended without a confirmed complete result.".into(),
                            evidence: format!(
                                "Wait error: {:?}; output drain completed: {}; process tree stopped: {}",
                                status.as_ref().err(),
                                drained, tree_stopped
                            ),
                            next_step: "Inspect remaining processes before retrying.".into(),
                        });
                    }
                    if final_state != "success" && a.run.details.failure.is_none() {
                        a.run.details.failure = Some(execution::failure(&a.run));
                    }
                    a.run.ports.clear();
                    a.run.cpu = 0.0;
                    a.run.memory = 0;
                    a.run.pid = None;
                    if let Err(e) = this.store.save_run(&a.run) {
                        a.run.status = "interrupted".into();
                        a.run.details.revision += 1;
                        a.run.details.failure = Some(Failure { category: "persistence".into(), summary: "Execution completed but history could not be saved.".into(), evidence: e, next_step: "Check disk space and database permissions. Completion is not durably recorded.".into() });
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
                let first_chunk = a.run.output.is_empty();
                a.run.output.push_str(text);
                if a.run.output.len() > 1_048_576 {
                    a.run.details.log_truncated = true;
                }
                trim_output(&mut a.run.output);
                a.run.details.revision += 1;
                a.run.details.output_events.push(OutputEvent {
                    at: now(),
                    stream: if text.starts_with("[stderr] ") {
                        "stderr"
                    } else {
                        "stdout"
                    }
                    .into(),
                    text: text.into(),
                });
                // Bound both byte size and event count; output remains the persisted 1 MiB tail.
                while a.run.details.output_events.len() > 1000
                    || a.run
                        .details
                        .output_events
                        .iter()
                        .map(|e| e.text.len())
                        .sum::<usize>()
                        > 131072
                {
                    a.run.details.output_events.remove(0);
                }
                if first_chunk {
                    (self.notify)(a.run.clone());
                }
            }
        }
    }
    pub async fn stop(&self, id: &str) -> Result<(), String> {
        if let Some((mut run, _, _)) = self.pending.lock().map_err(|e| e.to_string())?.remove(id) {
            run.transition("cancelled")?;
            run.details.failure = Some(execution::failure(&run));
            return self.record(&run);
        }
        let tx = self
            .active
            .lock()
            .map_err(|e| e.to_string())?
            .get(id)
            .map(|a| a.stop.clone())
            .ok_or("Process is no longer running")?;
        tx.send(()).await.map_err(|e| e.to_string())
    }
    #[cfg(test)]
    pub async fn start(
        self: &Arc<Self>,
        project: &str,
        preset: &str,
        confirmation: &str,
    ) -> Result<Run, String> {
        let run = self.prepare(project, preset, None).await?;
        if run.status == "failed" {
            return Err("Preflight failed".into());
        }
        let run = self.confirm(&run.id, confirmation, true).await?;
        if run.status == "failed" {
            Err(run.details.failure.map(|f| f.summary).unwrap_or_default())
        } else {
            Ok(run)
        }
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
fn known_secrets(preset: &Preset) -> Vec<String> {
    let mut secrets: Vec<_> = std::env::vars()
        .filter(|(k, _)| {
            [
                "SECRET",
                "TOKEN",
                "PASSWORD",
                "API_KEY",
                "PRIVATE_KEY",
                "CREDENTIAL",
            ]
            .iter()
            .any(|word| k.to_uppercase().contains(word))
        })
        .map(|(_, v)| v)
        .filter(|v| !v.is_empty())
        .collect();
    secrets.extend(
        preset
            .env
            .values()
            .filter_map(|name| std::env::var(name).ok())
            .filter(|v| !v.is_empty()),
    );
    secrets.sort_by_key(|s| std::cmp::Reverse(s.len()));
    secrets.dedup();
    secrets
}
async fn execution_path() -> String {
    #[cfg(unix)]
    {
        login_shell_path()
            .await
            .unwrap_or_else(|| std::env::var("PATH").unwrap_or_default())
    }
    #[cfg(not(unix))]
    {
        std::env::var("PATH").unwrap_or_default()
    }
}
async fn group_stopped(pid: u32) -> bool {
    #[cfg(unix)]
    {
        for _ in 0..20 {
            if unsafe { libc::kill(-(pid as i32), 0) } == -1
                && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
            {
                return true;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        // Zombies have exited and cannot continue work, although their process group remains visible.
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            Command::new("ps")
                .args(["-axo", "pgid=,stat="])
                .kill_on_drop(true)
                .output(),
        )
        .await;
        match result {
            Ok(Ok(output)) if output.status.success() => {
                !String::from_utf8_lossy(&output.stdout).lines().any(|line| {
                    let fields: Vec<_> = line.split_whitespace().collect();
                    fields.first().and_then(|s| s.parse::<u32>().ok()) == Some(pid)
                        && !fields.get(1).is_some_and(|s| s.starts_with('Z'))
                })
            }
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    } // Without a verified job-object boundary, report Interrupted conservatively.
}
async fn terminate(
    child: &mut tokio::process::Child,
    pid: Option<u32>,
) -> std::io::Result<std::process::ExitStatus> {
    if let Some(pid) = pid {
        #[cfg(unix)]
        unsafe {
            libc::kill(-(pid as i32), libc::SIGTERM);
        }
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T"])
                .status()
                .await;
        }
    }
    match tokio::time::timeout(std::time::Duration::from_secs(2), child.wait()).await {
        Ok(status) => status,
        Err(_) => {
            if let Some(pid) = pid {
                kill_group(pid);
            }
            let _ = child.start_kill();
            tokio::time::timeout(std::time::Duration::from_secs(2), child.wait())
                .await
                .map_err(|_| {
                    std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "Could not confirm process termination",
                    )
                })?
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
) -> Result<(), String> {
    // Keep a trailing window so a secret split across reads cannot escape redaction.
    let mut reader = BufReader::new(reader);
    let mut pending = Vec::new();
    loop {
        let buf = reader
            .fill_buf()
            .await
            .map_err(|_| "Output pipe could not be read".to_string())?;
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
    Ok(())
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
            policy: Default::default(),
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
        for _ in 0..100 {
            if !runner.active.lock().unwrap().contains_key(&run.id) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        let history = [store.run(&run.id).unwrap().unwrap()];
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
        task.await.unwrap().unwrap();
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
            policy: Default::default(),
        });
        store.save_project(&project).unwrap();
        (dir, Runner::new(store, Arc::new(|_| {})), project)
    }
    async fn finished(runner: &Arc<Runner>, id: &str) -> Run {
        tokio::time::timeout(std::time::Duration::from_secs(12), async {
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
        assert_eq!(done.status, "cancelled", "{:?}", done.details.failure);
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
        assert!(runner
            .store
            .runs()
            .unwrap()
            .iter()
            .all(|r| r.status == "failed"));
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
        task.await.unwrap().unwrap();
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
    #[tokio::test]
    async fn review_records_preflight_and_does_not_execute_until_confirmed() {
        let (dir, runner, p) = setup("printf safe > marker.txt");
        let prepared = runner.prepare(&p.id, "lifecycle", None).await.unwrap();
        assert_eq!(prepared.status, "awaiting_confirmation");
        assert!(!dir.path().join("marker.txt").exists());
        assert_eq!(
            prepared
                .details
                .transitions
                .iter()
                .map(|t| t.state.as_str())
                .collect::<Vec<_>>(),
            ["queued", "preflighting", "awaiting_confirmation"]
        );
        let started = runner.confirm(&prepared.id, "run", false).await.unwrap();
        let done = finished(&runner, &started.id).await;
        assert_eq!(done.status, "success");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("marker.txt")).unwrap(),
            "safe"
        );
        assert!(done.details.confirmation.is_some());
        assert!(runner.confirm(&prepared.id, "run", false).await.is_err());
    }
    #[tokio::test]
    async fn missing_directory_tool_file_and_environment_are_audited_blocks() {
        for kind in ["directory", "tool", "file", "env", "configuration"] {
            let (_dir, runner, mut p) = setup("echo should-not-execute");
            match kind {
                "directory" => p.commands[0].cwd = "missing".into(),
                "tool" => p.commands[0]
                    .policy
                    .required_tools
                    .push("pitboss-nonexistent-tool-9837".into()),
                "file" => p.commands[0]
                    .policy
                    .required_files
                    .push("missing.json".into()),
                "env" => p.commands[0]
                    .policy
                    .required_env
                    .push("PITBOSS_ABSENT_TEST_VARIABLE_9837".into()),
                _ => p.commands[0].policy.risk = "unknown".into(),
            }
            runner.store.save_project(&p).unwrap();
            let run = runner.prepare(&p.id, "lifecycle", None).await.unwrap();
            assert_eq!(run.status, "failed", "{kind}");
            assert!(run.details.preflight.iter().any(|c| c.result == "blocked"));
            assert!(run.pid.is_none());
            assert!(runner.store.run(&run.id).unwrap().is_some());
        }
    }
    #[tokio::test]
    async fn configuration_changes_and_expired_confirmation_fail_closed() {
        let (dir, runner, mut p) = setup("printf initial > marker");
        let review = runner.prepare(&p.id, "lifecycle", None).await.unwrap();
        p.commands[0].command = "printf changed > marker".into();
        runner.store.save_project(&p).unwrap();
        let rejected = runner.confirm(&review.id, "run", true).await.unwrap();
        assert_eq!(
            rejected.details.failure.unwrap().category,
            "confirmation_changed"
        );
        assert!(!dir.path().join("marker").exists());
        let expired = runner.prepare(&p.id, "lifecycle", None).await.unwrap();
        runner
            .pending
            .lock()
            .unwrap()
            .get_mut(&expired.id)
            .unwrap()
            .0
            .started_at -= 300_001;
        assert_eq!(
            runner
                .confirm(&expired.id, "run", true)
                .await
                .unwrap()
                .details
                .failure
                .unwrap()
                .category,
            "confirmation_expired"
        );
        assert!(!dir.path().join("marker").exists());
    }
    #[tokio::test]
    async fn risk_and_production_confirmation_are_enforced_by_backend() {
        for risk in ["destructive", "production_critical"] {
            let (_dir, runner, mut p) = setup("true");
            p.commands[0].policy.risk = risk.into();
            runner.store.save_project(&p).unwrap();
            let review = runner.prepare(&p.id, "lifecycle", None).await.unwrap();
            assert_eq!(
                runner
                    .confirm(&review.id, "run", true)
                    .await
                    .unwrap()
                    .status,
                "failed"
            );
            let review = runner.prepare(&p.id, "lifecycle", None).await.unwrap();
            let run = runner.confirm(&review.id, &p.name, true).await.unwrap();
            assert_eq!(finished(&runner, &run.id).await.status, "success");
        }
    }
    #[tokio::test]
    async fn dirty_git_warnings_require_override_and_can_be_forbidden() {
        let (dir, runner, mut p) = setup("true");
        assert!(std::process::Command::new("git")
            .args(["init", "--quiet"])
            .current_dir(dir.path())
            .status()
            .unwrap()
            .success());
        let review = runner.prepare(&p.id, "lifecycle", None).await.unwrap();
        assert!(review
            .details
            .preflight
            .iter()
            .any(|c| c.id == "git" && c.result == "warning"));
        assert_eq!(
            runner
                .confirm(&review.id, "run", false)
                .await
                .unwrap()
                .status,
            "failed"
        );
        let review = runner.prepare(&p.id, "lifecycle", None).await.unwrap();
        let run = runner.confirm(&review.id, "run", true).await.unwrap();
        let done = finished(&runner, &run.id).await;
        assert!(done
            .details
            .confirmation
            .unwrap()
            .warning_overrides
            .contains(&"git".into()));
        p.commands[0].policy.deny_warnings = true;
        runner.store.save_project(&p).unwrap();
        assert_eq!(
            runner
                .prepare(&p.id, "lifecycle", None)
                .await
                .unwrap()
                .status,
            "failed"
        );
    }
    #[tokio::test]
    async fn timeout_preserves_partial_output_and_exit_signal() {
        let (_dir, runner, mut p) = setup("printf started; sleep 30");
        p.commands[0].policy.timeout_seconds = 1;
        runner.store.save_project(&p).unwrap();
        let run = runner.start(&p.id, "lifecycle", "run").await.unwrap();
        let done = finished(&runner, &run.id).await;
        assert_eq!(done.status, "timed_out", "{:?}", done.details.failure);
        assert!(done.output.contains("started"));
        assert_eq!(done.details.failure.unwrap().category, "timeout");
        assert!(done.ended_at.is_some());
    }
    #[tokio::test]
    async fn graceful_stop_allows_cleanup_and_cancelled_review_never_starts() {
        let (dir, runner, p) =
            setup("trap 'printf cleanup; exit 0' TERM; printf ready; while :; do sleep 0.1; done");
        let review = runner.prepare(&p.id, "lifecycle", None).await.unwrap();
        runner.stop(&review.id).await.unwrap();
        assert_eq!(
            runner.store.run(&review.id).unwrap().unwrap().status,
            "cancelled"
        );
        assert!(runner.confirm(&review.id, "run", true).await.is_err());
        let run = runner.start(&p.id, "lifecycle", "run").await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        runner.stop(&run.id).await.unwrap();
        let done = finished(&runner, &run.id).await;
        assert_eq!(done.status, "cancelled", "{:?}", done.details.failure);
        assert!(done.output.contains("cleanup"));
        assert!(dir.path().exists());
    }
    #[tokio::test]
    async fn retries_create_new_records_and_never_reuse_authorization() {
        let (_dir, runner, p) = setup("exit 7");
        let run = runner.start(&p.id, "lifecycle", "run").await.unwrap();
        let original = finished(&runner, &run.id).await;
        let retry = runner
            .prepare(&p.id, "lifecycle", Some(run.id.clone()))
            .await
            .unwrap();
        assert_ne!(run.id, retry.id);
        assert_eq!(retry.status, "awaiting_confirmation");
        assert_eq!(retry.details.retry_of.as_deref(), Some(run.id.as_str()));
        assert!(retry.details.confirmation.is_none());
        assert_eq!(
            runner.store.run(&run.id).unwrap().unwrap().output,
            original.output
        );
        assert!(runner
            .prepare(&p.id, "lifecycle", Some("unknown".into()))
            .await
            .is_err());
    }
    #[tokio::test]
    async fn project_exclusivity_is_symmetric_and_parallel_is_explicit() {
        let (_dir, runner, mut p) = setup("sleep 20");
        p.commands[0].policy.concurrency = "project".into();
        let mut second = p.commands[0].clone();
        second.id = "second".into();
        second.policy.concurrency = "parallel".into();
        p.commands.push(second);
        runner.store.save_project(&p).unwrap();
        let first = runner.start(&p.id, "lifecycle", "run").await.unwrap();
        assert!(runner.start(&p.id, "second", "run").await.is_err());
        runner.stop(&first.id).await.unwrap();
        finished(&runner, &first.id).await;
        p.commands[0].policy.concurrency = "parallel".into();
        runner.store.save_project(&p).unwrap();
        let one = runner.start(&p.id, "lifecycle", "run").await.unwrap();
        let two = runner.start(&p.id, "lifecycle", "run").await.unwrap();
        assert_ne!(one.id, two.id);
        runner.stop(&one.id).await.unwrap();
        runner.stop(&two.id).await.unwrap();
        finished(&runner, &one.id).await;
        finished(&runner, &two.id).await;
    }
    #[tokio::test]
    async fn artifact_backups_are_verified_and_missing_outputs_fail_successful_exit() {
        let (dir, runner, mut p) = setup("printf new > result.txt");
        std::fs::write(dir.path().join("result.txt"), "known-good").unwrap();
        p.commands[0].policy.expected_artifacts = vec!["result.txt".into()];
        runner.store.save_project(&p).unwrap();
        let run = runner.start(&p.id, "lifecycle", "run").await.unwrap();
        let done = finished(&runner, &run.id).await;
        assert_eq!(done.status, "success");
        assert_eq!(done.details.artifacts.len(), 2);
        assert_eq!(
            std::fs::read_to_string(&done.details.artifacts[0].path).unwrap(),
            "known-good"
        );
        assert_eq!(done.details.artifacts[1].size, 3);
        p.commands[0].policy.expected_artifacts = vec!["missing.txt".into()];
        runner.store.save_project(&p).unwrap();
        let run = runner.start(&p.id, "lifecycle", "run").await.unwrap();
        let done = finished(&runner, &run.id).await;
        assert_eq!(done.exit_code, Some(0));
        assert_eq!(done.status, "failed");
        assert_eq!(done.details.failure.unwrap().category, "artifact");
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn failed_backup_blocks_execution_and_preserves_original() {
        let (dir, runner, mut p) = setup("printf changed > original.txt");
        std::fs::write(dir.path().join("original.txt"), "known-good").unwrap();
        std::os::unix::fs::symlink("original.txt", dir.path().join("artifact.txt")).unwrap();
        p.commands[0].policy.expected_artifacts = vec!["artifact.txt".into()];
        runner.store.save_project(&p).unwrap();
        let review = runner.prepare(&p.id, "lifecycle", None).await.unwrap();
        let run = runner.confirm(&review.id, "run", true).await.unwrap();
        assert_eq!(run.status, "failed");
        assert_eq!(run.details.failure.unwrap().category, "backup");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("original.txt")).unwrap(),
            "known-good"
        );
    }
    #[tokio::test]
    async fn retention_preserves_active_records_and_removes_old_logs() {
        let (_dir, runner, p) = setup("true");
        let review = runner.prepare(&p.id, "lifecycle", None).await.unwrap();
        for index in 0..60 {
            let mut run = review.clone();
            run.id = format!("completed-{index}");
            run.status = "success".into();
            run.started_at = index;
            runner.store.save_run(&run).unwrap();
        }
        runner.store.set_retention(50).unwrap();
        assert!(runner.store.run(&review.id).unwrap().is_some());
        assert!(runner.store.run("completed-0").unwrap().is_none());
        assert_eq!(runner.store.runs().unwrap().len(), 51);
    }
    #[tokio::test]
    async fn restart_recovers_every_nonterminal_state_as_interrupted() {
        let (dir, runner, p) = setup("true");
        let template = runner.prepare(&p.id, "lifecycle", None).await.unwrap();
        for state in [
            "queued",
            "preflighting",
            "awaiting_confirmation",
            "starting",
            "running",
        ] {
            let mut run = template.clone();
            run.id = state.into();
            run.status = state.into();
            runner.store.save_run(&run).unwrap();
        }
        drop(runner);
        let store = Storage::new(&dir.path().join("history.sqlite")).unwrap();
        assert!(store
            .runs()
            .unwrap()
            .iter()
            .all(|r| r.status == "interrupted" && r.details.failure.is_some()));
    }
    #[tokio::test]
    async fn output_is_bounded_and_diagnostics_do_not_invent_a_cause() {
        let (_dir, runner, p) = setup("python3 -c 'print(\"x\" * 1200000)' ; exit 9");
        let run = runner.start(&p.id, "lifecycle", "run").await.unwrap();
        let done = finished(&runner, &run.id).await;
        assert!(done.output.len() <= 1_048_576);
        assert!(done.details.output_events.len() <= 1000);
        assert!(done.details.log_truncated);
        assert_eq!(done.details.failure.unwrap().category, "unknown");
    }
    #[tokio::test]
    async fn failed_build_keeps_backup_and_error_evidence() {
        let (dir, runner, mut p) = setup(
            "printf partial > output; printf 'error[E0308]: mismatched types\\n' >&2; exit 1",
        );
        std::fs::write(dir.path().join("output"), "last-good").unwrap();
        p.commands[0].policy.expected_artifacts = vec!["output".into()];
        runner.store.save_project(&p).unwrap();
        let run = runner.start(&p.id, "lifecycle", "run").await.unwrap();
        let done = finished(&runner, &run.id).await;
        assert_eq!(done.status, "failed");
        assert_eq!(done.exit_code, Some(1));
        let failure = done.details.failure.unwrap();
        assert_eq!(failure.category, "compilation");
        assert!(failure.evidence.contains("E0308"));
        assert_eq!(
            std::fs::read_to_string(&done.details.artifacts[0].path).unwrap(),
            "last-good"
        );
        assert!(done
            .details
            .output_events
            .iter()
            .any(|e| e.stream == "stderr" && e.at > 0));
    }
}
