// One-shot: open the Clarity Recordings page, click each given User ID link,
// capture the resulting playback URL, and print a list.
//
// Usage:
//   node scripts/clarity_recording_urls.js <dashboardUrl> <userId1> <userId2> ...

const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

async function main() {
  const dashboardUrl = process.argv[2];
  const userIds = process.argv.slice(3);
  if (!dashboardUrl || !userIds.length) {
    console.error('usage: node scripts/clarity_recording_urls.js <dashboardUrl> <userId1> [userId2 ...]');
    process.exit(2);
  }

  const PROFILE_DIR = path.join(os.homedir(), '.config', 'clarity', 'playwright-profile');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Click "Recordings" top tab.
  const recordingsTab = page.locator('a, button, [role="tab"]').filter({ hasText: /^Recordings$/ }).first();
  await recordingsTab.click({ timeout: 5000 });
  await page.waitForTimeout(3000);

  // Scroll to load the list.
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(800);
  }

  const results = {};

  for (const uid of userIds) {
    try {
      // The User ID appears as a link in the table.
      const link = page.locator(`a, [role="link"], button`).filter({ hasText: new RegExp(`^${uid}$`) }).first();
      const found = await link.count();
      if (!found) {
        results[uid] = '(not found in current view)';
        continue;
      }
      // Capture the href attribute if it's a real anchor — that's the cleanest path.
      const href = await link.getAttribute('href').catch(() => null);
      if (href && href.startsWith('http')) {
        results[uid] = href;
        continue;
      }
      // Otherwise, click it and read window.location once the player opens.
      const [popup] = await Promise.all([
        page.waitForEvent('popup', { timeout: 3000 }).catch(() => null),
        link.click({ force: true }),
      ]);
      await page.waitForTimeout(2500);
      const url = popup ? popup.url() : page.url();
      results[uid] = url;
      // Go back so the next iteration finds the list again.
      if (popup) {
        await popup.close().catch(() => {});
      } else {
        await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(2500);
      }
    } catch (e) {
      results[uid] = `(error: ${e.message})`;
    }
  }

  console.log('\nDIRECT RECORDING URLS:');
  for (const [uid, url] of Object.entries(results)) {
    console.log(`\n${uid}:\n  ${url}`);
  }

  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
