import { test, expect } from "@playwright/test";
import { plainText } from "../src/terminal-text";
import { mergeRuns } from "../src/run-state";
import { createDemo } from "../src/demo";

test("terminal formatting handles carriage return and discards active escape sequences", () => {
  expect(plainText("10%\r20%\rDone\n\u001b[31merror\u001b[0m")).toBe(
    "Done\nerror",
  );
  expect(
    plainText("\u001b]8;;https://unsafe.example\u0007link\u001b]8;;\u0007"),
  ).toBe("link");
  expect(plainText("<script>alert(1)</script>")).toBe(
    "<script>alert(1)</script>",
  );
});

test("late lifecycle snapshots cannot regress preparation or completed executions", () => {
  const template = createDemo().runs[0];
  const old = { ...template, status: "awaiting_confirmation" as const };
  const running = { ...template, status: "running" as const };
  const terminal = { ...template, status: "timed_out" as const };
  expect(mergeRuns([terminal], [old, running])[0]).toEqual(terminal);
});

test("successful build exposes audit details, search, export, retry and history filters", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "On the floor" }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Search commands" })
    .fill("Repo Reaper · Build");
  await page.keyboard.press("Enter");
  const review = page.getByRole("dialog");
  await expect(review.getByLabel("Preflight results")).toContainText(
    "Browser simulation",
  );
  await expect(review).toContainText("Rollback:");
  await review.getByRole("button", { name: "Confirm & run" }).click();
  await expect(page.locator(".terminal-meta")).toContainText("Succeeded");
  await page.locator(".execution-details > summary").click();
  await expect(page.locator(".execution-details")).toContainText("Confirmed");
  await expect(page.locator(".execution-details")).toContainText(
    "Correlation:",
  );
  await page.getByRole("textbox", { name: "Search output" }).fill("completed");
  await expect(page.locator(".terminal-output")).toContainText(
    "completed successfully",
  );
  await expect(page.locator(".terminal-output")).not.toContainText(
    "Preparing project",
  );
  await page.getByRole("button", { name: "Pause scrolling" }).click();
  await expect(
    page.getByRole("button", { name: "Follow output" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export sanitized log" }).click();
  expect((await download).suggestedFilename()).toMatch(/^pit-boss-.*\.log$/);
  await page.getByRole("button", { name: "Rerun command" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm & run" })
    .click();
  await expect(page.locator(".terminal-meta")).toContainText("Succeeded");
  await page.locator(".execution-details > summary").click();
  await expect(
    page.getByRole("button", { name: "Original execution", exact: true }),
  ).toBeEnabled();
  await page.locator(".nav-item").filter({ hasText: /^Runs/ }).click();
  await page.getByLabel("Filter action type").selectOption("Build");
  await page.getByLabel("Filter trigger source").selectOption("manual");
  await page.getByLabel("Sort history").selectOption("oldest");
  await expect(page.locator(".data-table tbody tr")).not.toHaveCount(0);
});

test("destructive metadata enforces typed review and cancelling leaves an audit trail", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".project-name").filter({ hasText: "Shipwreck" }).click();
  await page.getByRole("button", { name: "Add action", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Protected diagnostic");
  await page.getByLabel("Command", { exact: true }).fill("echo safe-fixture");
  await page
    .getByText("Execution safety and preflight", { exact: true })
    .click();
  await page.getByLabel("Risk level").selectOption("destructive");
  await page.getByRole("button", { name: "Save action" }).click();
  await page
    .locator(".command-row")
    .filter({ hasText: "Protected diagnostic" })
    .getByRole("button", { name: /^Run/ })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Confirm & run" }),
  ).toBeDisabled();
  await page.getByLabel("Action confirmation").fill("Shipwreck");
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Confirm & run" }),
  ).toBeEnabled();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.locator(".nav-item").filter({ hasText: /^Runs/ }).click();
  await page.getByLabel("Search history").fill("Protected diagnostic");
  await expect(page.locator(".data-table tbody tr")).toContainText("Cancelled");
});

test("failed execution details display evidence, exit code and a safe retry path", async ({
  page,
}) => {
  const demo = createDemo();
  const original = demo.runs[0];
  const failure = {
    ...original,
    id: "failure-display-fixture",
    name: "Build failure fixture",
    status: "failed",
    exitCode: 1,
    startedAt: Date.now() - 4000,
    endedAt: Date.now(),
    output: "[stderr] error[E0308]: mismatched types\n",
    details: {
      revision: 4,
      preflight: [],
      transitions: [],
      risk: "caution",
      triggerSource: "manual",
      correlationId: "fixture",
      logReference: "demo",
      logTruncated: false,
      outputEvents: [],
      artifacts: [],
      failure: {
        category: "compilation",
        summary: "Likely cause: Rust compiler diagnostic",
        evidence: "error[E0308]: mismatched types",
        nextStep:
          "Open the first compiler diagnostic and inspect the referenced file.",
      },
    },
  };
  await page.addInitScript(
    (snapshot) =>
      localStorage.setItem("pit-boss-demo-v1", JSON.stringify(snapshot)),
    { ...demo, runs: [failure, ...demo.runs] },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "On the floor" }),
  ).toBeVisible();
  await page.locator(".nav-item").filter({ hasText: /^Runs/ }).click();
  await page.getByLabel("Search history").fill("Build failure fixture");
  await page.locator(".data-table tbody tr").click();
  await expect(page.locator(".terminal-meta")).toContainText("exit 1");
  await expect(page.locator(".execution-failure")).toContainText(
    "Likely cause: Rust compiler diagnostic",
  );
  await page.getByRole("button", { name: "Find evidence in output" }).click();
  await expect(page.locator(".terminal-output")).toContainText("E0308");
  await page.screenshot({
    path: "test-results/execution-failure.png",
    fullPage: true,
  });
});
