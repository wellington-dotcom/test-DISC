// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const PORTA = Number(process.env.PORT) || 4173;

// Usa o Chromium já instalado (PLAYWRIGHT_BROWSERS_PATH) quando a versão do pacote não o encontrar.
function chromiumLocal() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    const { chromium } = require('@playwright/test');
    if (fs.existsSync(chromium.executablePath())) return undefined;
  } catch (e) { /* segue para a busca manual */ }
  try {
    const pastas = fs.readdirSync(base).filter((p) => /^chromium-\d+$/.test(p)).sort().reverse();
    for (const p of pastas) {
      for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const exe = path.join(base, p, rel);
        if (fs.existsSync(exe)) return exe;
      }
    }
  } catch (e) { /* sem navegador local */ }
  return undefined;
}

const executablePath = chromiumLocal();

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.js$/,
  timeout: 60000,
  expect: { timeout: 7000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:' + PORTA,
    locale: 'pt-BR',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {}
  },
  projects: [
    { name: 'celular', use: { ...devices['Pixel 5'] }, testMatch: /candidato.*\.spec\.js$/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /candidato.*\.spec\.js$/ }
  ],
  webServer: {
    command: 'node tests/e2e/server.js',
    url: 'http://localhost:' + PORTA + '/index.html',
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORTA) },
    timeout: 20000
  }
});
