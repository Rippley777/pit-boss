import type { Run } from "./types";
/** IPC responses can arrive after newer lifecycle events; a terminal state must never regress. */
export function mergeRuns(
  current: Run[],
  incoming: Run[],
  preserveExisting = false,
): Run[] {
  const runs = new Map(current.map((run) => [run.id, run]));
  for (const run of incoming) {
    const previous = runs.get(run.id);
    if (
      previous &&
      (preserveExisting ||
        (previous.status !== "running" && run.status === "running"))
    )
      continue;
    runs.set(run.id, run);
  }
  return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt);
}
