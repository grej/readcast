import { test, expect } from "@playwright/test";

test.describe("Three-panel layout", () => {
  test("renders nav, center, and detail panels", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("nav-sidebar")).toBeVisible();
    await expect(page.getByTestId("center-panel")).toBeVisible();
    await expect(page.getByTestId("detail-panel")).toBeVisible();
  });

  test("nav is approximately 210px wide", async ({ page }) => {
    await page.goto("/");
    const box = await page.getByTestId("nav-sidebar").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(200);
    expect(box!.width).toBeLessThanOrEqual(220);
  });

  test("center panel is approximately 370px wide", async ({ page }) => {
    await page.goto("/");
    const box = await page.getByTestId("center-panel").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(360);
    expect(box!.width).toBeLessThanOrEqual(380);
  });

  test("bottom bar is always visible with queue toggle", async ({ page }) => {
    await page.goto("/");
    // Bottom bar always renders (Spotify model) — auto-loads first playlist
    await expect(page.getByTestId("bottom-bar")).toBeVisible();
    // Queue toggle button is always accessible
    await expect(page.getByTestId("queue-toggle")).toBeVisible();
  });

  test("page has dark background", async ({ page }) => {
    await page.goto("/");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // #08090d = rgb(8, 9, 13)
    expect(bg).toBe("rgb(8, 9, 13)");
  });
});
