import type { Project, Preset, Run, Snapshot } from "./types";
export const preset = (
  name: string,
  command: string,
  category: Preset["category"],
  extra: Partial<Preset> = {},
): Preset => ({
  id: crypto.randomUUID(),
  name,
  description: "",
  command,
  category,
  icon: "Terminal",
  cwd: "",
  environment: "Local",
  confirmation: false,
  confirmationMode: "Never",
  dangerous: false,
  pinned: ["Development", "Build", "Test", "Deploy"].includes(category),
  sortOrder: 0,
  keyboardShortcut: "",
  persistent: category === "Development",
  concurrent: false,
  env: {},
  ...extra,
});
const start = Date.now();
const names = [
  "Shipwreck",
  "Repo Reaper",
  "Port Authority",
  "Diffusion",
  "Env Reaper",
  "Stack Tech",
];
const techs = [
  ["Next.js", "TypeScript"],
  ["Rust", "Tauri"],
  ["React", "Vite"],
  ["Python", "FastAPI"],
  ["Node.js", "TypeScript"],
  ["Next.js", "Postgres"],
];
const descriptions = [
  "Ship something worth shipping.",
  "A clean slate for your repositories.",
  "Every port. Accounted for.",
  "Ideas, in motion.",
  "Keep your environments in check.",
  "Your stack, brought together.",
];
export function createDemo(): Snapshot {
  const projects: Project[] = names.map((name, i) => ({
    id: `demo-${i}`,
    name,
    path: `~/Code/${name.toLowerCase().replaceAll(" ", "-")}`,
    description: descriptions[i],
    technologies: techs[i],
    packageManager: i === 1 ? "cargo" : i === 3 ? "uv" : "pnpm",
    git: {
      branch: i === 3 ? "feat/pipeline" : i === 0 ? "feat/dashboard" : "main",
      commit: [
        "a4e82f1",
        "f32bc7a",
        "b8d91e2",
        "9c17ef3",
        "72abe01",
        "c9ee02a",
      ][i],
      message: "Refine application workflow",
      remote: `https://github.com/oddware/${name.toLowerCase().replaceAll(" ", "-")}`,
      changes: [3, 0, 0, 7, 0, 2][i],
      ahead: 0,
      behind: 0,
    },
    commands: [
      preset(
        "Development",
        i === 1
          ? "cargo run"
          : i === 3
            ? "uv run uvicorn app:app --reload"
            : "pnpm run dev",
        "Development",
        { id: `dev-${i}` },
      ),
      preset("Build", i === 1 ? "cargo build" : "pnpm run build", "Build", {
        id: `build-${i}`,
      }),
      preset(
        "Tests",
        i === 1 ? "cargo test" : i === 3 ? "uv run pytest" : "pnpm test",
        "Test",
        { id: `test-${i}` },
      ),
      preset("Deploy staging", "pnpm run deploy:staging", "Deploy", {
        id: `deploy-${i}`,
        environment: "Staging",
        confirmation: true,
      }),
      preset("Deploy production", "./scripts/deploy-production.sh", "Deploy", {
        environment: "Production",
        confirmation: true,
      }),
      preset("Pull", "git pull --ff-only", "Maintenance"),
    ],
    suggestions: [],
    favorite: i < 3,
    group: "Oddware",
    color: ["blue", "purple", "teal", "orange", "lime", "pink"][i],
    envFiles: [".env.local", ".env.example"],
  }));
  function run(
    i: number,
    ci: number,
    status: Run["status"],
    age: number,
    output: string,
    ports: number[] = [],
  ): Run {
    const p = projects[i],
      c = p.commands[ci];
    return {
      id: `demo-run-${i}-${ci}`,
      projectId: p.id,
      projectName: p.name,
      presetId: c.id,
      name: c.name,
      command: c.command,
      cwd: p.path,
      category: c.category,
      environment: c.environment,
      branch: p.git.branch,
      commit: p.git.commit,
      startedAt: start - age,
      endedAt: status === "running" ? null : start - age + 28000,
      exitCode: status === "running" ? null : status === "failed" ? 1 : 0,
      status,
      output: `[demo session — illustrative output]\n${output}`,
      pid: status === "running" ? 18420 + i : null,
      ports,
      cpu: status === "running" ? [1.2, 0.4, 0.8][i] : 0,
      memory: status === "running" ? [142, 38, 86][i] * 1048576 : 0,
    };
  }
  return {
    projects,
    runs: [
      run(
        0,
        0,
        "running",
        984000,
        "$ pnpm run dev\n\n  ▲ Next.js 15.2.3\n  - Local:        http://localhost:3000\n  - Environments: .env.local\n\n ✓ Starting...\n ✓ Ready in 842ms\n ○ Compiling /dashboard ...\n ✓ Compiled /dashboard in 312ms\n GET /dashboard 200 in 48ms\n GET /api/projects 200 in 21ms\n",
        [3000],
      ),
      run(
        1,
        0,
        "running",
        1524000,
        "$ cargo run\n   Compiling repo-reaper v0.1.0\n    Finished dev profile in 2.34s\n     Running target/debug/repo-reaper\n  Watching for repository changes…\n",
      ),
      run(
        2,
        0,
        "running",
        780000,
        "$ pnpm run dev\n\n  VITE v6.1.0  ready in 189 ms\n\n  ➜ Local: http://localhost:5173/\n  ➜ Watching for file changes\n",
        [5173],
      ),
      run(
        3,
        1,
        "failed",
        360000,
        "$ pnpm run build\n\n[stderr] Build failed: missing environment variable\n[stderr] DATABASE_URL is not configured.\n\nProcess exited with code 1.\n",
      ),
      run(
        0,
        3,
        "success",
        2100000,
        "$ pnpm run deploy:staging\n✓ Build complete\n✓ Assets uploaded\n✓ Deployment healthy\n",
      ),
      run(
        1,
        2,
        "success",
        2700000,
        "$ cargo test\n\nrunning 24 tests\ntest result: ok. 24 passed; 0 failed\n",
      ),
      run(
        4,
        1,
        "success",
        3600000,
        "$ pnpm run build\n✓ Build completed in 1.23s\n",
      ),
    ],
  };
}
