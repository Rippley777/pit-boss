import { test, expect } from "@playwright/test";
import { mergeRuns } from "../src/run-state";
import { createDemo } from "../src/demo";
test("late IPC responses cannot resurrect finished processes or erase streamed output", () => {
  const running = createDemo().runs[0];
  const finished = {
    ...running,
    status: "success" as const,
    endedAt: Date.now(),
    exitCode: 0,
    output: "complete",
  };
  expect(mergeRuns([finished], [running])[0]).toEqual(finished);
  const streamed = { ...running, output: "streamed output" };
  expect(mergeRuns([streamed], [{ ...running, output: "" }], true)[0]).toEqual(
    streamed,
  );
  expect(mergeRuns([running], [finished])[0]).toEqual(finished);
});
