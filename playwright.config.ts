import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: 1,
  webServer: {
    command: "node tests/fixture-server.mjs",
    port: 4173,
    reuseExistingServer: false,
  },
});
