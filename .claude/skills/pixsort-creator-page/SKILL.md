---
name: pixsort-creator-page
description: Generate a co-branded Pixsort creator/affiliate landing page at pixsort.app/<handle>. Use when a new partner signs up and needs their page auto-generated. Freezes meg/ as the canonical template — only 7 fields vary per creator (handle, displayName, role, creditLine, photo, brandColor, appsflyerUrl, quote). Everything else is baked into the template.
---

# Pixsort Creator Landing Page — Template Generator

Meg's page is the frozen canonical template. Every other creator page is Meg's page with 7 fields swapped in. No copy customization inputs. No headline overrides. Nothing else is "an input" — everything else is a constant baked into the template.

## When to use

- A new creator/affiliate signs up (via form or manually)
- The signup collected the 7 required fields
- Output: `<handle>/index.html` + `assets/<handle>.jpg` + `assets/<handle>-qr.png` on disk, ready to commit
- Live at `pixsort.app/<handle>/` once pushed

## Input schema (only 7 required)

```json
{
  "handle": "sarah",
  "displayName": "Sarah",
  "role": "Founder, SarahBrand",
  "creditLine": "Fitness coach · content creator · mom",
  "photo": "/absolute/path/to/sarah.jpg",
  "brandColor": "#FF88AA",
  "appsflyerUrl": "https://app.appsflyer.com/id6760485464?pid=sarah&c=sarah-2026-07&...",
  "quote": "PixSort made every clip findable overnight. Love it."
}
```

Optional: `brandColorDark` (auto-derived 12% darker from `brandColor` if omitted).

**Field usage in the template:**

| Field | Used in |
|-------|---------|
| `handle` | URL slug: `pixsort.app/<handle>/`; asset paths: `assets/<handle>.jpg`, `assets/<handle>-qr.png` |
| `displayName` | Collab mark ("X × PixSort"), hero photo caption, "X's link" microcopy (both instances), FAQ answers, spotlight section label ("Why X uses PixSort"), quote attribution, meta tags |
| `role` | Hero photo caption (bolded subtitle after name), quote attribution |
| `creditLine` | Hero photo caption (credit-class line under name), quote attribution |
| `photo` | Copied to `assets/<handle>.jpg` (converted from webp/png via `sips` on macOS) |
| `brandColor` | `--lime` CSS variable (highlighter, buttons, etc.) |
| `brandColorDark` | `--limedark` CSS variable (hover states). Auto-derived if omitted. |
| `appsflyerUrl` | Replaces all 5 AppsFlyer URLs in the file + encoded as QR |
| `quote` | Testimonial text in the spotlight quote card |

## Everything that stays frozen

Do NOT accept inputs for any of these. They come from `meg/index.html` verbatim:

- Headline: **"Your camera roll, / *auto-organized* for you."**
- Sub-copy: "100 photos sorted, on us."
- Product bumper: "What is PixSort? / The iPhone app that sorts your photos and videos into *smart albums.*"
- Discount banner explainer copy
- Walkthrough embed (iframed `/walkthrough-embed.html`, same for everyone)
- Screen-by-screen breakdown (rendered by the embed)
- FAQ questions and all FAQ answers except where `<displayName>'s link` gets swapped in
- All CSS structure (only the palette varies)
- All section rhythm, spacing, layout, animations
- Footer, nav, modal structure

Only two content transforms are automatic beyond the field substitutions:
1. Meta title: `<displayName> × PixSort: 100 Photos Sorted Free`
2. Section label: `Why <displayName> uses PixSort`

## Two entry points

**Interactive (Claude in the repo):** Invoke this skill via `/pixsort-creator-page`, provide the 7 fields (freeform prompt or JSON). Claude runs `generate.js`, verifies the output, and either commits + pushes or hands the diff back for review.

**Headless (dev's signup pipeline):**
```
node .claude/skills/pixsort-creator-page/generate.js --input creator.json
```
Reads JSON from `--input <file>` or stdin. Writes files. Prints structured JSON to stdout on success. Exits non-zero on validation error. Does NOT commit or push — caller wires in review + deploy.

## Photo handling

- Preferred format: JPG, portrait orientation, roughly ~1000×1400 (3:4 aspect)
- WebP/PNG input auto-converts via `sips -s format jpeg <in> --out assets/<handle>.jpg`
- The hero photo container is 3:4 aspect ratio with `object-fit: cover` — headshots and above-waist portraits fit best. Full-body shots crop to torso.

## QR generation

Uses `qrcode` npm package pre-installed at `tools/html-to-png/node_modules/qrcode`. QR encodes the exact AppsFlyer URL. Displays at 200×200 in the discount banner, hidden on `<760px` viewports.

Config:
```
width: 600, margin: 2, errorCorrectionLevel: 'M'
color: { dark: '#0F0F0F', light: '#FFFFFF' }
```

## Copy rules (locked, don't override)

- **No em dashes anywhere** in any generated string
- **Brand spelling:** the current partner pages use "PixSort" (camelcase). Match the template — don't invent a different spelling
- **SMS copy:** the template has no phone capture (like Meg's page); do not add it back
- **Never promise to text the discount.** Meta description says "Get 100 photos sorted free with X's Pixsort link." — no SMS references.

## Verification workflow (interactive mode only)

Before pushing, verify locally:
1. Start the local preview server (Node one-liner at port 3458)
2. Navigate to `/<handle>/`
3. Confirm: hero renders, photo loads, headline reads correctly, walkthrough iframe loads, all Download Now buttons href to the AppsFlyer URL, QR image loads
4. Only then commit + push

## Commit + push (interactive mode)

```
git add <handle>/ assets/<handle>.jpg assets/<handle>-qr.png
git commit -m "Add /<handle> landing page for <displayName>"
git push origin <branch>:main
```

Live in ~60s at `https://pixsort.app/<handle>/`.

## When something's missing at signup

- **Photo:** ask for a save-to path or reject the generation
- **AppsFlyer URL:** flag to Spencer (he generates one per partner). Never invent a URL — the QR + attribution will be wrong.
- **Quote:** if genuinely blank, either skip generation (best) or fill placeholder and mark for follow-up
- **Brand color:** default to Meg's `#C1FF72` and note in commit message that color needs partner confirmation

## Per-partner reference

Track shipped partners to keep pattern consistent:

| Handle | Display | Brand color | Audience |
|--------|---------|-------------|----------|
| meg | Meg | #C1FF72 | mom UGC creators (CANONICAL TEMPLATE) |
| tran | Tran | #FFE89A | UGC creators (500+ brands) — pre-freeze |
| laura | Laura | #FFB7D5 | family photo/scrapbook — pre-freeze |
| adley | Adley Kinsman | #E5FF76 | Viralish, general creators — pre-freeze |

## Related files

- **Canonical template:** `meg/index.html` (freeze point as of 2026-07-06)
- Walkthrough embed: `walkthrough-embed.html` (iframed on partner pages, kept in sync with homepage)
- Homepage: `index.html` (sort → albums → push → real iPhone Photos)
- QR generator: `tools/html-to-png/node_modules/qrcode`
- Headless CLI: `.claude/skills/pixsort-creator-page/generate.js`
