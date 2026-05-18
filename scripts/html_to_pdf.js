// Render an HTML file to PDF via Playwright.
// Usage: node scripts/html_to_pdf.js <inputHtmlPath> <outputPdfPath>

const { chromium } = require('playwright');
const path = require('path');

async function main() {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input || !output) {
    console.error('usage: node scripts/html_to_pdf.js <inputHtmlPath> <outputPdfPath>');
    process.exit(2);
  }
  const absIn = path.resolve(input);
  const absOut = path.resolve(output);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1024, height: 1400 } });
  const page = await context.newPage();
  await page.goto('file://' + absIn, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'screen' });
  await page.pdf({
    path: absOut,
    format: 'Letter',
    printBackground: true,
    margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
  });
  await browser.close();
  console.log('wrote:', absOut);
}

main().catch((e) => { console.error(e); process.exit(1); });
