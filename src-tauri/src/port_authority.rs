use crate::models::PortAuthorityStatus;
use std::path::{Path, PathBuf};

#[cfg(unix)]
use {
    serde::{Deserialize, Serialize},
    std::{
        fs,
        io::{Read, Write},
        os::{fd::AsRawFd, unix::net::UnixStream},
    },
};

#[cfg(all(test, not(unix)))]
use std::fs;

#[cfg(unix)]
const SOCKET_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(500);

pub struct CommandIntegration {
    pub binary: PathBuf,
    pub shell: PathBuf,
    pub script: String,
}

#[cfg(unix)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeEnvelope {
    version: u8,
    capture: ProbeCapture,
}

#[cfg(unix)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeCapture {
    argv: Vec<String>,
    executable: String,
    cwd: String,
    env: std::collections::BTreeMap<String, String>,
    error: String,
    exit_code: i32,
}

#[cfg(unix)]
#[derive(Deserialize)]
struct ProbeReply {
    id: Option<String>,
    error: Option<String>,
}

struct LiveAutopilot {
    enabled: bool,
    binary: Option<PathBuf>,
}

pub fn status() -> PortAuthorityStatus {
    let live = probe_live_autopilot();
    let binary = live
        .as_ref()
        .and_then(|state| state.binary.clone())
        .filter(|path| is_executable(path))
        .or_else(find_binary);
    let script = binary.as_deref().and_then(find_shell_script);
    let installed = binary.is_some();
    let autopilot_enabled = live.as_ref().is_some_and(|state| state.enabled);
    let detail = if !installed {
        "Port Authority was not found. Install the desktop app or set PORT_AUTHORITY_BIN before launching Pit Boss."
    } else if !autopilot_enabled {
        "Port Authority is installed. Open it and enable Conflict Autopilot to capture compatible dev/start commands."
    } else if script.is_none() {
        "Conflict Autopilot is enabled, but its bundled shell helper could not be found."
    } else if compatible_shell().is_none() {
        "Conflict Autopilot is enabled, but Pit Boss could not find bash or zsh."
    } else {
        "Conflict Autopilot is active for compatible npm, pnpm, yarn, and bun dev/start commands."
    };
    PortAuthorityStatus {
        installed,
        autopilot_enabled,
        ready: installed && autopilot_enabled && script.is_some() && compatible_shell().is_some(),
        binary_path: binary.map(|path| path.to_string_lossy().into_owned()),
        detail: detail.into(),
    }
}

pub fn command_integration(command: &str) -> Option<CommandIntegration> {
    let live = probe_live_autopilot()?;
    if !live.enabled {
        return None;
    }
    let binary = live
        .binary
        .filter(|path| is_executable(path))
        .or_else(find_binary)?;
    let helper = find_shell_script(&binary)?;
    let shell = compatible_shell()?;
    Some(CommandIntegration {
        binary,
        shell,
        script: format!(
            ". {}\npa_autopilot_on >/dev/null || exit $?\n{command}",
            shell_quote(&helper)
        ),
    })
}

fn find_binary() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PORT_AUTHORITY_BIN") {
        candidates.push(PathBuf::from(path));
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from(
            "/Applications/Port Authority.app/Contents/MacOS/port-authority",
        ));
        if let Some(home) = std::env::var_os("HOME") {
            candidates.push(
                PathBuf::from(home)
                    .join("Applications/Port Authority.app/Contents/MacOS/port-authority"),
            );
        }
    }
    if let Some(paths) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&paths).map(|path| path.join("port-authority")));
    }
    candidates.into_iter().find(|path| is_executable(path))
}

fn find_shell_script(binary: &Path) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(contents) = binary.parent().and_then(Path::parent) {
        candidates.push(contents.join("Resources/shell/port-authority.sh"));
    }
    if let Some(prefix) = binary.parent().and_then(Path::parent) {
        candidates.push(prefix.join("share/port-authority/shell/port-authority.sh"));
        candidates.push(prefix.join("lib/port-authority/shell/port-authority.sh"));
    }
    let mut ancestor = binary.parent();
    for _ in 0..6 {
        let Some(path) = ancestor else { break };
        candidates.push(path.join("shell/port-authority.sh"));
        ancestor = path.parent();
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn compatible_shell() -> Option<PathBuf> {
    let configured = std::env::var_os("SHELL").map(PathBuf::from);
    configured
        .filter(|path| is_supported_shell(path))
        .or_else(|| {
            ["/bin/zsh", "/bin/bash", "/usr/bin/bash"]
                .into_iter()
                .map(PathBuf::from)
                .find(|path| is_supported_shell(path))
        })
}

fn is_supported_shell(path: &Path) -> bool {
    path.is_file()
        && matches!(
            path.file_name().and_then(|name| name.to_str()),
            Some("bash" | "zsh")
        )
}

fn is_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    true
}

fn shell_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\"'\"'"))
}

#[cfg(unix)]
fn probe_live_autopilot() -> Option<LiveAutopilot> {
    // SAFETY: geteuid has no preconditions.
    let uid = unsafe { libc::geteuid() };
    if uid == 0 {
        return None;
    }
    let directory = PathBuf::from(format!("/tmp/port-authority-{uid}"));
    let socket = directory.join("autopilot.sock");
    let directory_metadata = fs::symlink_metadata(&directory).ok()?;
    let socket_metadata = fs::symlink_metadata(&socket).ok()?;
    use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
    if !directory_metadata.is_dir()
        || directory_metadata.uid() != uid
        || directory_metadata.permissions().mode() & 0o077 != 0
        || !socket_metadata.file_type().is_socket()
        || socket_metadata.uid() != uid
        || socket_metadata.permissions().mode() & 0o077 != 0
    {
        return None;
    }
    probe_socket(&socket, uid)
}

#[cfg(not(unix))]
fn probe_live_autopilot() -> Option<LiveAutopilot> {
    None
}

#[cfg(unix)]
fn probe_socket(path: &Path, expected_uid: u32) -> Option<LiveAutopilot> {
    let mut stream = UnixStream::connect(path).ok()?;
    stream.set_read_timeout(Some(SOCKET_TIMEOUT)).ok()?;
    stream.set_write_timeout(Some(SOCKET_TIMEOUT)).ok()?;
    let (peer_uid, peer_pid) = peer_identity(&stream)?;
    if peer_uid != expected_uid {
        return None;
    }
    let executable = std::env::current_exe().ok()?;
    let cwd = std::env::current_dir().ok()?;
    let request = ProbeEnvelope {
        version: 1,
        capture: ProbeCapture {
            argv: vec!["pit-boss-autopilot-status-probe".into()],
            executable: executable.to_string_lossy().into_owned(),
            cwd: cwd.to_string_lossy().into_owned(),
            env: Default::default(),
            error: String::new(),
            exit_code: 0,
        },
    };
    let bytes = serde_json::to_vec(&request).ok()?;
    stream.write_all(&bytes).ok()?;
    stream.shutdown(std::net::Shutdown::Write).ok()?;
    let mut response = Vec::new();
    (&mut stream).take(16_384).read_to_end(&mut response).ok()?;
    let reply: ProbeReply = serde_json::from_slice(&response).ok()?;
    let enabled = reply.id.is_some()
        || reply
            .error
            .as_deref()
            .is_some_and(|error| error.contains("Only failed commands"));
    Some(LiveAutopilot {
        enabled,
        binary: process_executable(peer_pid),
    })
}

#[cfg(target_os = "macos")]
fn peer_identity(stream: &UnixStream) -> Option<(u32, i32)> {
    let mut uid = 0;
    let mut gid = 0;
    let mut pid: libc::pid_t = 0;
    let mut pid_size = std::mem::size_of::<libc::pid_t>() as libc::socklen_t;
    // SAFETY: stream owns a valid connected socket and the output buffers have exact sizes.
    let valid = unsafe {
        libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) == 0
            && libc::getsockopt(
                stream.as_raw_fd(),
                libc::SOL_LOCAL,
                libc::LOCAL_PEERPID,
                (&mut pid as *mut libc::pid_t).cast(),
                &mut pid_size,
            ) == 0
    };
    valid.then_some((uid, pid))
}

#[cfg(target_os = "linux")]
fn peer_identity(stream: &UnixStream) -> Option<(u32, i32)> {
    let mut credentials: libc::ucred = unsafe { std::mem::zeroed() };
    let mut size = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    // SAFETY: stream owns a valid connected socket and the credential buffer has the exact size.
    let valid = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut credentials as *mut libc::ucred).cast(),
            &mut size,
        ) == 0
    };
    valid.then_some((credentials.uid, credentials.pid))
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn peer_identity(_stream: &UnixStream) -> Option<(u32, i32)> {
    None
}

#[cfg(target_os = "macos")]
fn process_executable(pid: i32) -> Option<PathBuf> {
    use std::os::unix::ffi::OsStringExt;
    let mut buffer = vec![0_u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    // SAFETY: the buffer is writable for the declared size and pid came from the kernel.
    let length =
        unsafe { libc::proc_pidpath(pid, buffer.as_mut_ptr().cast(), buffer.len() as u32) };
    if length <= 0 {
        return None;
    }
    buffer.truncate(length as usize);
    Some(PathBuf::from(std::ffi::OsString::from_vec(buffer)))
}

#[cfg(target_os = "linux")]
fn process_executable(pid: i32) -> Option<PathBuf> {
    fs::read_link(format!("/proc/{pid}/exe")).ok()
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn process_executable(_pid: i32) -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locates_the_helper_in_a_macos_bundle_and_quotes_it() {
        let directory = tempfile::tempdir().unwrap();
        let contents = directory.path().join("Port Authority's.app/Contents");
        let binary = contents.join("MacOS/port-authority");
        let helper = contents.join("Resources/shell/port-authority.sh");
        fs::create_dir_all(binary.parent().unwrap()).unwrap();
        fs::create_dir_all(helper.parent().unwrap()).unwrap();
        fs::write(&binary, "binary").unwrap();
        fs::write(&helper, "helper").unwrap();
        assert_eq!(find_shell_script(&binary), Some(helper.clone()));
        assert_eq!(
            shell_quote(&helper),
            format!("'{}'", helper.to_string_lossy().replace('\'', "'\"'\"'"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn status_probe_distinguishes_enabled_from_disabled_without_a_capture() {
        use std::os::unix::fs::PermissionsExt;
        use std::os::unix::net::UnixListener;

        fn serve(reply: &'static str) -> LiveAutopilot {
            let directory = tempfile::tempdir().unwrap();
            fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700)).unwrap();
            let socket = directory.path().join("autopilot.sock");
            let listener = UnixListener::bind(&socket).unwrap();
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = Vec::new();
                stream.read_to_end(&mut request).unwrap();
                let request: serde_json::Value = serde_json::from_slice(&request).unwrap();
                assert_eq!(request["capture"]["exitCode"], 0);
                stream.write_all(reply.as_bytes()).unwrap();
            });
            // SAFETY: geteuid has no preconditions.
            let state = probe_socket(&socket, unsafe { libc::geteuid() }).unwrap();
            server.join().unwrap();
            state
        }

        let disabled =
            serve(r#"{"id":null,"error":"Enable Conflict Autopilot before capturing commands."}"#);
        assert!(!disabled.enabled);
        let enabled =
            serve(r#"{"id":null,"error":"Only failed commands can be registered as conflicts."}"#);
        assert!(enabled.enabled);
    }
}
