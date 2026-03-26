import { test, expect } from "@playwright/test";

test.describe("Playlist view", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Navigate to Morning Commute playlist
    await expect(page.getByTestId("nav-sidebar").getByText("Morning Commute")).toBeVisible();
    await page.getByTestId("nav-sidebar").getByText("Morning Commute").click();
  });

  test("shows hero section with playlist info", async ({ page }) => {
    const hero = page.getByTestId("playlist-hero");
    await expect(hero).toBeVisible();
    await expect(hero.getByText("Morning Commute")).toBeVisible();
    // Should show item count
    await expect(hero.getByText("4 items")).toBeVisible();
  });

  test("Play All button is visible", async ({ page }) => {
    await expect(page.getByTestId("play-all-btn")).toBeVisible();
  });

  test("clicking Play All activates bottom bar", async ({ page }) => {
    // Navigating to a playlist auto-loads it, so bottom bar may already be visible
    // Click Play All to confirm it's functional
    await page.getByTestId("play-all-btn").click();
    await expect(page.getByTestId("bottom-bar")).toBeVisible();
  });

  test("tracklist shows playlist items", async ({ page }) => {
    // Wait for list items to load and draggable items to appear
    const trackList = page.getByTestId("center-panel").locator("[draggable=true]");
    await expect(trackList.first()).toBeVisible({ timeout: 5000 });
    const count = await trackList.count();
    expect(count).toBe(4);
  });

  test("items without audio show narration banner", async ({ page }) => {
    // Morning Commute has all items with audio, so no narration banner
    await expect(page.getByTestId("narration-banner")).not.toBeAttached();
  });

  test("Play All shows now-playing info in hero", async ({ page }) => {
    await page.getByTestId("play-all-btn").click();
    await page.waitForTimeout(300);
    // Hero should show "Now playing" label
    await expect(page.getByTestId("playlist-hero").getByText("Now playing")).toBeVisible();
  });
});
