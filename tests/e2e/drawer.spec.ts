import { test, expect } from "@playwright/test";

test.describe("Right drawer", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Navigate to a playlist (this auto-loads it into the player)
    await expect(page.getByTestId("nav-sidebar").getByText("Morning Commute")).toBeVisible();
    await page.getByTestId("nav-sidebar").getByText("Morning Commute").click();
    // Wait for playlist to load
    await expect(page.getByTestId("playlist-hero")).toBeVisible();
    // Bottom bar should now be visible since navigating to a playlist auto-loads it
    await expect(page.getByTestId("bottom-bar")).toBeVisible();
  });

  test("drawer is closed by default (width 0)", async ({ page }) => {
    const drawer = page.getByTestId("right-drawer");
    const box = await drawer.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(1);
  });

  test("queue toggle button in bottom bar opens drawer", async ({ page }) => {
    await page.getByTestId("queue-toggle").click();
    await page.waitForTimeout(300);

    const drawer = page.getByTestId("right-drawer");
    const box = await drawer.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(270);
    expect(box!.width).toBeLessThanOrEqual(290);
  });

  test("drawer shows track list for loaded playlist", async ({ page }) => {
    await page.getByTestId("queue-toggle").click();
    await page.waitForTimeout(300);

    const drawer = page.getByTestId("right-drawer");
    // Should show tracks from Morning Commute — check draggable items
    const items = drawer.locator("[draggable=true]");
    await expect(items.first()).toBeVisible();
    const count = await items.count();
    expect(count).toBe(4);
  });

  test("drawer close button closes drawer", async ({ page }) => {
    await page.getByTestId("queue-toggle").click();
    await page.waitForTimeout(300);

    await page.getByTestId("drawer-close").click();
    await page.waitForTimeout(300);

    const box = await page.getByTestId("right-drawer").boundingBox();
    expect(box!.width).toBeLessThanOrEqual(1);
  });

  test("playlist selector dropdown is present in drawer", async ({ page }) => {
    await page.getByTestId("queue-toggle").click();
    await page.waitForTimeout(300);

    await expect(page.getByTestId("drawer-playlist-select")).toBeVisible();
  });

  test("] keyboard shortcut toggles drawer", async ({ page }) => {
    // Drawer should start closed
    let box = await page.getByTestId("right-drawer").boundingBox();
    expect(box!.width).toBeLessThanOrEqual(1);

    await page.keyboard.press("]");
    await page.waitForTimeout(300);

    box = await page.getByTestId("right-drawer").boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(270);

    await page.keyboard.press("]");
    await page.waitForTimeout(300);

    box = await page.getByTestId("right-drawer").boundingBox();
    expect(box!.width).toBeLessThanOrEqual(1);
  });
});
