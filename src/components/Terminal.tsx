import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eraser,
  Maximize2,
  Minimize2,
  RotateCw,
  Square,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, duration } from "../bridge";
import { coloredLine, plainText, terminalText } from "../terminal-text";
import { isActive } from "../run-state";
import type { Run } from "../types";
export default function Terminal({
  runs,
  selectedId,
  onSelect,
  onClose,
  onStop,
  onRerun,
}: {
  runs: Run[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onStop: (run: Run) => void;
  onRerun: (run: Run) => void;
}) {
  const [collapsed, setCollapsed] = useState(false),
    [expanded, setExpanded] = useState(false),
    [cleared, setCleared] = useState<Record<string, number>>({}),
    [copied, setCopied] = useState(false),
    [search, setSearch] = useState(""),
    [follow, setFollow] = useState(true),
    [copyError, setCopyError] = useState("");
  const pre = useRef<HTMLPreElement>(null),
    autoScroll = useRef(true);
  const run = runs.find((r) => r.id === selectedId) || runs[0];
  const output = run?.output.slice(cleared[run.id] || 0) || "";
  const lines = terminalText(output).split("\n");
  const filtered = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) =>
      plainText(line).toLowerCase().includes(search.toLowerCase()),
    );
  const displayed = filtered.slice(-2000);

  useEffect(() => {
    if (pre.current && autoScroll.current && follow)
      pre.current.scrollTop = pre.current.scrollHeight;
  }, [output, collapsed, selectedId, follow]);
  useEffect(() => {
    autoScroll.current = true;
    setFollow(true);
    setSearch("");
  }, [selectedId]);
  if (!run) return null;
  const tabs = [
    run,
    ...runs.filter((r) => r.id !== run.id && r.status === "running"),
  ].slice(0, 5);
  return (
    <section
      className={`terminal-drawer ${collapsed ? "collapsed" : ""} ${expanded ? "expanded" : ""}`}
      aria-label="Command session"
    >
      <div className="terminal-toolbar">
        <span className="terminal-label">
          <TerminalIcon size={14} /> EXECUTION
        </span>
        <div className="terminal-tabs">
          {tabs.map((r) => (
            <button
              className={r.id === run.id ? "selected" : ""}
              key={r.id}
              onClick={() => onSelect(r.id)}
            >
              <span className={`tiny-dot ${r.status}`} />
              {r.projectName.toLowerCase().replaceAll(" ", "-")}
              <span className="tab-command">{r.name.toLowerCase()}</span>
            </button>
          ))}
        </div>
        <div className="terminal-tools">
          <button
            aria-label={collapsed ? "Expand terminal" : "Collapse terminal"}
            className="icon-btn"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          <button
            aria-label="Maximize terminal"
            className="icon-btn"
            onClick={() => {
              setExpanded(!expanded);
              setCollapsed(false);
            }}
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            aria-label="Close terminal"
            className="icon-btn"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
          <div className="terminal-meta">
            <span className="terminal-prompt">❯</span>
            <code>{run.command}</code>
            <span className="terminal-path">{run.cwd}</span>
            <span
              className="terminal-time"
              title={new Date(run.startedAt).toLocaleString()}
            >
              {duration(run)} ·{" "}
              {run.status === "success"
                ? "Succeeded"
                : run.status.replaceAll("_", " ")}
              {run.exitCode !== null && ` · exit ${run.exitCode}`}
            </span>
            <button
              title="Copy output"
              aria-label="Copy output"
              className="icon-btn"
              onClick={() => {
                void navigator.clipboard
                  .writeText(
                    displayed.map(({ line }) => plainText(line)).join("\n"),
                  )
                  .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  })
                  .catch((e) => setCopyError(String(e)));
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
            <button
              title="Clear visible output"
              aria-label="Clear visible output"
              className="icon-btn"
              onClick={() =>
                setCleared({ ...cleared, [run.id]: run.output.length })
              }
            >
              <Eraser size={13} />
            </button>
            <button
              title="Rerun command"
              aria-label="Rerun command"
              className="icon-btn"
              onClick={() => onRerun(run)}
            >
              <RotateCw size={13} />
            </button>
            {isActive(run.status) && (
              <button
                title="Stop command"
                aria-label="Stop command"
                className="icon-btn danger"
                onClick={() => onStop(run)}
              >
                <Square size={12} />
              </button>
            )}
          </div>
          <details className="execution-details" key={run.id}>
            <summary>
              {run.projectName} · {run.name} · Execution details
              {run.details?.failure ? " · Attention required" : ""}
            </summary>
            <div className="execution-detail-grid">
              <div>
                <strong>Execution</strong>
                <code>{run.id}</code>
                <span>Trigger: {run.details?.triggerSource || "manual"}</span>
                <span>Started: {new Date(run.startedAt).toLocaleString()}</span>
                <span>
                  Ended:{" "}
                  {run.endedAt
                    ? new Date(run.endedAt).toLocaleString()
                    : "Pending"}
                </span>
                <span>Signal: {run.details?.signal ?? "—"}</span>
                <code>
                  Correlation:{" "}
                  {run.details?.correlationId || "Not recorded (legacy)"}
                </code>
              </div>
              <div>
                <strong>Confirmation</strong>
                <span>
                  Risk:{" "}
                  {run.details?.risk.replaceAll("_", " ") ||
                    "Not recorded (legacy)"}
                </span>
                <span>
                  {run.details?.confirmation
                    ? `Confirmed ${new Date(run.details.confirmation.at).toLocaleString()}`
                    : "No recorded approval"}
                </span>
                <span>
                  Warning overrides:{" "}
                  {run.details?.confirmation?.warningOverrides.join(", ") ||
                    "None"}
                </span>
                <code>
                  Log: {run.details?.logReference || "Stored with execution"}
                </code>
              </div>
            </div>
            <div className="preflight-results">
              {run.details?.preflight.map((check) => (
                <div
                  className={`preflight-check ${check.result}`}
                  key={check.id}
                >
                  <strong>
                    {check.result.toUpperCase()} · {check.description} ·{" "}
                    {check.durationMs}ms
                  </strong>
                  <span>{check.explanation}</span>
                  {check.result !== "pass" && <span>{check.resolution}</span>}
                </div>
              )) || (
                <p>
                  Preflight details were not recorded for this older execution.
                </p>
              )}
            </div>
            <p>
              Lifecycle:{" "}
              {run.details?.transitions
                .map(
                  (t) =>
                    `${t.state.replaceAll("_", " ")} (${new Date(t.at).toLocaleTimeString()})`,
                )
                .join(" → ") || run.status}
            </p>
            <strong>Artifacts and preserved outputs</strong>
            {run.details?.artifacts.length ? (
              run.details.artifacts.map((a) => (
                <p key={a.path}>
                  <code>{a.path}</code> · {a.size.toLocaleString()} bytes
                </p>
              ))
            ) : (
              <p>
                No artifacts declared or verified. Check the command output for
                script-managed release paths.
              </p>
            )}
            {run.details?.retryOf && (
              <button
                className="button secondary"
                disabled={!runs.some((r) => r.id === run.details?.retryOf)}
                onClick={() => onSelect(run.details!.retryOf!)}
              >
                Original execution
                {!runs.some((r) => r.id === run.details?.retryOf) &&
                  " (outside loaded history or removed by retention)"}
              </button>
            )}
            {runs
              .filter((r) => r.details?.retryOf === run.id)
              .map((r) => (
                <button
                  key={r.id}
                  className="button secondary"
                  onClick={() => onSelect(r.id)}
                >
                  Related retry · {new Date(r.startedAt).toLocaleString()}
                </button>
              ))}
            {run.details?.outputEvents.length ? (
              <details>
                <summary>Recent output timestamps</summary>
                {run.details.outputEvents.slice(-50).map((e, i) => (
                  <p key={i}>
                    <code>
                      {new Date(e.at).toLocaleTimeString()} · {e.stream}
                    </code>{" "}
                    {plainText(e.text).slice(0, 200)}
                  </p>
                ))}
              </details>
            ) : null}
          </details>
          {run.details?.failure && (
            <div className="execution-failure" role="status">
              <strong>{run.details.failure.summary}</strong>
              <span>{run.details.failure.nextStep}</span>
              <button
                className="button secondary"
                onClick={() => {
                  setSearch(
                    plainText(run.details!.failure!.evidence).slice(0, 120),
                  );
                  setFollow(false);
                  pre.current?.focus();
                }}
              >
                Find evidence in output
              </button>
              <code>{run.details.failure.evidence}</code>
              <span>
                Retry creates a fresh execution and requires new preflight and
                approval. Check partial side effects first.
              </span>
            </div>
          )}
          <div className="output-controls">
            <input
              aria-label="Search output"
              placeholder="Search output…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              className="button secondary"
              aria-pressed={follow}
              onClick={() => {
                autoScroll.current = true;
                setFollow(!follow);
              }}
            >
              {follow ? "Pause scrolling" : "Follow output"}
            </button>
            <button
              className="button secondary"
              onClick={() => {
                void api.exportLog(run).catch((e) => setCopyError(String(e)));
              }}
            >
              Export sanitized log
            </button>
            <span>
              {filtered.length} lines
              {filtered.length > 2000 ? " · showing last 2,000" : ""}
            </span>
          </div>
          {(run.details?.logTruncated || copyError) && (
            <p className="log-notice">
              {copyError ||
                "Earlier output exceeded the 1 MiB retention limit and is no longer available. Export contains the retained tail."}
            </p>
          )}
          <pre
            tabIndex={0}
            aria-label="Execution output"
            ref={pre}
            className="terminal-output"
            onScroll={() => {
              if (pre.current)
                autoScroll.current =
                  pre.current.scrollHeight -
                    pre.current.scrollTop -
                    pre.current.clientHeight <
                  40;
            }}
          >
            {displayed.map(({ line, index }) => (
              <div
                key={index}
                className={line.includes("[stderr]") ? "log-error" : ""}
              >
                <span className="line-number">{index + 1}</span>
                {coloredLine(line || " ")}
              </div>
            ))}
            {run.status === "running" && <span className="terminal-cursor" />}
          </pre>
        </>
      )}
    </section>
  );
}
