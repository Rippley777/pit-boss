import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Blocks,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command,
  Cpu,
  Folder,
  FolderSearch,
  GitBranch,
  LayoutDashboard,
  LayoutGrid,
  List,
  LoaderCircle,
  MoreHorizontal,
  Network,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  Square,
  Star,
  Terminal as TerminalIcon,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Page, Project, Run, RunRequest, Snapshot } from "./types";
import { ago, api, isDesktop, projectState } from "./bridge";
import { mergeRuns } from "./run-state";
import {
  ActivityIcon,
  Branch,
  Empty,
  Logo,
  Modal,
  ProjectIcon,
  SectionHeading,
  Shortcut,
  StatusBadge,
} from "./components/ui";
import ProjectCard from "./components/ProjectCard";
import Terminal from "./components/Terminal";
import ProjectDetail, { RunTable } from "./components/ProjectDetail";
import {
  AddProjectDialog,
  CommandDialog,
  Palette,
  RunDialog,
} from "./components/Dialogs";

const navigation = [
  { name: "The Pit", icon: Radio },
  { name: "Dashboard", icon: LayoutDashboard },
  { name: "Projects", icon: Folder },
  { name: "Runs", icon: TerminalIcon },
  { name: "Deployments", icon: Rocket },
  { name: "Activity", icon: Activity },
] as const;
export default function App() {
  const [data, setData] = useState<Snapshot>({ projects: [], runs: [] }),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState<Page>("The Pit"),
    [projectId, setProjectId] = useState<string | null>(null),
    [actionProjectId, setActionProjectId] = useState<string | null>(null);
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [group, setGroup] = useState("All projects"),
    [view, setView] = useState<"grid" | "table">(() =>
      localStorage.getItem("pit-boss-view") === "table" ? "table" : "grid",
    ),
    [favorites, setFavorites] = useState(false);
  const [palette, setPalette] = useState(false),
    [add, setAdd] = useState<"add" | "scan" | null>(null),
    [requests, setRequests] = useState<RunRequest[]>([]),
    [terminal, setTerminal] = useState<string | null>(null),
    [toast, setToast] = useState<{ text: string; error: boolean } | null>(null),
    [refreshing, setRefreshing] = useState(false),
    [groupMenu, setGroupMenu] = useState(false),
    [remove, setRemove] = useState<Project | null>(null),
    [help, setHelp] = useState(false),
    [owner, setOwner] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now()),
    [autoRefresh, setAutoRefresh] = useState(
      () => localStorage.getItem("pit-boss-refresh") !== "off",
    );
  const notify = useCallback(
    (text: string, error = false) => setToast({ text, error }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const release = await api.subscribe((run) => {
          if (!disposed)
            setData((d) => ({
              ...d,
              runs: mergeRuns(d.runs, [run]),
            }));
        });
        if (disposed) {
          release();
          return;
        }
        unlisten = release;
        const snapshot = await api.snapshot();
        if (!disposed) {
          setData((d) => ({
            ...snapshot,
            runs: mergeRuns(d.runs, snapshot.runs),
          }));
          if (!isDesktop)
            setTerminal(
              snapshot.runs.find((r) => r.status === "running")?.id || null,
            );
        }
      } catch (e) {
        notify(String(e), true);
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [notify]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable='true']")
      )
        return;
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return;
      const key = e.key.toUpperCase();
      const match = data.projects
        .flatMap((project) =>
          project.commands.map((preset) => ({ project, preset })),
        )
        .find(({ preset }) => preset.keyboardShortcut?.toUpperCase() === key);
      if (match) {
        e.preventDefault();
        request(match);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [data.projects]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await api.refresh();
      setData((d) => ({
        projects: next.projects,
        runs: mergeRuns(d.runs, next.runs),
      }));
    } catch (e) {
      notify(String(e), true);
    } finally {
      setRefreshing(false);
    }
  }, [notify]);
  useEffect(() => {
    if (!autoRefresh || !isDesktop) return;
    const t = setInterval(() => void refresh(), 30000);
    return () => clearInterval(t);
  }, [autoRefresh, refresh]);
  function navigate(next: Page) {
    setPage(next);
    setProjectId(null);
    setSearch("");
    setStatus("all");
  }
  const save = useCallback(
    async (p: Project) => {
      try {
        const saved = await api.save(p);
        setData((d) => ({
          ...d,
          projects: d.projects.some((p) => p.id === saved.id)
            ? d.projects.map((p) => (p.id === saved.id ? saved : p))
            : [...d.projects, saved],
        }));
      } catch (e) {
        notify(String(e), true);
        throw e;
      }
    },
    [notify],
  );
  function request(r: RunRequest) {
    setRequests([r]);
  }
  async function stop(run: Run) {
    try {
      await api.stop(run.id);
      notify(`${run.projectName}: stop requested`);
    } catch (e) {
      notify(String(e), true);
    }
  }
  async function confirmRun(items: RunRequest[]) {
    const results = await Promise.allSettled(
      items.map(async ({ project, preset, restart }) => {
        if (restart?.status === "running") {
          await api.stop(restart.id);
          for (let i = 0; i < 50; i++) {
            const snapshot = await api.snapshot();
            if (
              !snapshot.runs.some(
                (r) => r.id === restart.id && r.status === "running",
              )
            )
              break;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        const run = await api.run(
          project.id,
          preset.id,
          preset.confirmation ||
            preset.dangerous ||
            preset.confirmationMode === "Always" ||
            preset.environment.toLowerCase() === "production"
            ? project.name
            : "run",
        );
        setData((d) => ({
          ...d,
          runs: mergeRuns(d.runs, [run], true),
        }));
        setTerminal(run.id);
        return run;
      }),
    );
    const errors = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (errors.length) {
      setRequests(items.filter((_, i) => results[i].status === "rejected"));
      throw new Error(
        `${errors.length} command(s) could not start: ${errors.map((e) => String(e.reason)).join("; ")}`,
      );
    }
  }
  function rerun(run: Run) {
    const project = data.projects.find((p) => p.id === run.projectId),
      preset = project?.commands.find((c) => c.id === run.presetId);
    if (project && preset)
      request({
        project,
        preset,
        restart: run.status === "running" ? run : undefined,
      });
    else
      notify(
        "This preset no longer exists. Create a new command in project settings.",
        true,
      );
  }
  function open(p: Project, target: string) {
    void api.open(p.id, target).catch((e) => notify(String(e), true));
  }
  function url(url: string) {
    void api.url(url).catch((e) => notify(String(e), true));
  }
  function copy(text: string) {
    void navigator.clipboard.writeText(text).then(
      () => notify("Copied to clipboard"),
      (e) => notify(String(e), true),
    );
  }
  const running = data.runs.filter((r) => r.status === "running"),
    groups = [...new Set(data.projects.map((p) => p.group))];
  const scoped = data.projects.filter(
    (p) => group === "All projects" || p.group === group,
  );
  const visible = scoped.filter(
    (p) =>
      (!favorites || p.favorite) &&
      (status === "all" || projectState(p, data.runs) === status) &&
      `${p.name} ${p.path} ${p.technologies.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const failures = data.projects.filter(
      (p) => projectState(p, data.runs) === "failed",
    ).length,
    ports = running.flatMap((r) => r.ports.map((port) => ({ port, run: r }))),
    deployments = data.runs.filter((r) => r.category === "Deploy");
  const selected = data.projects.find((p) => p.id === projectId),
    actionProject = data.projects.find((p) => p.id === actionProjectId),
    memory = running.reduce((sum, r) => sum + r.memory, 0),
    cpu = running.reduce((sum, r) => sum + r.cpu, 0);
  const filteredRuns = useMemo(
    () =>
      data.runs.filter(
        (r) =>
          (page !== "Deployments" || r.category === "Deploy") &&
          (status === "all" || r.status === status) &&
          (group === "All projects" ||
            data.projects.find((p) => p.id === r.projectId)?.group === group) &&
          `${r.projectName} ${r.name} ${r.command} ${r.branch} ${r.environment} ${r.output}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [data, page, status, group, search],
  );
  function batch(category: string) {
    setGroupMenu(false);
    const items = scoped.flatMap((project) => {
      const preset = project.commands.find((c) =>
        category === "Pull"
          ? c.command === "git pull --ff-only"
          : c.category === category,
      );
      return preset &&
        !running.some(
          (r) =>
            r.projectId === project.id &&
            r.presetId === preset.id &&
            !preset.concurrent,
        )
        ? [{ project, preset }]
        : [];
    });
    if (!items.length)
      notify(
        "No eligible presets in this pit. Add a command or stop the existing run first.",
      );
    else setRequests(items);
  }
  const runAction = {
    onRun: request,
    onStop: (r: Run) => void stop(r),
    onLogs: (r: Run) => setTerminal(r.id),
    onSave: (p: Project) => {
      void save(p).catch(() => {});
    },
    onOpen: open,
    onUrl: url,
    onAddAction: (p: Project) => setActionProjectId(p.id),
  };
  const time = new Date(now).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <div>
            <span>PIT BOSS</span>
            <small>RUN THE HOUSE.</small>
          </div>
        </div>
        <button
          className="workspace-switch"
          onClick={() => {
            setGroup(
              group === "All projects" && groups.length
                ? groups[0]
                : "All projects",
            );
          }}
        >
          <span className="workspace-avatar">O</span>
          <span>
            <strong>Local workspace</strong>
            <small>{isDesktop ? "On this machine" : "Demo workspace"}</small>
          </span>
          <ChevronDown size={13} />
        </button>
        <button className="sidebar-search" onClick={() => setPalette(true)}>
          <Search size={14} />
          <span>Quick command</span>
          <Shortcut>⌘ K</Shortcut>
        </button>
        <div className="nav-section-label">WORKSPACE</div>
        <nav>
          {navigation.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`nav-item ${page === name && !selected ? "active" : ""}`}
              onClick={() => navigate(name)}
            >
              <Icon size={17} />
              <span>{name}</span>
              {name === "The Pit" && <span className="nav-live-dot" />}
              {name === "Projects" && (
                <span className="nav-count">{data.projects.length}</span>
              )}
              {name === "Runs" && running.length > 0 && (
                <span className="nav-count running-count">
                  {running.length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-section-label pits-label">
          YOUR PITS
          <button
            className="icon-btn"
            title="Create a pit in project settings"
            aria-label="Manage pits"
            onClick={() => {
              navigate("Projects");
              notify("Open a project → Settings to create or assign its pit.");
            }}
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="pit-links">
          {groups.map((g) => (
            <button
              className={group === g ? "selected" : ""}
              key={g}
              onClick={() => {
                setGroup(group === g ? "All projects" : g);
                navigate("The Pit");
              }}
            >
              <span className="pit-dot" />
              {g}
              <span>{data.projects.filter((p) => p.group === g).length}</span>
            </button>
          ))}
          <button
            onClick={() => {
              setFavorites(!favorites);
              navigate("Dashboard");
            }}
            className={favorites ? "selected" : ""}
          >
            <Star size={13} />
            Favorites
            <span>{data.projects.filter((p) => p.favorite).length}</span>
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="system-status">
            <span className="tiny-dot running" />
            <span>
              {isDesktop ? "Local engine connected" : "Interactive demo"}
              <small>
                {isDesktop
                  ? `${running.length} active processes`
                  : "No local commands executed"}
              </small>
            </span>
            <Activity size={15} />
          </div>
          <button
            className={`nav-item ${page === "Settings" ? "active" : ""}`}
            onClick={() => navigate("Settings")}
          >
            <Settings size={17} />
            <span>Settings</span>
          </button>
          <button className="nav-item" onClick={() => setHelp(true)}>
            <CircleHelp size={17} />
            <span>Help & shortcuts</span>
            <ArrowUpRight size={12} />
          </button>
          <div className="sidebar-version">
            <Logo small />
            <span>
              Pit Boss <span className="muted">v0.1.0</span>
            </span>
            <span className="local-tag">LOCAL</span>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <span className="breadcrumb-active">
              {selected ? selected.name : page}
            </span>
            {page === "The Pit" && !selected && (
              <span className="live-label">
                <span className="tiny-dot running" /> LIVE
              </span>
            )}
          </div>
          <div className="topbar-right">
            <span className="machine">
              <span className="tiny-dot running" />
              {isDesktop ? "Local machine" : "Demo mode"}
            </span>
            <span className="topbar-divider" />
            <button
              className="icon-btn"
              title="Command center"
              aria-label="Open command center"
              onClick={() => setPalette(true)}
            >
              <Command size={16} />
            </button>
            <button
              className="notification-btn icon-btn"
              title="Activity"
              aria-label="View activity"
              onClick={() => navigate("Activity")}
            >
              <Bell size={16} />
              {failures > 0 && <span />}
            </button>
            <span className="user-avatar">O</span>
          </div>
        </header>
        <main className="main-scroll">
          <div className="page-content">
            {selected ? (
              <ProjectDetail
                key={selected.id}
                project={selected}
                runs={data.runs}
                onBack={() => setProjectId(null)}
                onRun={request}
                onSave={save}
                onRemove={setRemove}
                onLogs={(r) => setTerminal(r.id)}
                onStop={(r) => void stop(r)}
                onOpen={open}
                onUrl={url}
                onCopy={copy}
                onAddAction={(p) => setActionProjectId(p.id)}
              />
            ) : (
              <>
                <div className="page-heading">
                  <div className="heading-copy">
                    <div className="eyebrow">
                      {page === "The Pit"
                        ? "YOUR LOCAL OPERATIONS CENTER"
                        : "RUN THE HOUSE."}
                    </div>
                    <h1>
                      {page}
                      <span className="heading-period">.</span>
                      {page === "The Pit" && (
                        <span className="heading-live">
                          <span className="tiny-dot running" /> All eyes on your
                          stack
                        </span>
                      )}
                    </h1>
                    <p>
                      {
                        {
                          "The Pit":
                            "Every project. Every process. One place to call the shots.",
                          Dashboard:
                            "A clear view of everything you’re building.",
                          Projects: "Your projects, ready when you are.",
                          Runs: "Every command has a story. This is the record.",
                          Deployments:
                            "From your machine to the world. Keep every release in sight.",
                          Activity: "The pulse of your local workspace.",
                          Settings: "Make yourself at home.",
                        }[page]
                      }
                    </p>
                  </div>
                  <div className="page-heading-actions">
                    <button
                      className={`button secondary refresh-button ${refreshing ? "is-refreshing" : ""}`}
                      aria-label="Refresh workspace"
                      title="Refresh workspace"
                      onClick={() => void refresh()}
                      disabled={refreshing}
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => setAdd("scan")}
                    >
                      <FolderSearch size={14} /> Scan projects
                    </button>
                    <button
                      className="button primary"
                      onClick={() => setAdd("add")}
                    >
                      <Plus size={15} /> Add project
                    </button>
                  </div>
                </div>
                {loading ? (
                  <div className="loading-state">
                    <LoaderCircle className="spin" size={26} /> Connecting to
                    your workspace…
                  </div>
                ) : (
                  <>
                    {["The Pit", "Dashboard", "Projects"].includes(page) && (
                      <>
                        {page !== "Projects" && (
                          <div className="stats-grid">
                            <div className="stat-card">
                              <span className="stat-label">
                                <Blocks size={14} /> Total projects
                              </span>
                              <div className="stat-value">
                                {data.projects.length
                                  .toString()
                                  .padStart(2, "0")}
                                <span className="stat-note">
                                  across {groups.length} pit
                                  {groups.length !== 1 ? "s" : ""}
                                </span>
                              </div>
                              <div className="stat-bottom">
                                <span className="stat-mini-blocks">
                                  {Array.from(
                                    {
                                      length: Math.max(
                                        12,
                                        data.projects.length,
                                      ),
                                    },
                                    (_, i) => (
                                      <i
                                        key={i}
                                        className={
                                          i < data.projects.length
                                            ? "filled"
                                            : ""
                                        }
                                      />
                                    ),
                                  )}
                                </span>
                                <span>Ready to work</span>
                              </div>
                            </div>
                            <div className="stat-card">
                              <span className="stat-label">
                                <Zap size={14} /> Running now
                                <span className="tiny-dot running" />
                              </span>
                              <div className="stat-value lime">
                                {running.length.toString().padStart(2, "0")}
                                <span className="stat-note">
                                  active processes
                                </span>
                              </div>
                              <div className="stat-bottom">
                                <span className="lime">
                                  <Activity size={12} /> {ports.length} ports
                                  listening
                                </span>
                                <span className="mini-bars">
                                  {[
                                    7, 12, 9, 16, 11, 20, 14, 24, 18, 27, 20,
                                    17,
                                  ].map((h, i) => (
                                    <i
                                      key={i}
                                      style={{ height: running.length ? h : 3 }}
                                    />
                                  ))}
                                </span>
                              </div>
                            </div>
                            <div className="stat-card">
                              <span className="stat-label">
                                <Rocket size={14} /> Deployments
                                <span className="stat-period">24h</span>
                              </span>
                              <div className="stat-value">
                                {deployments
                                  .filter((r) => now - r.startedAt < 86400000)
                                  .length.toString()
                                  .padStart(2, "0")}
                                <span className="stat-note">
                                  deployments launched
                                </span>
                              </div>
                              <div className="stat-bottom">
                                <span>
                                  <Check size={12} className="lime" />{" "}
                                  {
                                    deployments.filter(
                                      (r) => r.status === "success",
                                    ).length
                                  }{" "}
                                  successful
                                </span>
                                <span className="muted">
                                  {
                                    deployments.filter(
                                      (r) => r.status === "failed",
                                    ).length
                                  }{" "}
                                  failed
                                </span>
                              </div>
                            </div>
                            <div className="stat-card">
                              <span className="stat-label">
                                <Cpu size={14} /> Resource usage
                              </span>
                              <div className="stat-value">
                                {memory >= 1073741824
                                  ? (memory / 1073741824).toFixed(1)
                                  : Math.round(memory / 1048576)}
                                <span className="stat-unit">
                                  {memory >= 1073741824 ? "GB" : "MB"}
                                </span>
                                <span className="stat-note">memory</span>
                              </div>
                              <div className="stat-bottom">
                                <span>
                                  <span className="tiny-dot running" />
                                  {cpu.toFixed(1)}% CPU
                                </span>
                                <span>
                                  {isDesktop
                                    ? "Tracked processes"
                                    : "Illustrative metrics"}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                        <div className="operations-layout">
                          <section className="projects-section">
                            <div className="project-controls">
                              <div className="project-control-title">
                                <h2>
                                  {page === "The Pit"
                                    ? "On the floor"
                                    : "Your projects"}
                                  <span className="count">
                                    {visible.length}
                                  </span>
                                </h2>
                                <select
                                  aria-label="Select pit"
                                  value={group}
                                  onChange={(e) => setGroup(e.target.value)}
                                >
                                  <option>All projects</option>
                                  {groups.map((g) => (
                                    <option key={g}>{g}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="project-control-actions">
                                <button
                                  className="start-all"
                                  onClick={() => batch("Development")}
                                >
                                  <Play size={11} fill="currentColor" /> Start
                                  all
                                </button>
                                <div className="menu-wrap">
                                  <button
                                    className="icon-btn"
                                    aria-label="Group actions"
                                    onClick={() => setGroupMenu(!groupMenu)}
                                  >
                                    <MoreHorizontal size={17} />
                                  </button>
                                  {groupMenu && (
                                    <>
                                      <button
                                        className="menu-dismiss"
                                        aria-label="Close group actions"
                                        onClick={() => setGroupMenu(false)}
                                      />
                                      <div className="dropdown">
                                        {[
                                          "Development",
                                          "Build",
                                          "Test",
                                          "Pull",
                                        ].map((c) => (
                                          <button
                                            key={c}
                                            onClick={() => batch(c)}
                                          >
                                            {c === "Development" ? "Start" : c}{" "}
                                            all
                                            <Play size={11} />
                                          </button>
                                        ))}
                                        <button
                                          onClick={() => {
                                            setGroupMenu(false);
                                            void Promise.all(
                                              running
                                                .filter((r) =>
                                                  scoped.some(
                                                    (p) => p.id === r.projectId,
                                                  ),
                                                )
                                                .map(stop),
                                            );
                                          }}
                                        >
                                          Stop all
                                          <Square size={11} />
                                        </button>
                                        <button
                                          onClick={() => {
                                            setGroupMenu(false);
                                            void refresh();
                                          }}
                                        >
                                          Check Git status
                                          <GitBranch size={12} />
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="filter-bar">
                              <div className="status-filters">
                                {[
                                  ["all", "All", scoped.length],
                                  [
                                    "running",
                                    "Running",
                                    scoped.filter(
                                      (p) =>
                                        projectState(p, data.runs) ===
                                        "running",
                                    ).length,
                                  ],
                                  [
                                    "stopped",
                                    "Stopped",
                                    scoped.filter(
                                      (p) =>
                                        projectState(p, data.runs) ===
                                        "stopped",
                                    ).length,
                                  ],
                                  [
                                    "failed",
                                    "Needs attention",
                                    scoped.filter(
                                      (p) =>
                                        projectState(p, data.runs) === "failed",
                                    ).length,
                                  ],
                                ].map(([value, label, count]) => (
                                  <button
                                    key={value}
                                    className={status === value ? "active" : ""}
                                    onClick={() => setStatus(String(value))}
                                  >
                                    {value === "running" && (
                                      <span className="tiny-dot running" />
                                    )}
                                    {label}
                                    <span
                                      className={
                                        value === "failed" && Number(count)
                                          ? "alert-count"
                                          : ""
                                      }
                                    >
                                      {count}
                                    </span>
                                  </button>
                                ))}
                              </div>
                              <div className="view-controls">
                                <button
                                  className={`icon-btn ${favorites ? "active" : ""}`}
                                  title="Favorites only"
                                  aria-label="Favorites only"
                                  onClick={() => setFavorites(!favorites)}
                                >
                                  <Star
                                    size={13}
                                    fill={favorites ? "currentColor" : "none"}
                                  />
                                </button>
                                <span />
                                <button
                                  className={`icon-btn ${view === "grid" ? "active" : ""}`}
                                  aria-label="Grid view"
                                  onClick={() => {
                                    setView("grid");
                                    localStorage.setItem(
                                      "pit-boss-view",
                                      "grid",
                                    );
                                  }}
                                >
                                  <LayoutGrid size={14} />
                                </button>
                                <button
                                  className={`icon-btn ${view === "table" ? "active" : ""}`}
                                  aria-label="Table view"
                                  onClick={() => {
                                    setView("table");
                                    localStorage.setItem(
                                      "pit-boss-view",
                                      "table",
                                    );
                                  }}
                                >
                                  <List size={15} />
                                </button>
                              </div>
                            </div>
                            {page === "Projects" && (
                              <div className="history-toolbar">
                                <Search size={15} />
                                <input
                                  aria-label="Search projects"
                                  placeholder="Search projects, paths, technologies…"
                                  value={search}
                                  onChange={(e) => setSearch(e.target.value)}
                                />
                              </div>
                            )}
                            {visible.length ? (
                              view === "grid" ? (
                                <div className="project-grid">
                                  {visible.map((p) => (
                                    <ProjectCard
                                      key={p.id}
                                      project={p}
                                      runs={data.runs}
                                      onDetail={() => setProjectId(p.id)}
                                      {...runAction}
                                    />
                                  ))}
                                </div>
                              ) : (
                                <div className="table-wrap">
                                  <table className="data-table project-table">
                                    <thead>
                                      <tr>
                                        <th>Project</th>
                                        <th>Status</th>
                                        <th>Branch</th>
                                        <th>Port</th>
                                        <th>Actions</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {visible.map((p) => {
                                        const run = running.find(
                                            (r) => r.projectId === p.id,
                                          ),
                                          dev = p.commands.find(
                                            (c) => c.category === "Development",
                                          );
                                        return (
                                          <tr key={p.id}>
                                            <td>
                                              <button
                                                className="table-project"
                                                onClick={() =>
                                                  setProjectId(p.id)
                                                }
                                              >
                                                <ProjectIcon
                                                  project={p}
                                                  small
                                                />
                                                <span>
                                                  <strong>{p.name}</strong>
                                                  <small>
                                                    {p.technologies.join(" · ")}
                                                  </small>
                                                </span>
                                              </button>
                                            </td>
                                            <td>
                                              <StatusBadge
                                                status={projectState(
                                                  p,
                                                  data.runs,
                                                )}
                                              />
                                            </td>
                                            <td>
                                              <Branch project={p} />
                                            </td>
                                            <td>
                                              {run?.ports.map((port) => (
                                                <button
                                                  className="text-link mono"
                                                  key={port}
                                                  onClick={() =>
                                                    url(
                                                      `http://localhost:${port}`,
                                                    )
                                                  }
                                                >
                                                  :{port}
                                                </button>
                                              )) || "—"}
                                            </td>
                                            <td>
                                              <div className="table-actions">
                                                <button
                                                  aria-label={`Run ${p.name}`}
                                                  className="icon-btn"
                                                  disabled={!dev}
                                                  onClick={() =>
                                                    dev &&
                                                    request({
                                                      project: p,
                                                      preset: dev,
                                                      restart: run,
                                                    })
                                                  }
                                                >
                                                  <Play size={13} />
                                                </button>
                                                <button
                                                  aria-label={`Logs ${p.name}`}
                                                  className="icon-btn"
                                                  disabled={
                                                    !data.runs.find(
                                                      (r) =>
                                                        r.projectId === p.id,
                                                    )
                                                  }
                                                  onClick={() =>
                                                    setTerminal(
                                                      data.runs.find(
                                                        (r) =>
                                                          r.projectId === p.id,
                                                      )?.id || null,
                                                    )
                                                  }
                                                >
                                                  <TerminalIcon size={13} />
                                                </button>
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )
                            ) : (
                              <Empty
                                title={
                                  data.projects.length
                                    ? "No projects match this view"
                                    : "Your floor is open"
                                }
                                icon={Blocks}
                              >
                                {data.projects.length ? (
                                  <button
                                    className="text-link"
                                    onClick={() => {
                                      setStatus("all");
                                      setFavorites(false);
                                      setSearch("");
                                      setGroup("All projects");
                                    }}
                                  >
                                    Reset filters
                                  </button>
                                ) : (
                                  <>
                                    <p>
                                      Bring your first project to the table.
                                    </p>
                                    <button
                                      className="button primary"
                                      onClick={() => setAdd("add")}
                                    >
                                      <Plus size={14} /> Add a project
                                    </button>
                                  </>
                                )}
                              </Empty>
                            )}
                            <div className="floor-footer">
                              <span>
                                <ShieldCheck size={12} /> Commands stay local.
                                You're in control.
                              </span>
                              <button
                                className="text-link"
                                onClick={() => setPalette(true)}
                              >
                                Open command center <Shortcut>⌘ K</Shortcut>
                              </button>
                            </div>
                          </section>
                          {page !== "Projects" && (
                            <aside className="operations-rail">
                              <section className="activity-panel panel">
                                <SectionHeading title="Recent activity">
                                  <button
                                    className="icon-btn"
                                    aria-label="All activity"
                                    onClick={() => navigate("Activity")}
                                  >
                                    <ArrowUpRight size={14} />
                                  </button>
                                </SectionHeading>
                                <div className="activity-list">
                                  {data.runs.slice(0, 6).map((r) => (
                                    <button
                                      className="activity-item"
                                      key={r.id}
                                      onClick={() => setTerminal(r.id)}
                                    >
                                      <ActivityIcon status={r.status} />
                                      <span>
                                        <strong>{r.projectName}</strong>
                                        <span
                                          className={
                                            r.status === "failed"
                                              ? "orange-text"
                                              : ""
                                          }
                                        >
                                          {r.status === "running"
                                            ? "Development server started"
                                            : r.status === "success"
                                              ? `${r.name} completed successfully`
                                              : r.status === "failed"
                                                ? `${r.name} failed · exit ${r.exitCode}`
                                                : `${r.name} ${r.status}`}
                                        </span>
                                        <small>
                                          {ago(r.endedAt || r.startedAt)}
                                          <i>·</i>
                                          {r.environment.toLowerCase()}
                                        </small>
                                      </span>
                                    </button>
                                  ))}
                                  {!data.runs.length && (
                                    <p className="muted">
                                      Your first command starts the timeline.
                                    </p>
                                  )}
                                </div>
                                <button
                                  className="rail-footer"
                                  onClick={() => navigate("Activity")}
                                >
                                  View all activity
                                  <ArrowRight size={13} />
                                </button>
                              </section>
                              <section className="ports-panel panel">
                                <SectionHeading
                                  title="Listening ports"
                                  count={ports.length}
                                >
                                  <Network size={14} className="muted" />
                                </SectionHeading>
                                {ports.length ? (
                                  ports.map(({ port, run }) => (
                                    <div
                                      className="port-row"
                                      key={`${run.id}-${port}`}
                                    >
                                      <span className="tiny-dot running" />
                                      <button
                                        className="port-number"
                                        onClick={() =>
                                          url(`http://localhost:${port}`)
                                        }
                                      >
                                        :{port}
                                      </button>
                                      <span>{run.projectName}</span>
                                      <button
                                        className="icon-btn"
                                        title="Inspect port owner"
                                        aria-label={`Inspect port ${port}`}
                                        onClick={() =>
                                          void api
                                            .portOwner(port)
                                            .then(setOwner, (e) =>
                                              notify(String(e), true),
                                            )
                                        }
                                      >
                                        <Search size={12} />
                                      </button>
                                      <button
                                        className="icon-btn"
                                        aria-label={`Open port ${port}`}
                                        onClick={() =>
                                          url(`http://localhost:${port}`)
                                        }
                                      >
                                        <ArrowUpRight size={13} />
                                      </button>
                                    </div>
                                  ))
                                ) : (
                                  <p className="muted">
                                    No listening ports detected.
                                  </p>
                                )}
                                <div className="ports-foot">
                                  <span className="tiny-dot running" />
                                  {ports.length
                                    ? "Tracked across active process groups"
                                    : "Ports appear when your servers start"}
                                </div>
                              </section>
                              <div className="house-note">
                                <Logo small />
                                <p>
                                  Your stack. Your rules.
                                  <span>The house is in good hands.</span>
                                </p>
                                <span>♠</span>
                              </div>
                            </aside>
                          )}
                        </div>
                      </>
                    )}
                    {["Runs", "Deployments", "Activity"].includes(page) && (
                      <>
                        <div className="history-toolbar">
                          <Search size={16} />
                          <input
                            aria-label="Search history"
                            placeholder="Search projects, commands, environments, or output…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                          <select
                            aria-label="Filter run status"
                            value={status}
                            onChange={(e) => setStatus(e.target.value)}
                          >
                            <option value="all">All statuses</option>
                            {[
                              "running",
                              "success",
                              "failed",
                              "stopped",
                              "interrupted",
                            ].map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                          <span className="tag">
                            {filteredRuns.length} results
                          </span>
                        </div>
                        {page === "Deployments" && (
                          <div className="deployment-summary">
                            <div className="panel">
                              <Rocket size={19} />
                              <span>Deployment targets</span>
                              <strong>
                                {data.projects.reduce(
                                  (n, p) =>
                                    n +
                                    p.commands.filter(
                                      (c) => c.category === "Deploy",
                                    ).length,
                                  0,
                                )}
                              </strong>
                            </div>
                            <div className="panel">
                              <ShieldCheck size={19} />
                              <span>Production safeguards</span>
                              <strong className="lime">Enabled</strong>
                            </div>
                            <div className="panel">
                              <Check size={19} />
                              <span>Successful releases</span>
                              <strong>
                                {
                                  deployments.filter(
                                    (r) => r.status === "success",
                                  ).length
                                }
                              </strong>
                            </div>
                          </div>
                        )}
                        {page === "Activity" ? (
                          <div className="timeline panel">
                            {filteredRuns.length ? (
                              filteredRuns.map((r) => (
                                <button
                                  key={r.id}
                                  className="timeline-row"
                                  onClick={() => setTerminal(r.id)}
                                >
                                  <span className="timeline-time">
                                    {new Date(
                                      r.endedAt || r.startedAt,
                                    ).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                    <small>
                                      {new Date(r.startedAt).toLocaleDateString(
                                        [],
                                        { month: "short", day: "numeric" },
                                      )}
                                    </small>
                                  </span>
                                  <ActivityIcon status={r.status} />
                                  <span>
                                    <strong>{r.projectName}</strong>
                                    <span>
                                      {r.name} · {r.status}
                                    </span>
                                  </span>
                                  <code>{r.command}</code>
                                  <span className="tag">{r.environment}</span>
                                  <ChevronRight size={14} />
                                </button>
                              ))
                            ) : (
                              <Empty
                                title="Nothing on the timeline yet"
                                icon={Activity}
                              >
                                Run a command or change your filters.
                              </Empty>
                            )}
                          </div>
                        ) : (
                          <RunTable
                            runs={filteredRuns}
                            onLogs={(r) => setTerminal(r.id)}
                          />
                        )}
                      </>
                    )}
                    {page === "Settings" && (
                      <div className="settings-grid">
                        <div className="panel">
                          <SectionHeading title="Workspace preferences" />
                          <div className="setting-row">
                            <div>
                              <strong>Automatic Git refresh</strong>
                              <p>
                                Refresh branch and working tree metadata every
                                30 seconds.
                              </p>
                            </div>
                            <button
                              className={`toggle ${autoRefresh ? "on" : ""}`}
                              role="switch"
                              aria-checked={autoRefresh}
                              aria-label="Automatic Git refresh"
                              onClick={() => {
                                setAutoRefresh(!autoRefresh);
                                localStorage.setItem(
                                  "pit-boss-refresh",
                                  autoRefresh ? "off" : "on",
                                );
                              }}
                            >
                              <span />
                            </button>
                          </div>
                          <div className="setting-row">
                            <div>
                              <strong>Default project view</strong>
                              <p>
                                Choose how you keep an eye on your projects.
                              </p>
                            </div>
                            <select
                              aria-label="Default project view"
                              value={view}
                              onChange={(e) => {
                                setView(e.target.value as "grid" | "table");
                                localStorage.setItem(
                                  "pit-boss-view",
                                  e.target.value,
                                );
                              }}
                            >
                              <option value="grid">Card grid</option>
                              <option value="table">Operations table</option>
                            </select>
                          </div>
                          <div className="setting-row">
                            <div>
                              <strong>Appearance</strong>
                              <p>A little less light. A little more focus.</p>
                            </div>
                            <span className="tag">Dark</span>
                          </div>
                        </div>
                        <div className="panel">
                          <SectionHeading title="Local engine" />
                          <div className="engine-info">
                            <Logo />
                            <div>
                              <h3>
                                Pit Boss <span className="tag">0.1.0</span>
                              </h3>
                              <p>
                                {isDesktop
                                  ? "Tauri · Rust · SQLite"
                                  : "Browser demo · localStorage"}
                              </p>
                            </div>
                            <span className="tiny-dot running" />
                          </div>
                          <p className="muted settings-copy">
                            {isDesktop
                              ? "Projects and command history are stored in your OS application-data directory. Active processes stop when you quit the app."
                              : "This preview simulates commands. Run npm run desktop to register local projects and use the Rust process engine."}
                          </p>
                          {!isDesktop && (
                            <button
                              className="button secondary"
                              onClick={() => {
                                setData(api.resetDemo());
                                setTerminal(null);
                                notify("Demo workspace reset");
                              }}
                            >
                              <RefreshCw size={13} /> Reset demo workspace
                            </button>
                          )}
                        </div>
                        <div className="panel">
                          <SectionHeading title="Command safety" />
                          <div className="safety-list">
                            <p>
                              <ShieldCheck size={16} /> Exact command and
                              directory reviewed before launch
                            </p>
                            <p>
                              <ShieldCheck size={16} /> Extra confirmation for
                              production deployments
                            </p>
                            <p>
                              <ShieldCheck size={16} /> Environment bindings
                              reference names, never saved values
                            </p>
                            <p>
                              <ShieldCheck size={16} /> Known environment
                              secrets redacted from captured output
                            </p>
                          </div>
                          <p className="muted settings-copy">
                            Avoid putting secrets directly in command text.
                            Commands can print data Pit Boss cannot identify as
                            sensitive.
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </main>
        {terminal && (
          <Terminal
            runs={data.runs}
            selectedId={terminal}
            onSelect={setTerminal}
            onClose={() => setTerminal(null)}
            onStop={(r) => void stop(r)}
            onRerun={rerun}
          />
        )}
        <footer className="statusbar">
          <div>
            <span className="tiny-dot running" />
            <span>{isDesktop ? "Engine online" : "Demo engine"}</span>
            <span className="statusbar-separator" />
            <GitBranch size={11} />
            <span>{data.projects.length} projects</span>
            <span className="statusbar-separator" />
            <span>{running.length} running</span>
            {failures > 0 && (
              <>
                <span className="statusbar-separator" />
                <span className="orange-text">{failures} needs attention</span>
              </>
            )}
          </div>
          <div>
            <button
              onClick={() =>
                setTerminal(running[0]?.id || data.runs[0]?.id || null)
              }
            >
              <TerminalIcon size={11} /> Terminal
            </button>
            <span className="statusbar-separator" />
            <span>All systems local</span>
            <span className="statusbar-separator" />
            <Clock3 size={10} />
            <span>{time}</span>
          </div>
        </footer>
      </div>
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role="status">
          {toast.error ? <X size={16} /> : <Check size={16} />}
          <span>{toast.text}</span>
          <button
            className="icon-btn"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {add && (
        <AddProjectDialog
          scan={add === "scan"}
          onClose={() => setAdd(null)}
          onSave={save}
        />
      )}{" "}
      {!!requests.length && (
        <RunDialog
          requests={requests}
          onClose={() => setRequests([])}
          onConfirm={confirmRun}
        />
      )}{" "}
      {actionProject && (
        <CommandDialog
          project={actionProject}
          onClose={() => setActionProjectId(null)}
          onSave={save}
        />
      )}
      {palette && (
        <Palette
          projects={data.projects}
          onClose={() => setPalette(false)}
          onRun={request}
          onOpen={open}
          onPage={navigate}
          onGroup={() => batch("Development")}
        />
      )}{" "}
      {remove && (
        <Modal
          title={`Remove ${remove.name}?`}
          subtitle="Your files and command history will be kept."
          onClose={() => setRemove(null)}
        >
          <p className="muted">
            This unregisters the project from Pit Boss. Running commands must be
            stopped first.
          </p>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setRemove(null)}
            >
              Cancel
            </button>
            <button
              className="button danger-button"
              onClick={async () => {
                try {
                  await api.remove(remove.id);
                  setData((d) => ({
                    ...d,
                    projects: d.projects.filter((p) => p.id !== remove.id),
                  }));
                  setProjectId(null);
                  setRemove(null);
                  notify("Project removed");
                } catch (e) {
                  notify(String(e), true);
                }
              }}
            >
              Remove project
            </button>
          </div>
        </Modal>
      )}
      {help && (
        <Modal
          title="Run the house."
          subtitle="A few shortcuts to keep things moving."
          onClose={() => setHelp(false)}
        >
          <div className="help-row">
            <span>Open command center</span>
            <Shortcut>⌘ / Ctrl + K</Shortcut>
          </div>
          <div className="help-row">
            <span>Navigate palette results</span>
            <Shortcut>↑ ↓</Shortcut>
          </div>
          <div className="help-row">
            <span>Choose an action</span>
            <Shortcut>Enter</Shortcut>
          </div>
          <div className="help-row">
            <span>Close a dialog</span>
            <Shortcut>Esc</Shortcut>
          </div>
          <div className="info-box">
            <Folder size={20} />
            <p>
              Register a project, approve its detected commands, then run it
              from a card or the command center. Click any activity to reopen
              its logs.
            </p>
          </div>
        </Modal>
      )}
      {owner !== null && (
        <Modal title="Port ownership" onClose={() => setOwner(null)}>
          <pre className="owner-output">
            {owner || "No listener found on this port."}
          </pre>
        </Modal>
      )}
    </div>
  );
}
