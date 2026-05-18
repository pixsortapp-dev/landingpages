// Playwright-driven Clarity dashboard fetcher.
//
// Persistent profile at ~/.config/clarity/playwright-profile keeps you signed in
// across runs. First run is HEADED so you can log into Microsoft once.
//
// Usage:
//   node scripts/clarity_dashboard.js login
//       — opens Clarity headed so you can sign in. Close the window when done.
//
//   node scripts/clarity_dashboard.js pull <projectUrl> [--from YYYY-MM-DD --to YYYY-MM-DD]
//       — opens the dashboard for that project, sets the date range, screenshots.
//       projectUrl is the full URL from your browser when viewing the project,
//       e.g. https://clarity.microsoft.com/projects/view/abc123/dashboard
//
// Output:
//   ~/.config/clarity/data/<project>/dashboard/<timestamp>/
//     ├── dashboard_full.png       (full-page screenshot)
//     ├── popular_pages.png        (cropped to Popular Pages card if found)
//     └── page_html.txt            (text content of the page for grep/parse)

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROFILE_DIR = path.join(os.homedir(), '.config', 'clarity', 'playwright-profile');
const DATA_ROOT = path.join(os.homedir(), '.config', 'clarity', 'data');

function parseArgs(argv) {
  const cmd = argv[2];
  const rest = argv.slice(3);
  const positional = [];
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      flags[a.slice(2)] = rest[i + 1];
      i++;
    } else {
      positional.push(a);
    }
  }
  return { cmd, positional, flags };
}

async function launch({ headed }) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !headed,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

async function cmdLogin() {
  const { context, page } = await launch({ headed: true });
  await page.goto('https://clarity.microsoft.com/', { waitUntil: 'domcontentloaded' });
  console.log('Sign in to Clarity in the opened window.');
  console.log('Once you can see your project list, close the browser window to save the session.');
  // Wait until the user closes the window.
  await new Promise((resolve) => {
    context.on('close', resolve);
  });
  console.log('session saved to', PROFILE_DIR);
}

async function cmdPull({ projectUrl, from, to }) {
  if (!projectUrl) {
    console.error('missing <projectUrl>. paste your Clarity dashboard URL.');
    process.exit(2);
  }

  // Extract a project identifier from the URL for filing.
  const projectMatch = projectUrl.match(/\/projects\/view\/([^/]+)/);
  const projectId = projectMatch ? projectMatch[1] : 'unknown';

  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', 'T').slice(0, 19);
  const outDir = path.join(DATA_ROOT, projectId, 'dashboard', ts);
  fs.mkdirSync(outDir, { recursive: true });

  const { context, page } = await launch({ headed: process.env.HEADED === '1' });

  // Build URL with date params if given. Clarity uses ?date_d=Custom%20Range&date_s=YYYY-MM-DD&date_e=YYYY-MM-DD
  // Format observed in the live dashboard. If this doesn't take, the script falls back to clicking the UI.
  let url = projectUrl;
  if (from && to) {
    const u = new URL(projectUrl);
    u.searchParams.set('date_d', 'Custom Range');
    u.searchParams.set('date_s', from);
    u.searchParams.set('date_e', to);
    url = u.toString();
  }

  console.log('opening:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Wait for any dashboard card to render. If we hit a login redirect, bail.
  try {
    await page.waitForSelector('text=/Sessions|Pages per session|Scroll depth|Dead click/i', { timeout: 20000 });
  } catch {
    if (page.url().includes('login.microsoftonline.com') || page.url().includes('login.live.com')) {
      console.error('not signed in. run: node scripts/clarity_dashboard.js login');
      await context.close();
      process.exit(1);
    }
    console.error('dashboard cards did not render within 20s. saving what we have anyway.');
  }

  await page.waitForTimeout(2000);

  // If a custom date range was requested, click the date picker and set it.
  if (from && to) {
    try {
      // The date pill text varies: "Last 3 days", "Custom range", or a date range string.
      const datePill = page.locator('button, [role="button"]').filter({
        hasText: /Last \d+ days|Last \d+ months|Custom|days|Yesterday|Today|\d{4}-\d{2}-\d{2}/i,
      }).first();
      await datePill.click({ timeout: 5000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(outDir, '_debug_after_pill_click.png') });

      // Click "Custom range" or "Custom" option in the dropdown.
      const customOpt = page.locator('text=/Custom range|Custom date|^Custom$/i').first();
      await customOpt.click({ timeout: 5000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(outDir, '_debug_after_custom_click.png') });

      // Fill start and end dates. Try input[type=date] first, fall back to text inputs.
      const dateInputs = page.locator('input[type="date"], input[placeholder*="date" i], input[aria-label*="date" i], input[aria-label*="Start" i], input[aria-label*="End" i]');
      const count = await dateInputs.count();
      console.log(`found ${count} possible date input(s)`);

      if (count >= 2) {
        await dateInputs.nth(0).fill(from);
        await dateInputs.nth(1).fill(to);
      } else {
        // Last-ditch: type into focused element. Many date pickers focus the start input on open.
        await page.keyboard.type(from);
        await page.keyboard.press('Tab');
        await page.keyboard.type(to);
      }

      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(outDir, '_debug_after_dates_filled.png') });

      // Click Apply / Done / Save.
      const apply = page.locator('button').filter({ hasText: /^(Apply|Done|Save|Update|OK)$/i }).first();
      if (await apply.count()) {
        await apply.click();
      } else {
        await page.keyboard.press('Enter');
      }

      await page.waitForTimeout(4000);
    } catch (e) {
      console.error('date picker automation failed:', e.message);
      console.error('check _debug_*.png in the output dir to see where it broke.');
    }
  }

  await page.waitForTimeout(2000);

  // Full-page screenshot.
  const fullPath = path.join(outDir, 'dashboard_full.png');
  await page.screenshot({ path: fullPath, fullPage: true });
  console.log('saved:', fullPath);

  // Try to locate a Popular Pages card and screenshot just that.
  try {
    const popular = page.locator('text=/Popular pages|Top pages/i').first();
    if (await popular.count()) {
      const card = popular.locator('xpath=ancestor::*[self::section or self::article or self::div][1]').first();
      const popPath = path.join(outDir, 'popular_pages.png');
      await card.screenshot({ path: popPath });
      console.log('saved:', popPath);
    }
  } catch (e) {
    console.error('could not isolate Popular Pages card:', e.message);
  }

  // Click each tab on the Referrer/Browsers/Devices/OS card and dump the text snapshot per tab.
  const tabsToCapture = ['Devices', 'Operating systems', 'Region'];
  const tabTextOut = {};
  for (const tabName of tabsToCapture) {
    try {
      const tab = page.locator('button, [role="tab"], a').filter({ hasText: new RegExp(`^${tabName}$`, 'i') }).first();
      if (await tab.count()) {
        await tab.click({ timeout: 4000 });
        await page.waitForTimeout(1500);
        const fullText = await page.evaluate(() => document.body.innerText);
        tabTextOut[tabName] = fullText;
      }
    } catch (e) {
      console.error(`failed to capture tab ${tabName}:`, e.message);
    }
  }
  fs.writeFileSync(path.join(outDir, 'tabs_devices_os.json'), JSON.stringify(tabTextOut, null, 2));

  // Dump visible text so the data can be grep'd / parsed.
  const text = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(path.join(outDir, 'page_text.txt'), text);
  console.log('saved: page_text.txt + tabs_devices_os.json');

  await context.close();
  console.log('\ndone. dir:', outDir);
}

async function main() {
  const { cmd, positional, flags } = parseArgs(process.argv);
  switch (cmd) {
    case 'login':
      await cmdLogin();
      break;
    case 'pull':
      await cmdPull({ projectUrl: positional[0], from: flags.from, to: flags.to });
      break;
    case 'recordings':
      await cmdRecordings({ recordingsUrl: positional[0], urlFilter: flags.url });
      break;
    default:
      console.log('usage:');
      console.log('  node scripts/clarity_dashboard.js login');
      console.log('  node scripts/clarity_dashboard.js pull <projectUrl> [--from YYYY-MM-DD --to YYYY-MM-DD]');
      console.log('  node scripts/clarity_dashboard.js recordings <recordingsUrl> [--url <substring>]');
      process.exit(2);
  }
}

// Scrape the recordings list table from Clarity, score each row, and pick the most-valuable to watch.
async function cmdRecordings({ recordingsUrl, urlFilter }) {
  if (!recordingsUrl) {
    console.error('missing <recordingsUrl>. paste your Clarity recordings page URL.');
    process.exit(2);
  }

  const projectMatch = recordingsUrl.match(/\/projects\/view\/([^/]+)/);
  const projectId = projectMatch ? projectMatch[1] : 'unknown';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(DATA_ROOT, projectId, 'recordings', ts);
  fs.mkdirSync(outDir, { recursive: true });

  const { context, page } = await launch({ headed: process.env.HEADED === '1' });

  console.log('opening:', recordingsUrl);
  await page.goto(recordingsUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Recordings is a top-nav tab, not a /recordings deep-link. Click it.
  try {
    const recordingsTab = page.locator('a, button, [role="tab"]').filter({ hasText: /^Recordings$/ }).first();
    await recordingsTab.click({ timeout: 5000 });
    await page.waitForTimeout(3000);
  } catch (e) {
    console.error('could not click Recordings tab:', e.message);
  }

  // Try to clear any pre-applied filters so we see all recordings, not just error sessions.
  try {
    const clearBtn = page.locator('button, [role="button"]').filter({ hasText: /^Clear$/i }).first();
    if (await clearBtn.count()) {
      await clearBtn.click({ timeout: 3000 });
      await page.waitForTimeout(2500);
    }
  } catch {}

  // Take an initial debug screenshot regardless so we always have one to inspect.
  await page.screenshot({ path: path.join(outDir, '_debug_recordings_loaded.png'), fullPage: false });
  await page.waitForTimeout(2000);

  // Scroll the recording list a few times to load more rows (Clarity lazy-loads).
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(1200);
  }

  // Pull every visible row's text via DOM. We're tolerant — Clarity's markup can change.
  const rows = await page.evaluate(() => {
    const out = [];
    // Each row tends to be a flexbox div with date + URL + duration etc. Try a few selectors.
    const candidates = document.querySelectorAll('[role="row"], [data-testid*="row"], [class*="ecording" i] [class*="row" i]');
    const seen = new Set();
    for (const el of candidates) {
      const t = el.innerText?.trim();
      if (!t || seen.has(t) || t.length < 20) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  });

  // If nothing matched, fall back to grabbing the full visible text of the recordings region.
  let parsed = [];
  if (rows.length) {
    parsed = rows.map(parseRecordingRow).filter(Boolean);
  }
  if (!parsed.length) {
    const fullText = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync(path.join(outDir, 'page_text.txt'), fullText);
    console.log('no rows matched selectors; saved full page_text.txt for inspection.');
  }

  // Filter by URL substring if requested.
  let filtered = parsed;
  if (urlFilter) {
    filtered = parsed.filter((r) => (r.url || '').toLowerCase().includes(urlFilter.toLowerCase()));
  }

  // Score each row. Higher = more worth watching.
  // Heuristic: reward clicks and reasonable duration, penalize sub-10-second sessions.
  function score(r) {
    const d = r.durationSec || 0;
    const c = r.clicks || 0;
    const p = r.pages || 1;
    if (d < 10) return -1; // bounces — skip
    let s = 0;
    s += c * 4; // big weight on clicks
    s += Math.min(d, 180) * 0.05; // up to 9 points for duration, capped
    s += (p - 1) * 3; // multi-page bonus
    return s;
  }

  const scored = filtered.map((r) => ({ ...r, _score: score(r) })).sort((a, b) => b._score - a._score);
  const top = scored.filter((r) => r._score > 0).slice(0, 15);

  fs.writeFileSync(path.join(outDir, 'all_recordings.json'), JSON.stringify(parsed, null, 2));
  fs.writeFileSync(path.join(outDir, 'top_to_watch.json'), JSON.stringify(top, null, 2));

  console.log(`\nparsed ${parsed.length} recordings (${filtered.length} after url filter "${urlFilter || '*'}")`);
  console.log(`\ntop ${top.length} sessions to watch (most valuable first):`);
  for (const [i, r] of top.entries()) {
    console.log(
      `  ${i + 1}. ${r.userId || '?'.padEnd(8)} | ${r.durationSec || 0}s | ${r.clicks || 0} clicks | ${r.pages || 1} pg | ${(r.device || '').padEnd(28)} | ${(r.url || '').slice(0, 50)}`,
    );
  }
  console.log(`\nout dir: ${outDir}`);
  await context.close();
}

// Parse one row's innerText into structured fields. Clarity row text looks roughly like:
//   "31\n10:09 PM\nMay 12\nEntry: .../beauty.html?...\n00:03\n0\n1\nz9jsw7\nUnited States ・ FacebookApp ・ Mobile"
function parseRecordingRow(text) {
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  // Find duration like 00:03 or 05:14
  const durIdx = lines.findIndex((l) => /^\d{1,2}:\d{2}$/.test(l));
  if (durIdx < 0) return null;
  const dur = lines[durIdx];
  const [m, s] = dur.split(':').map(Number);
  const durationSec = m * 60 + s;
  const clicks = Number(lines[durIdx + 1]);
  const pages = Number(lines[durIdx + 2]);
  const userId = lines[durIdx + 3];
  const device = lines[durIdx + 4];
  // URL: find the first line starting with "Entry:" or containing "pixsort"
  const urlLine = lines.find((l) => /^Entry:|pixsort\.app/i.test(l)) || '';
  const url = urlLine.replace(/^Entry:\s*/i, '').trim();
  return { durationSec, clicks, pages, userId, device, url };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
