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
import { duration } from "../bridge";
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
    [copied, setCopied] = useState(false);
  const pre = useRef<HTMLPreElement>(null),
    autoScroll = useRef(true);
  const run = runs.find((r) => r.id === selectedId) || runs[0];
  const output = run?.output.slice(cleared[run.id] || 0) || "";
  useEffect(() => {
    if (pre.current && autoScroll.current)
      pre.current.scrollTop = pre.current.scrollHeight;
  }, [output, collapsed, selectedId]);
  useEffect(() => {
    autoScroll.current = true;
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
          <TerminalIcon size={14} /> TERMINAL
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
              {duration(run)} · {run.status}
              {run.exitCode !== null && ` · exit ${run.exitCode}`}
            </span>
            <button
              title="Copy output"
              aria-label="Copy output"
              className="icon-btn"
              onClick={() => {
                void navigator.clipboard.writeText(output).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                });
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
            {run.status === "running" && (
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
          <pre
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
            {output.split("\n").map((line, i) => (
              <div
                key={i}
                className={
                  line.includes("[stderr]") || line.includes("failed")
                    ? "log-error"
                    : line.includes("✓") ||
                        line.includes("Ready") ||
                        line.includes("200")
                      ? "log-success"
                      : line.includes("http")
                        ? "log-link"
                        : line.includes("[demo") || line.includes("[DEMO")
                          ? "log-muted"
                          : ""
                }
              >
                <span className="line-number">{i + 1}</span>
                {line || " "}
              </div>
            ))}
            {run.status === "running" && <span className="terminal-cursor" />}
          </pre>
        </>
      )}
    </section>
  );
}
