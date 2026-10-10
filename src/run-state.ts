import type { Run } from "./types";
export const isActive = (status: Run["status"]) =>
  [
    "queued",
    "preflighting",
    "awaiting_confirmation",
    "starting",
    "running",
  ].includes(status);
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
        (!isActive(previous.status) && isActive(run.status)) ||
        (previous.details &&
          run.details &&
          previous.details.revision > run.details.revision))
    )
      continue;
    runs.set(run.id, run);
  }
  return [...runs.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .filter((run, index) => index < 500 || isActive(run.status));
}
