import { test, expect } from "@playwright/test";

test.describe("Search functionality", () => {
  test("search input is visible in center panel", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("search-input")).toBeVisible();
  });

  test("typing in search filters the article list", async ({ page }) => {
    await page.goto("/");
    // Wait for all articles to load
    await expect(page.getByTestId("center-panel").getByText("The Future of Artificial Intelligence")).toBeVisible();

    // Type a search term
    await page.getByTestId("search-input").fill("quantum");
    // Wait for debounced search
    await page.waitForTimeout(500);

    // Should show matching article
    await expect(page.getByTestId("center-panel").getByText("Quantum Computing")).toBeVisible();
  });

  test("clearing search restores full list", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("center-panel").getByText("The Future of Artificial Intelligence")).toBeVisible();

    // Search for something
    await page.getByTestId("search-input").fill("quantum");
    await page.waitForTimeout(500);

    // Clear search
    await page.getByTestId("search-input").fill("");
    await page.waitForTimeout(500);

    // All articles should be back
    await expect(page.getByTestId("center-panel").getByText("The Future of Artificial Intelligence")).toBeVisible();
    await expect(page.getByTestId("center-panel").getByText("Python Best Practices")).toBeVisible();
  });

  test("/ key focuses search input", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("/");
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    expect(focused).toBe("search-input");
  });
});
