import { test, expect } from "@playwright/test";

test.describe("Article list", () => {
  test("all seeded articles render in All Items view", async ({ page }) => {
    await page.goto("/");
    // Wait for articles to load
    await expect(page.getByTestId("center-panel").getByText("The Future of Artificial Intelligence")).toBeVisible();
    await expect(page.getByTestId("center-panel").getByText("Understanding Geopolitical Tensions")).toBeVisible();
    await expect(page.getByTestId("center-panel").getByText("Python Best Practices")).toBeVisible();
    await expect(page.getByTestId("center-panel").getByText("Climate Change and Renewable Energy")).toBeVisible();
  });

  test("articles with audio show audio icon", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("center-panel").getByText("The Future of Artificial Intelligence")).toBeVisible();
    // Articles with audio should have the ♫ icon visible in their row
    // We check that at least some audio icon wraps exist (class aud-icon-wrap)
    const audioIcons = page.locator(".aud-icon-wrap");
    // 5 articles have audio ready
    await expect(audioIcons.first()).toBeVisible();
    const count = await audioIcons.count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test("tag pills render on articles", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("center-panel").getByText("ai-tools").first()).toBeVisible();
  });

  test("clicking an article row updates detail panel", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("center-panel").getByText("The Future of Artificial Intelligence")).toBeVisible();
    // Click the first article
    await page.getByTestId("center-panel").getByText("The Future of Artificial Intelligence").click();
    // Detail panel should show the article title
    await expect(page.getByTestId("detail-panel").getByText("The Future of Artificial Intelligence").first()).toBeVisible();
  });

  test("source labels display correctly", async ({ page }) => {
    await page.goto("/");
    // techcrunch.com article should show "Techcrunch" or similar source label
    await expect(page.getByTestId("center-panel").getByText("Techcrunch").first()).toBeVisible();
  });
});
