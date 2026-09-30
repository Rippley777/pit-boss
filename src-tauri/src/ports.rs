use std::process::Command;
#[derive(Default)]
pub struct Metrics {
    pub ports: Vec<u16>,
    pub cpu: f64,
    pub memory: u64,
}
/// Inspect the entire process group, including servers spawned by npm/cargo.
pub fn inspect(pid: u32) -> Metrics {
    let mut metrics = Metrics::default();
    #[cfg(unix)]
    {
        let mut pids = vec![pid.to_string()];
        if let Ok(out) = Command::new("ps")
            .args(["-axo", "pid=,pgid=,%cpu=,rss="])
            .output()
        {
            for row in String::from_utf8_lossy(&out.stdout).lines() {
                let p: Vec<_> = row.split_whitespace().collect();
                if p.len() == 4 && p[1].parse::<u32>().ok() == Some(pid) {
                    pids.push(p[0].into());
                    metrics.cpu += p[2].parse::<f64>().unwrap_or(0.0);
                    metrics.memory += p[3].parse::<u64>().unwrap_or(0) * 1024;
                }
            }
        }
        pids.sort();
        pids.dedup();
        if let Ok(out) = Command::new("lsof")
            .args([
                "-nP",
                "-a",
                "-p",
                &pids.join(","),
                "-iTCP",
                "-sTCP:LISTEN",
                "-Fn",
            ])
            .output()
        {
            for line in String::from_utf8_lossy(&out.stdout)
                .lines()
                .filter(|s| s.starts_with('n'))
            {
                if let Some(port) = line.rsplit(':').next().and_then(|s| s.parse::<u16>().ok()) {
                    metrics.ports.push(port);
                }
            }
        }
    }
    metrics.ports.sort();
    metrics.ports.dedup();
    metrics
}
pub fn conflict_owner(port: u16) -> String {
    Command::new("lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_else(|_| "Port inspection requires lsof on this platform.".into())
}

/// Extract a port only from an explicit bind-error address or port argument.
pub fn conflict_port(output: &str, command: &str) -> Option<u16> {
    let lower = output.to_lowercase();
    if !lower.contains("eaddrinuse")
        && !lower.contains("address already in use")
        && !lower.contains("port is already in use")
    {
        return None;
    }
    for line in lower.lines().filter(|line| {
        line.contains("address") || line.contains("port") || line.contains("eaddrinuse")
    }) {
        for piece in line.split(':').skip(1) {
            let digits: String = piece
                .trim_start()
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(port) = digits.parse::<u16>() {
                if port != 0 {
                    return Some(port);
                }
            }
        }
    }
    let args: Vec<_> = command.split_whitespace().collect();
    for pair in args.windows(2) {
        if ["--port", "-p", "http.server"].contains(&pair[0]) {
            if let Ok(port) = pair[1].parse::<u16>() {
                return Some(port);
            }
        }
    }
    None
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_conflicting_address_without_confusing_errno_for_port() {
        assert_eq!(
            conflict_port(
                "Error: listen EADDRINUSE: address already in use :::3000",
                "npm run dev"
            ),
            Some(3000)
        );
        assert_eq!(
            conflict_port(
                "OSError: [Errno 48] Address already in use",
                "python3 -m http.server 8080"
            ),
            Some(8080)
        );
        assert_eq!(
            conflict_port(
                "OSError: [Errno 48] Address already in use",
                "python3 app.py"
            ),
            None
        );
        assert_eq!(conflict_port("Listening:3000", "npm run dev"), None);
    }
}
