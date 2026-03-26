import { test, expect } from "@playwright/test";

test.describe("Navigation sidebar", () => {
  test("All items is selected by default", async ({ page }) => {
    await page.goto("/");
    const allItem = page.getByTestId("nav-item-all");
    await expect(allItem).toBeVisible();
    // Should have active styling (border-left accent)
    const borderLeft = await allItem.evaluate((el) => getComputedStyle(el).borderLeftColor);
    expect(borderLeft).toBe("rgb(108, 140, 255)"); // #6c8cff
  });

  test("seeded lists appear in nav", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByTestId("nav-sidebar");
    await expect(nav.getByText("Morning Commute")).toBeVisible();
    await expect(nav.getByText("Study Queue")).toBeVisible();
    await expect(nav.getByText("Respond To")).toBeVisible();
    await expect(nav.getByText("AI Research")).toBeVisible();
  });

  test("clicking a playlist shows playlist hero view", async ({ page }) => {
    await page.goto("/");
    // Wait for lists to load
    await expect(page.getByTestId("nav-sidebar").getByText("Morning Commute")).toBeVisible();
    // Click the Morning Commute playlist
    await page.getByTestId("nav-sidebar").getByText("Morning Commute").click();
    await expect(page.getByTestId("playlist-hero")).toBeVisible();
    await expect(page.getByTestId("play-all-btn")).toBeVisible();
  });

  test("clicking a collection updates center panel header", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("nav-sidebar").getByText("Study Queue")).toBeVisible();
    await page.getByTestId("nav-sidebar").getByText("Study Queue").click();
    // Center panel should show the collection name
    await expect(page.getByTestId("center-panel").getByText("Study Queue")).toBeVisible();
  });

  test("collapse button hides nav and shows rail", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("nav-sidebar")).toBeVisible();
    await expect(page.getByTestId("nav-rail")).not.toBeAttached();

    await page.getByTestId("nav-collapse").click();
    // Wait for transition
    await page.waitForTimeout(300);

    await expect(page.getByTestId("nav-rail")).toBeVisible();
    // Nav sidebar should have width 0
    const navBox = await page.getByTestId("nav-sidebar").boundingBox();
    expect(navBox!.width).toBeLessThanOrEqual(1);
  });

  test("rail hamburger expands nav back", async ({ page }) => {
    await page.goto("/");
    // Collapse first
    await page.getByTestId("nav-collapse").click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId("nav-rail")).toBeVisible();

    // Click hamburger in rail to expand
    await page.getByTestId("nav-rail").locator("button").first().click();
    await page.waitForTimeout(300);

    const navBox = await page.getByTestId("nav-sidebar").boundingBox();
    expect(navBox!.width).toBeGreaterThanOrEqual(200);
  });

  test("[ keyboard shortcut toggles nav collapse", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByTestId("nav-sidebar");
    const initialBox = await nav.boundingBox();
    expect(initialBox!.width).toBeGreaterThanOrEqual(200);

    await page.keyboard.press("[");
    await page.waitForTimeout(300);

    const collapsedBox = await nav.boundingBox();
    expect(collapsedBox!.width).toBeLessThanOrEqual(1);

    await page.keyboard.press("[");
    await page.waitForTimeout(300);

    const expandedBox = await nav.boundingBox();
    expect(expandedBox!.width).toBeGreaterThanOrEqual(200);
  });
});
