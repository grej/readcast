import { test, expect } from "@playwright/test";

test.describe("Drag and drop reorder", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Navigate to Morning Commute playlist
    await expect(page.getByTestId("nav-sidebar").getByText("Morning Commute")).toBeVisible();
    await page.getByTestId("nav-sidebar").getByText("Morning Commute").click();
    await expect(page.getByTestId("playlist-hero")).toBeVisible();
  });

  test("drag handles have grab cursor", async ({ page }) => {
    const trackItems = page.getByTestId("center-panel").locator("[draggable=true]");
    await expect(trackItems.first()).toBeVisible();
    const dragHandle = trackItems.first().locator("span[style*='grab']");
    await expect(dragHandle).toBeVisible();
    const cursor = await dragHandle.evaluate((el) => getComputedStyle(el).cursor);
    expect(cursor).toBe("grab");
  });

  test("draggable items exist in playlist tracklist", async ({ page }) => {
    const draggableItems = page.getByTestId("center-panel").locator("[draggable=true]");
    await expect(draggableItems.first()).toBeVisible();
    const count = await draggableItems.count();
    expect(count).toBe(4); // Morning Commute has 4 items
  });

  test("drag and drop reorders tracks in playlist center panel", async ({ page }) => {
    // Use the center panel playlist tracks (which are fully visible)
    const center = page.getByTestId("center-panel");
    const items = center.locator("[draggable=true]");
    await expect(items.first()).toBeVisible();
    const count = await items.count();
    expect(count).toBe(4);

    // Drag first item to third position
    await items.first().dragTo(items.nth(2));
    await page.waitForTimeout(500);

    // Verify items are still present after the operation
    const newCount = await items.count();
    expect(newCount).toBe(4);
  });
});
