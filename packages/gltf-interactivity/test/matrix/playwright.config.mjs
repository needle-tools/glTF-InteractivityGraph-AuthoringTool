import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "matrix.spec.mjs",
  timeout: 900_000,
  expect: { timeout: 30_000 },
  workers: 1,
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: "http://127.0.0.1:5202",
  },
  webServer: {
    command: "node cache-pages.mjs && vite --config vite.config.mjs --host 127.0.0.1 --port 5202 --strictPort",
    cwd: new URL(".", import.meta.url).pathname,
    port: 5202,
    reuseExistingServer: false,
    timeout: 600_000,
  },
});
