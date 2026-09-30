import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Rocket,
  Square,
  Star,
  Terminal,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Preset, Project, Run, RunRequest } from "../types";
import { ago, api, duration } from "../bridge";
import {
  Branch,
  ActionGlyph,
  DetailLine,
  Empty,
  ProjectIcon,
  SectionHeading,
  StatusBadge,
} from "./ui";
import { CommandDialog } from "./Dialogs";
export default function ProjectDetail({
  project: p,
  runs,
  onBack,
  onRun,
  onSave,
  onRemove,
  onLogs,
  onStop,
  onOpen,
  onUrl,
  onCopy,
  onAddAction,
}: {
  project: Project;
  runs: Run[];
  onBack: () => void;
  onRun: (r: RunRequest) => void;
  onSave: (p: Project) => Promise<void>;
  onRemove: (p: Project) => void;
  onLogs: (r: Run) => void;
  onStop: (r: Run) => void;
  onOpen: (p: Project, target: string) => void;
  onUrl: (url: string) => void;
  onCopy: (text: string) => void;
  onAddAction: (project: Project) => void;
}) {
  const [tab, setTab] = useState("Actions"),
    [edit, setEdit] = useState<Preset | "new" | null>(null),
    [drag, setDrag] = useState(""),
    [actionMenu, setActionMenu] = useState(""),
    [suggestions, setSuggestions] = useState<Preset[]>(p.suggestions || []),
    [actionFilter, setActionFilter] = useState(""),
    [name, setName] = useState(p.name),
    [group, setGroup] = useState(p.group),
    [description, setDescription] = useState(p.description);
  const own = runs.filter((r) => r.projectId === p.id),
    active = own.filter((r) => r.status === "running");
  const ordered = [...p.commands].sort((a, b) => a.sortOrder - b.sortOrder);
  const actionGroups = [...new Set(ordered.map((c) => c.category || "Custom"))];
  useEffect(() => {
    if (tab !== "Actions") return;
    void api
      .suggestions(p.id)
      .then((found) =>
        setSuggestions((old) => {
          const all = [...(p.suggestions || []), ...old, ...found];
          return all.filter(
            (a, i) =>
              all.findIndex(
                (b) => b.name === a.name && b.command === a.command,
              ) === i &&
              !p.commands.some(
                (saved) => saved.name === a.name && saved.command === a.command,
              ),
          );
        }),
      )
      .catch(() => {});
  }, [tab, p.id, p.commands, p.suggestions]);
  async function addSuggested(action: Preset) {
    await onSave({
      ...p,
      commands: [
        ...p.commands,
        { ...action, sortOrder: p.commands.length, pinned: false },
      ],
      suggestions: suggestions.filter((s) => s.id !== action.id),
    });
    setSuggestions((old) => old.filter((s) => s.id !== action.id));
  }
  function duplicate(action: Preset) {
    void onSave({
      ...p,
      commands: [
        ...p.commands,
        {
          ...action,
          id: crypto.randomUUID(),
          name: `${action.name} copy`,
          pinned: false,
          keyboardShortcut: "",
          sortOrder: p.commands.length,
        },
      ],
    }).catch(() => {});
    setActionMenu("");
  }
  function reorder(id: string, to: number) {
    const commands = [...p.commands],
      from = commands.findIndex((c) => c.id === id);
    if (from < 0 || to < 0 || to >= commands.length) return;
    commands.splice(to, 0, commands.splice(from, 1)[0]);
    commands.forEach((action, sortOrder) => {
      action.sortOrder = sortOrder;
    });
    void onSave({ ...p, commands });
  }
  const actionRows = (rows: Preset[]) => (
    <div className="command-list">
      {rows.map((c) => (
        <div
          className={`command-row project-action-row ${c.dangerous ? "dangerous-action" : ""}`}
          key={c.id}
          draggable
          onDragStart={() => setDrag(c.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() =>
            reorder(
              drag,
              ordered.findIndex((item) => item.id === c.id),
            )
          }
        >
          <GripVertical size={15} className="muted" />
          <span className="command-type">
            <ActionGlyph name={c.icon || "Terminal"} size={17} />
          </span>
          <div className="command-row-info">
            <strong>
              {c.name}
              {c.dangerous && (
                <span className="danger-action-label">DANGEROUS</span>
              )}
            </strong>
            {c.description && (
              <span className="action-description">{c.description}</span>
            )}
            <code>{c.command}</code>
          </div>
          <span className="tag">{c.category}</span>
          <span className="tag">{c.environment}</span>
          <button
            className="icon-btn"
            title="Move up"
            aria-label={`Move ${c.name} up`}
            disabled={ordered.findIndex((item) => item.id === c.id) === 0}
            onClick={() =>
              reorder(c.id, ordered.findIndex((item) => item.id === c.id) - 1)
            }
          >
            <ArrowUp size={13} />
          </button>
          <button
            className={`pin-button ${c.pinned ? "selected" : ""}`}
            title={c.pinned ? "Unpin action" : "Pin action"}
            aria-label={`${c.pinned ? "Unpin" : "Pin"} ${c.name}`}
            onClick={() =>
              void onSave({
                ...p,
                commands: p.commands.map((x) =>
                  x.id === c.id ? { ...x, pinned: !x.pinned } : x,
                ),
              }).catch(() => {})
            }
          >
            <Star size={13} fill={c.pinned ? "currentColor" : "none"} />
          </button>
          <button
            className="icon-btn"
            title="Move down"
            aria-label={`Move ${c.name} down`}
            disabled={
              ordered.findIndex((item) => item.id === c.id) ===
              ordered.length - 1
            }
            onClick={() =>
              reorder(c.id, ordered.findIndex((item) => item.id === c.id) + 1)
            }
          >
            <ArrowDown size={13} />
          </button>
          <button
            className="icon-btn"
            aria-label={`Edit ${c.name}`}
            onClick={() => setEdit(c)}
          >
            <Pencil size={13} />
          </button>
          <button
            className="icon-btn danger"
            aria-label={`Delete ${c.name}`}
            onClick={() =>
              void onSave({
                ...p,
                commands: p.commands.filter((command) => command.id !== c.id),
              })
            }
          >
            <Trash2 size={13} />
          </button>
          <button
            className="button small secondary"
            onClick={() =>
              onRun({
                project: p,
                preset: c,
                restart: own.find(
                  (r) => r.presetId === c.id && r.status === "running",
                ),
              })
            }
          >
            <Play size={12} />{" "}
            {own.some((r) => r.presetId === c.id && r.status === "running")
              ? "Restart"
              : "Run"}
          </button>
          <div className="menu-wrap">
            <button
              className="icon-btn"
              aria-label={`More options for ${c.name}`}
              onClick={() => setActionMenu(actionMenu === c.id ? "" : c.id)}
            >
              <MoreHorizontal size={16} />
            </button>
            {actionMenu === c.id && (
              <>
                <button
                  className="menu-dismiss"
                  aria-label="Close action options"
                  onClick={() => setActionMenu("")}
                />
                <div className="dropdown action-dropdown">
                  {[
                    ["Edit", "edit"],
                    ["Duplicate", "duplicate"],
                    [c.pinned ? "Unpin" : "Pin to toolbar", "pin"],
                    ["View history", "history"],
                    ["Delete", "delete"],
                  ].map(([label, op]) => (
                    <button
                      key={op}
                      onClick={() => {
                        setActionMenu("");
                        if (op === "edit") setEdit(c);
                        else if (op === "duplicate") duplicate(c);
                        else if (op === "pin")
                          void onSave({
                            ...p,
                            commands: p.commands.map((x) =>
                              x.id === c.id ? { ...x, pinned: !x.pinned } : x,
                            ),
                          }).catch(() => {});
                        else if (op === "history") {
                          setActionFilter(c.id);
                          setTab("History");
                        } else if (op === "delete")
                          void onSave({
                            ...p,
                            commands: p.commands.filter((x) => x.id !== c.id),
                          }).catch(() => {});
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      ))}
      {!rows.length && (
        <Empty title="No actions yet">
          Add an action for a task you do often.
        </Empty>
      )}
    </div>
  );
  return (
    <>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={14} /> All projects
      </button>
      <div className="detail-header">
        <ProjectIcon project={p} />
        <div>
          <h1>{p.name}</h1>
          <p>{p.path}</p>
        </div>
        <Branch project={p} />
        <span className="flex-spacer" />
        <button
          className="button secondary"
          onClick={() => onOpen(p, "editor")}
        >
          <ExternalLink size={14} /> VS Code
        </button>
        <button
          className="button secondary"
          onClick={() => onOpen(p, "terminal")}
        >
          <Terminal size={14} /> Terminal
        </button>
      </div>
      <div className="page-tabs">
        {[
          "Overview",
          "Actions",
          "Processes",
          "Git",
          "Deployments",
          "History",
          "Settings",
        ].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
            {t === "Processes" && active.length > 0 && (
              <span className="count">{active.length}</span>
            )}
          </button>
        ))}
      </div>
      {tab === "Overview" && (
        <>
          <div className="detail-overview">
            <div className="panel">
              <SectionHeading title="Project at a glance" />
              <p className="project-description">
                {p.description || "Your next great project starts here."}
              </p>
              <DetailLine label="Technology">
                <span className="tags">
                  {p.technologies.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </span>
              </DetailLine>
              <DetailLine label="Package manager">
                {p.packageManager || "Not detected"}
              </DetailLine>
              <DetailLine label="Pit">{p.group}</DetailLine>
              <DetailLine label="Environment files">
                {p.envFiles.join(", ") || "None detected"}
              </DetailLine>
            </div>
            <div className="panel">
              <SectionHeading title="Working tree" />
              <DetailLine label="Branch">
                <Branch project={p} />
              </DetailLine>
              <DetailLine label="Changes">
                {p.git.changes
                  ? `${p.git.changes} uncommitted changes`
                  : "Clean working tree"}
              </DetailLine>
              <DetailLine label="Latest commit">
                <code>{p.git.commit.slice(0, 7) || "—"}</code>
              </DetailLine>
              <DetailLine label="Upstream">
                ↑ {p.git.ahead} ahead · ↓ {p.git.behind} behind
              </DetailLine>
            </div>
          </div>
          <SectionHeading
            title="Pinned actions"
            count={p.commands.filter((c) => c.pinned).length}
          >
            <button
              className="text-link"
              onClick={() => {
                setTab("Actions");
                onAddAction(p);
              }}
            >
              <Plus size={13} /> Add action
            </button>
          </SectionHeading>
          <div className="overview-action-chips">
            {ordered
              .filter((c) => c.pinned)
              .slice(0, 5)
              .map((c) => (
                <button
                  className="button secondary"
                  key={c.id}
                  onClick={() => onRun({ project: p, preset: c })}
                >
                  <ActionGlyph name={c.icon} />
                  {c.name}
                </button>
              ))}
            {!p.commands.some((c) => c.pinned) && (
              <p className="muted">
                Pin your most-used actions to keep them close at hand.
              </p>
            )}
          </div>
        </>
      )}
      {tab === "Actions" && (
        <>
          <SectionHeading title="Project actions" count={p.commands.length}>
            <button
              className="button secondary small"
              onClick={() => onAddAction(p)}
            >
              <Plus size={13} /> Add action
            </button>
          </SectionHeading>
          <p className="muted section-description">
            Your project controls, ready to run. Drag actions to reorder; pin
            favorites to the project toolbar.
          </p>
          {actionGroups.map((category) => (
            <section className="action-group" key={category}>
              <div className="action-group-heading">
                <strong>{category}</strong>
                <span>
                  {ordered.filter((c) => c.category === category).length}
                </span>
              </div>
              {actionRows(ordered.filter((c) => c.category === category))}
            </section>
          ))}
          <div className="suggested-actions">
            <SectionHeading
              title="Suggested actions"
              count={suggestions.length}
            >
              <button
                className="text-link"
                onClick={() =>
                  void api
                    .suggestions(p.id)
                    .then(setSuggestions)
                    .catch(() => {})
                }
              >
                <GitBranch size={13} /> Scan scripts
              </button>
            </SectionHeading>
            <p className="muted section-description">
              Detected from project scripts and tools. Add only what you want;
              suggestions never run automatically.
            </p>
            {suggestions.length ? (
              <div className="suggestion-list">
                {suggestions.map((action) => (
                  <div className="suggestion-row" key={action.id}>
                    <ActionGlyph name={action.icon} />
                    <span>
                      <strong>{action.name}</strong>
                      <code>{action.command}</code>
                    </span>
                    <span className="tag">{action.category}</span>
                    <button
                      className="button small secondary"
                      onClick={() => void addSuggested(action).catch(() => {})}
                    >
                      <Plus size={12} /> Add
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="no-suggestions">
                No new scripts found. Scripts in <code>scripts/</code>,{" "}
                <code>tools/</code>, and <code>bin/</code> appear here when
                available.
              </div>
            )}
          </div>
        </>
      )}
      {tab === "Processes" && (
        <>
          <SectionHeading title="Active processes" count={active.length} />
          {active.length ? (
            active.map((r) => (
              <div className="process-row" key={r.id}>
                <span className="tiny-dot running" />
                <div>
                  <strong>{r.name}</strong>
                  <code>{r.command}</code>
                </div>
                <span className="mono muted">PID {r.pid || "demo"}</span>
                <span>{duration(r)}</span>
                {r.ports.map((port) => (
                  <button
                    key={port}
                    className="text-link"
                    onClick={() => onUrl(`http://localhost:${port}`)}
                  >
                    :{port}
                    <ExternalLink size={12} />
                  </button>
                ))}
                <button
                  className="button secondary small"
                  onClick={() => onLogs(r)}
                >
                  <Terminal size={12} /> Logs
                </button>
                <button
                  className="button secondary small"
                  onClick={() => onStop(r)}
                >
                  <Square size={12} /> Stop
                </button>
              </div>
            ))
          ) : (
            <Empty title="All quiet here" icon={Terminal}>
              Start a command to monitor its process.
            </Empty>
          )}
        </>
      )}
      {tab === "Git" && (
        <div className="panel git-panel">
          <SectionHeading title="Repository">
            <button
              className="button secondary small"
              disabled={!p.git.remote}
              onClick={() => onOpen(p, "repository")}
            >
              <ExternalLink size={13} /> Open repository
            </button>
          </SectionHeading>
          <DetailLine label="Origin">
            {p.git.remote || "No remote configured"}
          </DetailLine>
          <DetailLine label="Branch">
            <GitBranch size={13} /> {p.git.branch || "Not a Git repository"}
          </DetailLine>
          <DetailLine label="Commit">
            <code>{p.git.commit || "—"}</code>
            <button
              className="icon-btn"
              disabled={!p.git.commit}
              aria-label="Copy commit SHA"
              onClick={() => onCopy(p.git.commit)}
            >
              <Copy size={12} />
            </button>
          </DetailLine>
          <DetailLine label="Message">{p.git.message || "—"}</DetailLine>
          <DetailLine label="Working tree">
            {p.git.changes} changes · {p.git.ahead} ahead · {p.git.behind}{" "}
            behind
          </DetailLine>
          <div className="git-actions">
            {p.commands
              .filter((c) => c.command.startsWith("git "))
              .map((c) => (
                <button
                  key={c.id}
                  className="button secondary"
                  onClick={() => onRun({ project: p, preset: c })}
                >
                  <GitBranch size={14} />
                  {c.name}
                </button>
              ))}
          </div>
        </div>
      )}
      {(tab === "Deployments" || tab === "History") && (
        <>
          {tab === "Deployments" && (
            <div className="deployment-targets">
              {p.commands
                .filter((c) => c.category === "Deploy")
                .map((c) => (
                  <div className="panel" key={c.id}>
                    <Rocket size={20} />
                    <h3>{c.environment}</h3>
                    <code>{c.command}</code>
                    <button
                      className="button secondary"
                      onClick={() => onRun({ project: p, preset: c })}
                    >
                      <Play size={13} /> Deploy
                    </button>
                  </div>
                ))}
            </div>
          )}
          <SectionHeading
            title={tab === "History" ? "Action history" : "Deployment history"}
          />
          {tab === "History" && (
            <div className="history-toolbar">
              <input
                aria-label="Search project action history"
                placeholder="Search action, command, output…"
                value={
                  actionFilter.startsWith("search:")
                    ? actionFilter.slice(7)
                    : ""
                }
                onChange={(e) => setActionFilter(`search:${e.target.value}`)}
              />
            </div>
          )}
          <RunTable
            runs={own.filter(
              (r) =>
                (tab !== "Deployments" || r.category === "Deploy") &&
                (tab !== "History" ||
                  (actionFilter.startsWith("search:")
                    ? `${r.name} ${r.command} ${r.output}`
                        .toLowerCase()
                        .includes(actionFilter.slice(7).toLowerCase())
                    : !actionFilter || r.presetId === actionFilter)),
            )}
            onLogs={onLogs}
          />
        </>
      )}
      {tab === "Settings" && (
        <div className="panel settings-panel">
          <h3>Project configuration</h3>
          <label className="field-label" htmlFor="project-name">
            Project name
          </label>
          <input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="field-label" htmlFor="project-group">
            Pit / group
          </label>
          <input
            id="project-group"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          />
          <label className="field-label" htmlFor="project-description">
            Description
          </label>
          <textarea
            id="project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button
            className="button primary"
            disabled={!name.trim()}
            onClick={() =>
              void onSave({
                ...p,
                name: name.trim(),
                group: group.trim() || "My projects",
                description,
              })
            }
          >
            Save changes
          </button>
          <div className="danger-zone">
            <div>
              <h3>Remove project</h3>
              <p>
                Removes registration only. Your files and command history stay
                on disk.
              </p>
            </div>
            <button
              className="button danger-button"
              onClick={() => onRemove(p)}
            >
              Remove
            </button>
          </div>
        </div>
      )}
      {edit && (
        <CommandDialog
          project={p}
          command={edit === "new" ? undefined : edit}
          onClose={() => setEdit(null)}
          onSave={onSave}
        />
      )}
    </>
  );
}
export function RunTable({
  runs,
  onLogs,
}: {
  runs: Run[];
  onLogs: (r: Run) => void;
}) {
  return runs.length ? (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Project / command</th>
            <th>Status</th>
            <th>Environment</th>
            <th>Commit</th>
            <th>Duration</th>
            <th>Started</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr
              key={r.id}
              onClick={() => onLogs(r)}
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onLogs(r)}
            >
              <td>
                <strong>{r.projectName}</strong>
                <code>{r.command}</code>
              </td>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td>
                <span className="tag">{r.environment}</span>
              </td>
              <td>
                <span className="commit">
                  <GitCommitHorizontal size={13} />
                  {r.commit.slice(0, 7) || "—"}
                </span>
              </td>
              <td className="mono">{duration(r)}</td>
              <td
                className="muted"
                title={new Date(r.startedAt).toLocaleString()}
              >
                {ago(r.startedAt)}
              </td>
              <td>
                <Terminal size={14} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="No runs to show" icon={Terminal}>
      Run a command to start building your history.
    </Empty>
  );
}
