// Minimal Playwright runner — drives a real Chromium browser.
// Usage:
//   node scripts/browse.js                 # opens https://pixsort.app
//   node scripts/browse.js index.html      # opens local file via file://
//   node scripts/browse.js https://...     # opens any URL
//   HEADED=1 node scripts/browse.js        # show the browser window
//
// Pair with `npm run serve` (port 5173) if you want to test against the
// live static site over http: `node scripts/browse.js http://localhost:5173`.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
  const arg = process.argv[2] || 'https://pixsort.app';
  const url = /^https?:\/\//.test(arg)
    ? arg
    : 'file://' + path.resolve(arg);

  const headless = !process.env.HEADED;
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  page.on('console', msg => console.log(`[console.${msg.type()}]`, msg.text()));
  page.on('pageerror', err => console.log('[pageerror]', err.message));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  console.log('title:', await page.title());

  fs.mkdirSync('screenshots', { recursive: true });
  const out = `screenshots/${Date.now()}.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log('screenshot:', out);

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
