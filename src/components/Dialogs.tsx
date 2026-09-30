import {
  ArrowRight,
  Check,
  ChevronRight,
  Command,
  FolderSearch,
  GitBranch,
  LoaderCircle,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { useMemo, useState } from "react";
import { api, isDesktop } from "../bridge";
import { preset as makePreset } from "../demo";
import type { Preset, Project, RunRequest } from "../types";
import { Modal, ProjectIcon, Shortcut } from "./ui";
export function RunDialog({
  requests,
  onClose,
  onConfirm,
}: {
  requests: RunRequest[];
  onClose: () => void;
  onConfirm: (requests: RunRequest[]) => Promise<void>;
}) {
  const [typed, setTyped] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const protectedActions = requests.filter(
    ({ preset }) =>
      preset.dangerous ||
      preset.environment.toLowerCase() === "production" ||
      preset.confirmation ||
      preset.confirmationMode === "Always",
  );
  const required = [
    ...new Set(protectedActions.map(({ project }) => project.name)),
  ].join(", ");
  return (
    <Modal
      title={
        requests.length > 1
          ? `Run ${requests.length} actions`
          : requests[0].restart
            ? `Restart ${requests[0].preset.name}`
            : "Review project action"
      }
      subtitle={
        isDesktop
          ? "Review exactly what will run on your machine."
          : "Demo mode · these actions will be simulated."
      }
      onClose={onClose}
    >
      <div className="run-review-list">
        {requests.map(({ project, preset, restart }) => (
          <div className="run-review" key={`${project.id}-${preset.id}`}>
            <div className="run-review-title">
              <ProjectIcon project={project} small />
              <strong>
                {project.name} → {preset.name}
              </strong>
              <span className="tag">{preset.environment}</span>
              {restart && <span className="tag">Restart</span>}
              {preset.dangerous && (
                <span className="tag danger-tag">
                  <ShieldCheck size={11} /> Dangerous
                </span>
              )}
            </div>
            {preset.description && (
              <p className="review-description">{preset.description}</p>
            )}
            <code>$ {preset.command}</code>
            <div className="review-path">
              <Terminal size={13} />
              {preset.cwd ? `${project.path}/${preset.cwd}` : project.path}
            </div>
            {Object.keys(preset.env).length > 0 && (
              <div className="review-env">
                Environment: {Object.keys(preset.env).join(", ")}{" "}
                <span>· resolved privately at launch</span>
              </div>
            )}
          </div>
        ))}
      </div>
      {protectedActions.length > 0 && (
        <div className="production-confirm">
          <ShieldCheck size={18} />
          <div>
            <strong>
              {protectedActions.some(({ preset }) => preset.dangerous)
                ? "Confirm protected action"
                : "Production safeguard"}
            </strong>
            <p>
              Type <b>{required}</b> to confirm{" "}
              {protectedActions.length === 1
                ? `“${protectedActions[0].preset.name}”`
                : "these actions"}
              .
            </p>
            <input
              aria-label="Action confirmation"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={required}
            />
          </div>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={busy || (!!required && typed !== required)}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm(requests);
              onClose();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Play size={14} />
          )}{" "}
          {busy
            ? "Starting…"
            : requests.length > 1
              ? "Run all actions"
              : "Confirm & run"}
        </button>
      </div>
    </Modal>
  );
}
export function AddProjectDialog({
  scan = false,
  onClose,
  onSave,
}: {
  scan?: boolean;
  onClose: () => void;
  onSave: (p: Project) => Promise<void>;
}) {
  const [path, setPath] = useState("~/Code/"),
    [found, setFound] = useState<Project[]>([]),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [approved, setApproved] = useState<Set<string>>(new Set()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [inspected, setInspected] = useState(false);
  const detect = async () => {
    setBusy(true);
    setError("");
    setFound([]);
    setInspected(false);
    try {
      const results = scan ? await api.scan(path) : [await api.detect(path)];
      setFound(results);
      setSelected(new Set(results.map((p) => p.id)));
      setApproved(new Set(results.flatMap((p) => p.commands.map((c) => c.id))));
      setInspected(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={scan ? "Discover your projects" : "Bring a project to the table"}
      subtitle={
        scan
          ? "Scan up to five levels deep. Dependencies and hidden folders are skipped."
          : "Register a local folder. Pit Boss will detect the rest."
      }
      onClose={onClose}
      wide={found.length > 1}
    >
      <label className="field-label">
        {scan ? "Scan directory" : "Project directory"}
      </label>
      <div className="input-action">
        <input
          autoFocus
          aria-label="Project directory"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void detect()}
        />
        <button
          className="button secondary browse-button"
          disabled={!isDesktop || busy}
          title={
            isDesktop
              ? "Browse for a folder"
              : "Open this dialog in the desktop app to browse local folders"
          }
          onClick={() =>
            void api
              .pickDirectory(path)
              .then((selected) => {
                if (selected) {
                  setPath(selected);
                  setError("");
                }
              })
              .catch((e) => setError(String(e)))
          }
        >
          <FolderSearch size={14} /> Browse
        </button>
        <button
          className="button secondary inspect-button"
          disabled={busy || !path.trim()}
          onClick={() => void detect()}
        >
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <FolderSearch size={14} />
          )}{" "}
          {scan ? "Scan" : "Inspect"}
        </button>
      </div>
      {!isDesktop && (
        <div className="info-box">
          <Terminal size={17} />
          <p>
            Local filesystem access is available in the desktop app. Start it
            with <code>npm run desktop</code>. You can explore the rest of Pit
            Boss in this browser demo.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {inspected && !found.length && (
        <p className="muted">No projects found in this directory.</p>
      )}
      <div className="discovered-list">
        {found.map((p) => (
          <div className="discovered-project" key={p.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(p.id)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(p.id);
                  else next.delete(p.id);
                  setSelected(next);
                }}
              />
              <ProjectIcon project={p} small />
              <strong>{p.name}</strong>
              <span className="tag">{p.technologies.join(" · ")}</span>
            </label>
            <p className="mono">{p.path}</p>
            <div className="detected-commands">
              {p.commands.map((c) => (
                <label key={c.id}>
                  <input
                    type="checkbox"
                    checked={approved.has(c.id)}
                    onChange={(e) => {
                      const next = new Set(approved);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      setApproved(next);
                    }}
                  />
                  <code>{c.command}</code>
                  <span className="tag">{c.category}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {found.length > 0 && (
        <p className="form-hint">
          <ShieldCheck size={13} /> Import approves the checked command presets.
          Nothing runs automatically.
        </p>
      )}
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={busy || !selected.size}
          onClick={async () => {
            setBusy(true);
            try {
              for (const p of found.filter((p) => selected.has(p.id))) {
                await onSave({
                  ...p,
                  commands: p.commands.filter((c) => approved.has(c.id)),
                  suggestions: [
                    ...p.suggestions,
                    ...p.commands.filter((c) => !approved.has(c.id)),
                  ],
                });
                setSelected((previous) => {
                  const next = new Set(previous);
                  next.delete(p.id);
                  return next;
                });
              }
              onClose();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Plus size={14} /> Import {selected.size || ""} project
          {selected.size !== 1 ? "s" : ""}
        </button>
      </div>
    </Modal>
  );
}
export function CommandDialog({
  project,
  command,
  onClose,
  onSave,
}: {
  project: Project;
  command?: Preset;
  onClose: () => void;
  onSave: (p: Project) => Promise<void>;
}) {
  const [form, setForm] = useState<Preset>(
      command || makePreset("", "", "Custom"),
    ),
    [env, setEnv] = useState(
      Object.entries((command || makePreset("", "", "Custom")).env)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n"),
    ),
    [error, setError] = useState("");
  function field<K extends keyof Preset>(key: K, value: Preset[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }
  return (
    <Modal
      title={command ? "Edit project action" : "Create a project action"}
      subtitle={`Configure an action for ${project.name}.`}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const bindings: Record<string, string> = {};
            for (const line of env.split("\n").filter((l) => l.trim())) {
              const [key, source, ...rest] = line.split("=");
              if (
                rest.length ||
                !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key?.trim()) ||
                !/^[A-Za-z_][A-Za-z0-9_]*$/.test(source?.trim())
              )
                throw new Error(
                  "Use KEY=SOURCE_ENV_VAR, one per line. Enter variable names, never secret values.",
                );
              bindings[key.trim()] = source.trim();
            }
            const next = {
              ...form,
              name: form.name.trim(),
              command: form.command.trim(),
              category: (form.category.trim() || "Custom") as Preset["category"],
              env: bindings,
              confirmation: form.confirmationMode === "Always",
              sortOrder: command?.sortOrder ?? project.commands.length,
            };
            if (!next.name || !next.command)
              throw new Error("Action name and command are required.");
            if (
              next.keyboardShortcut &&
              project.commands.some(
                (c) =>
                  c.id !== command?.id &&
                  c.keyboardShortcut.toUpperCase() ===
                    next.keyboardShortcut.toUpperCase(),
              )
            )
              throw new Error(
                "That keyboard shortcut is already assigned in this project.",
              );
            await onSave({
              ...project,
              commands: command
                ? project.commands.map((c) => (c.id === command.id ? next : c))
                : [...project.commands, next],
              suggestions: project.suggestions.filter((c) => c.id !== next.id),
            });
            onClose();
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        <label className="field-label" htmlFor="command-name">
          Name
        </label>
        <input
          id="command-name"
          required
          value={form.name}
          onChange={(e) => field("name", e.target.value)}
          placeholder="Seed database"
        />
        <label className="field-label" htmlFor="command-description">
          Description
        </label>
        <textarea
          id="command-description"
          value={form.description}
          onChange={(e) => field("description", e.target.value)}
          placeholder="Populate the local database with sample data"
          rows={2}
        />
        <label className="field-label" htmlFor="command-script">
          Command
        </label>
        <textarea
          id="command-script"
          className="mono"
          required
          value={form.command}
          onChange={(e) => field("command", e.target.value)}
          placeholder="npm run db:seed"
          rows={2}
        />
        {project.suggestions.length > 0 && (
          <>
            <label className="field-label" htmlFor="action-script-browser">
              Browse detected scripts{" "}
              <span>choose a suggestion to prefill this action</span>
            </label>
            <select
              id="action-script-browser"
              value=""
              onChange={(e) => {
                const suggested = project.suggestions.find(
                  (s) => s.id === e.target.value,
                );
                if (suggested) {
                  setForm({ ...suggested, id: command?.id || suggested.id });
                  setEnv(
                    Object.entries(suggested.env || {})
                      .map(([k, v]) => `${k}=${v}`)
                      .join("\n"),
                  );
                }
              }}
            >
              <option value="">Choose a detected project script…</option>
              {project.suggestions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.command}
                </option>
              ))}
            </select>
          </>
        )}
        <div className="form-row">
          <div>
            <label className="field-label" htmlFor="command-category">
              Category
            </label>
            <input
              id="command-category"
              list="action-category-options"
              value={form.category}
              onChange={(e) =>
                field("category", e.target.value as Preset["category"])
              }
              placeholder="Choose or enter a category"
            />
            <datalist id="action-category-options">
              {[
                "Development",
                "Build",
                "Test",
                "Deploy",
                "Database",
                "Maintenance",
                "Utilities",
                "Custom",
              ].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="field-label" htmlFor="command-environment">
              Environment
            </label>
            <select
              id="command-environment"
              value={form.environment}
              onChange={(e) => field("environment", e.target.value)}
            >
              {["Local", "Development", "Staging", "Production"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <label className="field-label" htmlFor="action-icon">
          Icon
        </label>
        <select
          id="action-icon"
          value={form.icon || "Terminal"}
          onChange={(e) => field("icon", e.target.value)}
        >
          {[
            "Terminal",
            "Play",
            "Rocket",
            "Code2",
            "Database",
            "FileCode",
            "FlaskConical",
            "Hammer",
            "Package",
            "Sparkles",
            "Trash2",
            "Wrench",
            "ShieldCheck",
            "Braces",
            "GitBranch",
          ].map((icon) => (
            <option key={icon} value={icon}>
              {icon}
            </option>
          ))}
        </select>
        <label className="field-label" htmlFor="command-cwd">
          Working directory <span>relative to project</span>
        </label>
        <input
          id="command-cwd"
          value={form.cwd}
          onChange={(e) => field("cwd", e.target.value)}
          placeholder=". (project root)"
        />
        <label className="field-label" htmlFor="command-env">
          Environment bindings <span>names only, no secrets</span>
        </label>
        <textarea
          id="command-env"
          className="mono"
          value={env}
          onChange={(e) => setEnv(e.target.value)}
          placeholder="DATABASE_URL=PIT_BOSS_DATABASE_URL"
          rows={2}
        />
        <p className="form-hint">
          Values are inherited from your desktop launch environment and redacted
          from captured output.
        </p>
        <label className="field-label" htmlFor="confirmation-mode">
          Confirmation
        </label>
        <select
          id="confirmation-mode"
          value={
            form.confirmationMode || (form.confirmation ? "Always" : "Never")
          }
          onChange={(e) => {
            const confirmationMode = e.target
              .value as Preset["confirmationMode"];
            setForm((previous) => ({
              ...previous,
              confirmationMode,
              confirmation: confirmationMode === "Always",
            }));
          }}
        >
          <option>Never</option>
          <option>Always</option>
          <option>Only in Production</option>
        </select>
        <p className="form-hint">
          Production actions always ask you to type the project name.
        </p>
        <label className="field-label" htmlFor="action-shortcut">
          Keyboard shortcut <span>optional · one letter or number</span>
        </label>
        <input
          id="action-shortcut"
          value={form.keyboardShortcut}
          maxLength={1}
          onChange={(e) =>
            field(
              "keyboardShortcut",
              e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
            )
          }
          placeholder="e.g. T"
        />
        <div className="checkboxes">
          {[
            [
              "dangerous",
              "Dangerous action · type the project name to confirm",
            ],
            ["pinned", "Pin to the project toolbar"],
            ["persistent", "Long-running process"],
            ["concurrent", "Allow concurrent runs"],
          ].map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={
                  form[
                    key as "dangerous" | "pinned" | "persistent" | "concurrent"
                  ]
                }
                onChange={(e) =>
                  field(
                    key as "dangerous" | "pinned" | "persistent" | "concurrent",
                    e.target.checked,
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit">
            <Check size={14} /> Save action
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function Palette({
  projects,
  onClose,
  onRun,
  onOpen,
  onPage,
  onGroup,
}: {
  projects: Project[];
  onClose: () => void;
  onRun: (r: RunRequest) => void;
  onOpen: (p: Project, target: string) => void;
  onPage: (page: "The Pit" | "Projects" | "Runs" | "Deployments") => void;
  onGroup: () => void;
}) {
  const [query, setQuery] = useState(""),
    [index, setIndex] = useState(0);
  const actions = useMemo(
    () => [
      ...(["The Pit", "Projects", "Runs", "Deployments"] as const).map(
        (page) => ({
          label: `Go to ${page}`,
          sub: "Navigation",
          icon: <ArrowRight size={16} />,
          action: () => onPage(page),
        }),
      ),
      {
        label: "Start all development servers",
        sub: "All projects",
        icon: <Play size={16} />,
        action: onGroup,
      },
      ...projects.flatMap((project) => [
        ...project.commands.map((preset) => ({
          label: `${project.name} · ${preset.name}`,
          sub: `${preset.category} · ${preset.description} · ${preset.command}`,
          icon: <Terminal size={16} />,
          action: () => onRun({ project, preset }),
        })),
        ...["terminal", "editor", "repository"].map((target) => ({
          label: `Open ${target} · ${project.name}`,
          sub: project.path,
          icon: <GitBranch size={16} />,
          action: () => onOpen(project, target),
        })),
      ]),
    ],
    [projects, onPage, onGroup, onRun, onOpen],
  );
  const filtered = actions
    .filter((a) =>
      `${a.label} ${a.sub}`.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 18);
  function choose(i: number) {
    const a = filtered[i];
    if (a) {
      onClose();
      a.action();
    }
  }
  return (
    <Modal title="Command center" onClose={onClose} wide>
      <div className="palette-search">
        <Search size={19} />
        <input
          autoFocus
          aria-label="Search commands"
          placeholder="What would you like to do?"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex(Math.min(index + 1, filtered.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex(Math.max(0, index - 1));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              choose(index);
            }
          }}
        />
        <Shortcut>esc</Shortcut>
      </div>
      <div className="palette-results">
        {filtered.map((a, i) => (
          <button
            key={a.label}
            className={i === index ? "selected" : ""}
            onClick={() => choose(i)}
            onMouseEnter={() => setIndex(i)}
          >
            {a.icon}
            <span>
              <strong>{a.label}</strong>
              <small>{a.sub}</small>
            </span>
            <ChevronRight size={13} />
          </button>
        ))}
        {!filtered.length && (
          <p className="muted">No matching commands. Try a project name.</p>
        )}
      </div>
      <div className="palette-footer">
        <Command size={13} /> Your whole workspace, one command away.
        <span>↑ ↓ navigate · ↵ select</span>
      </div>
    </Modal>
  );
}
