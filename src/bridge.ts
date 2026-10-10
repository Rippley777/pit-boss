import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { plainText } from "./terminal-text";
import { createDemo } from "./demo";
import type { Preset, Project, Run, Snapshot } from "./types";
export const isDesktop = "__TAURI_INTERNALS__" in window;
const key = "pit-boss-demo-v1";
let demo: Snapshot;
try {
  demo = JSON.parse(localStorage.getItem(key) || "null") || createDemo();
} catch {
  demo = createDemo();
}
function upgrade(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    portAuthority: snapshot.portAuthority || {
      installed: false,
      autopilotEnabled: false,
      ready: false,
      binaryPath: null,
      detail: "Port Authority detection is available in the desktop app.",
    },
    projects: snapshot.projects.map((p) => ({
      ...p,
      suggestions: p.suggestions || [],
      commands: (p.commands || []).map((c, sortOrder) => ({
        ...c,
        description: c.description || "",
        icon: c.icon || "Terminal",
        confirmationMode:
          c.confirmationMode ||
          (c.confirmation ? ("Always" as const) : ("Never" as const)),
        dangerous: c.dangerous || false,
        pinned: c.pinned || false,
        sortOrder: c.sortOrder ?? sortOrder,
        keyboardShortcut: c.keyboardShortcut || "",
      })),
    })),
  };
}

demo = upgrade(demo);
const listeners = new Set<(run: Run) => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
function persist() {
  try {
    localStorage.setItem(key, JSON.stringify(demo));
  } catch {
    /* Demo remains usable when storage is full. */
  }
}
function notify(run: Run) {
  if (run.details) run.details.revision++;
  persist();
  listeners.forEach((fn) => fn({ ...run }));
}
export const api = {
  async snapshot(): Promise<Snapshot> {
    return isDesktop ? invoke("snapshot") : structuredClone(demo);
  },
  async refresh(): Promise<Snapshot> {
    return isDesktop ? invoke("refresh_projects") : structuredClone(demo);
  },
  async pickDirectory(startPath?: string): Promise<string | null> {
    if (!isDesktop)
      throw new Error(
        "The native folder browser is available in the desktop app. Run npm run desktop.",
      );
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose a project folder",
      defaultPath: startPath?.startsWith("/") ? startPath : undefined,
    });
    return typeof selected === "string" ? selected : null;
  },
  async detect(path: string): Promise<Project> {
    if (!isDesktop)
      throw new Error(
        "Local project detection is available in the desktop app. Run npm run desktop to connect your filesystem.",
      );
    return invoke("detect_project", { path });
  },
  async scan(path: string): Promise<Project[]> {
    if (!isDesktop)
      throw new Error(
        "Directory scanning requires the desktop app. Run npm run desktop.",
      );
    return invoke("scan_projects", { path });
  },
  async suggestions(projectId: string): Promise<Preset[]> {
    if (isDesktop) return invoke("suggest_actions", { projectId });
    return structuredClone(
      demo.projects.find((p) => p.id === projectId)?.suggestions || [],
    );
  },
  async save(project: Project): Promise<Project> {
    if (isDesktop) return invoke("save_project", { project });
    if (
      demo.projects.some((p) => p.path === project.path && p.id !== project.id)
    )
      throw new Error("This directory is already registered.");
    demo.projects = [
      ...demo.projects.filter((p) => p.id !== project.id),
      project,
    ];
    persist();
    return structuredClone(project);
  },
  async remove(projectId: string) {
    if (isDesktop) return invoke("remove_project", { projectId });
    if (
      demo.runs.some((r) => r.projectId === projectId && r.status === "running")
    )
      throw new Error("Stop running commands before removing this project.");
    demo.projects = demo.projects.filter((p) => p.id !== projectId);
    persist();
  },
  async exportLog(run: Run): Promise<void> {
    if (isDesktop) {
      await invoke("export_execution", { runId: run.id });
      return;
    }
    const href = URL.createObjectURL(
      new Blob([plainText(run.output)], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = href;
    a.download = `pit-boss-${run.id}.log`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  },
  async retention(count?: number): Promise<number> {
    if (isDesktop) return invoke("history_retention", { count });
    if (count !== undefined)
      localStorage.setItem("pit-boss-retention", String(count));
    return Number(localStorage.getItem("pit-boss-retention") || 500);
  },
  async prepare(
    projectId: string,
    presetId: string,
    retryOf?: string,
  ): Promise<Run> {
    if (isDesktop)
      return invoke("prepare_execution", { projectId, presetId, retryOf });
    const p = demo.projects.find((p) => p.id === projectId)!;
    const c = p.commands.find((c) => c.id === presetId)!;
    const r: Run = {
      id: crypto.randomUUID(),
      projectId,
      projectName: p.name,
      presetId,
      name: c.name,
      command: c.command,
      cwd: c.cwd ? `${p.path}/${c.cwd}` : p.path,
      category: c.category,
      environment: c.environment,
      branch: p.git.branch,
      commit: p.git.commit,
      startedAt: Date.now(),
      endedAt: null,
      exitCode: null,
      status: "awaiting_confirmation",
      output: "",
      pid: null,
      ports: [],
      cpu: 0,
      memory: 0,
      details: {
        revision: 1,
        transitions: [{ state: "awaiting_confirmation", at: Date.now() }],
        preflight: [
          {
            id: "demo",
            description: "Browser simulation",
            result: "skipped",
            explanation:
              "Desktop checks are simulated; no filesystem or shell access.",
            resolution: "",
            durationMs: 0,
          },
        ],
        risk:
          c.environment.toLowerCase() === "production"
            ? "production_critical"
            : c.dangerous
              ? "destructive"
              : c.policy?.risk || "caution",
        triggerSource: "manual",
        correlationId: crypto.randomUUID(),
        retryOf,
        logReference: "demo",
        logTruncated: false,
        outputEvents: [],
        artifacts: [],
      },
    };
    demo.runs.unshift(r);
    notify(r);
    return structuredClone(r);
  },
  async run(
    executionId: string,
    confirmation: string,
    warnings: boolean,
  ): Promise<Run> {
    if (isDesktop)
      return invoke("run_command", { executionId, confirmation, warnings });
    const prepared = demo.runs.find((r) => r.id === executionId);
    if (!prepared || prepared.status !== "awaiting_confirmation")
      throw new Error("Prepare a new execution review.");
    const { projectId, presetId } = prepared;
    const p = demo.projects.find((p) => p.id === projectId)!,
      c = p.commands.find((c) => c.id === presetId)!;
    if (
      !c.concurrent &&
      demo.runs.some(
        (r) =>
          r.projectId === projectId &&
          r.presetId === presetId &&
          r.status === "running",
      )
    )
      throw new Error("This command is already running.");
    const needsTyped =
      c.confirmation ||
      c.dangerous ||
      c.confirmationMode === "Always" ||
      ["destructive", "production_critical"].includes(prepared.details!.risk);
    if (confirmation !== (needsTyped ? p.name : "run"))
      throw new Error("Confirmation did not match.");
    const r = prepared;
    r.status = "running";
    r.details!.processStartedAt = Date.now();
    r.details!.revision++;
    r.details!.confirmation = {
      at: Date.now(),
      expiresAt: r.startedAt + 300000,
      warningOverrides: [],
    };
    r.output = `[DEMO] Simulating ${c.name}. No shell command is executed.\n$ ${c.command}\n\n`;
    notify(r);
    timers.set(
      r.id,
      setTimeout(() => {
        r.output += "[demo] Preparing project…\n[demo] Dependencies checked.\n";
        notify(r);
        timers.set(
          r.id,
          setTimeout(() => {
            r.output += c.persistent
              ? "[demo] Development session ready. Waiting for changes…\n"
              : "[demo] Command completed successfully.\n";
            if (!c.persistent) {
              r.status = "success";
              r.exitCode = 0;
              r.endedAt = Date.now();
            }
            notify(r);
            timers.delete(r.id);
          }, 1600),
        );
      }, 700),
    );
    return structuredClone(r);
  },
  async stop(runId: string) {
    if (isDesktop) return invoke("stop_command", { runId });
    clearTimeout(timers.get(runId));
    timers.delete(runId);
    const r = demo.runs.find((r) => r.id === runId);
    if (r) {
      r.status = "cancelled";
      r.endedAt = Date.now();
      r.ports = [];
      r.cpu = 0;
      r.memory = 0;
      r.output += "\n[demo] Process stopped.\n";
      notify(r);
    }
  },
  async subscribe(fn: (run: Run) => void): Promise<() => void> {
    if (isDesktop) return listen<Run>("run-update", (e) => fn(e.payload));
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  async open(projectId: string, target: string) {
    if (isDesktop) return invoke("open_project", { projectId, target });
    throw new Error(`Opening ${target} requires the desktop app.`);
  },
  async url(url: string) {
    if (isDesktop) return invoke("open_url", { url });
    window.open(url, "_blank", "noopener,noreferrer");
  },
  async portOwner(port: number): Promise<string> {
    return isDesktop
      ? invoke("port_owner", { port })
      : "Port inspection requires the desktop app.";
  },
  resetDemo() {
    timers.forEach(clearTimeout);
    timers.clear();
    demo = createDemo();
    persist();
    return structuredClone(demo);
  },
};
export function duration(run: Run) {
  const s = Math.max(
    0,
    Math.floor(
      ((run.endedAt ?? Date.now()) -
        (run.details?.processStartedAt ?? run.startedAt)) /
        1000,
    ),
  );
  return s < 60
    ? `${s}s`
    : s < 3600
      ? `${Math.floor(s / 60)}m ${s % 60}s`
      : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
export function ago(time: number) {
  const s = Math.max(0, Math.floor((Date.now() - time) / 1000));
  return s < 60
    ? "just now"
    : s < 3600
      ? `${Math.floor(s / 60)}m ago`
      : s < 86400
        ? `${Math.floor(s / 3600)}h ago`
        : `${Math.floor(s / 86400)}d ago`;
}
export function projectState(project: Project, runs: Run[]) {
  const own = runs.filter((r) => r.projectId === project.id);
  return own.some((r) => r.status === "running")
    ? "running"
    : own[0]?.status === "failed"
      ? "failed"
      : "stopped";
}
