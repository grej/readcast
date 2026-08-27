import { test, expect } from "@playwright/test";

test("articles can be trashed, restored, and permanently deleted", async ({ page }) => {
  await page.goto("/");

  const title = "The Future of Artificial Intelligence";
  await page.getByText(title, { exact: true }).first().click();
  await expect(page.getByTestId("move-to-trash-button")).toBeVisible();

  page.once("dialog", dialog => dialog.accept());
  await page.getByTestId("move-to-trash-button").click();
  await expect(page.getByTestId("center-panel").getByText(title, { exact: true })).not.toBeAttached();

  await page.getByTestId("rail-trash").click();
  await expect(page.getByTestId("center-panel").getByText(title, { exact: true })).toBeVisible();
  await expect(page.getByTestId("restore-article-button")).toBeVisible();

  await page.getByTestId("restore-article-button").click();
  await expect(page.getByTestId("trash-empty")).toBeVisible();

  await page.getByTestId("rail-all").click();
  await page.getByText(title, { exact: true }).first().click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByTestId("move-to-trash-button").click();

  await page.getByTestId("rail-trash").click();
  await expect(page.getByTestId("permanent-delete-button")).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await page.getByTestId("permanent-delete-button").click();

  await expect(page.getByTestId("trash-empty")).toBeVisible();
  await page.getByTestId("rail-all").click();
  await expect(page.getByTestId("center-panel").getByText(title, { exact: true })).not.toBeAttached();
});
