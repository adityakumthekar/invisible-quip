import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 60000,
  use: { trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5180",
    url: "http://localhost:5180",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
