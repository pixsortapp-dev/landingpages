---
name: pixsort-creator-page
description: Generate a co-branded Pixsort creator/affiliate landing page at pixsort.app/<handle>. Use when a new partner signs up and needs their page auto-generated. Takes a creator brief (name, handle, photo, brand color, AppsFlyer link, quote), forks the canonical template, does all mechanical swaps, generates a QR code, and writes <handle>/index.html + assets/<handle>-qr.png. Backs the signup automation Tiff's dev is building.
---

# Pixsort Creator Landing Page

Generates a partner landing page at `pixsort.app/<handle>` from a structured brief. Backs both interactive use (Claude in the repo) and automated use (dev's signup pipeline calling `generate.js` headlessly).

## When to use

- Tiff (or the auto-signup form) has a new creator/affiliate ready to launch
- The signup collected: name, handle, photo, brand color, AppsFlyer link, optional quote
- Output: `<handle>/index.html` + `assets/<handle>-qr.png` committed to `main`, live at `pixsort.app/<handle>/`

## Input schema

Accept either freeform prompt or a JSON blob matching:

```json
{
  "handle": "meg",
  "displayName": "Meg the Creator",
  "credit": "Founder, Meg the Creator Community · UGC Educator",
  "photo": "/Users/tiffanyparra/Desktop/meg.png",
  "brandColor": "#C1FF72",
  "brandColorDark": "#A6E555",
  "appsflyerUrl": "https://app.appsflyer.com/id6760485464?pid=meg&c=meg-2026-07&...",
  "quote": "It's exactly what UGC creators need. I love it.",
  "headline": {
    "line1": "Your camera roll,",
    "line2Em": "auto-organized",
    "line2Suffix": " for you."
  }
}
```

Required: `handle`, `displayName`, `credit`, `photo`, `brandColor`, `appsflyerUrl`.
Optional: `brandColorDark` (auto-derived if omitted), `quote`, `headline`, `subCopy`, `featureRewrites`.

**Handle rules:** lowercase, kebab-case, matches the URL slug at `pixsort.app/<handle>`. Never uppercase.

## Fork template

Canonical template: **`tran/index.html`** (has walkthrough-embed iframe + product bumper + full section rhythm). Update this pointer if a newer partner page becomes the reference.

Steps:
1. `cp tran/index.html <handle>/index.html`
2. `cp -r <partner-photo> assets/<handle>.jpg` (convert webp→jpg via `sips` on macOS if needed)
3. Generate `assets/<handle>-qr.png` from the AppsFlyer URL (see QR section)

## Mechanical swaps

Global find/replace in `<handle>/index.html`:

| Find | Replace |
|------|---------|
| `assets/tran.jpg` | `assets/<handle>.jpg` |
| `assets/tran-qr.png` | `assets/<handle>-qr.png` |
| `source: 'tran'` | `source: '<handle>'` |
| `pixsort.app/tran` | `pixsort.app/<handle>` |
| all `https://app.appsflyer.com/id6760485464?pid=tran&...` URLs | new `<appsflyerUrl>` |

**All AppsFlyer URLs in the file (there are 3-5):** replace each with the exact partner link from Spencer. Do not template-fill; use the full URL Spencer generated so his tracking works verbatim.

CSS palette (in `:root`):
- `--lime: <brandColor>`
- `--limedark: <brandColorDark>` (auto-derive if omitted: shift 10-15% darker)

Partner-specific copy blocks (edit by hand or from input):
- Hero photo caption: `<displayName> · <credit>`
- Collab mark: `<displayName>` (line before "PixSort")
- Testimonial quote card (bottom of page): `<quote>` if provided, else use a placeholder or hide the section
- FAQ answer for "How do I get the discount?": uses `<displayName>`
- Modal title + subtitle: uses `<displayName>`
- Meta tags: `<title>`, `og:title`, `og:url`, `twitter:title` — all use `<displayName>` + `<handle>`
- Headline (h1): if `headline` provided, use it. Default: "Your camera roll, / *auto-organized* for you."

## QR code generation

The AppsFlyer URL is encoded as a QR displayed in the lime discount banner. Use the `qrcode` npm package already installed in `tools/html-to-png/node_modules/`:

```js
const qr = require('/absolute/path/to/tools/html-to-png/node_modules/qrcode');
qr.toFile('assets/<handle>-qr.png', '<appsflyerUrl>', {
  width: 600, margin: 2, errorCorrectionLevel: 'M',
  color: { dark: '#0F0F0F', light: '#FFFFFF' }
});
```

Displays at 200x200 in the banner, hidden on `<760px` viewports.

## Copy rules (locked)

- **No em dashes anywhere** — use commas, en dashes, or restructure
- **Brand spelling in code/copy:** the current partner pages use "PixSort" (camelcase). If unsure, match the surrounding page.
- **SMS opt-in disclosure required** below each phone form (already in template)
- **Do NOT promise to text the discount.** Success copy says "Locked to your number" not "we'll text you the code."
- **Microcopy under form:** `iOS · 100 photos free · <partner>'s link`

## Photo handling

- Preferred format: JPG, portrait orientation, ~1000×1400 or larger
- If input is WebP or PNG, convert via `sips -s format jpeg <in> --out assets/<handle>.jpg`
- The hero photo container is 3:4 aspect ratio with `object-fit: cover` — full-body shots will be cropped or feel small. Half-body / above-waist portraits fit best.

## Verification workflow (interactive mode)

Before pushing, verify locally:

1. Start the local preview server (Node one-liner at port 3458 works)
2. Navigate to `/<handle>/`
3. Confirm: hero renders, photo loads, headline reads correctly, walkthrough iframe loads, all AppsFlyer buttons href to the correct URL, QR image loads
4. Only then commit + push

## Commit + push

```
git add <handle>/ assets/<handle>.jpg assets/<handle>-qr.png
git commit -m "Add /<handle> landing page for <displayName>

<one-line context: partner + audience>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin <branch>:main
```

Live in ~60 seconds at https://pixsort.app/<handle>/ after GitHub Pages deploys.

## Headless mode (for dev's signup automation)

The dev pipeline should call `generate.js` in this directory with a JSON blob on stdin or `--input <file>`:

```
node .claude/skills/pixsort-creator-page/generate.js --input creator.json
```

Output: writes files, prints paths to stdout, exits 0 on success. Non-zero on validation failure. Does NOT commit or push — that's the caller's job (so the dev can wire in review/approval before deploy).

See `generate.js` for the exact schema + error contract.

## When something's missing

If the signup form didn't collect a field:
- **Photo:** ask Tiff to drop it in `~/Desktop/<handle>.png` or similar, then retry
- **AppsFlyer URL:** flag to Spencer (he generates one per partner) — do NOT invent a URL
- **Quote:** skip the spotlight section or use a placeholder; Tiff will fill it after the partner sends one
- **Brand color:** default to Pixsort's champagne yellow `#FFE89A` and note in the commit that the partner should confirm

## Per-partner reference table

Track what's been shipped so the pattern stays consistent:

| Handle | Display | Brand color | Audience |
|--------|---------|-------------|----------|
| adley | Adley Kinsman | #E5FF76 (lime) | Viralish, general creators |
| jake | Jake Peters | (as-is) | fitness |
| reid | Reid | (as-is) | general |
| jennifer | Jennifer (gymwithnefurjen) | (as-is) | petite fitness moms |
| adley-v2 | Adley (no-phone variant) | #E5FF76 | A/B test |
| laura | Laura | #FFB7D5 (pink) | family photo/scrapbook |
| tran | Tran | #FFE89A (champagne) | UGC creators (500+ brands) |
| meg | Meg the Creator | #C1FF72 (lime) | mom UGC creators |

## Related files

- Canonical template: `tran/index.html`
- Walkthrough embed (iframed on partner pages): `walkthrough-embed.html`
- Homepage (kept in sync with walkthrough): `index.html`
- Local QR generator: `tools/html-to-png/node_modules/qrcode`
- HTML preview tool: `tools/html-to-png/index.js`
