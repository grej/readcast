import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:9876",
    headless: true,
    launchOptions: {
      args: ["--autoplay-policy=no-user-gesture-required"],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: "pixi run python scripts/test-server.py --port 9876",
    port: 9876,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
