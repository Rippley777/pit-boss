import {
  ArrowUpRight,
  ExternalLink,
  MoreHorizontal,
  Play,
  Rocket,
  RotateCw,
  Square,
  Star,
  Terminal,
  AlertTriangle,
} from "lucide-react";
import { useState } from "react";
import { ago, projectState } from "../bridge";
import type { Project, Run, RunRequest } from "../types";
import { ActionGlyph, Branch, ProjectIcon, StatusBadge } from "./ui";
export default function ProjectCard({
  project: p,
  runs,
  onDetail,
  onRun,
  onStop,
  onLogs,
  onSave,
  onOpen,
  onUrl,
  onAddAction,
}: {
  project: Project;
  runs: Run[];
  onDetail: () => void;
  onRun: (r: RunRequest) => void;
  onStop: (r: Run) => void;
  onLogs: (r: Run) => void;
  onSave: (p: Project) => void;
  onOpen: (p: Project, target: string) => void;
  onUrl: (url: string) => void;
  onAddAction: (p: Project) => void;
}) {
  const [menu, setMenu] = useState(false),
    own = runs.filter((r) => r.projectId === p.id),
    running = own.find((r) => r.status === "running"),
    status = projectState(p, runs),
    last = own[0],
    deploy = own.find((r) => r.category === "Deploy"),
    dev = p.commands.find((c) => c.category === "Development"),
    deployment = p.commands.find((c) => c.category === "Deploy"),
    pinned = [...p.commands]
      .filter((c) => c.pinned)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .slice(0, 2),
    otherActions = p.commands.filter(
      (c) => !pinned.some((item) => item.id === c.id),
    );
  return (
    <article className={`project-card ${status}`}>
      <div className="card-top">
        <ProjectIcon project={p} />
        <button className="project-name" onClick={onDetail}>
          <h3>{p.name}</h3>
          <span>
            {p.technologies.slice(0, 2).join(" · ") || "Local project"}
          </span>
        </button>
        <button
          className={`icon-btn favorite ${p.favorite ? "active" : ""}`}
          title="Toggle favorite"
          aria-label={`Favorite ${p.name}`}
          onClick={() => onSave({ ...p, favorite: !p.favorite })}
        >
          <Star size={13} fill={p.favorite ? "currentColor" : "none"} />
        </button>
        <button
          className="icon-btn card-add-action"
          title={`Add an action to ${p.name}`}
          aria-label={`Add action to ${p.name}`}
          onClick={() => onAddAction(p)}
        >
          <span>+</span>
        </button>
        <div className="menu-wrap">
          <button
            className="icon-btn"
            aria-label={`More actions for ${p.name}`}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={17} />
          </button>
          {menu && (
            <>
              <button
                className="menu-dismiss"
                aria-label="Close actions"
                onClick={() => setMenu(false)}
              />
              <div className="dropdown">
                {[
                  ["Details & commands", "detail"],
                  ["Manage actions", "actions"],
                  ["Add action", "add-action"],
                  ["Open in VS Code", "editor"],
                  ["Open terminal here", "terminal"],
                  ["Open repository", "repository"],
                ].map(([label, action]) => (
                  <button
                    key={action}
                    onClick={() => {
                      setMenu(false);
                      if (action === "detail" || action === "actions")
                        onDetail();
                      else if (action === "add-action") onAddAction(p);
                      else onOpen(p, action);
                    }}
                  >
                    {label}
                    <ArrowUpRight size={12} />
                  </button>
                ))}
                {otherActions.length > 0 && (
                  <div className="dropdown-divider" />
                )}
                {otherActions.map((action) => (
                  <button
                    className="dropdown-action"
                    key={action.id}
                    title={`${action.description || action.name} · ${action.command}`}
                    onClick={() => {
                      setMenu(false);
                      onRun({
                        project: p,
                        preset: action,
                        restart: runs.find(
                          (r) =>
                            r.projectId === p.id &&
                            r.presetId === action.id &&
                            r.status === "running",
                        ),
                      });
                    }}
                  >
                    <ActionGlyph name={action.icon} />
                    <span>{action.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="card-path">{p.path}</div>
      <div className="card-state">
        <StatusBadge
          status={status}
          label={
            status === "failed"
              ? `${last?.category || "Command"} failed`
              : undefined
          }
        />
        <Branch project={p} />
      </div>
      <div className="card-info">
        {running ? (
          <>
            <span className="port-label">
              <span className="tiny-dot running" />
              {running.ports.length ? (
                <button
                  onClick={() => onUrl(`http://localhost:${running.ports[0]}`)}
                >
                  localhost:{running.ports[0]}
                  <ExternalLink size={10} />
                </button>
              ) : (
                "Process active"
              )}
            </span>
            <span className="resource-text">
              {Math.round(running.memory / 1048576)} MB <span>·</span>{" "}
              {running.cpu.toFixed(1)}% CPU
            </span>
          </>
        ) : status === "failed" ? (
          <>
            <span className="failure-label">
              <AlertTriangle size={12} /> {last?.name} exited with code{" "}
              {last?.exitCode}
            </span>
            <button className="text-link" onClick={() => last && onLogs(last)}>
              View logs <ArrowUpRight size={11} />
            </button>
          </>
        ) : (
          <>
            <span>No active processes</span>
            <span>
              {last
                ? ago(last.endedAt || last.startedAt)
                : "Ready when you are"}
            </span>
          </>
        )}
      </div>
      <div className="card-actions">
        <button
          className={running ? "subtle-btn" : "subtle-btn start"}
          disabled={!dev}
          onClick={() =>
            dev &&
            onRun({
              project: p,
              preset: running
                ? p.commands.find((c) => c.id === running.presetId) || dev
                : dev,
              restart: running,
            })
          }
        >
          {running ? <RotateCw size={12} /> : <Play size={12} />}{" "}
          {running ? "Restart" : "Run"}
        </button>
        <button
          className="subtle-btn"
          disabled={!deployment}
          onClick={() =>
            deployment && onRun({ project: p, preset: deployment })
          }
        >
          <Rocket size={12} />
          Deploy
        </button>
        {pinned.map((action) => (
          <button
            key={action.id}
            className="subtle-btn card-pinned-action"
            title={`${action.description || action.name} · ${action.command}`}
            onClick={() =>
              onRun({
                project: p,
                preset: action,
                restart: runs.find(
                  (r) =>
                    r.projectId === p.id &&
                    r.presetId === action.id &&
                    r.status === "running",
                ),
              })
            }
          >
            <ActionGlyph name={action.icon} size={12} />
            {action.name}
          </button>
        ))}
        <button
          className="subtle-btn"
          disabled={!last}
          onClick={() => last && onLogs(running || last)}
        >
          <Terminal size={12} />
          Logs
        </button>
        <span className="card-action-spacer" />
        {running ? (
          <button
            className="stop-btn"
            title={`Stop ${p.name}`}
            aria-label={`Stop ${p.name}`}
            onClick={() => onStop(running)}
          >
            <Square size={11} />
          </button>
        ) : (
          <span className="last-deploy">
            {deploy?.status === "success"
              ? `Deployed ${ago(deploy.endedAt || deploy.startedAt)}`
              : "Local"}
          </span>
        )}
      </div>
    </article>
  );
}
