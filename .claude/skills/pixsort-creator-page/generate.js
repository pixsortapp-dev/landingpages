#!/usr/bin/env node
/**
 * pixsort-creator-page — headless generator
 *
 * Reads a creator brief (JSON), forks tran/index.html, does mechanical swaps,
 * generates the AppsFlyer QR, and writes:
 *   <handle>/index.html
 *   assets/<handle>.jpg  (if photo path provided)
 *   assets/<handle>-qr.png
 *
 * Usage:
 *   node generate.js --input creator.json
 *   node generate.js < creator.json               # or pipe on stdin
 *   node generate.js --input creator.json --template adley-v2/index.html
 *   node generate.js --input creator.json --dry-run       # skip writes
 *
 * Exit codes:
 *   0  success (writes complete)
 *   1  validation failure (missing required field, bad handle, etc.)
 *   2  template or asset read error
 *   3  QR generation error
 *   4  file write error
 *
 * Does NOT commit or push. Caller wires in review / approval / deploy.
 *
 * Repo-relative paths throughout — run from the repo root
 * (pixsortapp-dev/landingpages).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── CLI ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
}
const inputPath = arg('--input');
const templatePath = arg('--template', 'tran/index.html');
const dryRun = argv.includes('--dry-run');

// ─── Repo root check ────────────────────────────────────────────────────────
const REPO_ROOT = process.cwd();
if (!fs.existsSync(path.join(REPO_ROOT, templatePath))) {
  fail(2, `Template not found at ${templatePath} — run from the repo root.`);
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
const required = ['handle', 'displayName', 'credit', 'photo', 'brandColor', 'appsflyerUrl'];
const missing = required.filter(k => !brief[k]);
if (missing.length) fail(1, `Missing required fields: ${missing.join(', ')}`);

const HANDLE = brief.handle.toLowerCase().trim();
if (!/^[a-z0-9-]+$/.test(HANDLE)) {
  fail(1, `Bad handle "${HANDLE}" — must be lowercase kebab-case (a-z, 0-9, hyphens).`);
}

const {
  displayName, credit, photo, brandColor, appsflyerUrl, quote
} = brief;

const brandColorDark = brief.brandColorDark || shade(brandColor, -12);

const headline = brief.headline || {
  line1: 'Your camera roll,',
  line2Prefix: '',
  line2Em: 'auto-organized',
  line2Suffix: ' for you.',
};

const subCopy = brief.subCopy || '100 photos sorted, on us.';

// ─── Output paths ───────────────────────────────────────────────────────────
const outDir = path.join(REPO_ROOT, HANDLE);
const outHtml = path.join(outDir, 'index.html');
const outPhoto = path.join(REPO_ROOT, 'assets', `${HANDLE}.jpg`);
const outQr = path.join(REPO_ROOT, 'assets', `${HANDLE}-qr.png`);

console.error(`[pixsort-creator-page] handle=${HANDLE} → ${outHtml}`);

// ─── Read + transform template ──────────────────────────────────────────────
let html;
try { html = fs.readFileSync(path.join(REPO_ROOT, templatePath), 'utf8'); }
catch (e) { fail(2, `Cannot read template ${templatePath}: ${e.message}`); }

// Infer the template's own handle from the path so we can swap it.
// e.g. 'tran/index.html' → 'tran'
const templateHandle = path.dirname(templatePath).split('/').pop();

// Global asset + slug swaps
html = html
  .replaceAll(`assets/${templateHandle}.jpg`, `assets/${HANDLE}.jpg`)
  .replaceAll(`assets/${templateHandle}-qr.png`, `assets/${HANDLE}-qr.png`)
  .replaceAll(`source: '${templateHandle}'`, `source: '${HANDLE}'`)
  .replaceAll(`pixsort.app/${templateHandle}`, `pixsort.app/${HANDLE}`);

// AppsFlyer URLs — replace EVERY absolute AppsFlyer link in the file
html = html.replace(
  /https:\/\/app\.appsflyer\.com\/id6760485464\?[^"'\s<>]+/g,
  appsflyerUrl
);

// CSS palette swap in :root
html = swapCssVar(html, '--lime', brandColor);
html = swapCssVar(html, '--limedark', brandColorDark);

// Headline (h1 lines) — swap the two `.h1-line` spans inside the first <h1>
html = html.replace(
  /(<h1[^>]*>\s*)<span class="h1-line">[^<]*<\/span>\s*<span class="h1-line">[^]*?<\/span>(\s*<\/h1>)/,
  (_m, open, close) =>
    `${open}<span class="h1-line">${escapeHtml(headline.line1)}</span>\n` +
    `      <span class="h1-line">${escapeHtml(headline.line2Prefix || '')}<em>${escapeHtml(headline.line2Em)}</em>${escapeHtml(headline.line2Suffix || '')}</span>${close}`
);

// Sub-copy under headline
html = html.replace(
  /(<p class="hero-discount-line">\s*<span>)[^<]*(<\/span>)/,
  `$1${escapeHtml(subCopy)}$2`
);

// Meta tags — <title>, og:title, og:url, twitter:title
html = html
  .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(displayName)} × PixSort · 100 Photos Sorted Free</title>`)
  .replace(/(og:title" content=")[^"]*/,        `$1${escapeAttr(displayName)} × PixSort · 100 Photos Sorted Free`)
  .replace(/(og:url" content=")[^"]*/,          `$1https://pixsort.app/${HANDLE}/`)
  .replace(/(twitter:title" content=")[^"]*/,   `$1${escapeAttr(displayName)} × PixSort · 100 Photos Sorted Free`)
  .replace(/(og:description" content=")[^"]*/,  `$1Get 100 photos sorted free with ${escapeAttr(displayName)}'s Pixsort link.`)
  .replace(/(twitter:description" content=")[^"]*/, `$1Get 100 photos sorted free with ${escapeAttr(displayName)}'s Pixsort link.`);

// Collab mark — the "Partner × PixSort" first span
html = html.replace(
  /(<div class="collab-mark">\s*<span>)[^<]+(<\/span>)/,
  `$1${escapeHtml(displayName)}$2`
);

// Hero photo caption + credit
html = html.replace(
  /(<div class="hero-photo-caption">\s*<span>)[^<]+(<\/span>[^<]*<span class="credit">)[^<]+(<\/span>)/,
  `$1${escapeHtml(displayName)}$2${escapeHtml(credit)}$3`
);

// Testimonial quote (if provided) — else leave template default
if (quote) {
  html = html.replace(
    /(<div class="quote-card"[^>]*>\s*<p[^>]*>)[^]*?(<\/p>)/,
    `$1"${escapeHtml(quote)}"$2`
  );
}

// FAQ answer for "How do I get the discount?" — uses partner name
html = html.replace(
  /(Your 100-photo unlock is locked to your number by )[A-Za-z ]+('s link)/,
  `$1${escapeHtml(displayName)}$2`
);

// Modal title + subtitle — uses partner name
html = html.replace(
  /(Get 100 photos sorted free with )[A-Za-z ]+('s link)/g,
  `$1${escapeHtml(displayName)}$2`
);

// Microcopy under form: "iOS · 100 photos free · <partner>'s link"
html = html.replace(
  /(<div class="microcopy">[^<]*<span>iOS<\/span>[^<]*<span>100 photos free<\/span>[^<]*<span>)[^<]+(<\/span>)/g,
  `$1${escapeHtml(displayName)}'s link$2`
);

// ─── Write files ────────────────────────────────────────────────────────────
if (dryRun) {
  console.error('[pixsort-creator-page] --dry-run: skipping writes');
  console.log(JSON.stringify({ handle: HANDLE, outHtml, outPhoto, outQr, dryRun: true }));
  process.exit(0);
}

// Ensure dirs
try {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(REPO_ROOT, 'assets'), { recursive: true });
} catch (e) {
  fail(4, `Cannot create output dir: ${e.message}`);
}

// Write HTML
try { fs.writeFileSync(outHtml, html); }
catch (e) { fail(4, `Cannot write ${outHtml}: ${e.message}`); }

// Copy / convert photo
if (photo && fs.existsSync(photo)) {
  const ext = path.extname(photo).toLowerCase();
  try {
    if (ext === '.webp' || ext === '.png') {
      // Convert via macOS sips (portable enough for this pipeline)
      execSync(`sips -s format jpeg "${photo}" --out "${outPhoto}"`, { stdio: 'ignore' });
    } else {
      fs.copyFileSync(photo, outPhoto);
    }
  } catch (e) {
    fail(4, `Cannot process photo ${photo}: ${e.message}`);
  }
} else {
  console.error(`[pixsort-creator-page] warning: photo not found at ${photo} — page will 404 on hero image until you drop it in ${outPhoto}`);
}

// Generate QR
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
    // Print structured result on stdout for the calling pipeline
    console.log(JSON.stringify({
      handle: HANDLE,
      outHtml: path.relative(REPO_ROOT, outHtml),
      outPhoto: path.relative(REPO_ROOT, outPhoto),
      outQr: path.relative(REPO_ROOT, outQr),
      liveUrl: `https://pixsort.app/${HANDLE}/`,
    }));
  });
} catch (e) {
  fail(3, `Cannot load qrcode package — is tools/html-to-png/node_modules/qrcode installed? (${e.message})`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function fail(code, msg) {
  console.error(`[pixsort-creator-page] error: ${msg}`);
  process.exit(code);
}

function swapCssVar(html, name, value) {
  const re = new RegExp(`(${name.replace(/[-]/g, '\\-')}\\s*:\\s*)#[0-9A-Fa-f]{3,8}`, 'g');
  return html.replace(re, `$1${value}`);
}

function shade(hex, pct) {
  const h = hex.replace('#', '');
  const n = h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h;
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
