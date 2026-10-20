import { test, expect } from "@playwright/test";

// Demo-mode smoke pass over the core screens. The demo viewer starts as "Rahul Barge" (a CSM Lead) — see
// src/lib/demoData.json — whose labs are the iGenetic Diagnostics group (1 parent + 2 children).

// Any uncaught error or console error fails the test it happened in.
test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on("pageerror", (err) => page.errors.push(err.message));
  page.on("console", (msg) => { if (msg.type() === "error") page.errors.push(msg.text()); });
  await page.goto("/");
  await expect(page.getByText("DEMO MODE")).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect(page.errors, "no console / page errors").toEqual([]);
});

function nav(page, label) {
  return page.locator(".sidebar .nav-item", { hasText: label }).first().click();
}

test("Total Labs shows tiles, the lab list, and search filters it", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Total Labs" })).toBeVisible();
  await expect(page.locator(".tile", { hasText: "Parent Labs (Clients)" })).toBeVisible();
  await expect(page.locator(".tile", { hasText: "Child Labs" })).toBeVisible();
  await expect(page.getByText("iGenetic Diagnostics", { exact: true })).toBeVisible();

  const search = page.getByPlaceholder(/Search lab name/);
  await expect(search).toHaveValue(""); // never pre-filled (the old email-autofill bug)
  await search.fill("zzz-no-such-lab");
  await expect(page.getByText("No labs match these filters.")).toBeVisible();
  await search.fill("igenetic");
  await expect(page.getByText("iGenetic Diagnostics", { exact: true })).toBeVisible();
});

test("every live screen opens without errors", async ({ page }) => {
  for (const [label, heading] of [
    ["Dashboard", "Dashboard"], ["My Portfolio", "My Portfolio"], ["Collections", "Collections"],
    ["Expansion", "Expansion"], ["Tasks", "Tasks"], ["Visits & Meetings", "Visits & Meetings"],
    ["Adoption Template", "Adoption Template"], ["Reports", "Reports"],
  ]) {
    await nav(page, label);
    // Database-backed screens show a demo-mode placeholder instead of their heading — either is fine.
    await expect(page.getByRole("heading", { name: heading }).or(page.getByText(/Demo mode —/)).first()).toBeVisible();
  }
});

test("display mode toggle switches theme and remembers it", async ({ page }) => {
  await page.getByRole("button", { name: "Dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("Add Lab: country and state are type-to-filter dropdowns", async ({ page }) => {
  await page.getByRole("button", { name: "+ Add New Lab" }).click();
  const country = page.getByPlaceholder("Search a country…");
  await country.click();
  await country.fill("indi");
  await page.locator(".ss-row", { hasText: /^India$/ }).click();
  await expect(country).toHaveValue("India");
  const state = page.getByPlaceholder("Search a state…");
  await expect(state).toBeEnabled();
  await state.click();
  await state.fill("maha");
  await page.locator(".ss-row", { hasText: "Maharashtra" }).click();
  await expect(state).toHaveValue("Maharashtra");
});

test("Adoption Template: totals must be 100% and Rescale fixes them", async ({ page }) => {
  await nav(page, "Adoption Template");
  await expect(page.locator(".tmpl-list-foot")).toContainText("100%");
  // Break the selected module's parameter total, then let Rescale bring it back to exactly 100.
  const firstWeight = page.locator(".tparam-row input[type=number]").first();
  await firstWeight.fill("90");
  await firstWeight.blur();
  await expect(page.getByText(/they must total exactly 100%/)).toBeVisible();
  await page.getByRole("button", { name: "Rescale to 100%" }).click();
  await expect(page.getByText("Parameters total: 100% / 100%")).toBeVisible();
});

test("Adoption Template is view-only for a plain CSM", async ({ page }) => {
  await page.locator(".csm-switcher").selectOption("Aditi"); // a CSM in the demo roster
  await nav(page, "Adoption Template");
  await expect(page.getByText(/View only/)).toBeVisible();
  await expect(page.locator(".tparam-row input[type=number]").first()).toBeDisabled();
});
