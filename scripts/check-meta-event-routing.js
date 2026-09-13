const fs = require('node:fs');
const path = require('node:path');

// Meta web event collection is intentionally disabled. Keep both JavaScript
// and no-script paths out of deployed pages and affiliate templates.
const root = path.resolve(__dirname, '..');
const forbidden = /2969207136622638|\bfbq\s*\(|connect\.facebook\.net|facebook\.com\/tr(?:[/?"'])/i;
const violations = [];
let checked = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && /\.(?:html?|[cm]?js)$/i.test(entry.name) && file !== __filename) {
      checked += 1;
      if (forbidden.test(fs.readFileSync(file, 'utf8'))) violations.push(path.relative(root, file));
    }
  }
}

walk(root);
if (violations.length) {
  console.error(`Meta event routing must remain disabled: ${violations.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`Meta event routing check passed (${checked} files)`);
}
