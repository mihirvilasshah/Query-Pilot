import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const MOCK_PORT = 54329;
const env = {
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon-key-not-a-real-key-0000000000",
  NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${PORT}`,
  NEXT_TELEMETRY_DISABLED: "1",
  MOCK_SUPABASE_PORT: String(MOCK_PORT),
  // AI deliberately unconfigured: the suite verifies the app works (and fails gracefully) without it.
  GEMINI_API_KEY: "",
  OPENROUTER_API_KEY: "",
};

/**
 * End-to-end tests run the production build against an in-memory Supabase stand-in (e2e/mock-supabase) seeded with a
 * synthetic hospital-pricing schema. No Docker, accounts or secrets are required.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    { command: "node e2e/mock-supabase/server.mjs", url: `http://127.0.0.1:${MOCK_PORT}/__state`, reuseExistingServer: !process.env.CI, env },
    {
      command: `node ../../node_modules/next/dist/bin/next build && node ../../node_modules/next/dist/bin/next start -p ${PORT}`,
      url: `http://127.0.0.1:${PORT}/api/health`,
      timeout: 420_000,
      reuseExistingServer: !process.env.CI,
      env,
    },
  ],
});
