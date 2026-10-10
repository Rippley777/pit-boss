export type Status =
  | "queued"
  | "preflighting"
  | "awaiting_confirmation"
  | "starting"
  | "running"
  | "success"
  | "failed"
  | "stopped"
  | "cancelled"
  | "timed_out"
  | "interrupted";
export type Category =
  | "Development"
  | "Build"
  | "Test"
  | "Deploy"
  | "Database"
  | "Maintenance"
  | "Utilities"
  | "Custom";
export type ConfirmationMode = "Never" | "Always" | "Only in Production";
export interface GitInfo {
  branch: string;
  commit: string;
  message: string;
  remote: string;
  changes: number;
  ahead: number;
  behind: number;
}
export interface Preset {
  id: string;
  name: string;
  description: string;
  command: string;
  cwd: string;
  category: Category;
  icon: string;
  environment: string;
  confirmation: boolean;
  confirmationMode: ConfirmationMode;
  dangerous: boolean;
  pinned: boolean;
  sortOrder: number;
  keyboardShortcut: string;
  persistent: boolean;
  concurrent: boolean;
  env: Record<string, string>;
  policy?: ExecutionPolicy;
}
export interface Project {
  id: string;
  name: string;
  path: string;
  description: string;
  technologies: string[];
  packageManager: string;
  git: GitInfo;
  commands: Preset[];
  suggestions: Preset[];
  favorite: boolean;
  group: string;
  color: string;
  envFiles: string[];
}
export type ProjectAction = Preset;
export interface Run {
  id: string;
  projectId: string;
  projectName: string;
  presetId: string;
  name: string;
  command: string;
  cwd: string;
  category: Category;
  environment: string;
  branch: string;
  commit: string;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  status: Status;
  output: string;
  pid: number | null;
  ports: number[];
  cpu: number;
  memory: number;
  details?: ExecutionDetails;
}
export interface Snapshot {
  projects: Project[];
  runs: Run[];
  portAuthority: PortAuthorityStatus;
}
export interface PortAuthorityStatus {
  installed: boolean;
  autopilotEnabled: boolean;
  ready: boolean;
  binaryPath: string | null;
  detail: string;
}
export type Page =
  | "The Pit"
  | "Dashboard"
  | "Projects"
  | "Runs"
  | "Deployments"
  | "Activity"
  | "Settings";
export interface RunRequest {
  project: Project;
  preset: Preset;
  restart?: Run;
  retryOf?: string;
  prepared?: Run;
  confirmation?: string;
  warnings?: boolean;
}

export interface ExecutionPolicy {
  risk?: "safe" | "caution" | "destructive" | "production_critical" | "";
  concurrency?:
    "parallel" | "project" | "action" | "deployment" | "global" | "";
  timeoutSeconds?: number;
  requiredFiles?: string[];
  requiredTools?: string[];
  requiredEnv?: string[];
  expectedArtifacts?: string[];
  deploymentBranch?: string;
  denyWarnings?: boolean;
  impact?: string;
  rollback?: string;
}
export interface PreflightCheck {
  id: string;
  description: string;
  result: "pass" | "warning" | "blocked" | "skipped";
  explanation: string;
  resolution: string;
  durationMs: number;
}
export interface ExecutionDetails {
  revision: number;
  transitions: { state: Status; at: number }[];
  preflight: PreflightCheck[];
  risk: string;
  triggerSource: string;
  correlationId: string;
  retryOf?: string | null;
  confirmation?: {
    at: number;
    expiresAt: number;
    warningOverrides: string[];
  } | null;
  failure?: {
    category: string;
    summary: string;
    evidence: string;
    nextStep: string;
  } | null;
  signal?: number | null;
  durationMs?: number | null;
  processStartedAt?: number | null;
  logReference: string;
  logTruncated: boolean;
  outputEvents: { at: number; stream: string; text: string }[];
  artifacts: { path: string; size: number }[];
}
