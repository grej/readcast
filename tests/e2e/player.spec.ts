import { test, expect } from "@playwright/test";

test.describe("Audio player (bottom bar)", () => {
  test("bottom bar is visible on initial load with auto-loaded playlist", async ({ page }) => {
    await page.goto("/");
    // Bottom bar auto-loads first playlist on mount
    await expect(page.getByTestId("bottom-bar")).toBeVisible();
    await expect(page.getByTestId("queue-toggle")).toBeVisible();
  });

  test("bottom bar shows transport controls after navigating to a playlist", async ({ page }) => {
    await page.goto("/");
    // Navigating to a playlist auto-loads it into the player
    await page.getByTestId("nav-sidebar").getByText("Morning Commute").click();
    // Should show track title instead of empty state
    await expect(page.getByTestId("bottom-bar").getByText("Morning Commute")).toBeVisible();
  });

  test("bottom bar shows track title and playlist name", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-sidebar").getByText("Morning Commute").click();
    await expect(page.getByTestId("bottom-bar")).toBeVisible();

    const bar = page.getByTestId("bottom-bar");
    // Should show first track title
    await expect(bar.getByText("The Future of Artificial Intelligence")).toBeVisible();
    // Should show playlist name
    await expect(bar.getByText("Morning Commute")).toBeVisible();
    // Should show track position
    await expect(bar.getByText("1/4")).toBeVisible();
  });

  test("play/pause button is present", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-sidebar").getByText("Morning Commute").click();
    await expect(page.getByTestId("player-play")).toBeVisible();
  });

  test("next button advances to next track", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-sidebar").getByText("Morning Commute").click();
    await expect(page.getByTestId("bottom-bar")).toBeVisible();

    const bar = page.getByTestId("bottom-bar");
    // First track
    await expect(bar.getByText("1/4")).toBeVisible();

    await page.getByTestId("player-next").click();
    // Should show second track position
    await expect(bar.getByText("2/4")).toBeVisible();
  });

  test("previous button goes back to previous track", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-sidebar").getByText("Morning Commute").click();
    await expect(page.getByTestId("bottom-bar")).toBeVisible();

    // Go to track 2
    await page.getByTestId("player-next").click();
    await expect(page.getByTestId("bottom-bar").getByText("2/4")).toBeVisible();

    // Go back to track 1
    await page.getByTestId("player-prev").click();
    await expect(page.getByTestId("bottom-bar").getByText("1/4")).toBeVisible();
  });

  test("audio element gets src set when track loads", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-sidebar").getByText("Morning Commute").click();
    await expect(page.getByTestId("bottom-bar")).toBeVisible();

    // Wait for drawer items to load and the audio effect to fire
    // Poll for the audio src to be set
    await expect(async () => {
      const audioSrc = await page.locator("[data-testid=audio-element]").evaluate(
        (el: HTMLAudioElement) => el.src
      );
      expect(audioSrc).toContain("/api/articles/");
    }).toPass({ timeout: 5000 });
  });

  test("progress bar is present", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-sidebar").getByText("Morning Commute").click();
    await expect(page.getByTestId("player-progress")).toBeVisible();
  });
});
