#!/usr/bin/env node
/**
 * Fork (sako4018): pre-fetch every RSS feed of the browser catalog into static files, so the site
 * works on GitHub Pages (no /api/rss-proxy there). Run after `vite build`:
 *
 *   node --import tsx scripts/fork-fetch-static-rss.mjs --out dist/rss
 *
 * Output: <out>/<staticRssKey(url)>.xml (trimmed to the newest MAX_ITEMS entries) and <out>/manifest.json.
 * Feeds that fail are simply missing; the app shows an empty source for them.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BROWSER_NEWS_CATALOG } from '../src/config/news-catalog.browser.generated.ts';
import { staticRssKey } from '../src/utils/static-rss.ts';

const MAX_ITEMS = 12;          // the app shows 5 per feed; spare ones cover filtering
const CONCURRENCY = 16;
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 2_000_000;
const UA = 'Mozilla/5.0 (compatible; WorldMonitorFork/1.0; +https://github.com/sako4018/worldmonitor)';

const outIndex = process.argv.indexOf('--out');
const outDir = resolve(outIndex > 0 ? process.argv[outIndex + 1] : 'public/rss');

function collectUrls() {
  const urls = new Set();
  const add = (u) => {
    if (typeof u === 'string') { if (/^https?:\/\//.test(u)) urls.add(u); return; }
    if (u && typeof u === 'object') Object.values(u).forEach(add);
  };
  for (const category of Object.values(BROWSER_NEWS_CATALOG.editions.full)) {
    for (const feed of category) add(feed.url);
  }
  for (const feed of BROWSER_NEWS_CATALOG.intel) add(feed.url);
  return [...urls];
}

/** Keep the first `max` items (RSS/RDF) or entries (Atom) and close the document again. */
export function trimFeed(xml, max = MAX_ITEMS) {
  const isRdf = /<rdf:RDF[\s>]/i.test(xml);
  const tag = /<item[\s>]/i.test(xml) ? 'item' : /<entry[\s>]/i.test(xml) ? 'entry' : null;
  if (!tag) return xml;
  const re = new RegExp(`<${tag}[\\s>]`, 'gi');
  let count = 0;
  let cut = -1;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    count += 1;
    if (count === max + 1) { cut = m.index; break; }
  }
  if (cut < 0) return xml;
  const tail = isRdf ? '</rdf:RDF>' : tag === 'entry' ? '</feed>' : '</channel></rss>';
  return xml.slice(0, cut) + tail;
}

async function fetchOne(url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_BYTES * 4) throw new Error('too large');
      if (!/<(rss|feed|rdf:RDF|channel)[\s>]/i.test(text)) throw new Error('not a feed');
      return trimFeed(text);
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  return null;
}

async function main() {
  const urls = collectUrls();
  mkdirSync(outDir, { recursive: true });
  const failed = [];
  let ok = 0;
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        const xml = await fetchOne(url);
        if (Buffer.byteLength(xml) > MAX_BYTES) throw new Error('trimmed feed still too large');
        writeFileSync(join(outDir, `${staticRssKey(url)}.xml`), xml, 'utf8');
        ok += 1;
      } catch (error) {
        failed.push({ url, error: String(error?.message ?? error).slice(0, 80) });
      }
    }
  }));
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), total: urls.length, ok, failed }, null, 1));
  console.log(`static rss: ${ok}/${urls.length} feeds written to ${outDir}; ${failed.length} failed`);
}

main().catch((error) => { console.error(error); process.exit(1); });
