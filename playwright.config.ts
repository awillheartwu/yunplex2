import { defineConfig, devices } from '@playwright/test'
const baseURL = `http://127.0.0.1:${process.env.PLAYWRIGHT_PRODUCTION === '1' ? '3013' : '3011'}`

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  }],
  webServer: {
    command: 'pnpm exec jiti scripts/browser-test-server.ts',
    url: `${baseURL}/api/system/health`,
    timeout: 120_000,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
  },
})
