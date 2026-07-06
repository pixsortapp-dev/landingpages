#!/usr/bin/env node
/**
 * pixsort-creator-page — headless generator
 *
 * Freezes meg/index.html as the canonical template. Only 7 fields vary
 * per creator; everything else is baked in. Writes:
 *   <handle>/index.html
 *   assets/<handle>.jpg  (from provided photo path)
 *   assets/<handle>-qr.png
 *
 * Usage:
 *   node generate.js --input creator.json
 *   node generate.js < creator.json              # or pipe on stdin
 *   node generate.js --input creator.json --dry-run
 *
 * Exit codes:
 *   0  success
 *   1  validation failure (missing required field, bad handle, etc.)
 *   2  template or asset read error
 *   3  QR generation error
 *   4  file write error
 *
 * Does NOT commit or push — caller wires in review + deploy.
 * Repo-relative paths throughout — run from the repo root.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── Constants ──────────────────────────────────────────────────────────────
const TEMPLATE_HANDLE = 'meg';
const TEMPLATE_PATH   = 'meg/index.html';

// ─── CLI ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const inputPath = argOf('--input');
const dryRun    = argv.includes('--dry-run');
const REPO_ROOT = process.cwd();

function argOf(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

if (!fs.existsSync(path.join(REPO_ROOT, TEMPLATE_PATH))) {
  fail(2, `Template not found at ${TEMPLATE_PATH} — run from the repo root.`);
}

// ─── Read input ─────────────────────────────────────────────────────────────
let raw;
if (inputPath) {
  try { raw = fs.readFileSync(inputPath, 'utf8'); }
  catch (e) { fail(1, `Cannot read --input: ${e.message}`); }
} else if (!process.stdin.isTTY) {
  raw = fs.readFileSync(0, 'utf8');
} else {
  fail(1, 'Provide --input <file.json> or pipe JSON on stdin.');
}

let brief;
try { brief = JSON.parse(raw); }
catch (e) { fail(1, `Input is not valid JSON: ${e.message}`); }

// ─── Validate ───────────────────────────────────────────────────────────────
const required = ['handle', 'displayName', 'role', 'creditLine', 'photo', 'brandColor', 'appsflyerUrl', 'quote'];
const missing = required.filter(k => !brief[k]);
if (missing.length) fail(1, `Missing required fields: ${missing.join(', ')}`);

const HANDLE = String(brief.handle).toLowerCase().trim();
if (!/^[a-z0-9-]+$/.test(HANDLE)) {
  fail(1, `Bad handle "${HANDLE}" — must be lowercase kebab-case (a-z, 0-9, hyphens).`);
}

const {
  displayName, role, creditLine, photo, brandColor, appsflyerUrl, quote,
} = brief;
const brandColorDark = brief.brandColorDark || shade(brandColor, -12);

if (!/^#[0-9A-Fa-f]{3,8}$/.test(brandColor)) {
  fail(1, `brandColor "${brandColor}" is not a valid hex color.`);
}
if (!/^https:\/\/app\.appsflyer\.com\//.test(appsflyerUrl)) {
  fail(1, `appsflyerUrl must start with https://app.appsflyer.com/ — got "${appsflyerUrl}"`);
}

// ─── Output paths ───────────────────────────────────────────────────────────
const outDir   = path.join(REPO_ROOT, HANDLE);
const outHtml  = path.join(outDir,    'index.html');
const outPhoto = path.join(REPO_ROOT, 'assets', `${HANDLE}.jpg`);
const outQr    = path.join(REPO_ROOT, 'assets', `${HANDLE}-qr.png`);

console.error(`[pixsort-creator-page] handle=${HANDLE} template=${TEMPLATE_PATH}`);

// ─── Read template ──────────────────────────────────────────────────────────
let html;
try { html = fs.readFileSync(path.join(REPO_ROOT, TEMPLATE_PATH), 'utf8'); }
catch (e) { fail(2, `Cannot read template: ${e.message}`); }

// ─── Transform ──────────────────────────────────────────────────────────────

// 1. Asset paths — assets/meg.jpg → assets/<handle>.jpg, same for QR
html = html
  .replaceAll(`assets/${TEMPLATE_HANDLE}.jpg`,     `assets/${HANDLE}.jpg`)
  .replaceAll(`assets/${TEMPLATE_HANDLE}-qr.png`,  `assets/${HANDLE}-qr.png`);

// 2. AppsFlyer URLs — replace every absolute AppsFlyer link in the file
html = html.replace(
  /https:\/\/app\.appsflyer\.com\/id6760485464\?[^"'\s<>]+/g,
  appsflyerUrl
);

// 3. CSS palette
html = swapCssVar(html, '--lime',     brandColor);
html = swapCssVar(html, '--limedark', brandColorDark);

// 4. Meta tags — title, og:title, twitter:title, og:url, meta description
const metaTitle = `${displayName} × PixSort: 100 Photos Sorted Free`;
const metaDesc  = `Get 100 photos sorted free with ${displayName}'s Pixsort link.`;
html = html
  .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(metaTitle)}</title>`)
  .replace(/(name="description" content=")[^"]*/,   `$1${escapeAttr(metaDesc)}`)
  .replace(/(og:title" content=")[^"]*/,            `$1${escapeAttr(metaTitle)}`)
  .replace(/(og:description" content=")[^"]*/,      `$1${escapeAttr(metaDesc)}`)
  .replace(/(og:url" content=")[^"]*/,              `$1https://pixsort.app/${HANDLE}/`)
  .replace(/(twitter:title" content=")[^"]*/,       `$1${escapeAttr(metaTitle)}`)
  .replace(/(twitter:description" content=")[^"]*/, `$1${escapeAttr(metaDesc)}`);

// 5. Collab mark — <span>Meg</span> before <span class="collab-x">×</span>
html = html.replace(
  /(<div class="collab-mark">\s*<span>)[^<]+(<\/span>\s*<span class="collab-x">)/,
  `$1${escapeHtml(displayName)}$2`
);

// 6. Hero photo caption — reconstruct the whole block
//    Template shape (Meg):
//      <div class="hero-photo-caption">
//        Meg · <span style="color:var(--grey);font-weight:600;">Founder, MegTheCreator community</span><br>
//        <span class="credit">UGC coach · creator community leader · mom</span>
//      </div>
html = html.replace(
  /(<div class="hero-photo-caption">)[^]*?(<\/div>)/,
  `$1
      ${escapeHtml(displayName)} · <span style="color:var(--grey);font-weight:600;">${escapeHtml(role)}</span><br>
      <span class="credit">${escapeHtml(creditLine)}</span>
    $2`
);

// 7. Hero photo alt text
html = html.replace(
  /(class="hero-photo" src="\.\.\/assets\/[a-z0-9-]+\.jpg" alt=")[^"]+(")/,
  `$1${escapeAttr(displayName)}$2`
);

// 8. QR image alt
html = html.replace(
  /(<img src="\.\.\/assets\/[a-z0-9-]+-qr\.png" alt=")[^"]+(")/,
  `$1Scan with your iPhone to install PixSort with ${escapeAttr(displayName)}'s link$2`
);

// 9. Section label — "Why Meg uses PixSort"
html = html.replace(
  /(<div class="social-label">Why )[^<]+( uses PixSort<\/div>)/,
  `$1${escapeHtml(displayName)}$2`
);

// 10. Testimonial quote text
html = html.replace(
  /(<p class="quote-text"[^>]*>\s*)"[^]*?"(\s*<\/p>)/,
  `$1"${escapeHtml(quote)}"$2`
);

// 11. Quote attribution — "Meg · Founder, MegTheCreator · UGC coach + community leader"
const quoteAttr = `${displayName} · ${role} · ${creditLine}`;
html = html.replace(
  /(<div class="quote-attr">)[^<]+(<\/div>)/,
  `$1${escapeHtml(quoteAttr)}$2`
);

// 12. "X's link" replacements — microcopy (both instances) + FAQ answers
//     Template has these literal strings; swap the possessive form.
html = html.replaceAll(`${TEMPLATE_HANDLE_DISPLAY()}'s link`, `${displayName}'s link`);

function TEMPLATE_HANDLE_DISPLAY() {
  // Meg's page uses "Meg" (short form) in "Meg's link", "Why Meg uses PixSort" etc.
  // If future template creators want a different short form, override here.
  return 'Meg';
}

// ─── Write files ────────────────────────────────────────────────────────────
if (dryRun) {
  console.error('[pixsort-creator-page] --dry-run: skipping writes');
  console.log(JSON.stringify({
    handle: HANDLE,
    outHtml: path.relative(REPO_ROOT, outHtml),
    outPhoto: path.relative(REPO_ROOT, outPhoto),
    outQr: path.relative(REPO_ROOT, outQr),
    liveUrl: `https://pixsort.app/${HANDLE}/`,
    dryRun: true,
  }));
  process.exit(0);
}

try {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(REPO_ROOT, 'assets'), { recursive: true });
} catch (e) {
  fail(4, `Cannot create output dir: ${e.message}`);
}

try { fs.writeFileSync(outHtml, html); }
catch (e) { fail(4, `Cannot write ${outHtml}: ${e.message}`); }

// Photo — copy or convert
if (photo && fs.existsSync(photo)) {
  const ext = path.extname(photo).toLowerCase();
  try {
    if (ext === '.webp' || ext === '.png') {
      execSync(`sips -s format jpeg "${photo}" --out "${outPhoto}"`, { stdio: 'ignore' });
    } else {
      fs.copyFileSync(photo, outPhoto);
    }
  } catch (e) {
    fail(4, `Cannot process photo ${photo}: ${e.message}`);
  }
} else {
  console.error(`[pixsort-creator-page] warning: photo missing at ${photo} — hero image will 404 until you drop it in ${outPhoto}`);
}

// QR
try {
  const qrPkg = require(path.join(REPO_ROOT, 'tools/html-to-png/node_modules/qrcode'));
  qrPkg.toFile(outQr, appsflyerUrl, {
    width: 600, margin: 2, errorCorrectionLevel: 'M',
    color: { dark: '#0F0F0F', light: '#FFFFFF' },
  }, (err) => {
    if (err) {
      console.error(`[pixsort-creator-page] QR write failed: ${err.message}`);
      process.exit(3);
    }
    console.log(JSON.stringify({
      handle: HANDLE,
      outHtml: path.relative(REPO_ROOT, outHtml),
      outPhoto: path.relative(REPO_ROOT, outPhoto),
      outQr: path.relative(REPO_ROOT, outQr),
      liveUrl: `https://pixsort.app/${HANDLE}/`,
    }));
  });
} catch (e) {
  fail(3, `Cannot load qrcode package (is tools/html-to-png/node_modules/qrcode installed?): ${e.message}`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function fail(code, msg) {
  console.error(`[pixsort-creator-page] error: ${msg}`);
  process.exit(code);
}

function swapCssVar(html, name, value) {
  const re = new RegExp(`(${name.replace(/-/g, '\\-')}\\s*:\\s*)#[0-9A-Fa-f]{3,8}`, 'g');
  return html.replace(re, `$1${value}`);
}

function shade(hex, pct) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const num = parseInt(n, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * pct / 100)));
  const g = Math.max(0, Math.min(255, ((num >> 8)  & 0xff) + Math.round(255 * pct / 100)));
  const b = Math.max(0, Math.min(255, ( num        & 0xff) + Math.round(255 * pct / 100)));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}
function escapeAttr(s) {
  return String(s).replace(/["&<>]/g, c => ({ '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}
