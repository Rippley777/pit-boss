import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "On the floor" }),
  ).toBeVisible();
});

test("operations overview, project filtering, favorites and table view", async ({
  page,
}) => {
  await expect(page.locator(".project-card")).toHaveCount(6);
  await expect(page.locator(".project-card.running")).toHaveCount(3);
  await page
    .locator(".status-filters")
    .getByRole("button", { name: "Needs attention" })
    .click();
  await expect(page.locator(".project-card")).toHaveCount(1);
  await expect(page.locator(".project-name")).toContainText("Diffusion");
  await page
    .locator(".status-filters")
    .getByRole("button", { name: /^All/ })
    .click();
  await page.getByRole("button", { name: "Favorites only" }).click();
  await expect(page.locator(".project-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Table view" }).click();
  await expect(page.locator(".project-table tbody tr")).toHaveCount(3);
});

test("command execution requires review, streams logs, and becomes searchable history", async ({
  page,
}) => {
  await page
    .locator(".project-card")
    .filter({ hasText: "Env Reaper" })
    .getByRole("button", { name: "Run", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("pnpm run dev");
  await expect(dialog).toContainText("~/Code/env-reaper");
  await expect(dialog).toContainText("simulated");
  await dialog.getByRole("button", { name: "Confirm & run" }).click();
  await expect(page.locator(".terminal-meta")).toContainText("pnpm run dev");
  await expect(page.locator(".terminal-output")).toContainText(
    "Dependencies checked.",
  );
  await expect(
    page.locator(".project-card").filter({ hasText: "Env Reaper" }),
  ).toContainText("Running");
  await page.locator(".nav-item").filter({ hasText: /^Runs/ }).click();
  await page
    .getByRole("textbox", { name: "Search history" })
    .fill("Env Reaper");
  await expect(page.locator(".data-table tbody tr")).toHaveCount(2);
  await page.getByRole("button", { name: "Stop command", exact: true }).click();
  await expect(page.locator(".terminal-meta")).toContainText("stopped");
});

test("production safeguards and command preset persistence", async ({
  page,
}) => {
  await page.locator(".project-name").filter({ hasText: "Shipwreck" }).click();
  await page
    .locator(".page-tabs")
    .getByRole("button", { name: "Deployments" })
    .click();
  await page
    .locator(".deployment-targets .panel")
    .filter({ hasText: "Production" })
    .getByRole("button", { name: "Deploy", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Confirm & run" }),
  ).toBeDisabled();
  await dialog
    .getByRole("textbox", { name: "Production confirmation" })
    .fill("Shipwreck");
  await expect(
    dialog.getByRole("button", { name: "Confirm & run" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page
    .locator(".page-tabs")
    .getByRole("button", { name: "Commands", exact: true })
    .click();
  await page.getByRole("button", { name: "Add command", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Check health");
  await page.getByLabel("Command", { exact: true }).fill("echo healthy");
  await page.getByRole("button", { name: "Save preset" }).click();
  await expect(
    page.locator(".command-row").filter({ hasText: "Check health" }),
  ).toContainText("echo healthy");
  await page.reload();
  await page.locator(".project-name").filter({ hasText: "Shipwreck" }).click();
  await expect(
    page.locator(".command-row").filter({ hasText: "Check health" }),
  ).toBeVisible();
});

test("palette keyboard navigation and honest desktop-only registration", async ({
  page,
}) => {
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Search commands" })
    .fill("Tests · Repo Reaper");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("cargo test");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("desktop app");
});

test("renders without console errors and stays within narrow viewport", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".project-card")).toHaveCount(6);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/pit-boss-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/pit-boss-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
