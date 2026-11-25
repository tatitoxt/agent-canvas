import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.ts",
  timeout: 45_000,
  workers: 1,
  retries: 0,
  globalSetup: "./e2e/globalSetup.mjs",
  globalTeardown: "./e2e/globalTeardown.mjs",
  use: {
    viewport: { width: 1440, height: 900 },
  },
});
