import { test, expect } from "@playwright/test";

test.describe("Keyboard shortcuts", () => {
  test("[ toggles nav collapse", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByTestId("nav-sidebar");
    let box = await nav.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(200);

    await page.keyboard.press("[");
    await page.waitForTimeout(300);
    box = await nav.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(1);
  });

  test("] toggles drawer when playlist loaded", async ({ page }) => {
    await page.goto("/");
    // Navigate to a playlist (auto-loads into player)
    await page.getByTestId("nav-sidebar").getByText("Morning Commute").click();
    await expect(page.getByTestId("bottom-bar")).toBeVisible();

    let box = await page.getByTestId("right-drawer").boundingBox();
    expect(box!.width).toBeLessThanOrEqual(1);

    await page.keyboard.press("]");
    await page.waitForTimeout(300);
    box = await page.getByTestId("right-drawer").boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(270);
  });

  test("Space toggles play/pause when playlist loaded", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-sidebar").getByText("Morning Commute").click();
    await page.getByTestId("play-all-btn").click();
    await expect(page.getByTestId("bottom-bar")).toBeVisible();

    // Get initial play state from the audio element
    const isPaused1 = await page.locator("[data-testid=audio-element]").evaluate(
      (el: HTMLAudioElement) => el.paused
    );

    // Press space to toggle
    await page.keyboard.press("Space");
    await page.waitForTimeout(200);

    const isPaused2 = await page.locator("[data-testid=audio-element]").evaluate(
      (el: HTMLAudioElement) => el.paused
    );

    // State should have changed
    expect(isPaused2).not.toBe(isPaused1);
  });

  test("/ focuses search input", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("/");
    // Search input should be focused
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    expect(focused).toBe("search-input");
  });

  test("ArrowDown navigates to next article", async ({ page }) => {
    await page.goto("/");
    // Wait for articles to load
    await expect(page.getByTestId("center-panel").getByText("The Future of Artificial Intelligence")).toBeVisible();

    // Press down arrow to focus first article
    await page.keyboard.press("ArrowDown");
    // Detail panel should update — no longer showing placeholder
    await expect(page.getByTestId("detail-panel").getByText("Select an article")).not.toBeVisible({ timeout: 2000 });
  });
});
