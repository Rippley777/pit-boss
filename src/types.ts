export type Status =
  "running" | "success" | "failed" | "stopped" | "interrupted";
export type Category =
  | "Development"
  | "Build"
  | "Test"
  | "Deploy"
  | "Database"
  | "Maintenance"
  | "Custom";
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
  command: string;
  cwd: string;
  category: Category;
  environment: string;
  confirmation: boolean;
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
  favorite: boolean;
  group: string;
  color: string;
  envFiles: string[];
}
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
