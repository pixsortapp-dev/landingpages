const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(entryPath);
    return entry.isFile() && entry.name === 'index.html' ? [entryPath] : [];
  });
}

function appsFlyerUrls(html) {
  const hrefs = [...html.matchAll(/href="(https:\/\/app\.appsflyer\.com\/id6760485464[^"]+)"/g)]
    .map((match) => match[1]);
  const constants = [...html.matchAll(/APP_STORE_URL\s*=\s*'(https:\/\/app\.appsflyer\.com\/id6760485464[^']+)'/g)]
    .map((match) => match[1]);
  return [...hrefs, ...constants].map((value) => new URL(value.replaceAll('&amp;', '&')));
}

const affiliatePages = walk('.')
  .map((file) => ({ file, html: fs.readFileSync(file, 'utf8') }))
  .map((page) => ({ ...page, urls: appsFlyerUrls(page.html) }))
  .filter((page) => page.urls.length > 0);
const trackingAsset = fs.readFileSync(path.join('assets', 'affiliate-tracking.js'), 'utf8');

assert(affiliatePages.length > 0, 'No affiliate landing pages with AppsFlyer CTAs found.');
assert(trackingAsset.includes('pixsort_partner_link_clicked'), 'Affiliate tracking asset must capture partner link opens');
assert(trackingAsset.includes('pixsort_partner_app_store_clicked'), 'Affiliate tracking asset must capture App Store CTA clicks');

for (const page of affiliatePages) {
  const pids = new Set(page.urls.map((url) => url.searchParams.get('pid')));
  assert(pids.size === 1, `${page.file}: multiple AppsFlyer pids found`);
  const [pid] = [...pids];
  assert(pid, `${page.file}: missing pid`);
  assert(page.html.includes('../assets/affiliate-tracking.js'), `${page.file}: missing affiliate tracking script`);
  assert(!page.html.includes('window.location.href = APP_STORE_DIRECT_URL'), `${page.file}: desktop branch bypasses AppsFlyer attribution`);
  assert(!page.html.includes('window.location.href = APP_STORE_URL'), `${page.file}: programmatic App Store redirects must go through redirectToAppStore`);
  assert(!page.html.includes('window.location.href = appsFlyerAppStoreUrl()'), `${page.file}: desktop AppsFlyer redirects must go through redirectToAppStore`);
  if (page.html.includes('APP_STORE_DIRECT_URL')) {
    assert(page.html.includes('function appsFlyerAppStoreUrl()'), `${page.file}: missing desktop AppsFlyer fallback helper`);
    assert(page.html.includes("url.searchParams.set('af_web_dp', APP_STORE_DIRECT_URL)"), `${page.file}: desktop helper must use App Store web fallback`);
    assert(page.html.includes('redirectToAppStore(appsFlyerAppStoreUrl());'), `${page.file}: desktop branch should preserve AppsFlyer params and track redirect clicks`);
  }

  const expectedWebFallback = `https://pixsort.app/${pid}/`;
  for (const url of page.urls) {
    const campaign = url.searchParams.get('c');
    const clickId = url.searchParams.get('af_sub3');
    assert(campaign, `${page.file}: missing campaign`);
    assert(clickId === `pixsort-app-${pid}`, `${page.file}: wrong af_sub3`);
    assert(url.searchParams.get('af_sub1') === pid, `${page.file}: wrong af_sub1`);
    assert(url.searchParams.get('af_sub2') === campaign, `${page.file}: wrong af_sub2`);
    assert(url.searchParams.get('deep_link_value') === 'collab', `${page.file}: wrong deep_link_value`);
    assert(url.searchParams.get('deep_link_sub1') === pid, `${page.file}: wrong deep_link_sub1`);
    assert(url.searchParams.get('deep_link_sub2') === campaign, `${page.file}: wrong deep_link_sub2`);
    assert(url.searchParams.get('deep_link_sub3') === clickId, `${page.file}: wrong deep_link_sub3`);
    assert(url.searchParams.get('af_web_dp') === expectedWebFallback, `${page.file}: wrong af_web_dp`);
    assert(url.searchParams.get('af_ios_url') === 'https://apps.apple.com/us/app/pixsort-ai-photo-organizer/id6760485464', `${page.file}: wrong af_ios_url`);
  }
}

console.log(`affiliate landing page checks passed (${affiliatePages.length} pages)`);
