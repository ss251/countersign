import { defineConfig, devices } from "@playwright/test";
import { consoleUrl } from "./lib/report.ts";

const viewport = { width: 1440, height: 900 };

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  workers: 1,
  retries: 0,
  fullyParallel: false,
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["./lib/report.ts"]],
  use: {
    baseURL: consoleUrl(),
    trace: "off",
    screenshot: "off",
    video: "off",
    viewport,
  },
  projects: [
    { name: "privy", use: { ...devices["Desktop Chrome"], viewport } },
    { name: "injected", use: { ...devices["Desktop Chrome"], viewport } },
  ],
});
