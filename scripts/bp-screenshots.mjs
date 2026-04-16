// Step 2: Take headless screenshots using the saved session.
// Usage: node scripts/bp-screenshots.mjs
//
// Captures: Agents, Fleets, each Configuration, and the overview pages.

import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'fs';

const AUTH_FILE = 'scripts/.bp-auth.json';
const SCREENSHOT_DIR = 'screenshots';

if (!existsSync(AUTH_FILE)) {
  console.error('No saved session found. Run "node scripts/bp-login.mjs" first.');
  process.exit(1);
}

mkdirSync(SCREENSHOT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: AUTH_FILE,
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

const screenshots = [
  { name: 'agents',                url: 'https://app.bindplane.com/agents' },
  { name: 'fleets',                url: 'https://app.bindplane.com/fleets' },
  { name: 'configurations',        url: 'https://app.bindplane.com/configurations' },
  { name: 'config-gateway',        url: 'https://app.bindplane.com/configurations/astroshop-gateway' },
  { name: 'config-node',           url: 'https://app.bindplane.com/configurations/astroshop-node' },
  { name: 'config-cluster',        url: 'https://app.bindplane.com/configurations/astroshop-cluster' },
  { name: 'fleet-gateway',         url: 'https://app.bindplane.com/fleets/astroshop-gateway-fleet' },
  { name: 'fleet-node',            url: 'https://app.bindplane.com/fleets/astroshop-node-fleet' },
  { name: 'fleet-cluster',         url: 'https://app.bindplane.com/fleets/astroshop-cluster-fleet' },
];

for (const { name, url } of screenshots) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    // If redirected to login, session expired
    if (page.url().includes('/login')) {
      console.error('Session expired. Re-run "node scripts/bp-login.mjs" to log in again.');
      break;
    }
    await page.waitForTimeout(2000); // let charts/tables render
    const path = `${SCREENSHOT_DIR}/${name}.png`;
    await page.screenshot({ path, fullPage: false });
    console.log(`✓ ${path}`);
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
  }
}

await browser.close();
console.log(`\nDone. Screenshots saved to ${SCREENSHOT_DIR}/`);
