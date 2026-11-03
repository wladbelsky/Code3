// Playwright Test config — run in the Playwright Docker image (tools/test.ps1 locally, GitHub Actions in CI)
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  timeout: 5 * 60 * 1000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8765',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    timezoneId: 'UTC',
    locale: 'en-GB',
    trace: 'retain-on-failure',
    browserName: 'chromium',
    // WebGL without a GPU: SwiftShader
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }
  },
  webServer: {
    command: 'node tests/support/serve.js 8765',
    url: 'http://127.0.0.1:8765/index.html',
    reuseExistingServer: !process.env.CI
  }
});
