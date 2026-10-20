import { defineConfig } from "@playwright/test";
import path from "node:path";
import os from "node:os";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:3187",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run build && npm start -- --port 3187",
    url: "http://127.0.0.1:3187",
    reuseExistingServer: false,
    env: {
      BATASBELI_STATE_FILE: path.join(os.tmpdir(), "batasbeli-e2e-state.json"),
    },
    timeout: 120000,
  },
});
