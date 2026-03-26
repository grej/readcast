import { test, expect } from "@playwright/test";

test.describe("Article detail panel", () => {
  test("detail panel is present when no article selected", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("center-panel")).toBeVisible();
    // The detail panel should exist with a data-testid
    await expect(page.getByTestId("detail-panel")).toBeVisible();
    // No article title should appear in the detail panel yet
    // (the panel shows placeholder or is empty)
    const inner = await page.getByTestId("detail-panel").innerHTML();
    // Should not contain any article-specific title (from seeded data)
    expect(inner).not.toContain("The Future of Artificial Intelligence");
  });

  test("shows article title when article is selected", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("center-panel").getByText("The Future of Artificial Intelligence")).toBeVisible();
    await page.getByTestId("center-panel").getByText("The Future of Artificial Intelligence").click();
    await expect(page.getByTestId("detail-panel").getByText("The Future of Artificial Intelligence").first()).toBeVisible();
  });

  test("shows tags for selected article", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("center-panel").getByText("The Future of Artificial Intelligence").click();
    await expect(page.getByTestId("detail-panel").getByText("ai-tools")).toBeVisible();
    await expect(page.getByTestId("detail-panel").getByText("ai-research")).toBeVisible();
  });

  test("shows list names in detail panel", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("center-panel").getByText("The Future of Artificial Intelligence").click();
    // The detail panel should show list memberships
    const detail = page.getByTestId("detail-panel");
    // Wait for data - list names appear as toggles in the detail panel
    await expect(detail.getByText("Morning Commute").first()).toBeVisible({ timeout: 5000 });
  });

  test("loads article body text", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("center-panel").getByText("The Future of Artificial Intelligence").click();
    // Body text should load
    await expect(page.getByTestId("detail-panel").getByText("AI is transforming industries")).toBeVisible({ timeout: 5000 });
  });
});
