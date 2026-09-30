import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GripVertical,
  Pencil,
  Play,
  Plus,
  Rocket,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { Preset, Project, Run, RunRequest } from "../types";
import { ago, duration } from "../bridge";
import {
  Branch,
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
}) {
  const [tab, setTab] = useState("Overview"),
    [edit, setEdit] = useState<Preset | "new" | null>(null),
    [drag, setDrag] = useState(""),
    [name, setName] = useState(p.name),
    [group, setGroup] = useState(p.group),
    [description, setDescription] = useState(p.description);
  const own = runs.filter((r) => r.projectId === p.id),
    active = own.filter((r) => r.status === "running");
  function reorder(id: string, to: number) {
    const commands = [...p.commands],
      from = commands.findIndex((c) => c.id === id);
    if (from < 0 || to < 0 || to >= commands.length) return;
    commands.splice(to, 0, commands.splice(from, 1)[0]);
    void onSave({ ...p, commands });
  }
  const commandList = (
    <div className="command-list">
      {p.commands.map((c, i) => (
        <div
          className="command-row"
          key={c.id}
          draggable
          onDragStart={() => setDrag(c.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => reorder(drag, i)}
        >
          <GripVertical size={15} className="muted" />
          <span className="command-type">
            <Terminal size={17} />
          </span>
          <div className="command-row-info">
            <strong>{c.name}</strong>
            <code>{c.command}</code>
          </div>
          <span className="tag">{c.category}</span>
          <span className="tag">{c.environment}</span>
          <button
            className="icon-btn"
            title="Move up"
            aria-label={`Move ${c.name} up`}
            disabled={i === 0}
            onClick={() => reorder(c.id, i - 1)}
          >
            <ArrowUp size={13} />
          </button>
          <button
            className="icon-btn"
            title="Move down"
            aria-label={`Move ${c.name} down`}
            disabled={i === p.commands.length - 1}
            onClick={() => reorder(c.id, i + 1)}
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
            onClick={() => onRun({ project: p, preset: c })}
          >
            <Play size={12} /> Run
          </button>
        </div>
      ))}
      {!p.commands.length && (
        <Empty title="No commands yet">
          Add a preset to give this project its first action.
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
          "Commands",
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
          <SectionHeading title="Command presets" count={p.commands.length}>
            <button className="text-link" onClick={() => setEdit("new")}>
              <Plus size={13} /> Add command
            </button>
          </SectionHeading>
          {commandList}
        </>
      )}
      {tab === "Commands" && (
        <>
          <SectionHeading
            title="Your command presets"
            count={p.commands.length}
          >
            <button
              className="button secondary small"
              onClick={() => setEdit("new")}
            >
              <Plus size={13} /> Add command
            </button>
          </SectionHeading>
          <p className="muted section-description">
            Drag to reorder, or use the arrows. Each command runs from this
            project's directory.
          </p>
          {commandList}
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
            title={tab === "History" ? "Command history" : "Deployment history"}
          />
          <RunTable
            runs={own.filter(
              (r) => tab !== "Deployments" || r.category === "Deploy",
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
