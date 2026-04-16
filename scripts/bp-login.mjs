// Step 1: Run this once interactively to save your BindPlane session.
// A browser window will open — log in via Google, then the script saves cookies.
// Usage: node scripts/bp-login.mjs

import { chromium } from '@playwright/test';

const AUTH_FILE = 'scripts/.bp-auth.json';

const browser = await chromium.launch({ headless: false }); // visible browser
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

await page.goto('https://app.bindplane.com');
console.log('Please log in via Google in the browser window...');
console.log('Waiting for you to reach the BindPlane dashboard...');

// Wait until we're on the BindPlane dashboard (not login, not Google OAuth)
await page.waitForURL((url) => {
  const s = url.toString();
  return s.startsWith('https://app.bindplane.com/') && !s.includes('/login');
}, { timeout: 300000 });
console.log('Logged in! Saving session...');

// Wait a bit for the app to fully load
await page.waitForTimeout(3000);

await context.storageState({ path: AUTH_FILE });
console.log(`Session saved to ${AUTH_FILE}`);
console.log('You can close this window. Run scripts/bp-screenshots.mjs to take screenshots.');

await browser.close();
