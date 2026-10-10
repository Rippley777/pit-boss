import {
  Activity,
  Anchor,
  Box,
  Braces,
  Check,
  ChevronRight,
  Circle,
  Code2,
  Cpu,
  Database,
  FileCode,
  FlaskConical,
  GitBranch,
  Hammer,
  Layers,
  Network,
  Package,
  Play,
  Rocket,
  ShieldCheck,
  Sparkles,
  Spade,
  Terminal,
  Trash2,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { Project } from "../types";
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand-mark ${small ? "small" : ""}`}>
      <Spade size={small ? 16 : 23} fill="currentColor" strokeWidth={1.5} />
    </div>
  );
}
const icons: Record<string, LucideIcon> = {
  Shipwreck: Anchor,
  "Repo Reaper": Box,
  "Port Authority": Network,
  Diffusion: Layers,
  "Env Reaper": ShieldCheck,
  "Stack Tech": Braces,
};
export function ProjectIcon({
  project,
  small = false,
}: {
  project: Project;
  small?: boolean;
}) {
  const Icon = icons[project.name] || Braces;
  return (
    <span className={`project-icon ${project.color} ${small ? "small" : ""}`}>
      <Icon size={small ? 17 : 23} strokeWidth={1.7} />
    </span>
  );
}
const actionIcons: Record<string, LucideIcon> = {
  Terminal,
  Play,
  Rocket,
  Code2,
  Database,
  FileCode,
  FlaskConical,
  Hammer,
  Package,
  Sparkles,
  Trash2,
  Wrench,
  ShieldCheck,
  Braces,
  GitBranch,
};
export function ActionGlyph({
  name,
  size = 15,
}: {
  name: string;
  size?: number;
}) {
  const Icon = actionIcons[name] || Terminal;
  return <Icon size={size} strokeWidth={1.8} />;
}
export function StatusBadge({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  return (
    <span className={`status-badge ${status}`}>
      <span className="status-dot" />
      {label ||
        (
          {
            running: "Running",
            failed: "Failed",
            stopped: "Stopped",
            success: "Succeeded",
            queued: "Queued",
            preflighting: "Preflighting",
            awaiting_confirmation: "Awaiting confirmation",
            starting: "Starting",
            cancelled: "Cancelled",
            timed_out: "Timed out",
            interrupted: "Interrupted",
          } as Record<string, string>
        )[status] ||
        status}
    </span>
  );
}
export function Branch({ project }: { project: Project }) {
  return (
    <span className="branch">
      <GitBranch size={12} />
      {project.git.branch || "No repository"}
      {project.git.changes > 0 && (
        <span
          className="dirty-dot"
          title={`${project.git.changes} uncommitted changes`}
        />
      )}
    </span>
  );
}
export function Empty({
  title,
  children,
  icon: Icon = Box,
}: {
  title: string;
  children?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={27} />
      </span>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current!;
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input, select, textarea, [tabindex="0"]',
        ),
      );
    focusable()[1]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const elements = focusable(),
          first = elements[0],
          last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-btn"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Sparkline({
  color = "var(--lime)",
  variant = 0,
}: {
  color?: string;
  variant?: number;
}) {
  const lines = [
    "0,29 9,27 17,30 26,15 35,20 43,16 52,22 61,12 70,15 79,9 89,14 98,5 108,8 120,4",
    "0,24 10,24 20,19 30,21 40,12 50,17 60,16 70,20 80,12 90,15 100,9 110,13 120,9",
    "0,26 15,26 15,20 35,20 35,15 62,15 62,9 88,9 88,4 120,4",
  ];
  return (
    <svg
      className="sparkline"
      viewBox="0 0 120 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={`M${lines[variant % 3].replaceAll(" ", " L")} L120,40 L0,40 Z`}
        fill={color}
        opacity=".045"
      />
      <polyline
        points={lines[variant % 3]}
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
export function SectionHeading({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <h2>
        {title}
        {count !== undefined && <span className="count">{count}</span>}
      </h2>
      <div>{children}</div>
    </div>
  );
}
export function ActivityIcon({ status }: { status: string }) {
  const Icon =
    status === "running"
      ? Activity
      : status === "success"
        ? Check
        : status === "failed"
          ? X
          : Circle;
  return (
    <span className={`activity-icon ${status}`}>
      <Icon size={13} />
    </span>
  );
}
export function DetailLine({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="detail-line">
      <span>{label}</span>
      <span>{children}</span>
    </div>
  );
}
export function Shortcut({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}
export { Cpu, ChevronRight };
