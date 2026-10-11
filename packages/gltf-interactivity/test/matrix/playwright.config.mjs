import { defineConfig } from "@playwright/test";

const port = Number(process.env.MATRIX_TEST_PORT ?? 5202);

export default defineConfig({
  testDir: ".",
  testMatch: ["matrix.spec.mjs", "conformance.spec.mjs", "xr.spec.mjs"],
  timeout: 900_000,
  expect: { timeout: 30_000 },
  // Timing assets have tight oracles; avoid starving their clocks with software-rendered pages.
  workers: Number(process.env.MATRIX_WORKERS ?? 2),
  fullyParallel: true,
  use: {
    browserName: "chromium",
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
    baseURL: `http://127.0.0.1:${port}`,
  },
  webServer: {
    command: `vite --config vite.config.mjs --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: new URL(".", import.meta.url).pathname,
    port,
    reuseExistingServer: process.env.REUSE_MATRIX_SERVER === "1",
    timeout: 600_000,
  },
});
