export type Status =
  "running" | "success" | "failed" | "stopped" | "interrupted";
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
}
