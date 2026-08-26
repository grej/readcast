import { test, expect } from "@playwright/test";

test("browser extension setup is visible and links to the archive", async ({ page }) => {
  await page.goto("/");

  const setupButton = page.getByTestId("extension-setup-button");
  await expect(setupButton).toBeVisible();
  await setupButton.click();

  const modal = page.getByTestId("extension-setup-modal");
  await expect(modal.getByRole("heading", { name: "Browser extension" })).toBeVisible();
  await expect(modal.getByText("brave://extensions")).toBeVisible();
  await expect(page.getByTestId("extension-download")).toHaveAttribute("href", "/api/extension.zip");
});
